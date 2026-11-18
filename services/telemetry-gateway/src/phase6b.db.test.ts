// Gateway test against a real migrated and seeded database (Phase 6b′, beta access): a touch-screen tablet's
// session is recorded as TOUCH and kept out of the research views, and behind a trusted proxy the tablet-code
// lockout counts each client address on its own. Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('Phase 6b′ beta access against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  const pw = `pw-${randomUUID()}`;
  let token = '';
  let domainId = 0;

  const call = async (path: string, init: { method?: string; body?: unknown; auth?: string; forwardedFor?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}),
        ...(init.forwardedFor ? { 'x-forwarded-for': init.forwardedFor } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const pairBody = { css_px_per_mm: 5.3, device_pixel_ratio: 2, screen_w_mm: 240, screen_h_mm: 160 };

  /** A planned DAY_14 session of a new participant, and its tablet code. */
  const plannedSession = async (n: number) => {
    const participant = await call('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `T6B-${run}-${n}`, domain_id: domainId, school: 'Beta School', birth_year_month: '2019-03', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    });
    const session = await call('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_14', language_code: 'he' } });
    const pin = (await call(`/sessions/${session.body.id}/pairing`, { method: 'POST', auth: token })).body.pin as string;
    return { id: session.body.id as string, participantId: participant.body.id as string, pin };
  };

  beforeAll(async () => {
    // The test client is on 127.0.0.1, standing in for the beta stack's Caddy.
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase6b-test', schoolHmacKey: 'phase6b-school', logLevel: 'silent', trustProxy: 'loopback' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const email = `phase6b-evaluator-${run}@ilt.local`;
    await pool.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Phase 6b evaluator', 'EVALUATOR')`, [email, await hash(pw)]);
    token = (await call('/auth/login', { method: 'POST', body: { email, password: pw } })).body.access_token;
    domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it('records how the tablet was written on and leaves touch sessions out of the research views', async () => {
    const touch = await plannedSession(1);
    const pen = await plannedSession(2);
    expect((await call('/sessions/pair', { method: 'POST', body: { ...pairBody, pin: touch.pin, input_kind: 'TOUCH' } })).body.status).toBe('ACCEPTED');
    expect((await call('/sessions/pair', { method: 'POST', body: { ...pairBody, pin: pen.pin } })).body.status).toBe('ACCEPTED');

    expect((await call(`/sessions/${touch.id}`, { auth: token })).body.input_kind).toBe('TOUCH');
    expect((await call(`/sessions/${pen.id}`, { auth: token })).body.input_kind).toBe('PEN');
    const stored = await pool.query('SELECT id, input_kind, device_model FROM sessions WHERE id = ANY($1) ORDER BY input_kind', [[touch.id, pen.id]]);
    expect(stored.rows.map((r) => [r.id, r.input_kind, r.device_model])).toEqual([[pen.id, 'PEN', 'DTH-A116'], [touch.id, 'TOUCH', 'TOUCH']]);
    await app.appLog.flush();
    const paired = await pool.query("SELECT details FROM app_events WHERE event_type = 'session.paired' AND entity_id = $1", [touch.id]);
    expect(paired.rows[0].details).toMatchObject({ input_kind: 'TOUCH' });

    // Both become completed research sessions with research consent: only the pen session reaches the views.
    const approval = (await pool.query(
      "INSERT INTO ethics_approvals (approval_type, authority, reference) VALUES ('RESEARCH', 'Phase 6b test', $1) RETURNING id", [run])).rows[0].id;
    for (const s of [touch, pen]) {
      await pool.query('UPDATE consent_records SET superseded_at = now() WHERE participant_id = $1 AND superseded_at IS NULL', [s.participantId]);
      await pool.query(
        "INSERT INTO consent_records (participant_id, consent_version, signed_on, allows_research_use, recorded_by) SELECT $1, 'T6B', current_date, true, evaluator_id FROM sessions WHERE id = $2",
        [s.participantId, s.id]);
      await pool.query("UPDATE sessions SET purpose = 'RESEARCH', status = 'COMPLETED', research_approval_id = $2, completed_at = now() WHERE id = $1", [s.id, approval]);
    }
    const inView = await pool.query('SELECT session_id, input_kind FROM v_research_sessions WHERE session_id = ANY($1)', [[touch.id, pen.id]]);
    expect(inView.rows).toEqual([{ session_id: pen.id, input_kind: 'PEN' }]);
  });

  it('behind a trusted proxy, locks tablet pairing for one client address only', async () => {
    const a = `203.0.113.${(parseInt(run.slice(0, 2), 16) % 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call('/sessions/pair', { method: 'POST', forwardedFor: a, body: { ...pairBody, pin: '000000' } })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    // Another client behind the same proxy still pairs.
    const other = await plannedSession(3);
    expect((await call('/sessions/pair', { method: 'POST', forwardedFor: '198.51.100.20', body: { ...pairBody, pin: other.pin } })).body.status).toBe('ACCEPTED');
    await app.appLog.flush();
    const logged = await pool.query(
      "SELECT DISTINCT client_ip::text AS ip FROM app_events WHERE event_type = 'auth.login.failed' AND entity_type = 'tablet' AND client_ip = $1::inet", [a]);
    expect(logged.rows.map((r) => r.ip.replace(/\/32$/, ''))).toEqual([a]);
  });
});
