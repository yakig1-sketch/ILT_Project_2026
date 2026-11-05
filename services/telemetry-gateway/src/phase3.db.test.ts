// Gateway test against a real migrated and seeded database (Phase 3a/3b): user management by the
// System Administrator (roles, Research Director PIN, password reset, unlock, deactivation), Domains
// and Regions, and settings with Domain and Region overrides, director approval and history.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

interface UserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  has_director_pin: boolean;
  locked: boolean;
}

describe.skipIf(!DB_URL)('Phase 3a administration against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().slice(0, 8);
  const admin = { email: `phase3-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '', id: '' };
  const evaluator = { email: `phase3-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '' };
  const created: string[] = [];
  const codes = { domain: `T3D_${run}`.toUpperCase(), region: `T3R_${run}`.toUpperCase() };

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
  };
  const login = (email: string, password: string) =>
    call<{ access_token: string; refresh_token: string }>('/auth/login', { method: 'POST', body: { email, password } });
  const events = async (type: string, entityId: string) => {
    await app.appLog.flush();
    return (await pool.query('SELECT details FROM app_events WHERE event_type = $1 AND entity_id = $2 ORDER BY id', [type, entityId])).rows as { details: Record<string, unknown> }[];
  };

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase3-test', schoolHmacKey: 'phase3-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const [u, role] of [[admin, 'ADMIN'], [evaluator, 'EVALUATOR']] as const) {
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id)
         VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL'))`,
        [u.email, await hash(u.password), `Phase 3 test ${role}`, role],
      );
      u.token = (await login(u.email, u.password)).body.access_token;
    }
    admin.id = (await pool.query('SELECT id FROM users WHERE email = $1', [admin.email])).rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1) OR id = ANY($2::uuid[])', [[admin.email, evaluator.email], created]);
    await pool.query('DELETE FROM participants WHERE study_code = $1', [`P3-${run}`]);
    await pool.query(
      `DELETE FROM setting_values WHERE domain_id IN (SELECT id FROM domains WHERE code = $1) OR region_id IN (SELECT id FROM regions WHERE code = $2)`,
      [codes.domain, codes.region],
    );
    await pool.query('DELETE FROM domains WHERE code = $1', [codes.domain]);
    await pool.query('DELETE FROM regions WHERE code = $1', [codes.region]);
    await pool.end();
  });

  it('allows user and organisation management to the System Administrator only', async () => {
    expect((await call('/users', { auth: evaluator.token })).status).toBe(403);
    expect((await call('/users', { method: 'POST', auth: evaluator.token, body: {} })).status).toBe(403);
    expect((await call('/domains?all=true', { auth: evaluator.token })).status).toBe(403);
    expect((await call('/regions', { method: 'POST', auth: evaluator.token, body: { code: 'XX', name_he: 'x', name_en: 'x' } })).status).toBe(403);
    expect((await call('/domains', { auth: evaluator.token })).status).toBe(200);
    expect((await call('/users')).status).toBe(401);
    expect((await call('/settings/catalogue', { auth: evaluator.token })).status).toBe(403);
    expect((await call('/settings/values?scope=SYSTEM', { auth: evaluator.token })).status).toBe(403);
    expect((await call('/settings', { method: 'PUT', auth: evaluator.token, body: {} })).status).toBe(403);
    expect((await call('/settings/history', { auth: evaluator.token })).status).toBe(403);
  });

  it('creates users, changes roles and the director PIN, resets passwords, unlocks and deactivates', async () => {
    const email = `Phase3-New-${run}@ILT.local`;
    const password = `pw-${randomUUID()}`;
    const body = { email, full_name: `Phase 3 new user ${run}`, role: 'EVALUATOR', password };

    // Validation: short password, PIN outside the Researcher role.
    expect((await call('/users', { method: 'POST', auth: admin.token, body: { ...body, password: 'short' } })).status).toBe(400);
    const wrongPin = await call<{ error: { code: string } }>('/users', { method: 'POST', auth: admin.token, body: { ...body, director_pin: '123456' } });
    expect(wrongPin.body.error.code).toBe('PIN_NOT_DIRECTOR');

    const made = await call<UserRow>('/users', { method: 'POST', auth: admin.token, body });
    expect(made.status).toBe(201);
    created.push(made.body.id);
    expect(made.body).toMatchObject({ email: email.toLowerCase(), role: 'EVALUATOR', is_active: true, has_director_pin: false, locked: false });
    expect(made.text).not.toContain('hash');
    expect((await call<{ error: { code: string } }>('/users', { method: 'POST', auth: admin.token, body: { ...body, email: email.toUpperCase() } })).body.error.code).toBe('EMAIL_TAKEN');
    const signedIn = await login(email.toLowerCase(), password);
    expect(signedIn.status).toBe(200);

    // Search by part of the name, any case.
    const found = await call<UserRow[]>(`/users?q=${encodeURIComponent(`NEW USER ${run.toUpperCase()}`)}&role=EVALUATOR`, { auth: admin.token });
    expect(found.body.map((u) => u.id)).toEqual([made.body.id]);

    // Researcher with a director PIN; refresh hands out the new role.
    const pin = String(100000 + Math.floor(Math.random() * 899999));
    const director = await call<UserRow>(`/users/${made.body.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'RESEARCHER', director_pin: pin } });
    expect(director.body).toMatchObject({ role: 'RESEARCHER', has_director_pin: true });
    const refreshed = await call<{ role: string; access_token: string }>('/auth/refresh', { method: 'POST', body: { refresh_token: signedIn.body.refresh_token } });
    expect(refreshed.body.role).toBe('RESEARCHER');
    // Back to Evaluator: the PIN goes with the role.
    const demoted = await call<UserRow>(`/users/${made.body.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'EVALUATOR' } });
    expect(demoted.body).toMatchObject({ role: 'EVALUATOR', has_director_pin: false });
    const updates = await events('users.user.updated', made.body.id);
    expect(updates.at(-1)!.details.changed).toMatchObject({ role: { old: 'RESEARCHER', new: 'EVALUATOR' }, director_pin: 'removed' });
    expect(JSON.stringify(updates)).not.toContain(pin);

    // Five wrong passwords lock the account; the administrator unlocks it.
    for (let i = 0; i < 5; i++) await login(email.toLowerCase(), 'wrong-password');
    expect((await call<UserRow[]>(`/users?q=${run}`, { auth: admin.token })).body.find((u) => u.id === made.body.id)!.locked).toBe(true);
    expect((await login(email.toLowerCase(), password)).status).toBe(423);
    const unlocked = await call<UserRow>(`/users/${made.body.id}`, { method: 'PATCH', auth: admin.token, body: { unlock: true } });
    expect(unlocked.body.locked).toBe(false);

    // Password reset: the old one stops working.
    const next = `pw-${randomUUID()}`;
    await call(`/users/${made.body.id}`, { method: 'PATCH', auth: admin.token, body: { password: next } });
    expect((await login(email.toLowerCase(), password)).status).toBe(401);
    const again = await login(email.toLowerCase(), next);
    expect(again.status).toBe(200);
    expect(JSON.stringify(await events('users.user.updated', made.body.id))).not.toContain(next);

    // Deactivation: no sign-in, no refresh; logged as deactivated.
    const off = await call<UserRow>(`/users/${made.body.id}`, { method: 'PATCH', auth: admin.token, body: { is_active: false } });
    expect(off.body.is_active).toBe(false);
    expect((await login(email.toLowerCase(), next)).status).toBe(401);
    expect((await call('/auth/refresh', { method: 'POST', body: { refresh_token: again.body.refresh_token } })).status).toBe(401);
    expect(await events('users.user.deactivated', made.body.id)).toHaveLength(1);
    expect((await call<UserRow[]>(`/users?q=${run}&active=false`, { auth: admin.token })).body.map((u) => u.id)).toContain(made.body.id);
  });

  it('stops the administrator from locking themself out', async () => {
    const self = await call<{ error: { code: string } }>(`/users/${admin.id}`, { method: 'PATCH', auth: admin.token, body: { is_active: false } });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('SELF_CHANGE');
    expect((await call(`/users/${admin.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'EVALUATOR' } })).status).toBe(409);
    expect((await call(`/users/${admin.id}`, { method: 'PATCH', auth: admin.token, body: { full_name: 'Phase 3 admin renamed' } })).status).toBe(200);
  });

  it('creates, renames, deactivates and reactivates Domains and Regions', async () => {
    const domain = await call<{ id: number; code: string; description_en: string | null }>('/domains', {
      method: 'POST', auth: admin.token,
      body: { code: codes.domain.toLowerCase(), name_he: 'תחום בדיקה', name_en: 'Test domain', description_en: 'Phase 3 test' },
    });
    expect(domain.status).toBe(201);
    expect(domain.body).toMatchObject({ code: codes.domain, description_en: 'Phase 3 test' });
    expect((await call<{ error: { code: string } }>('/domains', { method: 'POST', auth: admin.token, body: { code: codes.domain, name_he: 'א', name_en: 'b' } })).body.error.code).toBe('CODE_TAKEN');
    expect((await call('/domains', { method: 'POST', auth: admin.token, body: { code: 'bad code!', name_he: 'א', name_en: 'b' } })).status).toBe(400);

    const renamed = await call<{ name_en: string; code: string }>(`/domains/${domain.body.id}`, { method: 'PATCH', auth: admin.token, body: { name_en: 'Renamed domain', code: 'IGNORED' } });
    expect(renamed.body).toMatchObject({ name_en: 'Renamed domain', code: codes.domain });
    const renameLog = await events('organisation.domain.updated', String(domain.body.id));
    expect(renameLog[0]!.details.changed).toEqual({ name_en: { old: 'Test domain', new: 'Renamed domain' } });

    await call(`/domains/${domain.body.id}`, { method: 'PATCH', auth: admin.token, body: { is_active: false } });
    expect((await call<{ id: number }[]>('/domains', { auth: evaluator.token })).body.map((d) => d.id)).not.toContain(domain.body.id);
    expect((await call<{ id: number }[]>('/domains?all=true', { auth: admin.token })).body.map((d) => d.id)).toContain(domain.body.id);
    // A user can't be placed in a deactivated Domain.
    const intoInactive = await call('/users', {
      method: 'POST', auth: admin.token,
      body: { email: `phase3-x-${run}@ilt.local`, full_name: 'x', role: 'EVALUATOR', password: `pw-${randomUUID()}`, domain_id: domain.body.id },
    });
    expect(intoInactive.status).toBe(400);
    await call(`/domains/${domain.body.id}`, { method: 'PATCH', auth: admin.token, body: { is_active: true } });
    expect((await call<{ id: number }[]>('/domains', { auth: evaluator.token })).body.map((d) => d.id)).toContain(domain.body.id);

    const region = await call<{ id: number; code: string }>('/regions', { method: 'POST', auth: admin.token, body: { code: codes.region, name_he: 'אזור בדיקה', name_en: 'Test region' } });
    expect(region.status).toBe(201);
    expect((await call('/regions', { method: 'POST', auth: admin.token, body: { code: `${codes.region}2`, name_he: 'א', name_en: 'b', description_en: 'no' } })).status).toBe(400);
    expect(await events('organisation.region.created', String(region.body.id))).toHaveLength(1);
    expect((await call(`/regions/999999`, { method: 'PATCH', auth: admin.token, body: { name_en: 'x' } })).status).toBe(404);
  });

  it('sets, overrides, approves and records settings (FR-ORG-3…7, FR-CAN-12…14)', async () => {
    type Entry = { stored?: unknown; inherited: { value: unknown; source: string }; effective: { value: unknown; source: string } };
    type Values = { values: Record<string, Entry> };
    const put = (body: Record<string, unknown>) => call<{ changed?: number; error?: { code: string; details: unknown } }>('/settings', { method: 'PUT', auth: admin.token, body });
    const values = (q: string) => call<Values>(`/settings/values?${q}`, { auth: admin.token });
    const domainId = (await pool.query('SELECT id FROM domains WHERE code = $1', [codes.domain])).rows[0].id as number;
    const regionId = (await pool.query('SELECT id FROM regions WHERE code = $1', [codes.region])).rows[0].id as number;
    const director = { email: `phase3-dir-${run}@ilt.local`, pin: '864209' };
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, domain_id)
       VALUES ($1, $2, 'Phase 3 director', 'RESEARCHER', $3, (SELECT id FROM domains WHERE code = 'GENERAL'))`,
      [director.email, await hash(`pw-${randomUUID()}`), await hash(director.pin)],
    );
    created.push((await pool.query('SELECT id FROM users WHERE email = $1', [director.email])).rows[0].id);
    const approval = { director_email: director.email, director_pin: director.pin };

    const catalogue = await call<{ definitions: { key: string }[]; canvases: { code: string; recorded_direction: string | null }[] }>('/settings/catalogue', { auth: admin.token });
    expect(catalogue.body.definitions[0]!.key).toBe('scoring.composite.weight_speed_pct');
    // FR-CAN-14: the screen warns when a canvas's recorded fill order disagrees with the language's direction.
    expect(catalogue.body.canvases.find((c) => c.code === 'ILT_3X5_EN')!.recorded_direction).toBe('LTR_ROWS');
    expect(catalogue.body.canvases.find((c) => c.code === 'ILT_3X5_HE')!.recorded_direction).toBe('RTL_ROWS');
    expect(catalogue.body.canvases.find((c) => c.code === 'NOTEBOOK_HE')!.recorded_direction).toBeNull();

    // Scope rules: a Domain takes only Domain settings, a Region only Region settings.
    const domainView = await values(`scope=DOMAIN&target_id=${domainId}`);
    expect(Object.keys(domainView.body.values)).toContain('scoring.composite.weight_speed_pct');
    expect(Object.keys(domainView.body.values)).not.toContain('ilt.timer.inactivity_sec');
    expect((await put({ scope: 'REGION', target_id: regionId, changes: [{ key: 'scoring.pass_threshold', value: 70 }] })).body.error?.code).toBe('INVALID_SETTING');
    expect((await put({ scope: 'DOMAIN', changes: [{ key: 'language.he.mirrored', value: true }] })).status).toBe(400);
    expect((await put({ scope: 'DOMAIN', target_id: 999999, changes: [{ key: 'language.he.mirrored', value: true }] })).status).toBe(404);

    // Validation: range, enum, type and references.
    const invalid = await put({ scope: 'SYSTEM', changes: [
      { key: 'scoring.pen_lift.min_gap_ms', value: 5 },
      { key: 'ilt.inactivity_cue', value: 'LOUD' },
      { key: 'ilt.warmup.enabled', value: 'yes' },
      { key: 'language.en.ilt_canvas', value: 'ILT_3X5_HE' },
    ] });
    expect((invalid.body.error?.details as { errors: { reason: string }[] }).errors.map((e) => e.reason)).toEqual(['range', 'enum', 'type', 'reference']);

    // Governed settings need the director PIN; the weights must total 100.
    const weights = (speed: number, accuracy: number, lifts: number) => [
      { key: 'scoring.composite.weight_speed_pct', value: speed },
      { key: 'scoring.composite.weight_accuracy_pct', value: accuracy },
      { key: 'scoring.composite.weight_pen_lifts_pct', value: lifts },
    ];
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: weights(60, 20, 20) })).body.error?.code).toBe('DIRECTOR_PIN');
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: weights(60, 20, 20), director_email: director.email, director_pin: '000000' })).status).toBe(403);
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: weights(60, 30, 20), ...approval })).body.error?.code).toBe('WEIGHTS_TOTAL');
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: weights(60, 20, 20), reason: 'Phase 3 test', ...approval })).body.changed).toBe(3);
    const speed = (await values(`scope=DOMAIN&target_id=${domainId}`)).body.values['scoring.composite.weight_speed_pct']!;
    expect(speed).toMatchObject({ stored: 60, effective: { value: 60, source: 'DOMAIN' } });
    expect(['SYSTEM', 'DEFAULT']).toContain(speed.inherited.source);
    // Changing one weight alone breaks the total and is refused.
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: [{ key: 'scoring.composite.weight_speed_pct', value: 50 }], ...approval })).body.error?.code).toBe('WEIGHTS_TOTAL');
    // Saving the same values again changes nothing and needs no PIN.
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: weights(60, 20, 20) })).body.changed).toBe(0);

    // Language configuration per Domain.
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: [{ key: 'language.enabled', value: ['en'] }] })).body.error?.code).toBe('DEFAULT_LANGUAGE');
    expect((await put({ scope: 'DOMAIN', target_id: domainId, changes: [
      { key: 'language.enabled', value: ['en'] }, { key: 'language.default', value: 'en' }, { key: 'language.en.fill_direction', value: 'RTL_ROWS' },
    ] })).body.changed).toBe(3);

    // The Domain's languages decide which session languages a participant may use (FR-LANG-5).
    const participant = (await pool.query(
      `INSERT INTO participants (study_code, domain_id, grade_level, gender, dominant_hand) VALUES ($1, $2, 'GRADE_1', 'FEMALE', 'RIGHT') RETURNING id`,
      [`P3-${run}`, domainId],
    )).rows[0].id as string;
    expect((await call(`/participants/${participant}/languages`, { auth: evaluator.token })).body).toEqual({ enabled: ['en'], default: 'en' });
    const refused = await call<{ error: { code: string } }>('/sessions', { method: 'POST', auth: evaluator.token, body: { participant_id: participant, session_type: 'DAY_1', language_code: 'he' } });
    expect(refused.body.error.code).toBe('LANGUAGE_DISABLED');

    // A Region override of a process timer, then back to the inherited value.
    expect((await put({ scope: 'REGION', target_id: regionId, changes: [{ key: 'ilt.timer.inactivity_sec', value: 45 }], ...approval })).body.changed).toBe(1);
    expect((await values(`scope=REGION&target_id=${regionId}`)).body.values['ilt.timer.inactivity_sec']!.effective).toEqual({ value: 45, source: 'REGION' });
    expect((await put({ scope: 'REGION', target_id: regionId, changes: [{ key: 'ilt.timer.inactivity_sec', reset: true }], ...approval })).body.changed).toBe(1);
    expect((await values(`scope=REGION&target_id=${regionId}`)).body.values['ilt.timer.inactivity_sec']!.stored).toBeUndefined();

    // Turning director approval off always needs a director PIN.
    expect((await put({ scope: 'SYSTEM', changes: [{ key: 'governance.require_director_approval', value: false }] })).body.error?.code).toBe('DIRECTOR_PIN');

    // History and log.
    const history = await call<{ key: string; old_value: unknown; new_value: unknown; approved_by: string | null }[]>(
      `/settings/history?scope=REGION&target_id=${regionId}`, { auth: admin.token },
    );
    expect(history.body.map((h) => [h.key, h.old_value, h.new_value])).toEqual([['ilt.timer.inactivity_sec', 45, null], ['ilt.timer.inactivity_sec', null, 45]]);
    expect(history.body[0]).toMatchObject({ approved_by: 'Phase 3 director' });
    const domainHistory = await call<{ reason: string | null }[]>(`/settings/history?scope=DOMAIN&target_id=${domainId}&key=scoring.composite.weight_speed_pct`, { auth: admin.token });
    expect(domainHistory.body).toEqual([expect.objectContaining({ reason: 'Phase 3 test' })]);
    const log = await events('settings.override.changed', 'ilt.timer.inactivity_sec');
    expect(log.at(-1)!.details).toMatchObject({ scope: 'REGION', region_id: regionId, old_value: 45, removed: true });
  });
});
