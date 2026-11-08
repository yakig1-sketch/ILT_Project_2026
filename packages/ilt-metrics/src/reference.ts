// Reference recordings (FR-CAN-9/10, DDD §7.3): the values a canvas's scoring profile takes from a
// sample drawn on a tablet in reference mode. Same segmentation and speed code as children's blocks.
import type { PenSample } from '@ilt/shared-types';
import type { Box, CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import { DEFAULT_SCORING_SETTINGS, round2, scoreBlock, type ScoringSettings } from './score.js';
import { extractRawStrokes, mergeShortGaps } from './segment.js';

const inBox = (b: Box, x: number, y: number, margin: number) =>
  x >= b.x - margin && x <= b.x + b.w + margin && y >= b.y - margin && y <= b.y + b.h + margin;

/** The box a pen-down falls in: an exact hit first, then within the entry margin. */
function boxAt(boxes: readonly Box[], x: number, y: number, margin: number): Box | undefined {
  return boxes.find((b) => inBox(b, x, y, 0)) ?? boxes.find((b) => inBox(b, x, y, margin));
}

export interface SampleFillResult {
  /** Box ids in the order of their first stroke. */
  fill_order: number[];
  /** Pen lifts over the block (§8.2): strokes after merging gaps shorter than the minimum. */
  pen_lifts: number;
  boxes_written: number;
  boxes_total: number;
  /** Every box was written: only then can the fill order be accepted (it must cover every box). */
  complete: boolean;
}

/** SAMPLE_BLOCK_FILL: the fill order (box ids by first stroke) and the pen-lift count of one block. */
export function deriveSampleFill(
  samples: readonly PenSample[],
  canvas: CanvasGeometry,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): SampleFillResult {
  const strokes = mergeShortGaps(extractRawStrokes(samples), settings.pen_lift_min_gap_ms);
  const order: number[] = [];
  for (const s of strokes) {
    const p = s.points[0];
    const box = p && boxAt(canvas.boxes, p.x, p.y, settings.box_entry_margin_mm);
    if (box && !order.includes(box.id)) order.push(box.id);
  }
  return {
    fill_order: order,
    pen_lifts: strokes.length,
    boxes_written: order.length,
    boxes_total: canvas.boxes.length,
    complete: order.length === canvas.boxes.length,
  };
}

export interface NormalSpeedResult {
  /** Σ line length ÷ Σ line time over the letters of the recorded rows (mm/s), as for a child's block. */
  normal_speed_mm_s: number | null;
  rows: number;
  /** The boxes of the recorded rows, in fill order. */
  boxes: number[];
  letters_written: number;
  letters_expected: number;
  sum_line_length_mm: number;
  sum_line_time_ms: number;
  complete: boolean;
}

/** The first `rows` rows of a fill order (rows taken in the order the fill order reaches them). */
export function firstRows(canvas: CanvasGeometry, fillOrder: readonly number[], rows: number): number[] {
  const rowOf = new Map(canvas.boxes.map((b) => [b.id, b.row]));
  const seen: number[] = [];
  for (const id of fillOrder) {
    const r = rowOf.get(id);
    if (r !== undefined && !seen.includes(r)) seen.push(r);
  }
  const keep = new Set(seen.slice(0, rows));
  return fillOrder.filter((id) => keep.has(rowOf.get(id) ?? -1));
}

/** NORMAL_SPEED: the average ILT speed of a skilled writer over `rows` rows (default one). */
export function deriveNormalSpeed(
  samples: readonly PenSample[],
  canvas: CanvasGeometry,
  profile: ScoringProfile,
  fillOrder: readonly number[],
  rows = 1,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): NormalSpeedResult {
  const boxes = firstRows(canvas, fillOrder, rows);
  const score = scoreBlock(samples, canvas, { ...profile, fill_order: boxes, normal_speed_mm_s: null }, settings);
  const written = score.letters.filter((l) => l.status === 'WRITTEN').length;
  return {
    normal_speed_mm_s: score.avg_speed_mm_s === null ? null : round2(score.avg_speed_mm_s),
    rows,
    boxes,
    letters_written: written,
    letters_expected: boxes.length,
    sum_line_length_mm: round2(score.sum_line_length_mm),
    sum_line_time_ms: Math.round(score.sum_line_time_ms),
    complete: written === boxes.length && score.avg_speed_mm_s !== null,
  };
}
