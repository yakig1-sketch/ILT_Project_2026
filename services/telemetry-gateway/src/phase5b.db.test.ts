// Phase 5b against the database: intervention sessions (one target letter; training = the letter
// video and the training sheets, retention = one sheet after the set days), the sheet on the
// tablet (time and pen lifts only until sheet scoring), and the Dispatch Console's programme data.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import { PERFECT_ILT, synthBlock } from '@ilt/ilt-metrics';
import { controlMessage, type ControlEnvelope, type PenSample } from '@ilt/shared-types';
import type { CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import { buildApp } from './app.js';
import { letterVideoKey } from './routes/sessions.js';
import { Client, isEvent } from './ws-client.test-support.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const LETTER = JSON.parse(readFileSync(new URL('../../../Documents/05_Measures/Intervention_Letters/LETTER_HE_HE.json', import.meta.url), 'utf8')) as {
  geometry: CanvasGeometry; profile: ScoringProfile;
};

describe.skipIf(!DB_URL)('Phase 5b intervention sessions against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  const run = randomUUID().slice(0, 8);
  const users = {
    evaluator: { email: `phase5b-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'EVALUATOR', token: '' },
    admin: { email: `phase5b-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'ADMIN', token: '' },
    director: { email: `phase5b-dir-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'RESEARCHER', token: '' },
  };
  const directorPin = String(100000 + Math.floor(Math.random() * 899999));
  const code = `T5B_${run}`.toUpperCase();

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
  const errorCode = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase5b-test', schoolHmacKey: 'phase5b-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    for (const u of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id, director_pin_hash)
         VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL'), $5)`,
        [u.email, await hash(u.password), `Phase 5b test ${u.role}`, u.role, u.role === 'RESEARCHER' ? await hash(directorPin) : null],
      );
      u.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).body.access_token;
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [Object.values(users).map((u) => u.email)]);
    await pool.end();
  });

  it('plans a letter training and its retention check, and runs a sheet on the tablet', async () => {
    const admin = users.admin.token;
    const token = users.evaluator.token;
    const plan = (participant_id: string, letter_canvas_id: string, intervention_kind: 'TRAINING' | 'RETENTION', language_code = 'he') =>
      call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id, session_type: 'INTERVENTION', language_code, letter_canvas_id, intervention_kind } });

    // ---- A Hebrew letter set with one letter canvas, still a Draft.
    const set = await call<{ id: string }>('/canvas-sets', { method: 'POST', auth: admin, body: { language_code: 'he', set_type: 'INTERVENTION_LETTERS', name_he: 'בדיקה', name_en: `Letters ${run}` } });
    expect(set.status).toBe(201);
    const canvas = await call<{ id: string }>('/canvases', {
      method: 'POST', auth: admin, body: { canvas_set_id: set.body.id, code, name_he: 'האות ה', name_en: 'The letter He', geometry: LETTER.geometry, profile: LETTER.profile },
    });
    expect(canvas.status).toBe(201);
    const letterId = canvas.body.id;

    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST5B-${run}`, domain_id: domainId, school: 'Phase 5b School', birth_year_month: '2018-09', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    });
    expect(participant.status).toBe(201);
    const pid = participant.body.id;

    // ---- Only an Active letter of the session language can be used; the body must name the letter and the kind.
    expect(errorCode(await plan(pid, letterId, 'TRAINING'))).toBe('NO_LETTER');
    const bad = await call('/sessions', { method: 'POST', auth: token, body: { participant_id: pid, session_type: 'INTERVENTION', language_code: 'he' } });
    expect(bad.status).toBe(400);
    const activated = await call(`/canvases/${letterId}/activate`, { method: 'POST', auth: admin, body: { director_email: users.director.email, director_pin: directorPin } });
    expect(activated.status).toBe(200);
    expect(errorCode(await plan(pid, letterId, 'TRAINING', 'en'))).toBe('NO_LETTER');
    expect(errorCode(await plan(pid, letterId, 'RETENTION'))).toBe('NOT_TRAINED');

    // ---- Training: the letter video, then the training sheets (4 by default) of the letter.
    const training = await plan(pid, letterId, 'TRAINING');
    expect(training.status).toBe(201);
    type Detail = {
      session_type: string; intervention_kind: string; letter: { code: string; letter: string };
      steps: { step_index: number; step_type: string; label_key: string; block_number: number | null; video_key: string | null; canvas_code: string | null }[];
    };
    const detail = (await call<Detail>(`/sessions/${training.body.id}`, { auth: token })).body;
    expect(detail).toMatchObject({ session_type: 'INTERVENTION', intervention_kind: 'TRAINING', letter: { code, letter: 'ה' } });
    expect(detail.steps.map((s) => s.step_type)).toEqual(['VIDEO', 'INTERVENTION_SHEET', 'INTERVENTION_SHEET', 'INTERVENTION_SHEET', 'INTERVENTION_SHEET']);
    expect(detail.steps[0]).toMatchObject({ video_key: `letter_${code.toLowerCase()}`, label_key: 'step.video_letter' });
    // A letter set's usual codes drop their prefix: LETTER_HE_HE → letter_he_he.
    expect(letterVideoKey('LETTER_HE_HE')).toBe('letter_he_he');
    expect(detail.steps.slice(1).map((s) => [s.block_number, s.canvas_code, s.label_key])).toEqual([1, 2, 3, 4].map((n) => [n, code, 'step.intervention_sheet']));
    const stored = await pool.query('SELECT mirrored, fill_order FROM session_steps st JOIN sessions s ON s.id = st.session_id WHERE s.id = $1 AND st.step_index = 1', [training.body.id]);
    expect(stored.rows[0]).toEqual({ mirrored: false, fill_order: LETTER.profile.fill_order });
    // One intervention session open at a time.
    expect(errorCode(await plan(pid, letterId, 'TRAINING'))).toBe('INTERVENTION_OPEN');

    // ---- The Dispatch Console's programme: the letter, not trained yet, and the planned session.
    type Programme = {
      sessions: Record<string, unknown>;
      intervention: {
        language_code: string; training_sheets: number; retention_days: number;
        letters: { code: string; letter: string; trainings: number; retention_due: boolean; retention_due_on: string | null }[];
        sessions: { id: string; kind: string; code: string; status: string; sheets_total: number; sheets_done: number; can_open: boolean }[];
      };
    };
    const programme = async () => (await call<Programme>(`/participants/${pid}/protocol`, { auth: token })).body;
    const before = await programme();
    expect(before.sessions).not.toHaveProperty('INTERVENTION');
    expect(before.intervention).toMatchObject({ language_code: 'he', training_sheets: 4, retention_days: 14 });
    expect(before.intervention.letters.find((l) => l.code === code)).toMatchObject({ letter: 'ה', trainings: 0, retention_due: false, retention_due_on: null });
    expect(before.intervention.sessions).toEqual([expect.objectContaining({ id: training.body.id, kind: 'TRAINING', code, status: 'PLANNED', sheets_total: 4, sheets_done: 0, can_open: true })]);

    // ---- A sheet on the tablet: the letter canvas without the ILT profile; stored with time and pen lifts only.
    const { body: room } = await call<{ pin: string }>(`/sessions/${training.body.id}/pairing`, { method: 'POST', auth: token });
    const paired = await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: training.body.id });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 1, step_type: 'INTERVENTION_SHEET', attempt_number: 1 }));
    const d = (await tablet.next(isEvent('DISPATCH_STEP'))).payload as {
      step_type: string; attempt_number: number; block_number: number; block_count: number; canvas: CanvasGeometry; fill_order: number[]; profile?: unknown;
    };
    expect(d).toMatchObject({ step_type: 'INTERVENTION_SHEET', block_number: 1, block_count: 4, fill_order: LETTER.profile.fill_order });
    expect(d.canvas.letters).toHaveLength(15);
    expect(d.profile).toBeUndefined();
    await cockpit.next(isEvent('DISPATCH_STEP'));
    tablet.send(controlMessage('STEP_STARTED', { step_index: 1, attempt_number: d.attempt_number, block_started_at: new Date().toISOString() }));
    const samples = synthBlock([4, 3].map((id) => ({ box: d.canvas.boxes.find((b) => b.id === id)!, spec: PERFECT_ILT })));
    // Packets carry at most 512 samples.
    for (let sequence = 0; sequence * 500 < samples.length; sequence++) {
      const part = samples.slice(sequence * 500, (sequence + 1) * 500);
      tablet.ws.send(encodePacket({ packet_type: PacketType.BATCH, session_id: training.body.id, step_index: 1, attempt_number: d.attempt_number, sequence, samples: part }));
      await tablet.next(isEvent('BATCH_ACK'));
    }
    tablet.send(controlMessage('BLOCK_COMPLETE', {
      step_index: 1, attempt_number: d.attempt_number, end_reason: 'MANUAL', sample_count: samples.length, last_sample_seq: samples.length - 1, sha256: sha(samples),
    }));
    await cockpit.next(isEvent('BLOCK_STORED'));
    const scored = (await cockpit.next(isEvent('BLOCK_SCORED'), 10_000)).payload as { score_version: number | null; scores: Record<string, unknown> };
    expect(scored.score_version).toBeNull();
    expect(scored.scores).toMatchObject({ pen_lifts: 2, accuracy_score: null, composite_score: null });
    expect(Number(scored.scores.total_time_ms)).toBeGreaterThan(0);
    expect((await programme()).intervention.sessions[0]).toMatchObject({ status: 'IN_PROGRESS', sheets_done: 1 });
    // The step list shows the sheet's pen lifts although it has no score version yet (QA Take#1, T5).
    const attempts = (await call<{ attempts: { step_index: number; pen_lifts: number | null; score_version: number | null }[] }>(`/sessions/${training.body.id}`, { auth: token })).body.attempts;
    expect(attempts.find((a) => a.step_index === 1)).toMatchObject({ pen_lifts: 2, score_version: null });
    tablet.ws.close();
    cockpit.ws.close();

    // ---- Retention: due the set days after the letter's last completed training.
    await pool.query("UPDATE sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [training.body.id]);
    const early = await plan(pid, letterId, 'RETENTION');
    expect(errorCode(early)).toBe('RETENTION_NOT_DUE');
    expect((early.body as { error: { details: { due_on: string } } }).error.details.due_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await programme()).intervention.letters.find((l) => l.code === code)).toMatchObject({ trainings: 1, retention_due: false });
    await pool.query("UPDATE sessions SET completed_at = now() - interval '15 days' WHERE id = $1", [training.body.id]);
    expect((await programme()).intervention.letters.find((l) => l.code === code)).toMatchObject({ trainings: 1, retention_due: true });
    const retention = await plan(pid, letterId, 'RETENTION');
    expect(retention.status).toBe(201);
    const rd = (await call<Detail>(`/sessions/${retention.body.id}`, { auth: token })).body;
    expect(rd).toMatchObject({ intervention_kind: 'RETENTION' });
    expect(rd.steps.map((s) => [s.step_type, s.block_number])).toEqual([['INTERVENTION_SHEET', 1]]);
    // The sessions list filters on the intervention type.
    const listed = await call<{ id: string }[]>('/sessions?session_type=INTERVENTION', { auth: token });
    expect(listed.body.map((s) => s.id).sort()).toEqual([training.body.id, retention.body.id].sort());

    await app.appLog.flush();
    const created = await pool.query(
      `SELECT details->>'intervention_kind' AS kind, details->>'letter' AS letter FROM app_events
        WHERE event_type = 'session.created' AND session_id = ANY($1::uuid[]) ORDER BY id`,
      [[training.body.id, retention.body.id]],
    );
    expect(created.rows).toEqual([{ kind: 'TRAINING', letter: code }, { kind: 'RETENTION', letter: code }]);
  });
});
