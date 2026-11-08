// Gateway test against a real migrated and seeded database (Phase 3f): participants and consent.
// The participant record is edited without identity data (the study code never changes, the school is
// only a hash and is logged only as "changed"); consent is a history (FR-PART-4); a research session
// needs the research setting, a valid research approval and research consent (FR-PLAN-1); hand video
// needs the setting and consent (FR-PRIV-2). Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

interface Detail {
  study_code: string;
  grade_level: string;
  ses_group: string | null;
  is_active: boolean;
  consent: { consent_version: string; allows_research_use: boolean } | null;
  consent_history: { consent_version: string; superseded_at: string | null }[];
  research: { allowed: boolean; reason?: string };
  hand_video: { setting: boolean };
}

describe.skipIf(!DB_URL)('Phase 3f participants and consent against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().slice(0, 8);
  const mk = (role: string) => ({ email: `phase3f-${role.toLowerCase()}-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '', id: '', role });
  const admin = mk('ADMIN');
  const evaluator = mk('EVALUATOR');
  const analyst = mk('ANALYST');
  let domainId = 0;
  let pid = '';
  let approvalId = 0;

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const ev = <T>(path: string, method = 'GET', body?: unknown) => call<T>(path, { method, body, auth: evaluator.token });
  const detail = async () => (await ev<Detail>(`/participants/${pid}`)).body;
  const lastLog = async (type: string) =>
    (await pool.query('SELECT message, details FROM app_events WHERE event_type = $1 AND entity_id = $2 ORDER BY id DESC LIMIT 1', [type, pid])).rows[0];
  const newSession = (purpose?: string) =>
    ev<{ id: string; error?: { code: string } }>('/sessions', 'POST', { participant_id: pid, session_type: 'DAY_1', language_code: 'he', ...(purpose ? { purpose } : {}) });

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase3f-test', schoolHmacKey: 'phase3f-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
    for (const u of [admin, evaluator, analyst]) {
      u.id = (await pool.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.email, await hash(u.password), `Phase 3f ${u.role}`, u.role])).rows[0].id;
      u.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).body.access_token;
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool.query("DELETE FROM setting_values WHERE key = 'privacy.research_purpose_enabled' AND set_by = $1", [admin.id]).catch(() => undefined);
    await pool.end();
  });

  it('creates and edits a participant without identity data', async () => {
    const created = await ev<{ id: string }>('/participants', 'POST', {
      study_code: `T3F-${run}`, domain_id: domainId, school: 'Phase 3f School', birth_year_month: '2019-03',
      grade_level: 'GRADE_1', gender: 'FEMALE', ses_group: 'MID', dominant_hand: 'RIGHT',
    });
    expect(created.status).toBe(201);
    pid = created.body.id;
    // The code is unique whatever its case.
    expect((await ev('/participants', 'POST', {
      study_code: `t3f-${run}`, domain_id: domainId, school: 'x', birth_year_month: '2019-03', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT',
    })).status).toBe(409);

    const d = await detail();
    expect(d).toMatchObject({ study_code: `T3F-${run}`, ses_group: 'MID', consent: null, consent_history: [], research: { allowed: false, reason: 'RESEARCH_DISABLED' } });
    expect(JSON.stringify(d)).not.toContain('Phase 3f School');

    // The study code cannot change; other fields can, and only real changes are logged.
    expect((await ev(`/participants/${pid}`, 'PATCH', { study_code: 'OTHER' })).status).toBe(400);
    const patched = await ev<{ changed: string[] }>(`/participants/${pid}`, 'PATCH', { grade_level: 'GRADE_2', ses_group: 'MID', school: 'Another School' });
    expect(patched.body.changed.sort()).toEqual(['grade_level', 'school']);
    expect((await detail()).grade_level).toBe('GRADE_2');
    await app.appLog.flush();
    const log = await lastLog('participants.participant.updated');
    expect(log.details.changed).toEqual({ grade_level: { old: 'GRADE_1', new: 'GRADE_2' }, school: 'changed' });
    expect(JSON.stringify(log)).not.toMatch(/Another School/i);
    // The same school again is no change.
    expect((await ev<{ changed: string[] }>(`/participants/${pid}`, 'PATCH', { school: '  another   SCHOOL ' })).body.changed).toEqual([]);
  });

  it('keeps consent as a history with private defaults', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v1', signed_on: future })).status).toBe(400);
    expect((await ev(`/participants/${pid}/consent`, 'POST', { consent_version: ' ', signed_on: '2026-09-01' })).status).toBe(400);

    expect((await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v1', signed_on: '2026-09-01' })).status).toBe(201);
    let d = await detail();
    expect(d.consent).toMatchObject({ consent_version: 'v1', allows_research_use: false });
    expect(d.research.reason).toBe('RESEARCH_DISABLED');

    expect((await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v2', signed_on: '2026-10-01', allows_research_use: true })).status).toBe(201);
    d = await detail();
    expect(d.consent).toMatchObject({ consent_version: 'v2', allows_research_use: true });
    expect(d.consent_history.map((c) => [c.consent_version, c.superseded_at === null])).toEqual([['v2', true], ['v1', false]]);

    await app.appLog.flush();
    const log = (await pool.query("SELECT details FROM app_events WHERE event_type = 'participants.consent.recorded' AND details->>'study_code' = $1 ORDER BY id DESC LIMIT 1", [`T3F-${run}`])).rows[0];
    expect(log.details).toMatchObject({ consent_version: 'v2', new: { research_use: true }, old: { consent_version: 'v1', research_use: false } });
    // The application can never delete a consent record.
    await expect(pool.query('DELETE FROM consent_records WHERE participant_id = $1', [pid])).rejects.toThrow(/permission denied/);
  });

  it('allows a research session only with the setting, a valid approval and research consent', async () => {
    expect((await newSession('RESEARCH')).body.error?.code).toBe('RESEARCH_DISABLED');
    await pool.query(`INSERT INTO setting_values (key, scope, value, set_by) VALUES ('privacy.research_purpose_enabled', 'SYSTEM', 'true', $1)
                      ON CONFLICT (key, scope, domain_id, region_id) DO UPDATE SET value = 'true'`, [admin.id]);
    // Earlier test runs may have left a valid research approval: withdraw them so this run starts from none.
    for (const r of (await pool.query("SELECT id FROM ethics_approvals WHERE approval_type = 'RESEARCH' AND withdrawn_at IS NULL")).rows) {
      await call(`/ethics-approvals/${r.id}`, { method: 'PATCH', body: { withdrawn: true }, auth: admin.token });
    }
    expect((await newSession('RESEARCH')).body.error?.code).toBe('NO_RESEARCH_APPROVAL');

    // Only the System Administrator records approvals; dates must be in order; an expired one does not count.
    const approval = { approval_type: 'RESEARCH', authority: `Phase 3f IRB ${run}`, reference: 'T-1' };
    expect((await ev('/ethics-approvals', 'POST', approval)).status).toBe(403);
    expect((await call('/ethics-approvals', { method: 'POST', body: { ...approval, valid_from: '2026-02-01', valid_to: '2026-01-01' }, auth: admin.token })).status).toBe(400);
    const expired = await call<{ id: number; valid_now: boolean }>('/ethics-approvals', { method: 'POST', body: { ...approval, valid_to: '2020-01-01' }, auth: admin.token });
    expect(expired.body.valid_now).toBe(false);
    expect((await newSession('RESEARCH')).body.error?.code).toBe('NO_RESEARCH_APPROVAL');
    const ok = await call<{ id: number; valid_now: boolean }>('/ethics-approvals', { method: 'POST', body: approval, auth: admin.token });
    expect(ok.status).toBe(201);
    expect(ok.body.valid_now).toBe(true);
    approvalId = ok.body.id;

    const research = await newSession('RESEARCH');
    expect(research.status).toBe(201);
    const row = (await pool.query('SELECT purpose, research_approval_id, video_enabled FROM sessions WHERE id = $1', [research.body.id])).rows[0];
    expect(row).toEqual({ purpose: 'RESEARCH', research_approval_id: approvalId, video_enabled: false });
    expect((await call<{ sessions: number }[]>('/ethics-approvals', { auth: admin.token })).body.find((a) => (a as unknown as { id: number }).id === approvalId)?.sessions).toBe(1);

    // Consent withdrawn from research: research is blocked again; intervention sessions are unaffected.
    await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v3', signed_on: '2026-10-15' });
    expect((await newSession('RESEARCH')).body.error?.code).toBe('NO_RESEARCH_CONSENT');
    const plain = await newSession();
    expect(plain.status).toBe(201);
    expect((await pool.query('SELECT purpose FROM sessions WHERE id = $1', [plain.body.id])).rows[0].purpose).toBe('INTERVENTION');

    // A withdrawn approval is kept but no longer valid.
    await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v4', signed_on: '2026-10-20', allows_research_use: true });
    const withdrawn = await call<{ withdrawn_at: string | null; valid_now: boolean }>(`/ethics-approvals/${approvalId}`, { method: 'PATCH', body: { withdrawn: true }, auth: admin.token });
    expect(withdrawn.body.withdrawn_at).not.toBeNull();
    expect(withdrawn.body.valid_now).toBe(false);
    expect((await newSession('RESEARCH')).body.error?.code).toBe('NO_RESEARCH_APPROVAL');
    await expect(pool.query('DELETE FROM ethics_approvals WHERE id = $1', [approvalId])).rejects.toThrow(/permission denied/);
  });

  it('records hand video only with the setting and consent', async () => {
    await pool.query(`INSERT INTO setting_values (key, scope, value, set_by) VALUES ('ilt.video.recording_enabled', 'SYSTEM', 'true', $1)
                      ON CONFLICT (key, scope, domain_id, region_id) DO UPDATE SET value = 'true'`, [admin.id]);
    try {
      expect((await detail()).hand_video.setting).toBe(true);
      const without = await newSession();
      expect((await pool.query('SELECT video_enabled FROM sessions WHERE id = $1', [without.body.id])).rows[0].video_enabled).toBe(false);
      await ev(`/participants/${pid}/consent`, 'POST', { consent_version: 'v5', signed_on: '2026-10-25', allows_hand_video: true });
      const withConsent = await newSession();
      expect((await pool.query('SELECT video_enabled FROM sessions WHERE id = $1', [withConsent.body.id])).rows[0].video_enabled).toBe(true);
    } finally {
      await pool.query("DELETE FROM setting_values WHERE key = 'ilt.video.recording_enabled' AND scope = 'SYSTEM' AND set_by = $1", [admin.id]);
    }
  });

  it('deactivates a participant and limits who may see them', async () => {
    expect((await call(`/participants/${pid}`, { auth: analyst.token })).status).toBe(403);
    expect((await ev(`/participants/${pid}`, 'PATCH', { is_active: false })).status).toBe(200);
    expect((await ev<{ id: string }[]>(`/participants?q=T3F-${run}`)).body).toEqual([]);
    expect((await ev<{ id: string }[]>(`/participants?q=T3F-${run}&all=true`)).body.map((p) => p.id)).toEqual([pid]);
    expect((await newSession()).status).toBe(404);
    expect((await ev<{ error: { code: string } }>(`/participants/${pid}/consent`, 'POST', { consent_version: 'v6', signed_on: '2026-10-26' })).body.error.code).toBe('PARTICIPANT_INACTIVE');
    await app.appLog.flush();
    expect((await lastLog('participants.participant.updated')).message).toMatch(/deactivated$/);
  });
});
