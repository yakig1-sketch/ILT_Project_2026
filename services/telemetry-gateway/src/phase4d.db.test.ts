// Gateway test against a real migrated and seeded database (Phase 4d): the legacy import (FR-LEG-1) and
// paper-cohort scores (FR-LEG-2). The analytics service's parser is replaced by a stand-in; its own tests
// read the real sample files. Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('Phase 4d legacy import and paper scores against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  // Old-application numbers unique to this run.
  const n0 = 100000 + Math.floor(Math.random() * 800000);
  const ids = [String(n0), String(n0 + 1), String(n0 + 2)];
  const pw = `pw-${randomUUID()}`;
  const users = { admin: '', evaluator: '' };
  const tokens = { admin: '', evaluator: '' };
  let domain = 0;
  let asked: { path: string; body: any }[] = [];

  // The parser's answer for two measure files of three children (the third without an L/R flag).
  const parsed = (totals: number[]) => ({
    files: [
      { name: 'Total Time.xls', measure: 'TOTAL_TIME', detected: 'TOTAL_TIME', rows: 3, blocks: 2, warnings: [], error: null },
      { name: 'Hands Raises.xls', measure: 'HAND_RAISES', detected: 'HAND_RAISES', rows: 3, blocks: 2, warnings: [], error: null },
    ],
    warnings: ['id x: example warning'],
    children: ids.map((id, i) => ({
      legacy_id: id, hand: i === 0 ? 'RIGHT' : i === 1 ? 'LEFT' : null, hand_raw: i === 0 ? 1 : i === 1 ? 0 : null, mistakes: 3 + i,
      blocks: { 1: { TOTAL_TIME: totals[i], HAND_RAISES: 15 + i }, 2: { TOTAL_TIME: 30000, HAND_RAISES: 16 } },
      raw: { 1: { TOTAL_TIME: { file: 'Total Time.xls', value: totals[i] } }, 2: {} },
    })),
  });
  let answer: unknown = parsed([35769, 40000, 50000]);

  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const importBody = (dry_run: boolean, session_label = `QA ${run}`) => ({
    files: [{ name: 'Total Time.xls', content_base64: 'AAAA' }, { name: 'Hands Raises.xls', content_base64: 'BBBB', measure: 'HAND_RAISES' }],
    domain_id: domain, session_label, dry_run,
  });

  beforeAll(async () => {
    app = await buildApp({
      db: pool, checkS3: async () => true, jwtSecret: 'phase4d-test', schoolHmacKey: 'phase4d-school', logLevel: 'silent',
      analytics: async (path, body) => {
        asked.push({ path, body });
        return { status: 200, body: answer };
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const role of ['admin', 'evaluator'] as const) {
      const email = `phase4d-${role}-${run}@ilt.local`;
      users[role] = (await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, await hash(pw), `Phase 4d ${role}`, role.toUpperCase()])).rows[0].id;
      const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
      tokens[role] = ((await res.json()) as { access_token: string }).access_token;
    }
    domain = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
  });

  afterAll(async () => {
    // The children and participants of this run would otherwise show up in the cockpit's search.
    const mine = `SELECT id FROM participants WHERE legacy_ref = ANY($1) OR study_code IN ($2, $3, $4)`;
    const params = [[...ids, String(n0 + 10)], `P4D-${run}`, `T4D2-${run}`, `LEG-${n0 + 10}`];
    await pool.query(`DELETE FROM legacy_block_results WHERE participant_id IN (${mine})`, params).catch(() => undefined);
    await pool.query(`DELETE FROM paper_block_scores WHERE participant_id IN (${mine})`, params).catch(() => undefined);
    await pool.query(`DELETE FROM participants WHERE id IN (${mine})`, params).catch(() => undefined);
    await app?.close();
    await pool.end();
  });

  it('checks the files without writing, then imports the children and their block rows', async () => {
    expect((await call('POST', '/legacy/import', tokens.evaluator, importBody(true))).status).toBe(403);
    expect((await call('POST', '/legacy/import', tokens.admin, { ...importBody(true), domain_id: 999999 })).body.error.message_key).toBe('legacy.bad_domain');

    const check = await call('POST', '/legacy/import', tokens.admin, importBody(true));
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ dry_run: true, children: 3, new_children: 3, existing_children: 0, block_rows: 6, rows_to_update: 0, conflicts: [] });
    expect(check.body.sample[0]).toMatchObject({ legacy_id: ids[0], study_code: `LEG-${ids[0]}`, existing: false, hand: 'RIGHT', blocks: 2 });
    expect(asked[asked.length - 1]).toMatchObject({ path: '/legacy/parse', body: { files: [{ name: 'Total Time.xls', measure: null }, { name: 'Hands Raises.xls', measure: 'HAND_RAISES' }] } });
    expect((await pool.query('SELECT count(*)::int AS n FROM participants WHERE legacy_ref = ANY($1)', [ids])).rows[0].n).toBe(0);

    const done = await call('POST', '/legacy/import', tokens.admin, importBody(false));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ dry_run: false, children: 3, new_children: 3, block_rows: 6 });
    const people = (await pool.query(
      `SELECT study_code, cohort, grade_level, gender, ses_group, dominant_hand, domain_id FROM participants WHERE legacy_ref = ANY($1) ORDER BY legacy_ref`, [ids])).rows;
    expect(people).toEqual([
      { study_code: `LEG-${ids[0]}`, cohort: 'LEGACY', grade_level: null, gender: null, ses_group: null, dominant_hand: 'RIGHT', domain_id: domain },
      { study_code: `LEG-${ids[1]}`, cohort: 'LEGACY', grade_level: null, gender: null, ses_group: null, dominant_hand: 'LEFT', domain_id: domain },
      { study_code: `LEG-${ids[2]}`, cohort: 'LEGACY', grade_level: null, gender: null, ses_group: null, dominant_hand: null, domain_id: domain },
    ]);
    const pid = (await pool.query('SELECT id FROM participants WHERE legacy_ref = $1', [ids[0]])).rows[0].id;
    const results = await call('GET', `/participants/${pid}/legacy-results`, tokens.evaluator);
    expect(results.body.map((r: any) => [r.block_number, r.total_time_ms, r.pen_lifts, r.mistakes])).toEqual([[1, 35769, 15, '3'], [2, 30000, 16, '3']]);

    // Imported again with a changed value: the rows are updated, not doubled, and the children matched.
    answer = parsed([36000, 40000, 50000]);
    const again = await call('POST', '/legacy/import', tokens.admin, importBody(false));
    expect(again.body).toMatchObject({ new_children: 0, existing_children: 3, rows_to_update: 6 });
    expect((await call('GET', `/participants/${pid}/legacy-results`, tokens.admin)).body.map((r: any) => r.total_time_ms)).toEqual([36000, 30000]);
    expect((await pool.query('SELECT count(*)::int AS n FROM legacy_block_results WHERE participant_id = $1', [pid])).rows[0].n).toBe(2);

    const batches = (await call('GET', '/legacy/imports', tokens.admin)).body.filter((x: any) => x.session_label === `QA ${run}`);
    expect(batches.map((x: any) => [x.participants_created, x.participants_matched, x.block_rows])).toEqual([[0, 3, 6], [3, 0, 6]]);
    await new Promise((r) => setTimeout(r, 1500));
    const logged = await pool.query(`SELECT message FROM app_events WHERE event_type = 'data.legacy.imported' AND actor_user_id = $1 ORDER BY id`, [users.admin]);
    expect(logged.rows.map((r) => r.message)).toEqual([
      `Legacy import "QA ${run}": 3 children (3 new), 6 block rows`,
      `Legacy import "QA ${run}": 3 children (0 new), 6 block rows`,
    ]);
  });

  it('does not take a study code that already belongs to another participant', async () => {
    const other = String(n0 + 10);
    await pool.query(`INSERT INTO participants (study_code, domain_id, grade_level, gender, dominant_hand) VALUES ($1, $2, 'GRADE_1', 'MALE', 'RIGHT')`, [`LEG-${other}`, domain]);
    answer = { files: parsed([1, 1, 1]).files, warnings: [], children: [{ legacy_id: other, hand: 'RIGHT', hand_raw: 1, mistakes: null, blocks: { 1: { TOTAL_TIME: 1 } }, raw: { 1: {} } }] };
    const check = await call('POST', '/legacy/import', tokens.admin, importBody(true, `QA2 ${run}`));
    expect(check.body).toMatchObject({ children: 0, conflicts: [`LEG-${other}`] });
    expect((await call('POST', '/legacy/import', tokens.admin, importBody(false, `QA2 ${run}`))).body.error.message_key).toBe('legacy.nothing_to_import');
  });

  it('keeps grade and gender required for everyone but legacy children', async () => {
    await expect(pool.query(
      `INSERT INTO participants (study_code, domain_id, grade_level, gender, dominant_hand) VALUES ($1, $2, NULL, 'MALE', 'RIGHT')`, [`T4D-${run}`, domain],
    )).rejects.toThrow(/participants_demographics_check/);
  });

  it('records paper-cohort scores per block, with old and new values in the log', async () => {
    const created = await call('POST', '/participants', tokens.evaluator, {
      study_code: `P4D-${run}`, domain_id: domain, school: 'Paper school', birth_year_month: '2019-03', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT', cohort: 'PAPER',
    });
    expect(created.status).toBe(201);
    const pid = created.body.id;
    expect((await call('GET', `/participants/${pid}`, tokens.evaluator)).body.cohort).toBe('PAPER');

    const score = { session_type: 'DAY_1', block_number: 3, pen_lifts: 17, accurate_letters: 12, total_time_ms: 41500, notes: 'smudged box 4' };
    expect((await call('PUT', `/participants/${pid}/paper-scores`, tokens.evaluator, score)).body).toEqual({ saved: true });
    expect((await call('PUT', `/participants/${pid}/paper-scores`, tokens.evaluator, { ...score, accurate_letters: 16 })).status).toBe(400);
    expect((await call('PUT', `/participants/${pid}/paper-scores`, tokens.evaluator, { ...score, session_type: 'DAY_14', block_number: 3 })).status).toBe(400);
    await call('PUT', `/participants/${pid}/paper-scores`, tokens.admin, { ...score, accurate_letters: 13 });
    const list = (await call('GET', `/participants/${pid}/paper-scores`, tokens.evaluator)).body;
    expect(list).toEqual([expect.objectContaining({ session_type: 'DAY_1', block_number: 3, pen_lifts: 17, accurate_letters: 13, total_time_ms: 41500, notes: 'smudged box 4', saved_by: 'Phase 4d admin' })]);
    // All empty clears the block.
    expect((await call('PUT', `/participants/${pid}/paper-scores`, tokens.evaluator, { ...score, pen_lifts: null, accurate_letters: null, total_time_ms: null, notes: null })).body).toEqual({ saved: false });
    expect((await call('GET', `/participants/${pid}/paper-scores`, tokens.evaluator)).body).toEqual([]);

    // Only for the paper cohort.
    const tablet = (await call('POST', '/participants', tokens.evaluator, {
      study_code: `T4D2-${run}`, domain_id: domain, school: 'Tablet school', birth_year_month: '2019-03', grade_level: 'GRADE_1', gender: 'MALE', dominant_hand: 'RIGHT',
    })).body.id;
    expect((await call('PUT', `/participants/${tablet}/paper-scores`, tokens.evaluator, score)).body.error.message_key).toBe('paper.not_paper');

    await new Promise((r) => setTimeout(r, 1500));
    const logged = await pool.query(`SELECT message, details FROM app_events WHERE event_type = 'data.paper_scores.entered' AND entity_id = $1 ORDER BY id`, [pid]);
    expect(logged.rows.map((r) => r.message)).toEqual([
      `Paper scores entered: P4D-${run} DAY_1 block 3`,
      `Paper scores changed: P4D-${run} DAY_1 block 3`,
      `Paper scores cleared: P4D-${run} DAY_1 block 3`,
    ]);
    expect(logged.rows[1].details).toMatchObject({ old: { accurate_letters: 12 }, new: { accurate_letters: 13 } });

    // Free text matches the message; with the event types whose displayed name contains it (q_types), those entries match too.
    const search = async (extra: string) => (await call('GET', `/log/events?q=${encodeURIComponent('Paper scores entered')}${extra}`, tokens.admin))
      .body.events.filter((e: any) => e.entity_id === pid).map((e: any) => e.message);
    expect(await search('')).toEqual([`Paper scores entered: P4D-${run} DAY_1 block 3`]);
    expect((await search('&q_types=data.paper_scores.entered')).sort()).toEqual(logged.rows.map((r) => r.message).sort());
  });

  it('imports nothing when two files are set to the same measure', async () => {
    const twice = parsed([1, 1, 1]);
    twice.files = twice.files.map((f) => ({ ...f, measure: 'TOTAL_TIME', error: 'measure_twice' as any }));
    answer = { ...twice, children: [] };
    expect((await call('POST', '/legacy/import', tokens.admin, importBody(true, `QA3 ${run}`))).status).toBe(200);
    const refused = await call('POST', '/legacy/import', tokens.admin, importBody(false, `QA3 ${run}`));
    expect([refused.status, refused.body.error.message_key]).toEqual([400, 'legacy.measure_twice']);
    // Even when the other files still give children, nothing is written.
    answer = { ...parsed([1, 1, 1]), files: [twice.files[0], { ...twice.files[1], measure: 'HAND_RAISES', error: null }] };
    expect((await call('POST', '/legacy/import', tokens.admin, importBody(false, `QA3 ${run}`))).body.error.message_key).toBe('legacy.measure_twice');
    expect((await pool.query("SELECT count(*)::int AS n FROM legacy_block_results WHERE session_label = $1", [`QA3 ${run}`])).rows[0].n).toBe(0);
  });
});
