// Intervention sheet marks (DDD §8.7, FRS FR-COCK-5/6): the system's suggestion per letter, which
// the evaluator confirms or changes, and the row-3 similarity hint (shown, never scored).
import type { PenSample } from '@ilt/shared-types';
import type { Box, CanvasGeometry, LetterCell, ScoringProfile } from '@ilt/template-schemas';
import { DEFAULT_SCORING_SETTINGS, scoreBlock, type LetterResult, type ScoringSettings } from './score.js';
import { assignStrokesToBoxes, extractRawStrokes, mergeShortGaps, type Stroke } from './segment.js';

export interface MarkSuggestion {
  /** true = error. null = the evaluator decides (freehand row). */
  auto_error: boolean | null;
  start_point_ok: boolean | null;
}

/**
 * Pen lifts allowed inside a row-1 letter: none, except for letters written in several strokes
 * (ה ק ח ת א, `allow_internal_lifts`), which may lift once between strokes (strokes − 1).
 */
export function liftsAllowed(cell: LetterCell): number {
  if (!cell.allow_internal_lifts) return 0;
  return Math.max(0, (cell.model_strokes.length || 1) - 1);
}

export function suggestMark(letter: LetterResult, cell: LetterCell, box: Box, profile: ScoringProfile): MarkSuggestion {
  // The evaluator always decides row 3 (FR-COCK-5).
  if (cell.row_type === 'FREEHAND') return { auto_error: null, start_point_ok: null };
  // A box left empty or skipped is a wrong letter.
  if (letter.status !== 'WRITTEN') return { auto_error: true, start_point_ok: cell.row_type === 'START_DOT' ? false : null };

  switch (cell.row_type) {
    case 'TRACE_MODEL': {
      const allHit = cell.dots.every((d) => letter.dots[d.id]?.hit === true);
      const liftsOk = letter.internal_pen_lifts <= liftsAllowed(cell);
      return { auto_error: !(allHit && letter.dot_order_ok === true && liftsOk), start_point_ok: null };
    }
    case 'START_DOT': {
      const start = cell.dots.find((d) => d.role === 'START') ?? cell.dots[0];
      if (!start || !letter.start_point) return { auto_error: null, start_point_ok: null };
      const radius = profile.dots[start.id]?.radius_mm ?? 3.5;
      const ok =
        Math.hypot(letter.start_point.x - (box.x + start.x), letter.start_point.y - (box.y + start.y)) <= radius;
      // The system checks only the start; the evaluator confirms the letter's form.
      return { auto_error: !ok, start_point_ok: ok };
    }
  }
}

type P = [number, number];

/** Points (relative to their box) moved to their bounding-box centre and scaled so the longer side is 1. */
function normalise(sets: P[][]): P[][] {
  const all = sets.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return sets.map((s) => s.map(([x, y]) => [(x - cx) / scale, (y - cy) / scale] as P));
}

function distToPolylines(p: P, lines: P[][]): number {
  let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) best = Math.min(best, Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]));
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!;
      const [bx, by] = line[i]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
    }
  }
  return best;
}

/** Points every `step` along polylines (their own vertices included). */
function resample(lines: P[][], step: number): P[] {
  const out: P[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i]!;
      out.push(p);
      const q = line[i + 1];
      if (!q) continue;
      const n = Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1]) / step);
      for (let k = 1; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
    }
  }
  return out;
}

/** The mean distance (in letter sizes) at which the hint reaches 0. */
export const SIMILARITY_ZERO_AT = 0.25;

/**
 * Row-3 similarity hint (FR-COCK-6), 0–100: how close the written shape is to the model's centre
 * line once both are centred and scaled to the same size (mean distance both ways). A hint only:
 * it never counts toward a mark or a score.
 */
export function similarityHint(strokes: readonly Stroke[], cell: LetterCell, box: Box): number | null {
  const model = (cell.model_strokes.length ? cell.model_strokes : [cell.model_path]).filter((s) => s.length > 0) as P[][];
  const written = strokes.map((s) => s.points.map((p) => [p.x - box.x, p.y - box.y] as P)).filter((s) => s.length > 0);
  if (model.flat().length < 2 || written.flat().length < 2) return null;
  const [m, w] = [normalise(model), normalise(written)];
  const wPts = resample(w, 0.02);
  const mPts = resample(m, 0.02);
  const d = (wPts.reduce((s, p) => s + distToPolylines(p, m), 0) / wPts.length + mPts.reduce((s, p) => s + distToPolylines(p, w), 0) / mPts.length) / 2;
  return Math.round(100 * Math.max(0, 1 - d / SIMILARITY_ZERO_AT) * 100) / 100;
}

export interface SheetMark {
  box_id: number;
  fill_position: number;
  row_type: LetterCell['row_type'];
  letter: string;
  status: LetterResult['status'];
  auto_error: boolean | null;
  start_point_ok: boolean | null;
  internal_pen_lifts: number;
  lifts_allowed: number;
  /** Row 3 only, when the hint is on and the letter was written. */
  similarity_hint: number | null;
}

/** The system's suggested marks for every letter of an intervention sheet, in fill order. */
export function suggestSheetMarks(
  samples: readonly PenSample[],
  canvas: CanvasGeometry,
  profile: ScoringProfile,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
  options: { similarity: boolean } = { similarity: true },
): SheetMark[] {
  const r = scoreBlock(samples, canvas, profile, settings);
  const strokes = mergeShortGaps(extractRawStrokes(samples), settings.pen_lift_min_gap_ms);
  const { strokesByBox } = assignStrokesToBoxes(strokes, canvas.boxes, profile.fill_order, settings.box_entry_margin_mm);
  const cells = new Map(canvas.letters.map((l) => [l.box_id, l]));
  const boxes = new Map(canvas.boxes.map((b) => [b.id, b]));
  return r.letters.flatMap((letter) => {
    const cell = cells.get(letter.box_id);
    const box = boxes.get(letter.box_id);
    if (!cell || !box) return [];
    const s = suggestMark(letter, cell, box, profile);
    const own = strokesByBox.get(letter.box_id);
    return [{
      box_id: letter.box_id,
      fill_position: letter.fill_position,
      row_type: cell.row_type,
      letter: cell.letter,
      status: letter.status,
      ...s,
      internal_pen_lifts: letter.internal_pen_lifts,
      lifts_allowed: liftsAllowed(cell),
      similarity_hint: options.similarity && cell.row_type === 'FREEHAND' && own?.length ? similarityHint(own, cell, box) : null,
    }];
  });
}

/** Sheet accuracy = correct marks / marks x 100 (FRS FR-SCORE-16). */
export function sheetAccuracy(finalErrors: readonly (boolean | null)[]): number | null {
  const decided = finalErrors.filter((e): e is boolean => e !== null);
  if (decided.length === 0) return null;
  return (100 * decided.filter((e) => !e).length) / decided.length;
}
