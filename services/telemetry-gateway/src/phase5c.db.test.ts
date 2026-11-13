// Phase 5c against the database: when a letter sheet is stored, the system's suggested marks are
// stored with it (rows 1–2 decided, row 3 left to the evaluator with the similarity hint); the
// evaluator sets, changes and clears marks; every change is logged with the old and new value.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import { synthBlock, type LetterSpec } from '@ilt/ilt-metrics';
import { controlMessage, type ControlEnvelope, type PenSample } from '@ilt/shared-types';
import type { CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import { buildApp } from './app.js';
import { Client, isEvent } from './ws-client.test-support.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const LETTER = JSON.parse(readFileSync(new URL('../../../Documents/05_Measures/Intervention_Letters/LETTER_HE_HE.json', import.meta.url), 'utf8')) as {
  geometry: CanvasGeometry; profile: ScoringProfile;
};

describe.skipIf(!DB_URL)('Phase 5c intervention marks against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  const run = randomUUID().slice(0, 8);
  const users = {
    evaluator: { email: `phase5c-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'EVALUATOR', token: '' },
    other: { email: `phase5c-other-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'EVALUATOR', token: '' },
    admin: { email: `phase5c-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'ADMIN', token: '' },
    director: { email: `phase5c-dir-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'RESEARCHER', token: '' },
  };
  const directorPin = String(100000 + Math.floor(Math.random() * 899999));
  const code = `T5C_${run}`.toUpperCase();

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const sha = (samples: PenSample[]) => createHash('sha256').update(encodeSampleRecords(samples)).digest('hex');

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase5c-test', schoolHmacKey: 'phase5c-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    for (const u of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id, director_pin_hash)
         VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL'), $5)`,
        [u.email, await hash(u.password), `Phase 5c test ${u.role}`, u.role, u.role === 'RESEARCHER' ? await hash(directorPin) : null],
      );
      u.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).body.access_token;
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [Object.values(users).map((u) => u.email)]);
    await pool.end();
  });

  it('tells the tablet when a real pairing code has expired (QA Take#2 suggestion)', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const p = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST5CP-${run}`, domain_id: domainId, school: 'Phase 5c School', birth_year_month: '2018-09', grade_level: 'GRADE_1', gender: 'MALE', dominant_hand: 'RIGHT' },
    });
    const s = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: p.body.id, session_type: 'DAY_14', language_code: 'he' } });
    const { body: room } = await call<{ pin: string }>(`/sessions/${s.body.id}/pairing`, { method: 'POST', auth: token });
    await pool.query("UPDATE sessions SET pairing_expires_at = now() - interval '1 minute' WHERE id = $1", [s.body.id]);
    const pair = (pin: string) => call<{ status: string; error: { code: string; message_key: string } }>('/sessions/pair', {
      method: 'POST', body: { pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 },
    });
    const expired = await pair(room.pin);
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ status: 'REJECTED', error: { code: 'PIN_EXPIRED', message_key: 'kiosk.pin_expired' } });
    const wrong = await pair(room.pin === '000000' ? '000001' : '000000');
    expect(wrong.body.error).toMatchObject({ code: 'BAD_PIN', message_key: 'kiosk.pin_wrong' });
    // A new code replaces the old one: the old code is then simply wrong.
    const { body: fresh } = await call<{ pin: string }>(`/sessions/${s.body.id}/pairing`, { method: 'POST', auth: token });
    if (fresh.pin !== room.pin) expect((await pair(room.pin)).body.error.code).toBe('BAD_PIN');
    await app.appLog.flush();
    const reasons = (await pool.query(
      "SELECT details->>'reason' AS reason FROM app_events WHERE event_type = 'auth.login.failed' AND details->>'reason' LIKE 'PAIRING_PIN%' ORDER BY id DESC LIMIT 3",
    )).rows.map((r) => r.reason);
    expect(reasons).toContain('PAIRING_PIN_EXPIRED');
  });

  it('stores the suggested marks of a sheet and lets the evaluator confirm or change them', async () => {
    const admin = users.admin.token;
    const token = users.evaluator.token;
    const set = await call<{ id: string }>('/canvas-sets', { method: 'POST', auth: admin, body: { language_code: 'he', set_type: 'INTERVENTION_LETTERS', name_he: 'בדיקה', name_en: `Letters 5c ${run}` } });
    const canvas = await call<{ id: string }>('/canvases', {
      method: 'POST', auth: admin, body: { canvas_set_id: set.body.id, code, name_he: 'האות ה', name_en: 'The letter He', geometry: LETTER.geometry, profile: LETTER.profile },
    });
    expect((await call(`/canvases/${canvas.body.id}/activate`, { method: 'POST', auth: admin, body: { director_email: users.director.email, director_pin: directorPin } })).status).toBe(200);
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST5C-${run}`, domain_id: domainId, school: 'Phase 5c School', birth_year_month: '2018-09', grade_level: 'GRADE_1', gender: 'MALE', dominant_hand: 'RIGHT' },
    });
    const session = await call<{ id: string }>('/sessions', {
      method: 'POST', auth: token,
      body: { participant_id: participant.body.id, session_type: 'INTERVENTION', language_code: 'he', letter_canvas_id: canvas.body.id, intervention_kind: 'TRAINING' },
    });
    expect(session.status).toBe(201);
    const sessionId = session.body.id;
    // Phase 5d: a Normal speed of 20 mm/s for the sheets (the team records one per letter), so the composite exists.
    await pool.query(
      `UPDATE session_steps SET canvas_profile_snapshot = jsonb_set(canvas_profile_snapshot, '{normal_speed_mm_s}', '20')
        WHERE session_id = $1 AND step_type = 'INTERVENTION_SHEET'`, [sessionId]);

    // ---- The tablet writes the whole sheet like the model, except box 3 (row 1) moved off its dots.
    const { body: room } = await call<{ pin: string }>(`/sessions/${sessionId}/pairing`, { method: 'POST', auth: token });
    const paired = await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: sessionId });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 1, step_type: 'INTERVENTION_SHEET', attempt_number: 1 }));
    const d = (await tablet.next(isEvent('DISPATCH_STEP'))).payload as { attempt_number: number; canvas: CanvasGeometry; fill_order: number[] };
    await cockpit.next(isEvent('DISPATCH_STEP'));
    tablet.send(controlMessage('STEP_STARTED', { step_index: 1, attempt_number: d.attempt_number, block_started_at: new Date().toISOString() }));
    const model = (id: number): LetterSpec => {
      const cell = d.canvas.letters.find((l) => l.box_id === id)!;
      const dx = id === 3 ? 6 : 0;
      return { strokes: cell.model_strokes.map((s) => s.map(([x, y]) => [x + dx, y] as [number, number])) };
    };
    const samples = synthBlock(d.fill_order.map((id) => ({ box: d.canvas.boxes.find((b) => b.id === id)!, spec: model(id) })));
    for (let sequence = 0; sequence * 500 < samples.length; sequence++) {
      const part = samples.slice(sequence * 500, (sequence + 1) * 500);
      tablet.ws.send(encodePacket({ packet_type: PacketType.BATCH, session_id: sessionId, step_index: 1, attempt_number: d.attempt_number, sequence, samples: part }));
      await tablet.next(isEvent('BATCH_ACK'));
    }
    tablet.send(controlMessage('BLOCK_COMPLETE', {
      step_index: 1, attempt_number: d.attempt_number, end_reason: 'LAST_BOX', sample_count: samples.length, last_sample_seq: samples.length - 1, sha256: sha(samples),
    }));
    await cockpit.next(isEvent('BLOCK_STORED'));
    const scored = (await cockpit.next(isEvent('BLOCK_SCORED'), 10_000)).payload as {
      block_attempt_id: string; score_version: number | null; scores: { pen_lifts: number; accuracy_score: number | null; composite_score: number | null; pen_lift_score: number | null };
    };
    expect(scored.scores.pen_lifts).toBe(30);
    // Phase 5d: row 3 is open, so the sheet has no score version yet; its pen-lift score is known.
    expect(scored).toMatchObject({ score_version: null, scores: { accuracy_score: null, composite_score: null, pen_lift_score: 100 } });
    tablet.ws.close();
    cockpit.ws.close();
    const attemptId = scored.block_attempt_id;

    // ---- The suggestions: rows 1–2 decided by the system (box 3 ✗), row 3 open with its hint.
    type Mark = { box_id: number; row_type: string; letter: string; auto_error: boolean | null; start_point_ok: boolean | null;
      evaluator_error: boolean | null; final_error: boolean | null; decided_by: string | null; decided_by_name: string | null; similarity_hint: number | null;
      internal_pen_lifts: number | null; lifts_allowed: number | null };
    type Score = { score_version: number | null; open_marks: number; accuracy_score: number | null; pen_lift_score: number | null;
      speed_score: number | null; composite_score: number | null; pass: boolean | null };
    type Marks = { block_attempt_id: string; step_index: number; marks: Mark[]; score: Score };
    const got = (await call<Marks>(`/block-attempts/${attemptId}/intervention-marks`, { auth: token })).body;
    expect(got).toMatchObject({ block_attempt_id: attemptId, step_index: 1 });
    expect(got.marks.map((m) => m.box_id)).toEqual(LETTER.profile.fill_order);
    const byBox = (marks: Mark[], id: number) => marks.find((m) => m.box_id === id)!;
    expect(byBox(got.marks, 4)).toMatchObject({ row_type: 'TRACE_MODEL', letter: 'ה', auto_error: false, final_error: false, decided_by: 'SYSTEM' });
    // Row 1 keeps its lift count and allowance (QA Take#1, M2); other rows have none.
    expect(byBox(got.marks, 4)).toMatchObject({ internal_pen_lifts: 1, lifts_allowed: 1 });
    expect(byBox(got.marks, 9)).toMatchObject({ internal_pen_lifts: null, lifts_allowed: null });
    expect(byBox(got.marks, 3)).toMatchObject({ auto_error: true, final_error: true, decided_by: 'SYSTEM' });
    expect(got.score).toMatchObject({ score_version: null, open_marks: 5 });
    expect(byBox(got.marks, 9)).toMatchObject({ row_type: 'START_DOT', start_point_ok: true, final_error: false });
    for (const id of [10, 11, 12, 13, 14]) {
      expect(byBox(got.marks, id)).toMatchObject({ row_type: 'FREEHAND', auto_error: null, final_error: null, decided_by: null });
      expect(byBox(got.marks, id).similarity_hint).toBeGreaterThan(90);
    }

    // ---- The evaluator sets row 3, disagrees with box 3 and with box 9's form.
    const put = (marks: { box_id: number; error: boolean | null }[], auth = token) =>
      call<Marks>(`/block-attempts/${attemptId}/intervention-marks`, { method: 'PUT', auth, body: { marks } });
    const set1 = await put([10, 11, 12, 13].map((id) => ({ box_id: id, error: false })).concat({ box_id: 14, error: true }, { box_id: 3, error: false }, { box_id: 9, error: true }));
    expect(set1.status).toBe(200);
    expect(byBox(set1.body.marks, 3)).toMatchObject({ auto_error: true, evaluator_error: false, final_error: false, decided_by: 'EVALUATOR', decided_by_name: 'Phase 5c test EVALUATOR' });
    expect(byBox(set1.body.marks, 14)).toMatchObject({ final_error: true, decided_by: 'EVALUATOR' });
    expect(set1.body.marks.filter((m) => m.final_error === null)).toHaveLength(0);
    // Phase 5d: every mark set, so the sheet is scored: 13 of 15 correct; pen lifts 30 of 30; speed in range.
    expect(set1.body.score).toMatchObject({ score_version: 1, open_marks: 0, accuracy_score: 86.67, pen_lift_score: 100, speed_score: 100, composite_score: 96.67 });
    // Clearing the evaluator's value returns box 3 to the system's suggestion.
    const cleared = await put([{ box_id: 3, error: null }]);
    expect(byBox(cleared.body.marks, 3)).toMatchObject({ evaluator_error: null, final_error: true, decided_by: 'SYSTEM', decided_by_name: null });
    // Scored again from the marks: 12 of 15; still one score version, recomputed by the evaluator.
    expect(cleared.body.score).toMatchObject({ score_version: 1, accuracy_score: 80, composite_score: 95 });
    const versions = await pool.query('SELECT version, is_current, reason, accurate_letters FROM score_versions WHERE block_attempt_id = $1', [attemptId]);
    expect(versions.rows).toEqual([{ version: 1, is_current: true, reason: 'Intervention sheet: accuracy from the marks', accurate_letters: 12 }]);
    // Clearing a row-3 mark opens it again: the sheet loses its score until it is set.
    expect((await put([{ box_id: 10, error: null }])).body.score).toMatchObject({ score_version: null, open_marks: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM score_versions WHERE block_attempt_id = $1', [attemptId])).rows[0].n).toBe(0);
    expect((await put([{ box_id: 10, error: false }])).body.score).toMatchObject({ score_version: 1, accuracy_score: 80 });

    // ---- Refusals: an unknown box, another evaluator, a non-sheet attempt id.
    expect((await put([{ box_id: 99, error: true }])).body).toMatchObject({ error: { code: 'UNKNOWN_BOX' } });
    expect((await put([{ box_id: 3, error: true }], users.other.token)).status).toBe(404);
    expect((await call(`/block-attempts/${randomUUID()}/intervention-marks`, { auth: token })).status).toBe(404);

    // ---- The session detail counts the marks of the attempt.
    const detail = (await call<{ attempts: { step_index: number; marks: { total: number; correct: number; error: number; open: number } | null }[] }>(`/sessions/${sessionId}`, { auth: token })).body;
    expect(detail.attempts.find((a) => a.step_index === 1)!.marks).toEqual({ total: 15, correct: 12, error: 3, open: 0 });

    // ---- Phase 5d: the summary's intervention section and the console's programme carry the sheet results.
    type Result = { session_code: string; kind: string; code: string; sheets_total: number; sheets_scored: number; open_marks: number;
      accuracy_score: number | null; pen_lift_score: number | null; speed_score: number | null; composite_score: number | null; pass: boolean | null };
    const summary = (await call<{ intervention: Result[] }>(`/participants/${participant.body.id}/summary`, { auth: token })).body;
    expect(summary.intervention).toEqual([expect.objectContaining({
      kind: 'TRAINING', code, sheets_total: 4, sheets_scored: 1, open_marks: 0, accuracy_score: 80, pen_lift_score: 100, speed_score: 100, composite_score: 95, pass: null,
    })]);
    const programme = (await call<{ intervention: { sessions: { composite_score: number | null; sheets_scored: number }[] } }>(
      `/participants/${participant.body.id}/protocol`, { auth: token })).body;
    expect(programme.intervention.sessions[0]).toMatchObject({ composite_score: 95, sheets_scored: 1 });

    // ---- The log: one suggestion row for the sheet, one change row per changed mark with old and new values.
    await app.appLog.flush();
    const log = await pool.query(
      `SELECT event_type, details FROM app_events WHERE session_id = $1 AND event_type LIKE 'intervention.mark.%' ORDER BY id`, [sessionId],
    );
    expect(log.rows[0]).toMatchObject({ event_type: 'intervention.mark.suggested', details: { correct: 9, error: 1, open: 5 } });
    const changed = log.rows.filter((r) => r.event_type === 'intervention.mark.changed').map((r) => r.details);
    expect(changed).toHaveLength(10);
    expect(changed.find((c) => c.box_id === 3 && c.evaluator_error === false)).toMatchObject({ old_final_error: true, new_final_error: false });
    expect(changed.find((c) => c.box_id === 3 && c.evaluator_error === null)).toMatchObject({ old_final_error: false, new_final_error: true });
  });
});
