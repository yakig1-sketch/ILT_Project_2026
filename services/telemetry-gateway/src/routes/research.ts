// Analyst portal (Phase 4a; FRS FR-AN-1, FR-AN-3, FR-REP-4; DDD §9 research views, §14).
// Every route runs in a transaction as the ilt_analyst database role, which can read only the
// v_research_* views and the Domain and Region names: the database itself keeps analysts to
// RESEARCH sessions of participants whose current consent allows research use (FR-AN-3).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mirrorCanvas, type CanvasGeometry } from '@ilt/template-schemas';
import type { Queryable } from '../app-log.js';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';

/** Attempt statuses that count as a finished block (the latest one of each scored step counts). */
const FINISHED = "('COMPLETED', 'MANUAL_FINISH', 'TIMED_OUT')";
const ROW_LIMIT = 500;

const list = z.string().transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean));
const intList = list.pipe(z.array(z.coerce.number().int()));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ResearchFilter = z.object({
  domain_id: intList.optional(),
  /** Region ids; NONE matches sessions with no Region. */
  region_id: list.pipe(z.array(z.union([z.literal('NONE'), z.coerce.number().int()]))).optional(),
  school: list.pipe(z.array(z.string().regex(/^[0-9a-f]{8}$/))).optional(),
  grade: list.optional(),
  gender: list.optional(),
  /** SES groups; NONE matches participants with no SES recorded. */
  ses: list.optional(),
  hand: list.optional(),
  language: list.optional(),
  session_type: list.optional(),
  canvas: list.optional(),
  inactivity_sec: intList.optional(),
  from: day.optional(),
  to: day.optional(),
  tz: z.string().max(64).default('UTC'),
});
type Filter = z.infer<typeof ResearchFilter>;

/** Cohort grouping: the SQL for each choice (over sel = the chosen sessions, c = their counted blocks). */
export const GROUPS: Record<string, string> = {
  none: "'all'",
  domain: 'sel.domain_id::text',
  region: 'sel.region_id::text',
  school: 'left(sel.school_code_hmac, 8)',
  grade: 'sel.grade_level',
  gender: 'sel.gender',
  ses: 'sel.ses_group',
  hand: 'sel.dominant_hand',
  language: 'sel.language_code',
  stage: 'sel.session_type',
  canvas: 'c.canvas_code',
  inactivity: "(sel.settings_snapshot->'ilt.timer.inactivity_sec'->>'value')",
};

/** WHERE clause over v_research_sessions (alias rs) for the filter. */
export function researchWhere(f: Filter): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const c: string[] = [];
  const add = (sql: (n: string) => string, v: unknown) => {
    values.push(v);
    c.push(sql(`$${values.length}`));
  };
  if (f.domain_id?.length) add((n) => `rs.domain_id = ANY(${n}::int[])`, f.domain_id);
  if (f.region_id?.length) {
    const none = f.region_id.includes('NONE');
    add((n) => `(rs.region_id = ANY(${n}::int[])${none ? ' OR rs.region_id IS NULL' : ''})`, f.region_id.filter((x) => x !== 'NONE'));
  }
  if (f.school?.length) add((n) => `left(rs.school_code_hmac, 8) = ANY(${n}::text[])`, f.school);
  if (f.grade?.length) add((n) => `rs.grade_level = ANY(${n}::text[])`, f.grade);
  if (f.gender?.length) add((n) => `rs.gender = ANY(${n}::text[])`, f.gender);
  if (f.ses?.length) add((n) => `(rs.ses_group = ANY(${n}::text[]) OR (rs.ses_group IS NULL AND 'NONE' = ANY(${n}::text[])))`, f.ses);
  if (f.hand?.length) add((n) => `rs.dominant_hand = ANY(${n}::text[])`, f.hand);
  if (f.language?.length) add((n) => `rs.language_code = ANY(${n}::text[])`, f.language);
  if (f.session_type?.length) add((n) => `rs.session_type = ANY(${n}::text[])`, f.session_type);
  if (f.canvas?.length) add((n) => `EXISTS (SELECT 1 FROM v_research_blocks b WHERE b.session_id = rs.session_id AND b.canvas_code = ANY(${n}::text[]))`, f.canvas);
  if (f.inactivity_sec?.length) add((n) => `(rs.settings_snapshot->'ilt.timer.inactivity_sec'->>'value')::int = ANY(${n}::int[])`, f.inactivity_sec);
  if (f.from || f.to) {
    values.push(f.tz);
    const tz = `$${values.length}`;
    if (f.from) add((n) => `(rs.completed_at AT TIME ZONE ${tz})::date >= ${n}::date`, f.from);
    if (f.to) add((n) => `(rs.completed_at AT TIME ZONE ${tz})::date <= ${n}::date`, f.to);
  }
  return { sql: c.length ? `WHERE ${c.join(' AND ')}` : '', values };
}

/** The chosen sessions (sel) and their counted blocks (counted): the latest finished attempt of each scored step. */
const withSelection = (where: string) => `
  WITH sel AS (SELECT rs.* FROM v_research_sessions rs ${where}),
  counted AS (
    SELECT DISTINCT ON (b.session_id, b.step_index) b.*
      FROM v_research_blocks b JOIN sel ON sel.session_id = b.session_id
     WHERE b.is_scored AND b.status IN ${FINISHED}
     ORDER BY b.session_id, b.step_index, b.attempt_number DESC)`;

/** Means of the block measures, rounded for display. */
const MEASURES = `
  count(c.block_attempt_id)::int AS blocks,
  round(avg(c.composite_score), 1)::float8 AS composite,
  round(avg(c.accuracy_score), 1)::float8 AS accuracy,
  round(avg(c.speed_score), 1)::float8 AS speed_score,
  round(avg(c.avg_speed_mm_s), 2)::float8 AS avg_speed_mm_s,
  round(avg(c.pen_lifts), 2)::float8 AS pen_lifts,
  round(avg(c.total_time_ms))::float8 AS total_time_ms`;

export const researchRoutes: FastifyPluginAsync = async (app) => {
  const analyst = app.requireRole('ANALYST', 'RESEARCHER');
  const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };
  const badRequest = (details: unknown) => ({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details } });

  /** Runs fn as the ilt_analyst role, which reads only the research views (and Domain/Region names). */
  const asAnalyst = <T>(fn: (q: Queryable) => Promise<T>) =>
    inTransaction(app.deps.db, async (q) => {
      await q.query('SET LOCAL ROLE ilt_analyst');
      return fn(q);
    });

  /** Filter choices: Domains and Regions, and the values found in the research data. */
  app.get('/research/options', { preHandler: analyst }, async () =>
    asAnalyst(async (q) => {
      // One connection: the queries run one after another.
      const domains = await rows(q, 'SELECT id, code, name_he, name_en FROM domains ORDER BY code');
      const regions = await rows(q, 'SELECT id, code, name_he, name_en FROM regions ORDER BY code');
      const present = await one<{ sessions: number; participants: number; schools: string[] | null; inactivity: number[] | null; canvases: string[] | null }>(q, `
          SELECT count(*)::int AS sessions, count(DISTINCT study_code)::int AS participants,
                 array_agg(DISTINCT left(school_code_hmac, 8) ORDER BY left(school_code_hmac, 8)) FILTER (WHERE school_code_hmac IS NOT NULL) AS schools,
                 array_agg(DISTINCT (settings_snapshot->'ilt.timer.inactivity_sec'->>'value')::int) FILTER (WHERE settings_snapshot ? 'ilt.timer.inactivity_sec') AS inactivity,
                 (SELECT array_agg(DISTINCT canvas_code ORDER BY canvas_code) FROM v_research_blocks WHERE canvas_code IS NOT NULL) AS canvases
            FROM v_research_sessions`);
      return {
        domains, regions,
        sessions: present?.sessions ?? 0, participants: present?.participants ?? 0,
        schools: present?.schools ?? [], inactivity_sec: (present?.inactivity ?? []).sort((a, b) => a - b), canvases: present?.canvases ?? [],
      };
    }));

  /** The research sessions that match, newest first, each with the means of its counted blocks. */
  app.get('/research/sessions', { preHandler: analyst }, async (req, reply) => {
    const f = ResearchFilter.safeParse(req.query);
    if (!f.success) return reply.status(400).send(badRequest(f.error.flatten()));
    const { sql, values } = researchWhere(f.data);
    return asAnalyst(async (q) => {
      const found = await rows<Record<string, unknown> & { total: number }>(q, `${withSelection(sql)}
        SELECT sel.session_id, sel.session_code, sel.study_code, sel.domain_id, sel.region_id, left(sel.school_code_hmac, 8) AS school_key,
               sel.grade_level, sel.gender, sel.ses_group, sel.dominant_hand, sel.cohort, sel.language_code, sel.session_type,
               sel.age_months, sel.started_at, sel.completed_at,
               (sel.settings_snapshot->'ilt.timer.inactivity_sec'->>'value')::int AS inactivity_sec,
               ${MEASURES}, count(*) OVER ()::int AS total
          FROM sel LEFT JOIN counted c ON c.session_id = sel.session_id
         GROUP BY sel.session_id, sel.session_code, sel.study_code, sel.domain_id, sel.region_id, sel.school_code_hmac, sel.grade_level,
                  sel.gender, sel.ses_group, sel.dominant_hand, sel.cohort, sel.language_code, sel.session_type, sel.age_months,
                  sel.started_at, sel.completed_at, sel.settings_snapshot
         ORDER BY sel.completed_at DESC NULLS LAST, sel.session_code
         LIMIT ${ROW_LIMIT}`, values);
      const total = found[0]?.total ?? 0;
      return { sessions: found.map(({ total: _t, ...s }) => s), total, limited: total > ROW_LIMIT };
    });
  });

  /** Cohort slicing (FR-AN-1): participants, sessions, blocks and mean measures per group. */
  app.get<{ Querystring: Record<string, string> }>('/research/cohort', { preHandler: analyst }, async (req, reply) => {
    const { group_by = 'none', ...rest } = req.query;
    const group = GROUPS[group_by];
    const f = ResearchFilter.safeParse(rest);
    if (!group || !f.success) return reply.status(400).send(badRequest(f.success ? { group_by } : f.error.flatten()));
    const { sql, values } = researchWhere(f.data);
    return asAnalyst(async (q) => ({
      group_by,
      groups: await rows(q, `${withSelection(sql)}
        SELECT ${group} AS grp, count(DISTINCT sel.study_code)::int AS participants, count(DISTINCT sel.session_id)::int AS sessions, ${MEASURES}
          FROM sel LEFT JOIN counted c ON c.session_id = sel.session_id
         GROUP BY 1 ORDER BY 1 NULLS LAST`, values),
    }));
  });

  /** One research session: its details and every block attempt, the counted ones marked. */
  app.get<{ Params: { id: string } }>('/research/sessions/:id', { preHandler: analyst }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    return asAnalyst(async (q) => {
      const session = await one<Record<string, unknown> & { settings_snapshot: Record<string, { value: unknown }> | null }>(q, `
        SELECT session_id, session_code, study_code, domain_id, region_id, left(school_code_hmac, 8) AS school_key, grade_level, gender,
               ses_group, dominant_hand, cohort, session_type, language_code, age_months, device_model, started_at, completed_at, settings_snapshot
          FROM v_research_sessions WHERE session_id = $1`, [req.params.id]);
      if (!session) return reply.status(404).send(notFound);
      const blocks = await rows(q, `
        SELECT b.block_attempt_id, b.step_index, b.step_type, b.label_key, b.block_number, b.canvas_code, b.canvas_version, b.mirrored,
               b.attempt_number, b.status, b.sample_count, b.total_time_ms, b.active_writing_time_ms, b.air_time_ms,
               b.score_version, b.pen_lifts, b.accurate_letters, b.accuracy_score::float8, b.avg_speed_mm_s::float8, b.speed_score::float8,
               b.pen_lift_score::float8, b.composite_score::float8, b.pass,
               (b.is_scored AND b.status IN ${FINISHED} AND b.attempt_number = max(b.attempt_number) FILTER (WHERE b.status IN ${FINISHED})
                  OVER (PARTITION BY b.step_index)) AS counts
          FROM v_research_blocks b WHERE b.session_id = $1 ORDER BY b.step_index, b.attempt_number`, [req.params.id]);
      const snap = session.settings_snapshot ?? {};
      const value = (k: string) => snap[k]?.value ?? null;
      const { settings_snapshot: _s, ...rest } = session;
      return {
        session: {
          ...rest,
          settings: {
            inactivity_sec: value('ilt.timer.inactivity_sec'), inactivity_last_box_sec: value('ilt.timer.inactivity_last_box_sec'),
            pass_threshold: value('scoring.pass_threshold'), weight_speed_pct: value('scoring.composite.weight_speed_pct'),
            weight_accuracy_pct: value('scoring.composite.weight_accuracy_pct'), weight_pen_lifts_pct: value('scoring.composite.weight_pen_lifts_pct'),
          },
        },
        blocks,
      };
    });
  });

  /** Replay data for one research block attempt (FR-REP-4), in the same shape as the cockpit's replay. */
  app.get<{ Params: { id: string } }>('/research/attempts/:id/replay', { preHandler: analyst }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const user = req.user as UserClaims;
    const data = await asAnalyst(async (q) => {
      const a = await one<{
        block_attempt_id: string; session_id: string; session_code: string; attempt_number: number; status: string; step_index: number;
        step_type: string; label_key: string; block_number: number | null; total_time_ms: number | null; mirrored: boolean;
        fill_order: number[] | null; geometry: CanvasGeometry | null; score_version: number | null; composite_score: string | null;
        accuracy_score: string | null; speed_score: string | null; pen_lift_score: string | null; pen_lifts: number | null; avg_speed_mm_s: string | null;
      }>(q, `
        SELECT b.block_attempt_id, b.session_id, rs.session_code, b.attempt_number, b.status, b.step_index, b.step_type, b.label_key,
               b.block_number, b.total_time_ms, b.mirrored, b.fill_order, cv.geometry, b.score_version, b.composite_score,
               b.accuracy_score, b.speed_score, b.pen_lift_score, b.pen_lifts, b.avg_speed_mm_s
          FROM v_research_blocks b JOIN v_research_sessions rs ON rs.session_id = b.session_id
          LEFT JOIN v_research_canvases cv ON cv.canvas_id = b.canvas_id
         WHERE b.block_attempt_id = $1`, [req.params.id]);
      if (!a?.geometry) return undefined;
      const samples = await rows<{ t_us: number; x_mm: number; y_mm: number; pressure: number; flags: number; box_id: number }>(
        q, 'SELECT t_us, x_mm, y_mm, pressure, flags, box_id FROM v_research_samples WHERE block_attempt_id = $1 ORDER BY sample_seq', [a.block_attempt_id]);
      const letters = await rows<{ box_id: number; speed_mm_s: number | null; is_accurate: boolean | null }>(
        q, 'SELECT box_id, speed_mm_s, is_accurate FROM v_research_letters WHERE block_attempt_id = $1 ORDER BY box_id', [a.block_attempt_id]);
      return { a, samples, letters };
    });
    if (!data) return reply.status(404).send(notFound);
    const { a, samples, letters } = data;
    app.appLog.writeOnce(`replay:${user.sub}:${a.block_attempt_id}`, {
      severity: 'INFO', event_type: 'data.replay.opened', actor_user_id: user.sub, actor_role: user.role, session_id: a.session_id,
      entity_type: 'block_attempt', entity_id: a.block_attempt_id,
      message: `Research replay opened: ${a.session_code} step ${a.step_index}, attempt ${a.attempt_number}`, details: { portal: 'analyst' },
    });
    return {
      attempt: { id: a.block_attempt_id, attempt_number: a.attempt_number, status: a.status, session_code: a.session_code, step_index: a.step_index,
        step_type: a.step_type, label_key: a.label_key, block_number: a.block_number, total_time_ms: a.total_time_ms },
      canvas: a.mirrored ? mirrorCanvas(a.geometry!) : a.geometry,
      fill_order: a.fill_order,
      samples: {
        t_us: samples.map((s) => s.t_us), x: samples.map((s) => s.x_mm), y: samples.map((s) => s.y_mm),
        p: samples.map((s) => s.pressure), f: samples.map((s) => s.flags), box: samples.map((s) => s.box_id),
      },
      letters: letters.map((l) => ({ ...l, pen_lifts_internal: null })),
      score: a.score_version == null ? null : {
        version: a.score_version, composite_score: a.composite_score, accuracy_score: a.accuracy_score, speed_score: a.speed_score,
        pen_lift_score: a.pen_lift_score, pen_lifts: a.pen_lifts, avg_speed_mm_s: a.avg_speed_mm_s,
      },
    };
  });
};
