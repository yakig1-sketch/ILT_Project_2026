// Gateway test against a real migrated and seeded database (Phase 4a): the analyst portal routes.
// Only COMPLETED sessions tagged RESEARCH, of participants whose current consent allows research use,
// are visible (FR-AN-3); the routes run as the ilt_analyst role, which cannot read the tables behind
// the research views. Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { Readable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

interface SessionRow { session_id: string; study_code: string; school_key: string; blocks: number; composite: number | null; gender: string }
interface Group { grp: string | null; participants: number; sessions: number; blocks: number; composite: number | null; pen_lifts: number | null }

describe.skipIf(!DB_URL)('Phase 4a analyst portal against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  // Every participant of this run shares one school, so the school filter isolates the run.
  const school = createHash('sha256').update(`phase4a-${run}`).digest('hex');
  const schoolKey = school.slice(0, 8);
  const pw = `pw-${randomUUID()}`;
  const users = { analyst: '', researcher: '', evaluator: '', admin: '' };
  const tokens = { analyst: '', researcher: '', evaluator: '', admin: '' };
  const ids = { visible: '', female: '', noConsent: '', intervention: '', running: '', attempt: '', hiddenAttempt: '', ppt: '' };

  // Stand-in for the analytics service (Phase 4b): its own tests cover the computation.
  let analytics: (path: string, body?: unknown) => Promise<{ status: number; body: unknown }> = async () => ({ status: 404, body: null });
  let exportKey = '';
  const get = async (path: string, token: string) => {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    app = await buildApp({
      db: pool, checkS3: async () => true, jwtSecret: 'phase4a-test', schoolHmacKey: 'phase4a-school', logLevel: 'silent',
      analytics: (path, body) => analytics(path, body),
      exportFiles: { open: async (key) => (key === exportKey ? { stream: Readable.from([Buffer.from('PK-test-zip')]), size: 11 } : null) },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const role of ['analyst', 'researcher', 'evaluator', 'admin'] as const) {
      const email = `phase4a-${role}-${run}@ilt.local`;
      users[role] = (await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, await hash(pw), `Phase 4a ${role}`, role.toUpperCase()])).rows[0].id;
      const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
      tokens[role] = ((await res.json()) as { access_token: string }).access_token;
    }
    const domain = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
    const canvas = (await pool.query("SELECT id FROM canvases WHERE code = 'ILT_3X5_HE' AND status = 'ACTIVE'")).rows[0].id;
    const template = (await pool.query("SELECT id FROM protocol_templates WHERE session_type = 'DAY_1' LIMIT 1")).rows[0].id;
    const snapshot = JSON.stringify({ 'ilt.timer.inactivity_sec': { value: 20, source: 'DEFAULT' }, 'scoring.pass_threshold': { value: 2, source: 'DEFAULT' } });

    const participant = async (code: string, gender: string, research: boolean) => {
      const id = (await pool.query(
        `INSERT INTO participants (study_code, domain_id, school_code_hmac, grade_level, gender, ses_group, dominant_hand)
         VALUES ($1, $2, $3, 'GRADE_1', $4, NULL, 'RIGHT') RETURNING id`, [code, domain, school, gender])).rows[0].id;
      await pool.query(
        `INSERT INTO consent_records (participant_id, consent_version, signed_on, allows_research_use, recorded_by) VALUES ($1, 'T4A', current_date, $2, $3)`,
        [id, research, users.evaluator]);
      return id as string;
    };
    const session = async (ppt: string, purpose: string, status: string) =>
      (await pool.query(
        `INSERT INTO sessions (session_code, participant_id, evaluator_id, domain_id, language_code, purpose, session_type, protocol_template_id,
                               status, settings_snapshot, started_at, completed_at, research_approval_id)
         VALUES ($1, $2, $3, $4, 'he', $5::varchar, 'DAY_1', $6, $7::varchar, $8, now() - interval '1 hour', CASE WHEN $7::varchar = 'COMPLETED' THEN now() END,
                 CASE WHEN $5::varchar = 'RESEARCH' THEN (SELECT min(id) FROM ethics_approvals) END) RETURNING id`,
        [`T4A-${randomUUID().slice(0, 8)}`, ppt, users.evaluator, domain, purpose, template, status, snapshot])).rows[0].id as string;
    const step = async (sessionId: string, index: number, type: string, block: number | null, scored: boolean) =>
      (await pool.query(
        `INSERT INTO session_steps (session_id, step_index, step_type, label_key, block_number, is_scored, canvas_id)
         VALUES ($1, $2, $3, 'step.ilt_block', $4, $5, $6) RETURNING id`, [sessionId, index, type, block, scored, canvas])).rows[0].id as string;
    const attempt = async (stepId: string, n: number, status: string, composite: number | null, lifts: number) => {
      const id = (await pool.query(
        `INSERT INTO block_attempts (session_step_id, attempt_number, status, started_at, ended_at, total_time_ms, sample_count)
         VALUES ($1, $2, $3, now() - interval '30 minutes', now() - interval '29 minutes', 60000, 3) RETURNING id`, [stepId, n, status])).rows[0].id as string;
      if (composite !== null) {
        await pool.query(
          `INSERT INTO score_versions (block_attempt_id, version, settings_used, profile_used, engine_version, letters_expected, pen_lifts,
                                       accuracy_score, avg_speed_mm_s, speed_score, composite_score)
           VALUES ($1, 1, '{}', '{}', 'test', 15, $2, 50, 20, 40, $3)`, [id, lifts, composite]);
      }
      return id;
    };

    // Visible: RESEARCH, COMPLETED, research consent. Block 1 was repeated (attempt 2 counts); the warm-up does not count.
    ids.ppt = await participant(`T4A-M-${run}`, 'MALE', true);
    ids.visible = await session(ids.ppt, 'RESEARCH', 'COMPLETED');
    await attempt(await step(ids.visible, 0, 'WARMUP_BLOCK', null, false), 1, 'COMPLETED', 99, 9);
    const b1 = await step(ids.visible, 1, 'ILT_BLOCK', 1, true);
    ids.hiddenAttempt = await attempt(b1, 1, 'ABORTED', 10, 9);
    ids.attempt = await attempt(b1, 2, 'COMPLETED', 80, 2);
    await attempt(await step(ids.visible, 2, 'ILT_BLOCK', 2, true), 1, 'COMPLETED', 60, 4);
    await pool.query(
      `INSERT INTO pen_samples (block_attempt_id, sample_seq, sample_time, t_us, x_mm, y_mm, pressure, flags, box_id)
       SELECT $1, g, now(), g * 4000, 10 + g, 20, 0.5, CASE WHEN g = 0 THEN 3 ELSE 1 END, 1 FROM generate_series(0, 2) g`, [ids.attempt]);
    await pool.query(
      `INSERT INTO letter_measures (block_attempt_id, box_id, fill_position, row_index, status) VALUES ($1, 1, 1, 1, 'WRITTEN')`, [ids.attempt]);
    await pool.query(
      `INSERT INTO letter_scores (score_version_id, box_id, speed_mm_s, is_accurate)
       SELECT id, 1, 21.5, true FROM score_versions WHERE block_attempt_id = $1`, [ids.attempt]);
    // Visible: a second participant, one block.
    const female = await participant(`T4A-F-${run}`, 'FEMALE', true);
    ids.female = await session(female, 'RESEARCH', 'COMPLETED');
    await attempt(await step(ids.female, 1, 'ILT_BLOCK', 1, true), 1, 'COMPLETED', 50, 6);
    // Not visible: no research consent; an INTERVENTION session; a session still running.
    const noConsent = await participant(`T4A-N-${run}`, 'MALE', false);
    ids.noConsent = await session(noConsent, 'RESEARCH', 'COMPLETED');
    await attempt(await step(ids.noConsent, 1, 'ILT_BLOCK', 1, true), 1, 'COMPLETED', 70, 1);
    ids.intervention = await session(ids.ppt, 'INTERVENTION', 'COMPLETED');
    ids.running = await session(ids.ppt, 'RESEARCH', 'IN_PROGRESS');
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it('is for analysts and researchers only', async () => {
    expect((await fetch(`${base}/api/v1/research/sessions`)).status).toBe(401);
    expect((await get('/research/sessions', tokens.evaluator)).status).toBe(403);
    expect((await get('/research/sessions', tokens.admin)).status).toBe(403);
    expect((await get('/research/options', tokens.researcher)).status).toBe(200);
  });

  it('lists only completed RESEARCH sessions with research consent, with the means of the counted blocks', async () => {
    const { status, body } = await get(`/research/sessions?school=${schoolKey}`, tokens.analyst);
    expect(status).toBe(200);
    const found = body.sessions as SessionRow[];
    expect(found.map((s) => s.session_id).sort()).toEqual([ids.visible, ids.female].sort());
    const male = found.find((s) => s.session_id === ids.visible)!;
    // Blocks 1 (attempt 2: 80) and 2 (60); the aborted attempt and the warm-up do not count.
    expect(male).toMatchObject({ school_key: schoolKey, blocks: 2, composite: 70 });
    expect(body.total).toBe(2);
    // Filters.
    expect((await get(`/research/sessions?school=${schoolKey}&gender=FEMALE`, tokens.analyst)).body.total).toBe(1);
    expect((await get(`/research/sessions?school=${schoolKey}&ses=NONE&inactivity_sec=20&canvas=ILT_3X5_HE`, tokens.analyst)).body.total).toBe(2);
    expect((await get(`/research/sessions?school=${schoolKey}&inactivity_sec=30`, tokens.analyst)).body.total).toBe(0);
    // Region: NONE is "not recorded"; it can be combined with Region ids.
    expect((await get(`/research/sessions?school=${schoolKey}&region_id=NONE`, tokens.analyst)).body.total).toBe(2);
    expect((await get(`/research/sessions?school=${schoolKey}&region_id=999999`, tokens.analyst)).body.total).toBe(0);
    expect((await get(`/research/sessions?school=${schoolKey}&region_id=999999,NONE`, tokens.analyst)).body.total).toBe(2);
    expect((await get('/research/sessions?school=nothex', tokens.analyst)).status).toBe(400);
  });

  it('slices the cohort by a chosen grouping', async () => {
    const all = (await get(`/research/cohort?school=${schoolKey}`, tokens.analyst)).body.groups as Group[];
    expect(all).toEqual([expect.objectContaining({ grp: 'all', participants: 2, sessions: 2, blocks: 3, composite: 63.3, pen_lifts: 4 })]);
    const byGender = (await get(`/research/cohort?school=${schoolKey}&group_by=gender`, tokens.analyst)).body.groups as Group[];
    expect(byGender.map((g) => [g.grp, g.blocks, g.composite])).toEqual([['FEMALE', 1, 50], ['MALE', 2, 70]]);
    expect((await get('/research/cohort?group_by=name', tokens.analyst)).status).toBe(400);
  });

  it('shows one research session with every attempt, the counted ones marked, and refuses the others', async () => {
    const { status, body } = await get(`/research/sessions/${ids.visible}`, tokens.analyst);
    expect(status).toBe(200);
    expect(body.session).toMatchObject({ study_code: `T4A-M-${run}`, settings: { inactivity_sec: 20, pass_threshold: 2 } });
    expect(body.session.settings_snapshot).toBeUndefined();
    expect(body.blocks.map((b: { step_index: number; attempt_number: number; counts: boolean }) => [b.step_index, b.attempt_number, b.counts]))
      .toEqual([[0, 1, false], [1, 1, false], [1, 2, true], [2, 1, true]]);
    for (const hidden of [ids.noConsent, ids.intervention, ids.running]) {
      expect((await get(`/research/sessions/${hidden}`, tokens.analyst)).status).toBe(404);
    }
  });

  it('replays a research block in the cockpit replay shape and logs it', async () => {
    const { status, body } = await get(`/research/attempts/${ids.attempt}/replay`, tokens.analyst);
    expect(status).toBe(200);
    expect(body.attempt).toMatchObject({ id: ids.attempt, attempt_number: 2, block_number: 1 });
    expect(body.canvas.boxes.length).toBeGreaterThan(0);
    expect(body.samples.t_us).toEqual([0, 4000, 8000]);
    expect(body.letters).toEqual([{ box_id: 1, speed_mm_s: 21.5, is_accurate: true, pen_lifts_internal: null }]);
    expect(Number(body.score.composite_score)).toBe(80);
    // A page that asks twice in a row (React StrictMode in development) is logged once.
    expect((await get(`/research/attempts/${ids.attempt}/replay`, tokens.analyst)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    const logged = await pool.query(
      `SELECT details FROM app_events WHERE event_type = 'data.replay.opened' AND entity_id = $1 AND actor_user_id = $2`, [ids.attempt, users.analyst]);
    expect(logged.rows).toHaveLength(1);
    expect(logged.rows[0]?.details).toMatchObject({ portal: 'analyst' });
    const noConsentAttempt = (await pool.query(
      `SELECT ba.id FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id WHERE st.session_id = $1`, [ids.noConsent])).rows[0].id;
    expect((await get(`/research/attempts/${noConsentAttempt}/replay`, tokens.analyst)).status).toBe(404);
  });

  it('passes kinematics requests to the analytics service and logs an opening once (Phase 4b)', async () => {
    const asked: string[] = [];
    analytics = async (path) => {
      asked.push(path);
      if (path.includes(ids.attempt)) {
        return { status: 200, body: { attempt: { id: ids.attempt, session_id: ids.visible, session_code: 'S4B', step_index: 1, attempt_number: 2 }, summary: { strokes: 1 } } };
      }
      if (path.includes(ids.visible)) return { status: 200, body: { attempts: [] } };
      return { status: 404, body: null };
    };
    expect((await get(`/research/attempts/${ids.attempt}/kinematics`, tokens.evaluator)).status).toBe(403);
    const k = await get(`/research/attempts/${ids.attempt}/kinematics`, tokens.analyst);
    expect(k.status).toBe(200);
    expect(k.body.summary).toEqual({ strokes: 1 });
    expect((await get(`/research/attempts/${ids.attempt}/kinematics`, tokens.analyst)).status).toBe(200);
    expect((await get(`/research/sessions/${ids.visible}/kinematics`, tokens.researcher)).body).toEqual({ attempts: [] });
    expect((await get(`/research/sessions/${ids.noConsent}/kinematics`, tokens.analyst)).status).toBe(404);
    expect((await get('/research/attempts/not-a-uuid/kinematics', tokens.analyst)).status).toBe(404);
    expect(asked).toEqual([
      `/kinematics/attempts/${ids.attempt}`, `/kinematics/attempts/${ids.attempt}`,
      `/kinematics/sessions/${ids.visible}`, `/kinematics/sessions/${ids.noConsent}`,
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    const logged = await pool.query(
      `SELECT message FROM app_events WHERE event_type = 'data.kinematics.opened' AND entity_id = $1 AND actor_user_id = $2`, [ids.attempt, users.analyst]);
    expect(logged.rows.map((r) => r.message)).toEqual(['Kinematics opened: S4B step 1, attempt 2']);
    analytics = async () => {
      throw new Error('connection refused');
    };
    const down = await get(`/research/attempts/${ids.attempt}/kinematics`, tokens.analyst);
    expect(down).toMatchObject({ status: 503, body: { error: { message_key: 'analyst.analytics_down' } } });
  });

  it('exports the filtered research sessions and serves the file through a signed link (Phase 4c)', async () => {
    const post = async (path: string, token: string, body?: unknown) => {
      const res = await fetch(`${base}/api/v1${path}`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    };
    let asked: any = null;
    analytics = async (path, body) => {
      asked = { path, body };
      exportKey = `exports/${(body as { export_id: string }).export_id}.zip`;
      return { status: 200, body: { object_key: exportKey, size_bytes: 11, row_counts: { sessions: 2, blocks: 5 } } };
    };
    expect((await post('/research/exports', tokens.evaluator, { format: 'CSV' })).status).toBe(403);
    expect((await post('/research/exports', tokens.analyst, { format: 'XLSX' })).status).toBe(400);
    expect((await post('/research/exports', tokens.analyst, { format: 'CSV', filters: { school: 'ffffffff' } })).body.error.message_key).toBe('analyst.export.no_sessions');

    const created = await post('/research/exports', tokens.analyst, { format: 'CSV', filters: { school: schoolKey, gender: '' }, include_samples: true });
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({ status: 'RUNNING', format: 'CSV', session_count: 2, filters: { school: schoolKey }, include_samples: true });
    expect(created.body.object_key).toBeUndefined();
    await new Promise((r) => setTimeout(r, 1500));
    // Only the matching research sessions are sent to the analytics service.
    expect(asked.path).toBe('/exports');
    expect([...asked.body.session_ids].sort()).toEqual([ids.visible, ids.female].sort());
    expect(asked.body).toMatchObject({ export_id: created.body.id, format: 'CSV', include_samples: true, include_kinematics: false });

    const mine = (await get('/research/exports', tokens.analyst)).body.exports;
    expect(mine[0]).toMatchObject({ id: created.body.id, status: 'READY', size_bytes: 11, row_counts: { sessions: 2, blocks: 5 } });
    expect((await get('/research/exports', tokens.researcher)).body.exports.find((e: { id: string }) => e.id === created.body.id)).toBeUndefined();
    expect((await post(`/research/exports/${created.body.id}/link`, tokens.researcher)).status).toBe(404);

    const link = await post(`/research/exports/${created.body.id}/link`, tokens.analyst);
    expect(link.status).toBe(200);
    const file = await fetch(`${base}${link.body.url}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/zip');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="ilt-research-export-\d{8}-\d{4}-csv\.zip"$/);
    expect(await file.text()).toBe('PK-test-zip');
    // A HEAD request sends no file and is not logged as a download.
    const head = await fetch(`${base}${link.body.url}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    // A bad link is refused with a short page in Hebrew and English (a browser opens it), not JSON.
    const tampered = await fetch(`${base}${link.body.url.replace(/sig=[^&]+/, 'sig=AAAA')}`);
    expect(tampered.status).toBe(403);
    expect(tampered.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await tampered.text()).toContain('This download link has expired or is not valid.');
    // An unknown address does not repeat itself (it may hold ids).
    const unknown = await fetch(`${base}/api/v1/research/exports/${created.body.id}/nothing?user=${users.analyst}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } });
    const expired = link.body.url.replace(/expires=\d+/, 'expires=1000');
    expect((await fetch(`${base}${expired}`)).status).toBe(403);

    // A build that fails is recorded as FAILED.
    analytics = async () => ({ status: 500, body: null });
    const failing = await post('/research/exports', tokens.analyst, { format: 'PARQUET', filters: { school: schoolKey } });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await get('/research/exports', tokens.analyst)).body.exports.find((e: { id: string }) => e.id === failing.body.id).status).toBe('FAILED');

    const logged = await pool.query(
      `SELECT event_type, severity FROM app_events WHERE entity_id IN ($1, $2) ORDER BY occurred_at`, [created.body.id, failing.body.id]);
    expect(logged.rows).toEqual([
      { event_type: 'data.export.created', severity: 'INFO' },
      { event_type: 'data.export.downloaded', severity: 'INFO' },
      { event_type: 'data.export.created', severity: 'WARN' },
    ]);
  });

  it('hides a session once the current consent no longer allows research use', async () => {
    await pool.query('UPDATE consent_records SET superseded_at = now() WHERE participant_id = $1 AND superseded_at IS NULL', [ids.ppt]);
    await pool.query(
      `INSERT INTO consent_records (participant_id, consent_version, signed_on, allows_research_use, recorded_by) VALUES ($1, 'T4A-2', current_date, false, $2)`,
      [ids.ppt, users.evaluator]);
    const found = (await get(`/research/sessions?school=${schoolKey}`, tokens.analyst)).body.sessions as SessionRow[];
    expect(found.map((s) => s.session_id)).toEqual([ids.female]);
    expect((await get(`/research/attempts/${ids.attempt}/replay`, tokens.analyst)).status).toBe(404);
  });

  it('runs as a database role that cannot read the tables behind the views', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE ilt_analyst');
      await expect(client.query('SELECT 1 FROM participants LIMIT 1')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
