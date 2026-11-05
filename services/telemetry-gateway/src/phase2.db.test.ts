// End-to-end gateway test against a real migrated and seeded database (Phase 2 flow): a Day 1
// session with the intro video, the warm-up (measured, not scored), ILT blocks scored when they
// are stored, repeat block, the inactivity alert, a notebook page (time only), a video missing in
// the session language, a Day 2 paper notebook page, the Comparative Summary, the pass threshold
// with the director PIN, and replay data.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set; the CI database job sets it.
import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import { PERFECT_ILT, synthBlock, type LetterSpec } from '@ilt/ilt-metrics';
import { controlMessage, type ControlEnvelope, type PenSample } from '@ilt/shared-types';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE } from '@ilt/template-schemas';
import { buildApp } from './app.js';
import { Client, isEvent } from './ws-client.test-support.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

describe.skipIf(!DB_URL)('Phase 2 flow against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  const run = randomUUID().slice(0, 8);
  const users = {
    evaluator: { email: `phase2-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'EVALUATOR', token: '' },
    admin: { email: `phase2-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'ADMIN', token: '' },
    director: { email: `phase2-director-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'RESEARCHER', token: '' },
  };
  const directorPin = String(100000 + Math.floor(Math.random() * 899999));
  let insertedVideoId: string | null = null;
  let previousThreshold: unknown = undefined;

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
  const box = (id: number) => ILT_GRID_GEOMETRY.boxes.find((b) => b.id === id)!;
  /** A whole ILT block of perfect letters in the Hebrew fill order (15 letters, 15 pen lifts). */
  const fullBlock = (spec: LetterSpec = PERFECT_ILT) => synthBlock(ILT_PROFILE_HE.fill_order.map((id) => ({ box: box(id), spec })));

  beforeAll(async () => {
    app = await buildApp({
      db: pool, checkS3: async () => true, jwtSecret: 'phase2-test', schoolHmacKey: 'phase2-school', logLevel: 'silent',
      media: { get: async () => ({ body: VIDEO_BYTES, contentType: 'video/mp4' }) },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    for (const u of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id, director_pin_hash)
         VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL'), $5)`,
        [u.email, await hash(u.password), `Phase 2 test ${u.role}`, u.role, u.role === 'RESEARCHER' ? await hash(directorPin) : null],
      );
      const ok = await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } });
      u.token = ok.body.access_token;
    }
    // CI seeds no videos (no Git LFS files): add a Hebrew intro row if there is none.
    const intro = await pool.query("SELECT id FROM instruction_videos WHERE video_key = 'intro' AND language_code = 'he' AND status = 'ACTIVE'");
    if (intro.rowCount === 0) {
      const v = await pool.query(
        `INSERT INTO instruction_videos (video_key, language_code, version, status, title_he, title_en, object_key, sha256)
         VALUES ('intro', 'he', 99, 'ACTIVE', 'בדיקה', 'Test', 'test/intro.mp4', $1) RETURNING id`,
        ['0'.repeat(64)],
      );
      insertedVideoId = v.rows[0].id;
    }
    const prev = await pool.query("SELECT value FROM setting_values WHERE key = 'scoring.pass_threshold' AND scope = 'SYSTEM'");
    previousThreshold = prev.rows[0]?.value;
  });

  afterAll(async () => {
    // Leave the pass threshold as it was, through the API so the history records the restore too.
    const restore = users.admin.token
      ? await call('/settings', {
          method: 'PUT',
          auth: users.admin.token,
          body: {
            scope: 'SYSTEM',
            changes: [previousThreshold === undefined ? { key: 'scoring.pass_threshold', reset: true } : { key: 'scoring.pass_threshold', value: previousThreshold }],
            director_email: users.director.email,
            director_pin: directorPin,
            reason: 'Phase 2 test cleanup',
          },
        }).catch(() => null)
      : null;
    await app?.close();
    if (restore?.status !== 200) {
      await pool.query("DELETE FROM setting_values WHERE key = 'scoring.pass_threshold' AND scope = 'SYSTEM'");
    }
    if (restore?.status !== 200 && previousThreshold !== undefined) {
      await pool.query(
        "INSERT INTO setting_values (key, scope, value, set_by) VALUES ('scoring.pass_threshold', 'SYSTEM', $1, (SELECT id FROM users WHERE email = $2))",
        [JSON.stringify(previousThreshold), users.admin.email],
      );
    }
    if (insertedVideoId) await pool.query('DELETE FROM instruction_videos WHERE id = $1', [insertedVideoId]);
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [Object.values(users).map((u) => u.email)]);
    await pool.end();
  });

  it('runs a Day 1 session: video, warm-up, scored blocks, repeat, notebook page, summary and replay', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST2-${run}`, domain_id: domainId, school: 'Phase 2 School', birth_year_month: '2018-09', grade_level: 'GRADE_2', gender: 'MALE', dominant_hand: 'LEFT' },
    });
    expect(participant.status).toBe(201);
    const pid = participant.body.id;

    const created = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: pid, session_type: 'DAY_1', language_code: 'he' } });
    const sessionId = created.body.id;
    type Detail = { status: string; steps: { step_index: number; step_type: string; status: string }[]; available_videos: string[]; attempts: Record<string, unknown>[] };
    const detail = await call<Detail>(`/sessions/${sessionId}`, { auth: token });
    const types = detail.body.steps.map((s) => s.step_type);
    expect(types).toHaveLength(15);
    expect(types.slice(0, 3)).toEqual(['VIDEO', 'WARMUP_BLOCK', 'ILT_BLOCK']);
    expect(detail.body.available_videos).toContain('intro');
    const notebookIndex = types.indexOf('NOTEBOOK_PAGE');
    // A recorded Normal speed (20 mm/s) for the ILT steps, so speed and composite scores exist.
    await pool.query(
      `UPDATE session_steps SET canvas_profile_snapshot = jsonb_set(canvas_profile_snapshot, '{normal_speed_mm_s}', '20')
        WHERE session_id = $1 AND step_type = 'ILT_BLOCK'`,
      [sessionId],
    );

    const { body: room } = await call<{ pin: string }>(`/sessions/${sessionId}/pairing`, { method: 'POST', auth: token });
    const paired = await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: sessionId });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);

    // ---- Intro video: the gateway resolves the Hebrew version; the tablet downloads it with its token.
    cockpit.send(controlMessage('VIDEO_PLAY', { step_index: 0 }));
    const play = await tablet.next(isEvent('VIDEO_PLAY'));
    const vp = play.payload as { step_index: number; video_key: string; language: string; url: string };
    expect(vp).toMatchObject({ step_index: 0, video_key: 'intro', language: 'he' });
    const media = await fetch(`${base}${vp.url}`, { headers: { authorization: `Bearer ${paired.body.token}` } });
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('video/mp4');
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(VIDEO_BYTES);
    expect((await fetch(`${base}${vp.url}`)).status).toBe(401);
    // No block can start while the video plays.
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 1, step_type: 'WARMUP_BLOCK', attempt_number: 1 }));
    expect(((await cockpit.next(isEvent('ERROR'))).payload as { code: string }).code).toBe('VIDEO_PLAYING');
    tablet.send(controlMessage('VIDEO_ENDED', { step_index: 0, reason: 'ENDED' }));
    await cockpit.next(isEvent('VIDEO_ENDED'));
    expect((await call<Detail>(`/sessions/${sessionId}`, { auth: token })).body.steps[0]!.status).toBe('DONE');

    /** Runs one writing step on the tablet and returns BLOCK_SCORED. */
    const runBlock = async (stepIndex: number, stepType: string, samples: PenSample[], expectAttempt = 1) => {
      cockpit.send(controlMessage('DISPATCH_STEP', { step_index: stepIndex, step_type: stepType as 'ILT_BLOCK', attempt_number: 1 }));
      const d = await tablet.next(isEvent('DISPATCH_STEP'));
      return finishDispatched(d, stepIndex, samples, expectAttempt);
    };
    const finishDispatched = async (d: ControlEnvelope, stepIndex: number, samples: PenSample[], expectAttempt: number) => {
      const attempt = (d.payload as { attempt_number: number }).attempt_number;
      expect(attempt).toBe(expectAttempt);
      await cockpit.next(isEvent('DISPATCH_STEP'));
      tablet.send(controlMessage('STEP_STARTED', { step_index: stepIndex, attempt_number: attempt, block_started_at: new Date().toISOString() }));
      await cockpit.next(isEvent('STEP_STARTED'));
      // Packets carry at most 512 samples.
      for (let sequence = 0; sequence * 500 < samples.length; sequence++) {
        const part = samples.slice(sequence * 500, (sequence + 1) * 500);
        tablet.ws.send(encodePacket({ packet_type: PacketType.BATCH, session_id: sessionId, step_index: stepIndex, attempt_number: attempt, sequence, samples: part }));
        await tablet.next(isEvent('BATCH_ACK'));
      }
      tablet.send(controlMessage('BLOCK_COMPLETE', {
        step_index: stepIndex, attempt_number: attempt, end_reason: 'LAST_BOX', sample_count: samples.length,
        last_sample_seq: samples.length - 1, sha256: sha(samples),
      }));
      await cockpit.next(isEvent('BLOCK_STORED'));
      return (await cockpit.next(isEvent('BLOCK_SCORED'), 10_000)).payload as { block_attempt_id: string; score_version: number | null; scores: Record<string, unknown> };
    };

    // ---- Warm-up: measured (letter measures stored), not scored.
    const warm = await runBlock(1, 'WARMUP_BLOCK', fullBlock());
    expect(warm.score_version).toBeNull();
    expect(warm.scores).toMatchObject({ pen_lifts: 15, accurate_letters: 15 });
    expect((await pool.query('SELECT count(*)::int AS n FROM letter_measures WHERE block_attempt_id = $1', [warm.block_attempt_id])).rows[0].n).toBe(15);
    expect((await pool.query('SELECT count(*)::int AS n FROM score_versions WHERE block_attempt_id = $1', [warm.block_attempt_id])).rows[0].n).toBe(0);

    // ---- ILT block 1: scored on storage (score version 1) with the separate component scores.
    const ilt1 = await runBlock(2, 'ILT_BLOCK', fullBlock());
    expect(ilt1.score_version).toBe(1);
    expect(ilt1.scores).toMatchObject({ pen_lifts: 15, accurate_letters: 15, accuracy_score: 100, pen_lift_score: 100, speed_score: 100, composite_score: 100, pass: null });
    const sv = await pool.query('SELECT version, is_current, composite_score, engine_version, settings_used FROM score_versions WHERE block_attempt_id = $1', [ilt1.block_attempt_id]);
    expect(sv.rows).toHaveLength(1);
    expect(sv.rows[0]).toMatchObject({ version: 1, is_current: true, composite_score: '100.00' });
    expect(sv.rows[0].settings_used.weight_speed_pct).toBe(50);
    expect((await pool.query('SELECT count(*)::int AS n FROM letter_scores ls JOIN score_versions sv ON sv.id = ls.score_version_id WHERE sv.block_attempt_id = $1', [ilt1.block_attempt_id])).rows[0].n).toBe(15);

    // ---- Repeat block 1: attempt 1 is kept as REPEATED, attempt 2 is sent and scored.
    cockpit.send(controlMessage('REPEAT_BLOCK', { step_index: 2, reason: 'DISRUPTION' }));
    const again = await tablet.next(isEvent('DISPATCH_STEP'));
    // Attempt 2: letters 7 mm/s too slow, so the speed score drops below 100.
    const ilt1b = await finishDispatched(again, 2, fullBlock({ ...PERFECT_ILT, speed_mm_s: 13 }), 2);
    expect(ilt1b.score_version).toBe(1);
    expect(Number(ilt1b.scores.speed_score)).toBeLessThan(100);
    const attempts = await pool.query(
      `SELECT ba.attempt_number, ba.status, ba.repeat_reason FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id
        WHERE st.session_id = $1 AND st.step_index = 2 ORDER BY ba.attempt_number`, [sessionId],
    );
    expect(attempts.rows).toEqual([
      { attempt_number: 1, status: 'REPEATED', repeat_reason: 'DISRUPTION' },
      { attempt_number: 2, status: 'COMPLETED', repeat_reason: null },
    ]);
    // A step not finished cannot be repeated.
    cockpit.send(controlMessage('REPEAT_BLOCK', { step_index: 3, reason: 'OTHER' }));
    expect(((await cockpit.next(isEvent('ERROR'))).payload as { code: string }).code).toBe('NOT_REPEATABLE');

    // ---- ILT block 2, with an inactivity alert on the way.
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 3, step_type: 'ILT_BLOCK', attempt_number: 1 }));
    const d2 = await tablet.next(isEvent('DISPATCH_STEP'));
    tablet.send(controlMessage('INACTIVITY_ALERT', { level: 'AMBER', idle_ms: 30_500, box_id: 4 }));
    await cockpit.next(isEvent('INACTIVITY_ALERT'));
    const ilt2 = await finishDispatched(d2, 3, fullBlock(), 1);
    expect(ilt2.scores).toMatchObject({ composite_score: 100 });

    // ---- Notebook page: time and pen lifts only.
    const notebookSamples = synthBlock([0, 1, 2].map((id) => ({ box: box(id), spec: PERFECT_ILT })));
    const nb = await runBlock(notebookIndex, 'NOTEBOOK_PAGE', notebookSamples);
    expect(nb.score_version).toBeNull();
    expect(nb.scores).toMatchObject({ pen_lifts: 3, accuracy_score: null, composite_score: null });
    expect(Number(nb.scores.total_time_ms)).toBeGreaterThan(0);
    const nbAttempt = await pool.query('SELECT total_time_ms FROM block_attempts WHERE id = $1', [nb.block_attempt_id]);
    expect(nbAttempt.rows[0].total_time_ms).toBeGreaterThan(0);

    // ---- Session detail carries the current scores per attempt.
    const after = await call<Detail>(`/sessions/${sessionId}`, { auth: token });
    expect(after.body.attempts.find((a) => a.id === ilt2.block_attempt_id)).toMatchObject({ score_version: 1, composite_score: '100.00' });

    // ---- Comparative summary: Day 1 first pair = block 1 (attempt 2, the repeat) and block 2.
    type Box = { key: string; complete: boolean; blocks: { attempt_id: string | null }[]; composite_score: number | null; pass: boolean | null; avg_pen_lifts: number | null; accuracy_pct: number | null };
    type Summary = { scoring: { pass_threshold: number | null; weight_speed_pct: number }; boxes: Box[] };
    let summary = await call<Summary>(`/participants/${pid}/summary`, { auth: token });
    expect(summary.status).toBe(200);
    const first = summary.body.boxes.find((b) => b.key === 'DAY_1_FIRST')!;
    expect(first.complete).toBe(true);
    expect(first.blocks.map((b) => b.attempt_id)).toEqual([ilt1b.block_attempt_id, ilt2.block_attempt_id]);
    expect(first).toMatchObject({ avg_pen_lifts: 15, accuracy_pct: 100 });
    expect(first.composite_score).toBeLessThan(100);
    expect(summary.body.boxes.find((b) => b.key === 'DAY_14')!.blocks.every((b) => b.attempt_id === null)).toBe(true);

    // ---- Pass threshold: admin only, approved with a Research Director's PIN.
    const put = (auth: string, extra: Record<string, unknown> = {}) =>
      call<{ error?: { code: string } }>('/settings', { method: 'PUT', auth, body: { scope: 'SYSTEM', changes: [{ key: 'scoring.pass_threshold', value: 80 }], ...extra } });
    expect((await put(token)).status).toBe(403);
    expect((await put(users.admin.token)).body.error?.code).toBe('DIRECTOR_PIN');
    const wrongPin = directorPin === '111111' ? '222222' : '111111';
    expect((await put(users.admin.token, { director_email: users.director.email, director_pin: wrongPin })).status).toBe(403);
    expect((await put(users.admin.token, { director_email: users.director.email, director_pin: directorPin })).status).toBe(200);
    summary = await call<Summary>(`/participants/${pid}/summary`, { auth: token });
    expect(summary.body.scoring.pass_threshold).toBe(80);
    const firstNow = summary.body.boxes.find((b) => b.key === 'DAY_1_FIRST')!;
    expect(firstNow.pass).toBe(firstNow.composite_score! >= 80);
    const history = await pool.query("SELECT new_value, approved_by IS NOT NULL AS approved FROM setting_value_history WHERE key = 'scoring.pass_threshold' ORDER BY id DESC LIMIT 1");
    expect(history.rows[0]).toEqual({ new_value: 80, approved: true });

    // ---- Replay data: every stored sample and the speed per house.
    const replay = await call<{ samples: { t_us: number[] }; letters: { speed_mm_s: number }[]; canvas: { boxes: unknown[] } }>(`/attempts/${ilt2.block_attempt_id}/replay`, { auth: token });
    expect(replay.status).toBe(200);
    expect(replay.body.samples.t_us).toHaveLength(fullBlock().length);
    expect(replay.body.letters).toHaveLength(15);
    expect(replay.body.letters.every((l) => l.speed_mm_s > 0)).toBe(true);
    expect(replay.body.canvas.boxes).toHaveLength(15);

    await app.appLog.flush();
    const events = await pool.query<{ event_type: string }>('SELECT event_type FROM app_events WHERE session_id = $1', [sessionId]);
    expect(events.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining([
      'session.video.played', 'session.video.ended', 'session.block.scored', 'session.block.repeated', 'session.inactivity.amber', 'data.replay.opened',
    ]));
    const security = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM app_events WHERE entity_id = 'scoring.pass_threshold' AND occurred_at > now() - interval '5 minutes'",
    );
    expect(security.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining(['auth.director_pin.failed', 'auth.director_pin.verified', 'settings.value.changed']));
    tablet.ws.close();
    cockpit.ws.close();
  });

  it('warns about a video missing in the session language and times a Day 2 paper page', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST2B-${run}`, domain_id: domainId, school: 'Phase 2 School', birth_year_month: '2019-01', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    });
    // English Day 1: no English intro video yet, so the cockpit warns and the evaluator skips it.
    const en = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_1', language_code: 'en' } });
    const enDetail = await call<{ available_videos: string[] }>(`/sessions/${en.body.id}`, { auth: token });
    expect(enDetail.body.available_videos).not.toContain('intro');
    const { body: room } = await call<{ pin: string }>(`/sessions/${en.body.id}/pairing`, { method: 'POST', auth: token });
    const paired = await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: en.body.id });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);
    cockpit.send(controlMessage('VIDEO_PLAY', { step_index: 0 }));
    expect(((await cockpit.next(isEvent('ERROR'))).payload as { code: string }).code).toBe('NO_VIDEO');
    expect((await call(`/sessions/${en.body.id}/steps/0`, { method: 'PATCH', auth: token, body: { status: 'SKIPPED' } })).status).toBe(200);
    tablet.ws.close();
    cockpit.ws.close();

    // Day 2: two paper notebook pages timed in the cockpit, with notes.
    const day2 = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_2', language_code: 'he' } });
    const d2 = await call<{ steps: { step_index: number; step_type: string; status: string; paper_duration_ms: number | null; notes: string | null }[] }>(`/sessions/${day2.body.id}`, { auth: token });
    const paper = d2.body.steps.filter((s) => s.step_type === 'PAPER_NOTEBOOK_PAGE');
    expect(paper).toHaveLength(2);
    const ilt = d2.body.steps.find((s) => s.step_type === 'ILT_BLOCK')!;
    expect((await call(`/sessions/${day2.body.id}/steps/${ilt.step_index}/paper`, { method: 'POST', auth: token, body: { duration_ms: 1000 } })).status).toBe(409);
    expect((await call(`/sessions/${day2.body.id}/steps/${paper[0]!.step_index}/paper`, { method: 'POST', auth: token, body: { duration_ms: -5 } })).status).toBe(400);
    expect((await call(`/sessions/${day2.body.id}/steps/${paper[0]!.step_index}/paper`, { method: 'POST', auth: token, body: { duration_ms: 63_400, notes: 'Wrote slowly' } })).status).toBe(200);
    const after = await call<{ status: string; steps: { step_index: number; status: string; paper_duration_ms: number | null; notes: string | null }[] }>(`/sessions/${day2.body.id}`, { auth: token });
    expect(after.body.status).toBe('IN_PROGRESS');
    expect(after.body.steps.find((s) => s.step_index === paper[0]!.step_index)).toMatchObject({ status: 'DONE', paper_duration_ms: 63_400, notes: 'Wrote slowly' });
    // A page already saved cannot be saved again.
    expect((await call(`/sessions/${day2.body.id}/steps/${paper[0]!.step_index}/paper`, { method: 'POST', auth: token, body: { duration_ms: 1 } })).status).toBe(409);
    await app.appLog.flush();
    const events = await pool.query<{ event_type: string }>('SELECT event_type FROM app_events WHERE session_id = $1', [day2.body.id]);
    expect(events.rows.map((r) => r.event_type)).toContain('session.paper_page.timed');
  });

  it('releases the tablet from an unfinished session and turns away tablets of released or ended sessions', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST2C-${run}`, domain_id: domainId, school: 'Phase 2 School', birth_year_month: '2018-11', grade_level: 'GRADE_2', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    });
    const created = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_1', language_code: 'he' } });
    const sessionId = created.body.id;
    const pair = async () => {
      const { body: room } = await call<{ pin: string }>(`/sessions/${sessionId}/pairing`, { method: 'POST', auth: token });
      return (await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } })).body.token;
    };
    const closeCode = (c: Client) => new Promise<number>((resolve) => c.ws.once('close', (code: number) => resolve(code)));
    const tabletOnline = (online: boolean) => (m: ControlEnvelope | Uint8Array) =>
      isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet === online;
    type Detail = { status: string; tablet_paired: boolean };

    const first = await pair();
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: first });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: sessionId });
    await cockpit.next(tabletOnline(true));
    expect((await call<Detail>(`/sessions/${sessionId}`, { auth: token })).body.tablet_paired).toBe(true);

    // Not while a step runs on the tablet (here the intro video).
    cockpit.send(controlMessage('VIDEO_PLAY', { step_index: 0 }));
    await tablet.next(isEvent('VIDEO_PLAY'));
    const refused = await call<{ error: { code: string } }>(`/sessions/${sessionId}/release-tablet`, { method: 'POST', auth: token });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('STEP_RUNNING');
    cockpit.send(controlMessage('VIDEO_ENDED', { step_index: 0, reason: 'STOPPED' }));
    await tablet.next(isEvent('VIDEO_ENDED'));

    // Released: the tablet is disconnected as rejected (it returns to the PIN screen); the session stays open.
    const closed = closeCode(tablet);
    expect((await call(`/sessions/${sessionId}/release-tablet`, { method: 'POST', auth: token })).status).toBe(200);
    expect(await closed).toBe(4401);
    await cockpit.next(tabletOnline(false));
    const released = await call<Detail>(`/sessions/${sessionId}`, { auth: token });
    expect(released.body).toMatchObject({ status: 'IN_PROGRESS', tablet_paired: false });
    // The old token no longer connects (a reload on the tablet cannot return to the session).
    const stale = await Client.open(`${wsBase}/ws/tablet`, { auth: first });
    expect(await closeCode(stale)).toBe(4401);

    // A new pairing continues the session.
    const second = await pair();
    const again = await Client.open(`${wsBase}/ws/tablet`, { auth: second });
    await cockpit.next(tabletOnline(true));

    // Ended while the tablet was away: on reconnect the tablet is told the session is over.
    again.ws.close();
    await cockpit.next(tabletOnline(false));
    cockpit.send(controlMessage('ABORT_SESSION', { reason: 'TEST', save_partial: true }));
    await cockpit.next(isEvent('ABORT_SESSION'));
    const late = await Client.open(`${wsBase}/ws/tablet`, { auth: second });
    await late.next(isEvent('ABORT_SESSION'));
    late.ws.close();
    cockpit.ws.close();
    // A closed session has no tablet to release.
    expect((await call(`/sessions/${sessionId}/release-tablet`, { method: 'POST', auth: token })).status).toBe(409);

    await app.appLog.flush();
    const events = await pool.query<{ event_type: string; actor_user_id: string | null }>(
      "SELECT event_type, actor_user_id FROM app_events WHERE session_id = $1 AND event_type = 'session.tablet.released'", [sessionId],
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]!.actor_user_id).not.toBeNull();
  });

  it('filters the session list and searches participants by code', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const code = `FLT_${run}`;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: code, domain_id: domainId, school: 'Phase 2 School', birth_year_month: '2019-02', grade_level: 'GRADE_1', gender: 'MALE', dominant_hand: 'LEFT' },
    });
    const day1 = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_1', language_code: 'he' } });
    const day2 = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_2', language_code: 'he' } });
    type Row = { id: string; study_code: string; session_type: string; status: string };
    const list = async (q: string) => (await call<Row[]>(`/sessions?${q}`, { auth: token })).body.map((r) => r.id);

    // Search matches the participant code in any case; '_' is a literal character, not a wildcard.
    expect(await list(`q=${code.toLowerCase()}`)).toEqual([day2.body.id, day1.body.id]);
    expect(await list(`q=FLTX${run}`)).toEqual([]);
    expect(await list(`q=${code}&session_type=DAY_2`)).toEqual([day2.body.id]);
    expect(await list(`q=${code}&status=PLANNED`)).toHaveLength(2);
    expect(await list(`q=${code}&status=COMPLETED`)).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await list(`q=${code}&from=${today}&to=${today}`)).toHaveLength(2);
    expect(await list(`q=${code}&to=2000-01-01`)).toEqual([]);
    expect((await call(`/sessions?status=DONE`, { auth: token })).status).toBe(400);
    expect((await call(`/sessions?from=yesterday`, { auth: token })).status).toBe(400);
    expect((await call(`/sessions?tz=Mars/Base`, { auth: token })).status).toBe(400);
    // A day is the evaluator's day: far ahead of UTC, "today" in Kiritimati may already be tomorrow in UTC terms.
    const kiri = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect(await list(`q=${code}&from=${kiri}&to=${kiri}&tz=Pacific/Kiritimati`)).toHaveLength(2);

    const found = await call<{ id: string; study_code: string }[]>(`/participants?q=${encodeURIComponent(`lt_${run}`)}&limit=5`, { auth: token });
    expect(found.body.map((p) => p.id)).toEqual([participant.body.id]);
    expect((await call<unknown[]>(`/participants?q=FLT%25${run}`, { auth: token })).body).toEqual([]);
    expect((await call(`/participants?limit=0`, { auth: token })).status).toBe(400);
  });
});
