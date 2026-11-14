// Phase 5e against the database: paper-cohort blocks fill the Comparative Summary's anchors (no speed or
// composite), legacy results get their own section per session label, analysts see both only with
// current research consent and by the participant filters, exports carry their study codes, and the
// console says whether Research may be chosen for an intervention session.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { researchCheck } from './routes/participants.js';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('Phase 5e paper and legacy results against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().slice(0, 8);
  const pw = `pw-${randomUUID()}`;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let exportBody: { session_ids: string[]; study_codes: string[] } | null = null;

  const call = async <T>(method: string, path: string, token: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  beforeAll(async () => {
    app = await buildApp({
      db: pool, checkS3: async () => true, jwtSecret: 'phase5e-test', schoolHmacKey: 'phase5e-school', logLevel: 'silent',
      // Stand-in for the analytics service: records the export request.
      analytics: async (path, body) => {
        if (path === '/exports') exportBody = body as typeof exportBody;
        return { status: 200, body: { object_key: 'exports/x.zip', size_bytes: 1, row_counts: {} } };
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const role of ['evaluator', 'analyst'] as const) {
      const email = `phase5e-${role}-${run}@ilt.local`;
      userIds[role] = (await pool.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, await hash(pw), `Phase 5e ${role}`, role.toUpperCase()])).rows[0].id;
      tokens[role] = (await call<{ access_token: string }>('POST', '/auth/login', '', { email, password: pw })).body.access_token;
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])', [Object.values(userIds)]);
    await pool.end();
  });

  it('shows paper and legacy results in the summary, to analysts with consent, and in exports', async () => {
    const ev = tokens.evaluator!;
    // A Domain of this test only, so the analyst's filter finds just these participants.
    const domain = (await pool.query(`INSERT INTO domains (code, name_he, name_en, description_he, description_en) VALUES ($1, 'בדיקה', $1, '', '') RETURNING id`,
      [`T5E_${run}`.toUpperCase()])).rows[0].id as number;
    const create = async (code: string, gender: string, cohort: 'PAPER' | 'TABLET') => (await call<{ id: string }>('POST', '/participants', ev, {
      study_code: code, domain_id: domain, school: 'Phase 5e school', birth_year_month: '2019-01', grade_level: 'GRADE_1', gender, dominant_hand: 'RIGHT', cohort,
    })).body.id;
    const paperCode = `T5E-P-${run}`;
    const legacyCode = `T5E-L-${run}`;
    const paper = await create(paperCode, 'FEMALE', 'PAPER');
    // A legacy child with imported blocks (the import itself is covered in Phase 4d).
    const legacy = await create(legacyCode, 'MALE', 'TABLET');
    await pool.query("UPDATE participants SET cohort = 'LEGACY' WHERE id = $1", [legacy]);
    const batch = (await pool.query(`INSERT INTO legacy_import_batches (imported_by, session_label, domain_id, files, participants_created, participants_matched, block_rows)
      VALUES ($1, 'Old 2019', $2, '[]', 0, 1, 2) RETURNING id`, [userIds.evaluator, domain])).rows[0].id;
    for (const [n, lifts, width, total] of [[1, 15, 11, 30000], [2, 19, 13, 40000]] as const) {
      await pool.query(`INSERT INTO legacy_block_results (participant_id, import_batch_id, source_file, session_label, block_number, pen_lifts, width_mm, total_time_ms, writing_time_ms, air_time_ms, raw_row)
        VALUES ($1, $2, 'old.xls', 'Old 2019', $3, $4, $5, $6, $6 / 2, $6 / 2, '{}')`, [legacy, batch, n, lifts, width, total]);
    }

    // ---- Paper blocks fill the Day 1 first pair; the other anchors stay empty.
    for (const s of [{ block_number: 1, pen_lifts: 15, accurate_letters: 12, total_time_ms: 30000 }, { block_number: 2, pen_lifts: 17, accurate_letters: 15, total_time_ms: 34000 }]) {
      expect((await call('PUT', `/participants/${paper}/paper-scores`, ev, { session_type: 'DAY_1', notes: null, ...s })).body).toEqual({ saved: true });
    }
    type Box = { key: string; source: string; complete: boolean; avg_time_ms: number | null; avg_pen_lifts: number | null; avg_accurate_letters: number | null;
      accuracy_pct: number | null; pen_lift_score: number | null; speed_score: number | null; composite_score: number | null; blocks: { attempt_id: string | null; on_paper?: boolean }[] };
    type Summary = { participant: { cohort: string }; boxes: Box[]; legacy: { session_label: string; blocks: unknown[]; means: Record<string, number | null> }[] };
    const ps = (await call<Summary>('GET', `/participants/${paper}/summary`, ev)).body;
    expect(ps.participant.cohort).toBe('PAPER');
    expect(ps.boxes.find((b) => b.key === 'DAY_1_FIRST')).toMatchObject({
      source: 'PAPER', complete: true, avg_time_ms: 32000, avg_pen_lifts: 16, avg_accurate_letters: 13.5, accuracy_pct: 90,
      pen_lift_score: 94.12, speed_score: null, composite_score: null, blocks: [{ attempt_id: null, on_paper: true }, { attempt_id: null, on_paper: true }],
    });
    expect(ps.boxes.find((b) => b.key === 'DAY_1_LAST')).toMatchObject({ source: 'TABLET', avg_time_ms: null });
    expect(ps.legacy).toEqual([]);

    // ---- Legacy results: their own section per session label, with the label's means.
    const ls = (await call<Summary>('GET', `/participants/${legacy}/summary`, ev)).body;
    expect(ls.legacy).toEqual([expect.objectContaining({
      session_label: 'Old 2019', means: { pen_lifts: 17, width_mm: 12, total_time_ms: 35000, writing_time_ms: 17500, air_time_ms: 17500 },
    })]);
    expect(ls.legacy[0]!.blocks).toHaveLength(2);

    // ---- Analysts: nothing without current research consent.
    const an = tokens.analyst!;
    type Offline = { participants: number; anchors: { key: string; participants: number; blocks: number; avg_pen_lifts: number | null; accuracy_pct: number | null }[];
      labels: { session_label: string; participants: number; pen_lifts: number | null }[]; paper: { total: number; rows: { study_code: string }[] }; legacy: { total: number } };
    const offline = async (q: string) => (await call<Offline>('GET', `/research/offline?domain_id=${domain}${q}`, an)).body;
    const none = await offline('');
    expect(none.anchors.find((a) => a.key === 'DAY_1_FIRST')).toMatchObject({ participants: 0, blocks: 0 });
    expect(none.labels).toEqual([]);
    expect((await call('POST', '/research/exports', an, { filters: { domain_id: String(domain) }, format: 'CSV' })).body).toMatchObject({ error: { code: 'NO_SESSIONS' } });

    const today = new Date().toISOString().slice(0, 10);
    // A form signed "today" in Israel just after midnight is still yesterday in UTC: accepted; days ahead are not.
    const israelToday = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await call('POST', `/participants/${legacy}/consent`, ev, { consent_version: 'v0', signed_on: israelToday })).status).toBe(201);
    expect((await call('POST', `/participants/${legacy}/consent`, ev, { consent_version: 'v0', signed_on: later })).status).toBe(400);
    for (const id of [paper, legacy]) {
      expect((await call('POST', `/participants/${id}/consent`, ev, { consent_version: 'v1', signed_on: today, allows_research_use: true })).status).toBe(201);
    }
    const seen = await offline('');
    expect(seen.anchors.find((a) => a.key === 'DAY_1_FIRST')).toMatchObject({ participants: 1, blocks: 2, avg_pen_lifts: 16, accuracy_pct: 90 });
    expect(seen.labels).toEqual([expect.objectContaining({ session_label: 'Old 2019', participants: 1, pen_lifts: 17 })]);
    expect(seen.paper.total).toBe(2);
    expect(seen.legacy.total).toBe(2);
    // The participant filters apply: only the legacy child is MALE.
    const male = await offline('&gender=MALE');
    expect(male.paper.total).toBe(0);
    expect(male.legacy.total).toBe(2);
    // The participants an export would include, for the portal's Exports screen.
    expect(seen.participants).toBe(2);
    expect(male.participants).toBe(1);
    expect(none.participants).toBe(0);

    // ---- Exports carry the paper and legacy participants' study codes (no research sessions here).
    expect((await call('POST', '/research/exports', an, { filters: { domain_id: String(domain) }, format: 'CSV' })).status).toBe(202);
    for (let i = 0; i < 30 && !exportBody; i++) await new Promise((r) => setTimeout(r, 100));
    expect(exportBody).toMatchObject({ session_ids: [], study_codes: [legacyCode, paperCode].sort() });

    // ---- The console says whether Research may be chosen, as the new-session form does (FR-PLAN-1).
    const protocol = (await call<{ intervention: { research: { allowed: boolean; reason?: string } } }>('GET', `/participants/${paper}/protocol`, ev)).body;
    const check = await researchCheck(pool, paper);
    expect(protocol.intervention.research).toEqual(check.allowed ? { allowed: true } : { allowed: false, reason: check.reason });
    // A consent without research use always blocks it.
    await call('POST', `/participants/${paper}/consent`, ev, { consent_version: 'v2', signed_on: today, allows_research_use: false });
    const after = (await call<{ intervention: { research: { allowed: boolean; reason?: string } } }>('GET', `/participants/${paper}/protocol`, ev)).body;
    expect(after.intervention.research.allowed).toBe(false);
  });
});
