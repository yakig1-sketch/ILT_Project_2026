// Results: Comparative Summary Dashboard (FR-SUM-1…4) and replay data for one block (FR-REP-1/2, DDD §14).
// The pass threshold is set with the other settings (routes/settings.ts).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mirrorCanvas, type CanvasGeometry } from '@ilt/template-schemas';
import type { UserClaims } from '../auth.js';
import { one, rows } from '../db.js';
import { scoringSettingsFrom } from '../scoring-store.js';
import { loadEffectiveSettings, setting } from '../settings-store.js';

/** Anchor pairs compared on the dashboard (FR-SUM-1). */
export const ANCHORS = [
  { key: 'DAY_1_FIRST', session_type: 'DAY_1', blocks: [1, 2] },
  { key: 'DAY_1_LAST', session_type: 'DAY_1', blocks: [7, 8] },
  { key: 'DAY_2_FIRST', session_type: 'DAY_2', blocks: [1, 2] },
  { key: 'DAY_2_LAST', session_type: 'DAY_2', blocks: [3, 4] },
  { key: 'DAY_14', session_type: 'DAY_14', blocks: [1, 2] },
] as const;

/** Blocks that count: the latest finished attempt of each ILT block (a repeated attempt is kept for audit only). */
const FINISHED = "('COMPLETED', 'MANUAL_FINISH', 'TIMED_OUT')";

interface BlockRow {
  session_id: string;
  session_code: string;
  session_type: string;
  block_number: number;
  attempt_id: string;
  attempt_number: number;
  total_time_ms: number | null;
  pen_lifts: number | null;
  accuracy_score: string | null;
  accurate_letters: number | null;
  sum_line_length_mm: number | null;
  sum_line_time_ms: number | null;
  avg_speed_mm_s: string | null;
  speed_score: string | null;
  pen_lift_score: string | null;
  composite_score: string | null;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
const roundOrNull = (v: number | null) => (v === null ? null : Math.round(v));
const mean = (vs:(number | null)[]) => (vs.length === 0 || vs.some((v) => v === null) ? null : (vs as number[]).reduce((a, b) => a + b, 0) / vs.length);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export const resultRoutes: FastifyPluginAsync = async (app) => {
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };

  app.get<{ Params: { id: string } }>('/participants/:id/summary', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const p = await one<{ id: string; study_code: string; domain_id: number; region_id: number | null }>(
      app.deps.db, 'SELECT id, study_code, domain_id, region_id FROM participants WHERE id = $1', [req.params.id],
    );
    if (!p) return reply.status(404).send(notFound);

    // The participant's latest session of each type that was not aborted.
    const sessions = await rows<{ id: string; session_type: string }>(
      app.deps.db,
      `SELECT DISTINCT ON (session_type) id, session_type FROM sessions
        WHERE participant_id = $1 AND status <> 'ABORTED' ORDER BY session_type, created_at DESC`,
      [p.id],
    );
    const blocks = sessions.length === 0 ? [] : await rows<BlockRow>(
      app.deps.db,
      `SELECT DISTINCT ON (st.id) s.id AS session_id, s.session_code, s.session_type, st.block_number, ba.id AS attempt_id,
              ba.attempt_number, ba.total_time_ms, sv.pen_lifts, sv.accuracy_score, sv.accurate_letters, sv.sum_line_length_mm,
              sv.sum_line_time_ms, sv.avg_speed_mm_s, sv.speed_score, sv.pen_lift_score, sv.composite_score
         FROM sessions s
         JOIN session_steps st ON st.session_id = s.id AND st.step_type = 'ILT_BLOCK'
         JOIN block_attempts ba ON ba.session_step_id = st.id AND ba.status IN ${FINISHED}
         LEFT JOIN score_versions sv ON sv.block_attempt_id = ba.id AND sv.is_current
        WHERE s.id = ANY($1::uuid[])
        ORDER BY st.id, ba.attempt_number DESC`,
      [sessions.map((s) => s.id)],
    );

    // Threshold and weights in effect now for the participant's Domain (FR-SUM-4).
    const scoring = scoringSettingsFrom(await loadEffectiveSettings(app.deps.db, p.domain_id, p.region_id));
    const boxes = ANCHORS.map((a) => {
      const bs = a.blocks.map((n) => blocks.find((b) => b.session_type === a.session_type && b.block_number === n) ?? null);
      const found = bs.filter((b): b is BlockRow => b !== null);
      const sumLen = found.reduce((s, b) => s + (b.sum_line_length_mm ?? 0), 0);
      const sumTime = found.reduce((s, b) => s + (b.sum_line_time_ms ?? 0), 0);
      const composite = found.length === 0 ? null : mean(found.map((b) => num(b.composite_score)));
      return {
        key: a.key,
        session_type: a.session_type,
        block_numbers: a.blocks,
        complete: found.length === a.blocks.length,
        blocks: bs.map((b, i) => (b
          ? { block_number: a.blocks[i], attempt_id: b.attempt_id, attempt_number: b.attempt_number, session_code: b.session_code, composite_score: num(b.composite_score) }
          : { block_number: a.blocks[i], attempt_id: null })),
        avg_time_ms: found.length ? mean(found.map((b) => b.total_time_ms)) : null,
        // Pen lifts are counted, so the pair's mean is a whole number (14 and 15 → 15, half rounds up).
        avg_pen_lifts: roundOrNull(found.length ? mean(found.map((b) => b.pen_lifts)) : null),
        accuracy_pct: found.length ? r2(mean(found.map((b) => num(b.accuracy_score)))) : null,
        avg_speed_mm_s: sumTime > 0 ? r2(sumLen / (sumTime / 1000)) : null,
        speed_score: found.length ? r2(mean(found.map((b) => num(b.speed_score)))) : null,
        accuracy_score: found.length ? r2(mean(found.map((b) => num(b.accuracy_score)))) : null,
        pen_lift_score: found.length ? r2(mean(found.map((b) => num(b.pen_lift_score)))) : null,
        composite_score: r2(composite),
        pass: composite === null || scoring.pass_threshold === null ? null : composite >= scoring.pass_threshold,
      };
    });
    return {
      participant: { id: p.id, study_code: p.study_code },
      scoring: {
        pass_threshold: scoring.pass_threshold,
        weight_speed_pct: scoring.weight_speed_pct,
        weight_accuracy_pct: scoring.weight_accuracy_pct,
        weight_pen_lifts_pct: scoring.weight_pen_lifts_pct,
      },
      boxes,
    };
  });

  /**
   * The participant's protocol at a glance (FRS v3.3 Figure 2, Dispatch Console): the latest
   * non-aborted session of each type with its steps and their status, the Day 14 block average, and
   * the timer and warm-up settings in effect now for the participant.
   */
  app.get<{ Params: { id: string } }>('/participants/:id/protocol', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const user = req.user as UserClaims;
    const p = await one<{ id: string; study_code: string; grade_level: string | null; domain_id: number; region_id: number | null;
      domain_code: string; domain_name_he: string; domain_name_en: string }>(
      app.deps.db,
      `SELECT p.id, p.study_code, p.grade_level, p.domain_id, p.region_id, d.code AS domain_code, d.name_he AS domain_name_he, d.name_en AS domain_name_en
         FROM participants p JOIN domains d ON d.id = p.domain_id WHERE p.id = $1`,
      [req.params.id],
    );
    if (!p) return reply.status(404).send(notFound);

    // Each day shows the session that carries its protocol: one running now, else the latest completed,
    // else the latest planned. A later duplicate (for example a second Day 1 planned after Day 1 was
    // completed) must not hide the completed day; it is listed in `others` instead.
    const all = await rows<{ id: string; session_code: string; session_type: string; status: string; language_code: string;
      created_at: string; evaluator_id: string }>(
      app.deps.db,
      `SELECT id, session_code, session_type, status, language_code, created_at, evaluator_id FROM sessions
        WHERE participant_id = $1 AND status <> 'ABORTED'
        ORDER BY session_type,
                 CASE WHEN status IN ('PAIRED', 'IN_PROGRESS', 'PAUSED') THEN 0 WHEN status = 'COMPLETED' THEN 1 ELSE 2 END,
                 created_at DESC`,
      [p.id],
    );
    const sessions = all.filter((s, i) => i === 0 || all[i - 1]!.session_type !== s.session_type);
    const canOpen = (s: { evaluator_id: string }) => user.role !== 'EVALUATOR' || s.evaluator_id === user.sub;
    const steps = sessions.length === 0 ? [] : await rows<{ session_id: string; step_index: number; step_type: string; label_key: string;
      block_number: number | null; is_scored: boolean; status: string; video_key: string | null; composite_score: string | null }>(
      app.deps.db,
      `SELECT st.session_id, st.step_index, st.step_type, st.label_key, st.block_number, st.is_scored, st.status, st.video_key,
              (SELECT sv.composite_score FROM block_attempts ba JOIN score_versions sv ON sv.block_attempt_id = ba.id AND sv.is_current
                WHERE ba.session_step_id = st.id AND ba.status IN ${FINISHED} ORDER BY ba.attempt_number DESC LIMIT 1) AS composite_score
         FROM session_steps st WHERE st.session_id = ANY($1::uuid[]) ORDER BY st.session_id, st.step_index`,
      [sessions.map((s) => s.id)],
    );

    const settings = await loadEffectiveSettings(app.deps.db, p.domain_id, p.region_id);
    const sourceOf = (key: string) => settings[key]?.source ?? 'DEFAULT';
    const day14 = sessions.find((s) => s.session_type === 'DAY_14');
    const day14Scores = steps.filter((st) => st.session_id === day14?.id && st.step_type === 'ILT_BLOCK').map((st) => num(st.composite_score));
    return {
      participant: {
        id: p.id, study_code: p.study_code, grade_level: p.grade_level,
        domain: { code: p.domain_code, name_he: p.domain_name_he, name_en: p.domain_name_en },
      },
      sessions: Object.fromEntries(sessions.map((s) => [s.session_type, {
        id: s.id, session_code: s.session_code, status: s.status, language_code: s.language_code, created_at: s.created_at,
        // Evaluators open only their own sessions (as GET /sessions/:id).
        can_open: canOpen(s),
        others: all.filter((o) => o.session_type === s.session_type && o.id !== s.id)
          .map((o) => ({ id: o.id, session_code: o.session_code, status: o.status, can_open: canOpen(o) })),
        steps: steps.filter((st) => st.session_id === s.id).map(({ session_id: _s, composite_score, ...st }) => ({ ...st, composite_score: num(composite_score) })),
      }])),
      day14_average: day14Scores.length && day14Scores.every((v) => v !== null) ? r2(mean(day14Scores)) : null,
      settings: {
        in_transition_sec: setting(settings, 'ilt.timer.in_transition_sec', 20),
        inactivity_sec: setting(settings, 'ilt.timer.inactivity_sec', 20),
        timers_source: [sourceOf('ilt.timer.in_transition_sec'), sourceOf('ilt.timer.inactivity_sec')].find((x) => x !== 'SYSTEM' && x !== 'DEFAULT') ?? sourceOf('ilt.timer.in_transition_sec'),
        warmup_enabled: setting(settings, 'ilt.warmup.enabled', true),
        director_approval: setting(settings, 'governance.require_director_approval', true),
      },
    };
  });

  /** Replay data for one block attempt (FR-REP-1/2): the canvas as written, every sample, and per-house speed. */
  app.get<{ Params: { id: string } }>('/attempts/:id/replay', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const user = req.user as UserClaims;
    const a = await one<{
      id: string; attempt_number: number; status: string; session_id: string; session_code: string; evaluator_id: string;
      step_index: number; step_type: string; label_key: string; block_number: number | null; mirrored: boolean;
      fill_order: number[] | null; geometry: CanvasGeometry; total_time_ms: number | null;
    }>(
      app.deps.db,
      `SELECT ba.id, ba.attempt_number, ba.status, s.id AS session_id, s.session_code, s.evaluator_id, st.step_index, st.step_type,
              st.label_key, st.block_number, st.mirrored, st.fill_order, c.geometry, ba.total_time_ms
         FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id JOIN sessions s ON s.id = st.session_id
         JOIN canvases c ON c.id = st.canvas_id WHERE ba.id = $1`,
      [req.params.id],
    );
    // Evaluators replay sessions they ran; researchers and admins all sessions (FR-REP-4).
    if (!a || (user.role === 'EVALUATOR' && a.evaluator_id !== user.sub)) return reply.status(404).send(notFound);
    const samples = await rows<{ t_us: number; x_mm: number; y_mm: number; pressure: number; flags: number; box_id: number }>(
      app.deps.db, 'SELECT t_us, x_mm, y_mm, pressure, flags, box_id FROM pen_samples WHERE block_attempt_id = $1 ORDER BY sample_seq', [a.id],
    );
    const letters = await rows<{ box_id: number; speed_mm_s: number | null; is_accurate: boolean | null; pen_lifts_internal: number | null }>(
      app.deps.db,
      `SELECT ls.box_id, ls.speed_mm_s, ls.is_accurate, ls.pen_lifts_internal FROM letter_scores ls
         JOIN score_versions sv ON sv.id = ls.score_version_id WHERE sv.block_attempt_id = $1 AND sv.is_current`,
      [a.id],
    );
    const score = await one(app.deps.db, `SELECT version, composite_score, accuracy_score, speed_score, pen_lift_score, pen_lifts, avg_speed_mm_s
      FROM score_versions WHERE block_attempt_id = $1 AND is_current`, [a.id]);
    app.appLog.write({
      severity: 'INFO', event_type: 'data.replay.opened', actor_user_id: user.sub, actor_role: user.role, session_id: a.session_id,
      entity_type: 'block_attempt', entity_id: a.id, message: `Replay opened: ${a.session_code} step ${a.step_index}, attempt ${a.attempt_number}`,
    });
    return {
      attempt: { id: a.id, attempt_number: a.attempt_number, status: a.status, session_code: a.session_code, step_index: a.step_index,
        step_type: a.step_type, label_key: a.label_key, block_number: a.block_number, total_time_ms: a.total_time_ms },
      canvas: a.mirrored ? mirrorCanvas(a.geometry) : a.geometry,
      fill_order: a.fill_order,
      // Columnar arrays keep the payload small (a block has a few thousand samples).
      samples: {
        t_us: samples.map((s) => s.t_us), x: samples.map((s) => s.x_mm), y: samples.map((s) => s.y_mm),
        p: samples.map((s) => s.pressure), f: samples.map((s) => s.flags), box: samples.map((s) => s.box_id),
      },
      letters,
      score: score ?? null,
    };
  });
};
