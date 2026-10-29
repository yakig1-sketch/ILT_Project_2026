// Letter measures and block scores (DDD §8.3–8.6). Pure functions, no I/O.
// Scores are returned unrounded; round only when storing (round2).
import type { PenSample } from '@ilt/shared-types';
import type { Box, CanvasGeometry, Dot, ScoringProfile } from '@ilt/template-schemas';
import { closestOnSegment, segmentLength, type TimedPoint } from './geometry.js';
import { assignStrokesToBoxes, extractRawStrokes, mergeShortGaps, type Stroke } from './segment.js';

export const ENGINE_VERSION = '0.1.0';

/** Scoring settings, taken from the session's settings snapshot (DDD §6.2). */
export interface ScoringSettings {
  weight_speed_pct: number;
  weight_accuracy_pct: number;
  weight_pen_lifts_pct: number;
  pass_threshold: number | null;
  above_range_policy: 'CAP_100' | 'SYMMETRIC_PENALTY';
  pen_lift_min_gap_ms: number;
  require_dot_order: boolean;
  require_width_band: boolean;
  require_no_internal_lift: boolean;
  width_nominal_mm: number;
  width_tolerance_mm: number;
  box_entry_margin_mm: number;
}

export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  weight_speed_pct: 50,
  weight_accuracy_pct: 25,
  weight_pen_lifts_pct: 25,
  pass_threshold: null,
  above_range_policy: 'CAP_100',
  pen_lift_min_gap_ms: 50,
  require_dot_order: true,
  require_width_band: false,
  require_no_internal_lift: false,
  width_nominal_mm: 11.0,
  width_tolerance_mm: 2.0,
  box_entry_margin_mm: 2.0,
};

export interface DotMeasure {
  dist_mm: number;
  /** Time of closest approach. */
  closest_t_us: number;
  hit: boolean;
  /** Time of the first touch within the radius, or null. */
  first_hit_t_us: number | null;
}

export interface LetterResult {
  box_id: number;
  fill_position: number;
  row_index: number;
  status: 'WRITTEN' | 'SKIPPED' | 'EMPTY';
  // raw, settings-independent
  t_start_us: number | null;
  t_end_us: number | null;
  /** First contact point (canvas mm). */
  start_point: { x: number; y: number } | null;
  stroke_count_raw: number;
  path_length_mm: number | null;
  contact_time_ms: number | null;
  width_mm: number | null;
  mean_pressure: number | null;
  // depend on settings / profile
  strokes: number;
  internal_pen_lifts: number;
  dots: Record<string, DotMeasure>;
  dot_order_ok: boolean | null;
  width_in_band: boolean | null;
  line_length_mm: number | null;
  line_time_ms: number | null;
  speed_mm_s: number | null;
  line_start_fallback: boolean;
  line_end_fallback: boolean;
  accuracy_score: number;
  is_accurate: boolean;
}

export interface BlockScore {
  engine_version: string;
  letters_expected: number;
  letters: LetterResult[];
  skipped_boxes: number;
  last_box_completed: boolean;
  raw_stroke_count: number;
  pen_lifts: number;
  internal_pen_lifts: number;
  accurate_letters: number;
  accuracy_score: number;
  sum_line_length_mm: number;
  sum_line_time_ms: number;
  avg_speed_mm_s: number | null;
  speed_score: number | null;
  pen_lift_score: number | null;
  composite_score: number | null;
  pass: boolean | null;
  total_time_ms: number | null;
  active_writing_time_ms: number;
  air_time_ms: number | null;
}

export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** Speed score (DDD §8.5). N = normal speed, f = flexibility %, X = average speed. */
export function speedScore(
  x: number | null,
  normal: number | null,
  flexPct: number,
  policy: ScoringSettings['above_range_policy'],
): number | null {
  if (x === null || normal === null || x <= 0) return null;
  const f = flexPct / 100;
  const lower = normal * (1 - f);
  const upper = normal * (1 + f);
  if (x < lower) return 100 / (lower / x);
  if (x > upper) return policy === 'SYMMETRIC_PENALTY' ? 100 / (x / upper) : 100;
  return 100;
}

/** Pen-lift score (DDD §8.5): 100 / (X / E), capped at 100; null when nothing was written. */
export function penLiftScore(penLifts: number, expected: number): number | null {
  if (penLifts <= 0) return null;
  return Math.min(100, 100 / (penLifts / expected));
}

export function compositeScore(
  speed: number | null,
  accuracy: number | null,
  penLift: number | null,
  s: Pick<ScoringSettings, 'weight_speed_pct' | 'weight_accuracy_pct' | 'weight_pen_lifts_pct'>,
): number | null {
  if (speed === null || accuracy === null || penLift === null) return null;
  return (s.weight_speed_pct * speed + s.weight_accuracy_pct * accuracy + s.weight_pen_lifts_pct * penLift) / 100;
}

function measureDot(strokes: readonly Stroke[], cx: number, cy: number, radius: number): DotMeasure {
  let best = { dist_mm: Infinity, t_us: 0 };
  let firstHit: number | null = null;
  for (const s of strokes) {
    const pts = s.points;
    if (pts.length === 1) {
      const p = pts[0]!;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < best.dist_mm) best = { dist_mm: d, t_us: p.t_us };
      if (firstHit === null && d <= radius) firstHit = p.t_us;
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const c = closestOnSegment(cx, cy, pts[i - 1]!, pts[i]!);
      if (c.dist_mm < best.dist_mm) best = c;
      if (firstHit === null && c.dist_mm <= radius) firstHit = c.t_us;
    }
  }
  return { dist_mm: best.dist_mm, closest_t_us: best.t_us, hit: best.dist_mm <= radius, first_hit_t_us: firstHit };
}

interface FlatPoint extends TimedPoint {
  stroke: number;
}

function letterFor(
  box: Box,
  fillPosition: number,
  strokes: readonly Stroke[] | undefined,
  status: LetterResult['status'],
  dots: readonly Dot[],
  allowInternalLifts: boolean,
  profile: ScoringProfile,
  settings: ScoringSettings,
): LetterResult {
  const empty: LetterResult = {
    box_id: box.id, fill_position: fillPosition, row_index: box.row, status,
    t_start_us: null, t_end_us: null, start_point: null, stroke_count_raw: 0, path_length_mm: null, contact_time_ms: null,
    width_mm: null, mean_pressure: null, strokes: 0, internal_pen_lifts: 0, dots: {},
    dot_order_ok: null, width_in_band: null, line_length_mm: null, line_time_ms: null, speed_mm_s: null,
    line_start_fallback: false, line_end_fallback: false, accuracy_score: 0, is_accurate: false,
  };
  if (!strokes || strokes.length === 0) return empty;

  const flat: FlatPoint[] = strokes.flatMap((s, i) => s.points.map((p) => ({ ...p, stroke: i })));
  const first = flat[0]!;
  const last = flat[flat.length - 1]!;

  let pathLength = 0;
  for (let i = 1; i < flat.length; i++) {
    if (flat[i]!.stroke === flat[i - 1]!.stroke) pathLength += segmentLength(flat[i - 1]!, flat[i]!);
  }
  const contactTimeMs = strokes.reduce((sum, s) => sum + (s.end_us - s.start_us), 0) / 1000;
  const pressures = strokes.flatMap((s) => s.pressures);
  const meanPressure = pressures.reduce((a, b) => a + b, 0) / pressures.length;

  // Dots in absolute canvas coordinates.
  const absDot = (id: string) => {
    const d = dots.find((x) => x.id === id);
    return d ? { x: box.x + d.x, y: box.y + d.y } : null;
  };
  const dotMeasures: Record<string, DotMeasure> = {};
  for (const [id, rule] of Object.entries(profile.dots)) {
    const p = absDot(id);
    if (p) dotMeasures[id] = measureDot(strokes, p.x, p.y, rule.radius_mm);
  }

  // Order: time the pen passes each dot (first touch if touched, else closest approach).
  const passTimes = profile.dot_order
    .map((id) => dotMeasures[id])
    .map((m) => (m ? (m.first_hit_t_us ?? m.closest_t_us) : null));
  const dotOrderOk = passTimes.every((t) => t !== null) && passTimes.every((t, i) => i === 0 || t! > passTimes[i - 1]!);

  // Width: horizontal travel toward B and back (ILT letters with A, B, C).
  let widthMm: number | null = null;
  const a = absDot('A');
  const b = absDot('B');
  const c = absDot('C');
  if (a && b && c) {
    const sign = b.x >= (a.x + c.x) / 2 ? 1 : -1;
    const ext = Math.max(...flat.map((p) => sign * p.x));
    widthMm = ext - sign * first.x + (ext - sign * last.x);
  }
  const widthInBand = widthMm === null ? null : Math.abs(widthMm - settings.width_nominal_mm) <= settings.width_tolerance_mm;

  // Line from the first dot's radius to the last dot's radius.
  const firstId = profile.dot_order[0]!;
  const lastId = profile.dot_order[profile.dot_order.length - 1]!;
  const pFirst = absDot(firstId);
  const pLast = absDot(lastId);
  const rFirst = profile.dots[firstId]?.radius_mm ?? 0;
  const rLast = profile.dots[lastId]?.radius_mm ?? 0;
  let iStart = pFirst ? flat.findIndex((p) => Math.hypot(p.x - pFirst.x, p.y - pFirst.y) <= rFirst) : -1;
  let iEnd = -1;
  if (pLast) {
    for (let i = flat.length - 1; i >= 0; i--) {
      if (Math.hypot(flat[i]!.x - pLast.x, flat[i]!.y - pLast.y) <= rLast) {
        iEnd = i;
        break;
      }
    }
  }
  let startFallback = iStart < 0;
  let endFallback = iEnd < 0;
  if (startFallback) iStart = 0;
  if (endFallback) iEnd = flat.length - 1;
  if (iEnd <= iStart) {
    iStart = 0;
    iEnd = flat.length - 1;
    startFallback = true;
    endFallback = true;
  }
  let lineLength = 0;
  for (let i = iStart + 1; i <= iEnd; i++) {
    if (flat[i]!.stroke === flat[i - 1]!.stroke) lineLength += segmentLength(flat[i - 1]!, flat[i]!);
  }
  const lineTimeMs = (flat[iEnd]!.t_us - flat[iStart]!.t_us) / 1000;
  const speed = lineTimeMs > 0 ? lineLength / (lineTimeMs / 1000) : null;

  const internalLifts = strokes.length - 1;
  const accuracy = Object.entries(profile.dots).reduce(
    (sum, [id, rule]) => sum + (dotMeasures[id]?.hit ? rule.weight_pct : 0),
    0,
  );
  const requiredHit = Object.entries(profile.dots).every(([id, rule]) => !rule.required || dotMeasures[id]?.hit === true);
  const isAccurate =
    requiredHit &&
    (!settings.require_dot_order || dotOrderOk) &&
    (!settings.require_width_band || widthInBand === true) &&
    (!settings.require_no_internal_lift || internalLifts === 0 || allowInternalLifts);

  return {
    ...empty,
    t_start_us: first.t_us,
    t_end_us: last.t_us,
    start_point: { x: first.x, y: first.y },
    stroke_count_raw: strokes.reduce((n, s) => n + s.raw_count, 0),
    path_length_mm: pathLength,
    contact_time_ms: contactTimeMs,
    width_mm: widthMm,
    mean_pressure: meanPressure,
    strokes: strokes.length,
    internal_pen_lifts: internalLifts,
    dots: dotMeasures,
    dot_order_ok: dotOrderOk,
    width_in_band: widthInBand,
    line_length_mm: lineLength,
    line_time_ms: lineTimeMs,
    speed_mm_s: speed,
    line_start_fallback: startFallback,
    line_end_fallback: endFallback,
    accuracy_score: accuracy,
    is_accurate: isAccurate,
  };
}

/**
 * Scores one block attempt. `canvas` is the resolved canvas as dispatched (mirroring already
 * applied). For intervention sheets, each letter's own dots replace the canvas-level dots.
 */
export function scoreBlock(
  samples: readonly PenSample[],
  canvas: CanvasGeometry,
  profile: ScoringProfile,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): BlockScore {
  const raw = extractRawStrokes(samples);
  const strokes = mergeShortGaps(raw, settings.pen_lift_min_gap_ms);
  const { strokesByBox, skipped } = assignStrokesToBoxes(strokes, canvas.boxes, profile.fill_order, settings.box_entry_margin_mm);
  const boxById = new Map(canvas.boxes.map((b) => [b.id, b]));
  const letterCells = new Map(canvas.letters.map((l) => [l.box_id, l]));
  const skippedSet = new Set(skipped);

  const letters = profile.fill_order.map((id, pos) => {
    const box = boxById.get(id)!;
    const cell = letterCells.get(id);
    const status: LetterResult['status'] = strokesByBox.has(id) ? 'WRITTEN' : skippedSet.has(id) ? 'SKIPPED' : 'EMPTY';
    return letterFor(box, pos, strokesByBox.get(id), status, cell ? cell.dots : canvas.dots, cell?.allow_internal_lifts ?? false, profile, settings);
  });

  const written = letters.filter((l) => l.status === 'WRITTEN');
  const expected = profile.fill_order.length;
  const sumLength = written.reduce((s, l) => s + (l.line_length_mm ?? 0), 0);
  const sumTime = written.reduce((s, l) => s + (l.line_time_ms && l.line_time_ms > 0 ? l.line_time_ms : 0), 0);
  const avgSpeed = sumTime > 0 ? sumLength / (sumTime / 1000) : null;
  const accuracy = letters.reduce((s, l) => s + l.accuracy_score, 0) / expected;
  const speed = speedScore(avgSpeed, profile.normal_speed_mm_s, profile.speed_flex_pct, settings.above_range_policy);
  const lifts = penLiftScore(strokes.length, profile.expected_pen_lifts_per_block);
  const composite = compositeScore(speed, written.length > 0 ? accuracy : null, lifts, settings);

  const assigned = written.flatMap((l) => strokesByBox.get(l.box_id) ?? []);
  const startUs = assigned.length ? Math.min(...assigned.map((s) => s.start_us)) : null;
  const endUs = assigned.length ? Math.max(...assigned.map((s) => s.end_us)) : null;
  const totalMs = startUs !== null && endUs !== null ? (endUs - startUs) / 1000 : null;
  const activeMs = raw.reduce((sum, s) => sum + (s.end_us - s.start_us), 0) / 1000;

  return {
    engine_version: ENGINE_VERSION,
    letters_expected: expected,
    letters,
    skipped_boxes: skipped.length,
    last_box_completed: letters[letters.length - 1]?.status === 'WRITTEN',
    raw_stroke_count: raw.length,
    pen_lifts: strokes.length,
    internal_pen_lifts: written.reduce((s, l) => s + l.internal_pen_lifts, 0),
    accurate_letters: letters.filter((l) => l.is_accurate).length,
    accuracy_score: accuracy,
    sum_line_length_mm: sumLength,
    sum_line_time_ms: sumTime,
    avg_speed_mm_s: avgSpeed,
    speed_score: speed,
    pen_lift_score: lifts,
    composite_score: composite,
    pass: composite === null || settings.pass_threshold === null ? null : composite >= settings.pass_threshold,
    total_time_ms: totalMs,
    active_writing_time_ms: activeMs,
    air_time_ms: totalMs === null ? null : Math.max(0, totalMs - activeMs),
  };
}
