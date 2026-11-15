// Gateway test against a real migrated and seeded database (Phase 5g): the analyst portal's cohort overview
// (FR-AN-1; FRS v3.3 Figure 8): totals, the learning curve, the box plots and the participant table.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('Phase 5g cohort overview against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  // One school for the run, so the school filter isolates it.
  const school = createHash('sha256').update(`phase5g-${run}`).digest('hex');
  const schoolKey = school.slice(0, 8);
  const pw = `pw-${randomUUID()}`;
  const tokens = { analyst: '', evaluator: '' };
  let evaluator = '';
  let day14First = '';

  const get = async (path: string, token = tokens.analyst) => {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase5g-test', schoolHmacKey: 'phase5g-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const role of ['analyst', 'evaluator'] as const) {
      const email = `phase5g-${role}-${run}@ilt.local`;
      const id = (await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, await hash(pw), `Phase 5g ${role}`, role.toUpperCase()])).rows[0].id as string;
      if (role === 'evaluator') evaluator = id;
      const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
      tokens[role] = ((await res.json()) as { access_token: string }).access_token;
    }
    const domain = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id;
    const canvas = (await pool.query("SELECT id FROM canvases WHERE code = 'ILT_3X5_HE' AND status = 'ACTIVE'")).rows[0].id;
    const snapshot = JSON.stringify({ 'scoring.pass_threshold': { value: 60, source: 'DEFAULT' } });

    const participant = async (code: string, gender: string, ses: string | null) => {
      const id = (await pool.query(
        `INSERT INTO participants (study_code, domain_id, school_code_hmac, grade_level, gender, ses_group, dominant_hand)
         VALUES ($1, $2, $3, 'GRADE_1', $4, $5, 'RIGHT') RETURNING id`, [code, domain, school, gender, ses])).rows[0].id as string;
      await pool.query(
        `INSERT INTO consent_records (participant_id, consent_version, signed_on, allows_research_use, recorded_by) VALUES ($1, 'T5G', current_date, true, $2)`,
        [id, evaluator]);
      return id;
    };
    /** A completed research session of the stage with ILT blocks [block number, seconds, composite]. */
    const session = async (ppt: string, stage: string, blocks: [number, number, number][]) => {
      const template = (await pool.query(
        `SELECT id FROM protocol_templates ORDER BY (session_type = $1) DESC, id LIMIT 1`, [stage])).rows[0].id;
      const id = (await pool.query(
        `INSERT INTO sessions (session_code, participant_id, evaluator_id, domain_id, language_code, purpose, session_type, protocol_template_id,
                               status, settings_snapshot, started_at, completed_at, research_approval_id)
         VALUES ($1, $2, $3, $4, 'he', 'RESEARCH', $5, $6, 'COMPLETED', $7, now() - interval '1 hour', now(), (SELECT min(id) FROM ethics_approvals))
         RETURNING id`, [`T5G-${randomUUID().slice(0, 8)}`, ppt, evaluator, domain, stage, template, snapshot])).rows[0].id as string;
      const attempts: string[] = [];
      for (const [i, [block, sec, composite]] of blocks.entries()) {
        const step = (await pool.query(
          `INSERT INTO session_steps (session_id, step_index, step_type, label_key, block_number, is_scored, canvas_id)
           VALUES ($1, $2, 'ILT_BLOCK', 'step.ilt_block', $3, true, $4) RETURNING id`, [id, i + 1, block, canvas])).rows[0].id;
        const attempt = (await pool.query(
          `INSERT INTO block_attempts (session_step_id, attempt_number, status, started_at, ended_at, total_time_ms, sample_count)
           VALUES ($1, 1, 'COMPLETED', now() - interval '30 minutes', now() - interval '29 minutes', $2, 3) RETURNING id`, [step, sec * 1000])).rows[0].id as string;
        await pool.query(
          `INSERT INTO score_versions (block_attempt_id, version, settings_used, profile_used, engine_version, letters_expected, pen_lifts,
                                       accuracy_score, avg_speed_mm_s, speed_score, composite_score)
           VALUES ($1, 1, '{}', '{}', 'test', 15, 3, 50, 20, 40, $2)`, [attempt, composite]);
        attempts.push(attempt);
      }
      return attempts;
    };

    // P1 (male, low SES): Day 1 blocks 1–2, Day 14 blocks 1–2 (composite 75 ≥ 60: pass).
    const p1 = await participant(`T5G-A-${run}`, 'MALE', 'LOW');
    await session(p1, 'DAY_1', [[1, 60, 40], [2, 50, 50]]);
    day14First = (await session(p1, 'DAY_14', [[1, 40, 70], [2, 30, 80]]))[0]!;
    // P2 (female, no SES): Day 1 block 1, Day 14 block 1 (composite 40: not a pass).
    const p2 = await participant(`T5G-B-${run}`, 'FEMALE', null);
    await session(p2, 'DAY_1', [[1, 80, 30]]);
    await session(p2, 'DAY_14', [[1, 70, 40]]);
    // P3 (female): Day 1 block 1 only.
    const p3 = await participant(`T5G-C-${run}`, 'FEMALE', null);
    await session(p3, 'DAY_1', [[1, 100, 20]]);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it('is for analysts and researchers, with a known grouping and measure', async () => {
    expect((await get('/research/overview', tokens.evaluator)).status).toBe(403);
    expect((await get('/research/overview?group_by=name')).status).toBe(400);
    expect((await get('/research/overview?measure=height')).status).toBe(400);
  });

  it('gives the totals, the learning curve and the spread per group', async () => {
    const { status, body } = await get(`/research/overview?school=${schoolKey}&measure=time`);
    expect(status).toBe(200);
    expect(body.totals).toMatchObject({ participants: 3, sessions: 5, blocks: 7 });
    expect(body.curve.map((c: any) => [c.session_type, c.block_number, c.blocks, c.mean])).toEqual([
      ['DAY_1', 1, 3, 80], ['DAY_1', 2, 1, 50], ['DAY_14', 1, 2, 55], ['DAY_14', 2, 1, 30],
    ]);
    // Each participant's own mean time: 45, 75 and 100 s.
    expect(body.boxes).toEqual([{ grp: 'all', participants: 3, min: 45, q1: 60, median: 75, q3: 87.5, max: 100 }]);

    const byGender = (await get(`/research/overview?school=${schoolKey}&measure=composite&group_by=gender`)).body;
    expect(byGender.curve.filter((c: any) => c.session_type === 'DAY_1' && c.block_number === 1).map((c: any) => [c.grp, c.mean]))
      .toEqual([['FEMALE', 25], ['MALE', 40]]);
    expect(byGender.boxes.map((b: any) => [b.grp, b.participants, b.median])).toEqual([['FEMALE', 2, 27.5], ['MALE', 1, 60]]);
    // Filters apply: low SES only.
    expect((await get(`/research/overview?school=${schoolKey}&ses=LOW`)).body.totals.participants).toBe(1);
  });

  it('lists each participant with the Day 14 composite, pass and the block to replay', async () => {
    const { body } = await get(`/research/overview?school=${schoolKey}`);
    expect(body.participants.total).toBe(3);
    expect(body.participants.rows.map((p: any) => [p.study_code, p.sessions, p.ilt_blocks, p.stages, p.day14_composite, p.day14_pass])).toEqual([
      [`T5G-A-${run}`, 2, 4, ['DAY_1', 'DAY_14'], 75, true],
      [`T5G-B-${run}`, 2, 2, ['DAY_1', 'DAY_14'], 40, false],
      [`T5G-C-${run}`, 1, 1, ['DAY_1'], null, null],
    ]);
    expect(body.participants.rows[0].day14_attempt_id).toBe(day14First);
    expect((await get(`/research/attempts/${day14First}/replay`)).status).not.toBe(403);
  });
});
