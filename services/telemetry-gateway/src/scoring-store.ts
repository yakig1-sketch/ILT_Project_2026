// Block measures and scores (DDD §8, §9). Runs once a block's samples are stored and checked:
// letter measures for every ILT-type block, score version 1 for scored blocks (ILT blocks), and
// time and pen lifts only for notebook pages. Scores use the session's settings snapshot.
import {
  DEFAULT_SCORING_SETTINGS,
  extractRawStrokes,
  mergeShortGaps,
  round2,
  scoreBlock,
  type BlockScore,
  type ScoringSettings,
} from '@ilt/ilt-metrics';
import type { CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import type { Queryable } from './app-log.js';
import { inTransaction, one } from './db.js';
import { setting, type SettingsSnapshot } from './settings-store.js';
import { loadSamples } from './telemetry-store.js';

/** Scoring settings from a session's settings snapshot (DDD §6.2), defaults for missing keys. */
export function scoringSettingsFrom(snapshot: SettingsSnapshot): ScoringSettings {
  const d = DEFAULT_SCORING_SETTINGS;
  return {
    weight_speed_pct: Number(setting(snapshot, 'scoring.composite.weight_speed_pct', d.weight_speed_pct)),
    weight_accuracy_pct: Number(setting(snapshot, 'scoring.composite.weight_accuracy_pct', d.weight_accuracy_pct)),
    weight_pen_lifts_pct: Number(setting(snapshot, 'scoring.composite.weight_pen_lifts_pct', d.weight_pen_lifts_pct)),
    pass_threshold: snapshot['scoring.pass_threshold']?.value == null ? null : Number(snapshot['scoring.pass_threshold'].value),
    above_range_policy: setting(snapshot, 'scoring.speed.above_range_policy', d.above_range_policy),
    pen_lift_min_gap_ms: Number(setting(snapshot, 'scoring.pen_lift.min_gap_ms', d.pen_lift_min_gap_ms)),
    require_dot_order: setting(snapshot, 'scoring.accurate.require_dot_order', d.require_dot_order),
    require_width_band: setting(snapshot, 'scoring.accurate.require_width_band', d.require_width_band),
    require_no_internal_lift: setting(snapshot, 'scoring.accurate.require_no_internal_lift', d.require_no_internal_lift),
    width_nominal_mm: Number(setting(snapshot, 'scoring.width.nominal_mm', d.width_nominal_mm)),
    width_tolerance_mm: Number(setting(snapshot, 'scoring.width.tolerance_mm', d.width_tolerance_mm)),
    box_entry_margin_mm: Number(setting(snapshot, 'ilt.box_entry_margin_mm', d.box_entry_margin_mm)),
  };
}

export interface ScoreInput {
  attemptId: string;
  /** The canvas as dispatched (mirroring applied). */
  canvas: CanvasGeometry;
  /** Canvas scoring profile snapshot; null for notebook pages (timed only). */
  profile: ScoringProfile | null;
  isScored: boolean;
  snapshot: SettingsSnapshot;
}

/** What the cockpit shows after a block (BLOCK_SCORED.scores). Scores rounded to 2 decimals. */
export interface BlockSummary {
  total_time_ms: number | null;
  pen_lifts: number;
  skipped_boxes: number | null;
  letters_expected: number | null;
  internal_pen_lifts: number | null;
  accurate_letters: number | null;
  accuracy_score: number | null;
  avg_speed_mm_s: number | null;
  speed_score: number | null;
  pen_lift_score: number | null;
  composite_score: number | null;
  pass: boolean | null;
  letters: { box_id: number; status: string; speed_mm_s: number | null; is_accurate: boolean; internal_pen_lifts: number; b_hit: boolean }[];
}

const r2 = (v: number | null) => (v === null ? null : round2(v));

/** Measures (and, for scored blocks, scores) one stored attempt. Returns the cockpit summary and the score version. */
export async function scoreAttempt(db: Queryable, input: ScoreInput): Promise<{ score_version: number | null; summary: BlockSummary }> {
  const samples = await loadSamples(db, input.attemptId);
  const settings = scoringSettingsFrom(input.snapshot);

  if (!input.profile) {
    // Notebook page: time and pen lifts only (FR-PLAN-5).
    const raw = extractRawStrokes(samples);
    const strokes = mergeShortGaps(raw, settings.pen_lift_min_gap_ms);
    const total = raw.length ? (raw[raw.length - 1]!.end_us - raw[0]!.start_us) / 1000 : null;
    const active = raw.reduce((s, x) => s + (x.end_us - x.start_us), 0) / 1000;
    await db.query(
      `UPDATE block_attempts SET raw_stroke_count = $2, total_time_ms = $3, active_writing_time_ms = $4, air_time_ms = $5, pen_lifts = $6 WHERE id = $1`,
      [input.attemptId, raw.length, total === null ? null : Math.round(total), Math.round(active), total === null ? null : Math.round(Math.max(0, total - active)), strokes.length],
    );
    return {
      score_version: null,
      summary: {
        total_time_ms: total, pen_lifts: strokes.length, skipped_boxes: null, letters_expected: null, internal_pen_lifts: null,
        accurate_letters: null, accuracy_score: null, avg_speed_mm_s: null, speed_score: null, pen_lift_score: null,
        composite_score: null, pass: null, letters: [],
      },
    };
  }

  const r = scoreBlock(samples, input.canvas, input.profile, settings);
  const version = await inTransaction(db, async (q) => {
    await q.query(
      `UPDATE block_attempts SET raw_stroke_count = $2, total_time_ms = $3, active_writing_time_ms = $4, air_time_ms = $5,
              last_box_completed = $6, skipped_boxes = $7, pen_lifts = $8 WHERE id = $1`,
      [input.attemptId, r.raw_stroke_count, r.total_time_ms === null ? null : Math.round(r.total_time_ms), Math.round(r.active_writing_time_ms),
        r.air_time_ms === null ? null : Math.round(r.air_time_ms), r.last_box_completed, r.skipped_boxes, r.pen_lifts],
    );
    for (const l of r.letters) {
      await q.query(
        `INSERT INTO letter_measures (block_attempt_id, box_id, fill_position, row_index, status, t_start_us, t_end_us, stroke_count_raw,
           path_length_mm, contact_time_ms, dot_closest, width_mm, mean_pressure)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (block_attempt_id, box_id) DO NOTHING`,
        [input.attemptId, l.box_id, l.fill_position, l.row_index, l.status, l.t_start_us, l.t_end_us, l.stroke_count_raw,
          l.path_length_mm, l.contact_time_ms, l.status === 'WRITTEN' ? JSON.stringify(l.dots) : null, l.width_mm, l.mean_pressure],
      );
    }
    if (!input.isScored) return null;
    return insertScoreVersion(q, input.attemptId, 1, r, settings, input.profile!, null, null);
  });
  return { score_version: version, summary: summaryOf(r) };
}

/** Writes a score version and its letter scores; earlier versions stop being current. */
export async function insertScoreVersion(
  q: Queryable,
  attemptId: string,
  version: number,
  r: BlockScore,
  settings: ScoringSettings,
  profile: ScoringProfile,
  reason: string | null,
  userId: string | null,
): Promise<number> {
  await q.query('UPDATE score_versions SET is_current = false WHERE block_attempt_id = $1 AND is_current', [attemptId]);
  const sv = await one<{ id: string }>(
    q,
    `INSERT INTO score_versions (block_attempt_id, version, is_current, settings_used, profile_used, engine_version, reason, computed_by,
       letters_expected, pen_lifts, internal_pen_lifts, accurate_letters, accuracy_score, sum_line_length_mm, sum_line_time_ms,
       avg_speed_mm_s, speed_score, pen_lift_score, composite_score, pass)
     VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
    [attemptId, version, JSON.stringify(settings), JSON.stringify(profile), r.engine_version, reason, userId, r.letters_expected,
      r.pen_lifts, r.internal_pen_lifts, r.accurate_letters, r2(r.accuracy_score), r.sum_line_length_mm, r.sum_line_time_ms,
      r.avg_speed_mm_s === null ? null : Math.round(r.avg_speed_mm_s * 1000) / 1000, r2(r.speed_score), r2(r.pen_lift_score),
      r2(r.composite_score), r.pass],
  );
  for (const l of r.letters) {
    if (l.status !== 'WRITTEN') continue;
    await q.query(
      `INSERT INTO letter_scores (score_version_id, box_id, pen_lifts_internal, dots_hit, dot_order_ok, width_in_band, line_length_mm,
         line_time_ms, speed_mm_s, line_start_fallback, line_end_fallback, accuracy_score, is_accurate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [sv!.id, l.box_id, l.internal_pen_lifts, JSON.stringify(Object.fromEntries(Object.entries(l.dots).map(([k, d]) => [k, d.hit]))),
        l.dot_order_ok, l.width_in_band, l.line_length_mm, l.line_time_ms, l.speed_mm_s, l.line_start_fallback, l.line_end_fallback,
        r2(l.accuracy_score), l.is_accurate],
    );
  }
  return version;
}

export function summaryOf(r: BlockScore): BlockSummary {
  return {
    total_time_ms: r.total_time_ms,
    pen_lifts: r.pen_lifts,
    skipped_boxes: r.skipped_boxes,
    letters_expected: r.letters_expected,
    internal_pen_lifts: r.internal_pen_lifts,
    accurate_letters: r.accurate_letters,
    accuracy_score: r2(r.accuracy_score),
    avg_speed_mm_s: r2(r.avg_speed_mm_s),
    speed_score: r2(r.speed_score),
    pen_lift_score: r2(r.pen_lift_score),
    composite_score: r2(r.composite_score),
    pass: r.pass,
    letters: r.letters.map((l) => ({
      box_id: l.box_id, status: l.status, speed_mm_s: r2(l.speed_mm_s), is_accurate: l.is_accurate,
      internal_pen_lifts: l.internal_pen_lifts, b_hit: l.dots.B?.hit ?? false,
    })),
  };
}
