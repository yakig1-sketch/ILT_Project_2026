// Gateway test against a real migrated and seeded database (Phase 3c): the canvas library. Canvas
// sets, loading a Draft, validation, activation with director approval, versions, Domain overrides
// of the scoring profile (used by new sessions), retiring and deleting.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE, NOTEBOOK_GEOMETRY } from '@ilt/template-schemas';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

interface Detail {
  id: string;
  code: string;
  version: number;
  status: string;
  default_scoring_profile: { dots: Record<string, { radius_mm: number; weight_pct: number }>; expected_pen_lifts_per_block: number } | null;
  issues: { code: string }[];
  versions: { id: string; version: number; status: string }[];
  overrides: { domain_id: number; profile_patch: unknown; approved_by: string | null }[];
  used_by: { key: string; scope: string }[];
}

describe.skipIf(!DB_URL)('Phase 3c canvas library against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().slice(0, 8);
  const admin = { email: `phase3c-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '' };
  const evaluator = { email: `phase3c-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '' };
  const director = { email: `phase3c-dir-${run}@ilt.local`, pin: '975310' };
  const approval = { director_email: director.email, director_pin: director.pin };
  const code = `T3C_${run}`.toUpperCase();
  const domainCode = `T3CD_${run}`.toUpperCase();
  let setId = '';
  let domainId = 0;

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const as = <T>(path: string, method = 'GET', body?: unknown) => call<T>(path, { method, body, auth: admin.token });
  const detail = async (id: string) => (await as<Detail>(`/canvases/${id}/detail`)).body;

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase3c-test', schoolHmacKey: 'phase3c-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const [u, role] of [[admin, 'ADMIN'], [evaluator, 'EVALUATOR']] as const) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id) VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL'))`,
        [u.email, await hash(u.password), `Phase 3c test ${role}`, role],
      );
      u.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).body.access_token;
    }
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, domain_id)
       VALUES ($1, $2, 'Phase 3c director', 'RESEARCHER', $3, (SELECT id FROM domains WHERE code = 'GENERAL'))`,
      [director.email, await hash(`pw-${randomUUID()}`), await hash(director.pin)],
    );
    domainId = (await as<{ id: number }>('/domains', 'POST', { code: domainCode, name_he: 'בדיקה', name_en: 'Canvas test', description_he: '', description_en: '' })).body.id;
  });

  afterAll(async () => {
    await app?.close();
    // Best effort: leave no test canvases behind (session rows may not be removable by ilt_app).
    const tryQuery = (sql: string, params: unknown[]) => pool.query(sql, params).catch(() => undefined);
    await tryQuery('DELETE FROM session_steps WHERE canvas_id IN (SELECT id FROM canvases WHERE code = $1)', [code]);
    await tryQuery('DELETE FROM sessions WHERE participant_id IN (SELECT id FROM participants WHERE study_code = $1)', [`P3C-${run}`]);
    await tryQuery('DELETE FROM participants WHERE study_code = $1', [`P3C-${run}`]);
    await tryQuery('DELETE FROM setting_values WHERE domain_id = $1', [domainId]);
    await tryQuery('DELETE FROM canvas_scoring_overrides WHERE canvas_id IN (SELECT id FROM canvases WHERE code = $1)', [code]);
    await tryQuery('DELETE FROM canvases WHERE code = $1', [code]);
    await tryQuery('DELETE FROM canvas_sets WHERE id = $1', [setId]);
    await tryQuery('DELETE FROM domains WHERE id = $1', [domainId]);
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [[admin.email, evaluator.email, director.email]]);
    await pool.end();
  });

  it('manages canvas sets and Draft canvases for the System Administrator only', async () => {
    expect((await call('/canvas-sets', { auth: evaluator.token })).status).toBe(403);
    expect((await call('/canvases', { method: 'POST', auth: evaluator.token, body: {} })).status).toBe(403);

    const set = await as<{ id: string }>('/canvas-sets', 'POST', { language_code: 'he', set_type: 'ILT', name_he: 'בדיקה', name_en: `Test set ${run}` });
    expect(set.status).toBe(201);
    setId = set.body.id;
    expect((await as<{ error: { code: string } }>('/canvas-sets', 'POST', { language_code: 'he', set_type: 'ILT', name_he: 'x', name_en: `TEST SET ${run}` })).body.error.code).toBe('NAME_TAKEN');

    // The geometry must match the schema and the set's type.
    const broken = await as<{ error: { code: string } }>('/canvases', 'POST', { canvas_set_id: setId, code, name_he: 'א', name_en: 'A', geometry: { canvas_type: 'ILT_GRID' } });
    expect(broken.body.error.code).toBe('BAD_GEOMETRY');
    const notebook = await as<{ error: { code: string } }>('/canvases', 'POST', { canvas_set_id: setId, code, name_he: 'א', name_en: 'A', geometry: NOTEBOOK_GEOMETRY });
    expect(notebook.body.error.code).toBe('WRONG_CANVAS_TYPE');

    // Without a profile a starter profile is made: equal weights, one pen lift per box.
    const made = await as<{ id: string }>('/canvases', 'POST', { canvas_set_id: setId, code: code.toLowerCase(), name_he: 'רשת', name_en: 'Grid', geometry: ILT_GRID_GEOMETRY });
    expect(made.status).toBe(201);
    const d = await detail(made.body.id);
    expect(d).toMatchObject({ code, version: 1, status: 'DRAFT', issues: [] });
    expect(Object.values(d.default_scoring_profile!.dots).map((x) => x.weight_pct)).toEqual([34, 33, 33]);
    expect(d.default_scoring_profile!.expected_pen_lifts_per_block).toBe(15);
    expect((await as<{ error: { code: string } }>('/canvases', 'POST', { canvas_set_id: setId, code, name_he: 'א', name_en: 'A', geometry: ILT_GRID_GEOMETRY })).body.error.code).toBe('CODE_TAKEN');

    const sets = await as<{ id: string; canvases: { code: string; status: string }[] }[]>('/canvas-sets');
    expect(sets.body.find((s) => s.id === setId)!.canvases).toEqual([expect.objectContaining({ code, status: 'DRAFT' })]);
  });

  it('validates, activates with approval, versions, overrides per Domain, retires and deletes', async () => {
    const v1 = (await as<{ id: string; canvases: { id: string }[] }[]>('/canvas-sets')).body.find((s) => s.id === setId)!.canvases[0]!.id;

    // Too big for the tablet and a profile with an unknown dot: both block activation.
    const tooBig = { ...ILT_GRID_GEOMETRY, size: { width: 300, height: 95 } };
    const badProfile = { ...ILT_PROFILE_HE, dots: { ...ILT_PROFILE_HE.dots, D: { radius_mm: 1, weight_pct: 0, required: false } } };
    const edited = await as<{ issues: { code: string }[] }>(`/canvases/${v1}`, 'PATCH', { geometry: tooBig, profile: badProfile });
    expect(edited.body.issues.map((i) => i.code).sort()).toEqual(['DOES_NOT_FIT', 'UNKNOWN_DOT']);
    expect((await as<{ error: { code: string } }>(`/canvases/${v1}/activate`, 'POST', approval)).body.error.code).toBe('CANVAS_INVALID');
    expect((await as<{ issues: unknown[] }>(`/canvases/${v1}/validate`, 'POST')).body.issues).toHaveLength(2);
    expect((await as(`/canvases/${v1}`, 'PATCH', { geometry: ILT_GRID_GEOMETRY, profile: ILT_PROFILE_HE })).status).toBe(200);

    // Activation puts a scoring profile into use: a director approves it.
    expect((await as(`/canvases/${v1}/activate`, 'POST', {})).status).toBe(403);
    expect((await as(`/canvases/${v1}/activate`, 'POST', { ...approval, director_pin: '000000' })).status).toBe(403);
    expect((await as(`/canvases/${v1}/activate`, 'POST', approval)).body).toMatchObject({ activated: true, retired_version: null });
    expect((await as<{ error: { code: string } }>(`/canvases/${v1}`, 'PATCH', { name_en: 'x' })).body.error.code).toBe('NOT_DRAFT');
    expect((await as<{ error: { code: string } }>(`/canvases/${v1}`, 'DELETE')).body.error.code).toBe('NOT_DRAFT');

    // A Domain override stores only what differs from the canvas profile.
    const domainProfile = { ...ILT_PROFILE_HE, dots: { ...ILT_PROFILE_HE.dots, B: { ...ILT_PROFILE_HE.dots.B, radius_mm: 2 } } };
    expect((await as(`/canvases/${v1}/overrides/${domainId}`, 'PUT', { profile: domainProfile })).status).toBe(403);
    expect((await as(`/canvases/${v1}/overrides/${domainId}`, 'PUT', { profile: domainProfile, ...approval })).body).toEqual({ changed: 1 });
    expect((await as(`/canvases/${v1}/overrides/${domainId}`, 'PUT', { profile: domainProfile, ...approval })).body).toEqual({ changed: 0 });
    const badWeights = { ...ILT_PROFILE_HE, dots: { ...ILT_PROFILE_HE.dots, B: { ...ILT_PROFILE_HE.dots.B, weight_pct: 50 } } };
    expect((await as<{ error: { code: string } }>(`/canvases/${v1}/overrides/${domainId}`, 'PUT', { profile: badWeights, ...approval })).body.error.code).toBe('CANVAS_INVALID');
    expect((await detail(v1)).overrides).toEqual([expect.objectContaining({ domain_id: domainId, profile_patch: { dots: { B: { radius_mm: 2 } } }, approved_by: 'Phase 3c director' })]);

    // A new version is a Draft copy; one Draft per code. Activating it retires v1 and keeps the override.
    const v2 = await as<{ id: string; version: number }>(`/canvases/${v1}/versions`, 'POST');
    expect(v2.body.version).toBe(2);
    expect((await as<{ error: { code: string } }>(`/canvases/${v1}/versions`, 'POST')).body.error.code).toBe('DRAFT_EXISTS');
    expect((await as(`/canvases/${v2.body.id}/activate`, 'POST', approval)).body).toMatchObject({ activated: true, retired_version: 1 });
    const now = await detail(v2.body.id);
    expect(now.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['2:ACTIVE', '1:RETIRED']);
    expect(now.overrides).toHaveLength(1);

    // New sessions in that Domain use the merged profile.
    await as('/settings', 'PUT', { scope: 'DOMAIN', target_id: domainId, changes: [{ key: 'language.he.ilt_canvas', value: code }], ...approval });
    const participant = (await pool.query(
      `INSERT INTO participants (study_code, domain_id, grade_level, gender, dominant_hand) VALUES ($1, $2, 'GRADE_1', 'FEMALE', 'RIGHT') RETURNING id`,
      [`P3C-${run}`, domainId],
    )).rows[0].id;
    const session = await call<{ id: string }>('/sessions', { method: 'POST', auth: evaluator.token, body: { participant_id: participant, session_type: 'DAY_1', language_code: 'he' } });
    expect(session.status).toBe(201);
    const snap = (await pool.query(
      `SELECT canvas_profile_snapshot AS p FROM session_steps WHERE session_id = $1 AND canvas_id = $2 LIMIT 1`, [session.body.id, v2.body.id],
    )).rows[0].p;
    expect(snap.dots.B).toEqual({ radius_mm: 2, weight_pct: 90, required: true });

    // Removing the override.
    expect((await as(`/canvases/${v2.body.id}/overrides/${domainId}`, 'PUT', { reset: true, ...approval })).body).toEqual({ changed: 1 });

    // Retiring is refused while a setting names the code; a Retired canvas takes no override.
    const inUse = await as<{ error: { code: string; details: { uses: { key: string; scope: string }[] } } }>(`/canvases/${v2.body.id}/retire`, 'POST');
    expect(inUse.body.error).toMatchObject({ code: 'CANVAS_IN_USE', details: { uses: [{ key: 'language.he.ilt_canvas', scope: 'DOMAIN' }] } });
    await as('/settings', 'PUT', { scope: 'DOMAIN', target_id: domainId, changes: [{ key: 'language.he.ilt_canvas', reset: true }], ...approval });
    expect((await as(`/canvases/${v2.body.id}/retire`, 'POST')).body).toEqual({ retired: true });

    expect((await as<{ error: { code: string } }>(`/canvases/${v2.body.id}/overrides/${domainId}`, 'PUT', { profile: domainProfile, ...approval })).body.error.code).toBe('RETIRED');

    // Deleting an unused Draft.
    const v3 = await as<{ id: string }>(`/canvases/${v2.body.id}/versions`, 'POST');
    expect((await as(`/canvases/${v3.body.id}`, 'DELETE')).body).toEqual({ deleted: true });

    await app.appLog.flush();
    const logged = (await pool.query(
      `SELECT event_type FROM app_events WHERE entity_type IN ('canvas', 'canvas_set') AND details->>'code' = $1 ORDER BY id`, [code],
    )).rows.map((r) => r.event_type);
    expect(logged).toEqual(expect.arrayContaining(['canvas.uploaded', 'canvas.updated', 'canvas.validated', 'canvas.activated', 'canvas.override.changed', 'canvas.version.created', 'canvas.retired', 'canvas.deleted']));
  });
});
