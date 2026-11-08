// Gateway test against a real migrated and seeded database (Phase 3e): the action-log search and CSV
// export (FR-LOG-3) and the append-only log (FR-LOG-4). Its own entries carry a run marker, so the
// free-text filter keeps them apart from what the running system logs. Runs only when
// TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { csvCell } from './routes/log.js';

const DB_URL = process.env.TEST_DATABASE_URL;

interface Page { events: { id: string; event_type: string; severity: string; actor_email: string | null; domain_code: string | null; message: string }[]; next: string | null; total: number | null }

describe('csvCell', () => {
  it('quotes, doubles quotes, and makes formulas plain text', () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe.skipIf(!DB_URL)('Phase 3e action log against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().replace(/-/g, '').slice(0, 10);
  const marker = `t3e${run}`;
  const admin = { email: `phase3e-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '', id: '' };
  const evaluator = { email: `phase3e-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '' };
  let generalId = 0;

  const call = async (path: string, auth?: string) => {
    const res = await fetch(`${base}/api/v1${path}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
    return res;
  };
  const search = async (params: Record<string, string>) => {
    const res = await call(`/log/events?${new URLSearchParams({ q: marker, ...params })}`, admin.token);
    return { status: res.status, body: (await res.json()) as Page };
  };

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase3e-test', schoolHmacKey: 'phase3e-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    generalId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
    admin.id = (await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Phase 3e admin', 'ADMIN') RETURNING id`,
      [admin.email, await hash(admin.password)])).rows[0].id;
    await pool.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Phase 3e evaluator', 'EVALUATOR')`,
      [evaluator.email, await hash(evaluator.password)]);
    const login = async (u: { email: string; password: string }) =>
      ((await (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(u) })).json()) as { access_token: string }).access_token;
    admin.token = await login(admin);
    evaluator.token = await login(evaluator);

    // Five entries a minute apart, two of them a microsecond apart (the page cursor must keep both).
    const at = (min: number, us = 0) => `now() - interval '${60 - min} minutes' + interval '${us} microseconds'`;
    const add = (when: string, sev: string, type: string, msg: string, user: string | null, domain: number | null, details: object) =>
      pool.query(
        `INSERT INTO app_events (occurred_at, severity, event_type, actor_user_id, actor_role, domain_id, message, details)
         VALUES (${when}, $1, $2, $3, $4, $5, $6, $7)`,
        [sev, type, user, user ? 'ADMIN' : null, domain, msg, JSON.stringify(details)]);
    await add(at(1), 'INFO', 'auth.login.succeeded', `Signed in ${marker}`, admin.id, null, { note: marker });
    await add(at(2), 'SECURITY', 'auth.login.failed', `Wrong password ${marker}`, null, null, { email: 'someone@ilt.local', note: marker });
    await add(at(3), 'INFO', 'settings.value.changed', `Setting changed ${marker}`, admin.id, generalId, { key: 'scoring.pass_threshold', note: marker });
    await add(at(4), 'WARN', 'session.link.lost', `=HYPERLINK("x") ${marker}`, null, generalId, { note: marker, extra: 'עברית' });
    await add(at(4, 1), 'WARN', 'session.link.lost', `Link lost again ${marker}`, null, generalId, { note: marker, code: `QX${run.slice(0, 4)}-01` });
  });

  afterAll(async () => {
    await app?.close();
    // The log entries stay (append-only); the test users stay referenced by them, so they are only deactivated.
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [[admin.email, evaluator.email]]).catch(() => undefined);
    await pool.end();
  });

  it('is for the System Administrator only', async () => {
    expect((await call('/log/events')).status).toBe(401);
    expect((await call('/log/events', evaluator.token)).status).toBe(403);
    expect((await call('/log/events.csv', evaluator.token)).status).toBe(403);
  });

  it('finds the run by free text, newest first, with the total', async () => {
    const { status, body } = await search({});
    expect(status).toBe(200);
    expect(body.total).toBe(5);
    expect(body.events.map((e) => e.event_type)).toEqual([
      'session.link.lost', 'session.link.lost', 'settings.value.changed', 'auth.login.failed', 'auth.login.succeeded',
    ]);
    expect(body.events[0]!.message).toMatch(/^Link lost again/);
    // A word may be the start of a token.
    expect((await search({ q: `${marker.slice(0, -2)} hyperlink` })).body.total).toBe(1);
    // A code with a hyphen and digits (QA3F-01 is stored as 'qa3f' and '-01'), in any case.
    expect((await search({ q: `${marker} qx${run.slice(0, 4)}-01` })).body.total).toBe(1);
    expect((await search({ q: `${marker} QX${run.slice(0, 4)}-0` })).body.total).toBe(1);
    expect((await search({ q: `${marker} -- !` })).body.total).toBe(5);
  });

  it('filters by type, severity, user and Domain', async () => {
    expect((await search({ types: 'auth.login.succeeded,auth.login.failed' })).body.total).toBe(2);
    expect((await search({ severity: 'WARN,SECURITY' })).body.total).toBe(3);
    const mine = (await search({ user_id: admin.id })).body;
    expect(mine.total).toBe(2);
    expect(mine.events.every((e) => e.actor_email === admin.email)).toBe(true);
    const general = (await search({ domain_id: String(generalId) })).body;
    expect(general.total).toBe(3);
    expect(general.events.every((e) => e.domain_code === 'GENERAL')).toBe(true);
    expect((await search({ session_code: 'S000000-NONE' })).body.total).toBe(0);
    expect((await search({ to: new Date(Date.now() - 58 * 60_000).toISOString() })).body.total).toBe(2);
  });

  it('pages with a cursor that keeps entries a microsecond apart', async () => {
    const seen: string[] = [];
    let next: string | null = null;
    let pages = 0;
    do {
      const page: Page = (await search({ limit: '2', ...(next ? { before: next } : {}) })).body;
      seen.push(...page.events.map((e) => e.id));
      next = page.next;
      if (pages++ === 0) expect(page.total).toBe(5);
      else expect(page.total).toBeNull();
    } while (next && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
  });

  it('refuses a bad filter', async () => {
    expect((await search({ types: 'no.such.type' })).status).toBe(400);
    expect((await search({ severity: 'LOUD' })).status).toBe(400);
    expect((await search({ from: 'yesterday' })).status).toBe(400);
  });

  it('exports the matches to CSV and logs the export', async () => {
    const res = await call(`/log/events.csv?${new URLSearchParams({ q: marker })}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="ilt_action_log_\d{12}\.csv"/);
    expect(res.headers.get('x-ilt-rows')).toBe('5');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('occurred_at,severity,event_type,user_email,user_name,role,device_id,domain,region,session_code,entity_type,entity_id,client_ip,message,details');
    expect(lines).toHaveLength(6);
    expect(text).toContain(`"'=HYPERLINK(""x"") ${marker}"`);
    expect(text).toContain('עברית');

    await app.appLog.flush();
    const logged = await pool.query(
      `SELECT details FROM app_events WHERE event_type = 'data.export.created' AND actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [admin.id]);
    expect(logged.rows[0]?.details).toMatchObject({ export: 'action_log', rows: 5, truncated: false, filter: { q: marker } });
  });

  it('keeps the log append-only for the application role (FR-LOG-4)', async () => {
    await expect(pool.query('DELETE FROM app_events WHERE message LIKE $1', [`%${marker}%`])).rejects.toThrow(/permission denied/);
    await expect(pool.query("UPDATE app_events SET message = 'x' WHERE message LIKE $1", [`%${marker}%`])).rejects.toThrow(/permission denied/);
  });
});
