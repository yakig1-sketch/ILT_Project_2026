// System suggestions for intervention marks (DDD §8.7). The evaluator confirms or changes them.
import type { Box, LetterCell, ScoringProfile } from '@ilt/template-schemas';
import type { LetterResult } from './score.js';

export interface MarkSuggestion {
  /** true = error. null = the evaluator decides (freehand row, or nothing written). */
  auto_error: boolean | null;
  start_point_ok: boolean | null;
}

export function suggestMark(letter: LetterResult, cell: LetterCell, box: Box, profile: ScoringProfile): MarkSuggestion {
  if (letter.status !== 'WRITTEN') return { auto_error: true, start_point_ok: null };

  switch (cell.row_type) {
    case 'TRACE_MODEL': {
      const allHit = cell.dots.every((d) => letter.dots[d.id]?.hit === true);
      const liftsOk = letter.internal_pen_lifts === 0 || cell.allow_internal_lifts;
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
    case 'FREEHAND':
      return { auto_error: null, start_point_ok: null };
  }
}

/** Sheet accuracy = correct marks / marks x 100 (FRS FR-SCORE-16). */
export function sheetAccuracy(finalErrors: readonly (boolean | null)[]): number | null {
  const decided = finalErrors.filter((e): e is boolean => e !== null);
  if (decided.length === 0) return null;
  return (100 * decided.filter((e) => !e).length) / decided.length;
}
