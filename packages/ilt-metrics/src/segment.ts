// Stroke extraction, stroke merging and assignment of strokes to boxes (DDD §8.1–8.2).
import { StrokeFlag, type PenSample } from '@ilt/shared-types';
import type { Box } from '@ilt/template-schemas';
import type { TimedPoint } from './geometry.js';

export interface Stroke {
  /** Contact points in time order. */
  points: TimedPoint[];
  pressures: number[];
  start_us: number;
  end_us: number;
  /** Number of raw pointerdown strokes merged into this one. */
  raw_count: number;
}

/** Splits contact samples into raw strokes (pointerdown to pointerup). */
export function extractRawStrokes(samples: readonly PenSample[]): Stroke[] {
  const sorted = [...samples].sort((a, b) => a.sample_seq - b.sample_seq);
  const strokes: Stroke[] = [];
  let current: Stroke | null = null;
  for (const s of sorted) {
    const contact = (s.flags & StrokeFlag.CONTACT) !== 0;
    if (!contact) {
      current = null;
      continue;
    }
    if (current === null || (s.flags & StrokeFlag.STROKE_START) !== 0) {
      current = { points: [], pressures: [], start_us: s.t_us, end_us: s.t_us, raw_count: 1 };
      strokes.push(current);
    }
    current.points.push({ x: s.x_mm, y: s.y_mm, t_us: s.t_us });
    current.pressures.push(s.pressure);
    current.end_us = s.t_us;
    if ((s.flags & StrokeFlag.STROKE_END) !== 0) current = null;
  }
  return strokes;
}

/** Merges strokes separated by a lift shorter than minGapMs: such a gap is not a pen lift. */
export function mergeShortGaps(strokes: readonly Stroke[], minGapMs: number): Stroke[] {
  const out: Stroke[] = [];
  for (const s of strokes) {
    const prev = out[out.length - 1];
    if (prev && s.start_us - prev.end_us < minGapMs * 1000) {
      prev.points.push(...s.points);
      prev.pressures.push(...s.pressures);
      prev.end_us = s.end_us;
      prev.raw_count += s.raw_count;
    } else {
      out.push({ ...s, points: [...s.points], pressures: [...s.pressures] });
    }
  }
  return out;
}

const inBox = (b: Box, x: number, y: number, margin: number) =>
  x >= b.x - margin && x <= b.x + b.w + margin && y >= b.y - margin && y <= b.y + b.h + margin;

export interface BoxAssignment {
  /** Strokes per box id. */
  strokesByBox: Map<number, Stroke[]>;
  /** Box ids passed over in the fill order (before the last written box, without strokes). */
  skipped: number[];
}

/**
 * Forward-only active box rule: the active box starts at fillOrder[0]; a stroke that starts inside
 * a box later in the fill order makes it the active box. Strokes starting anywhere else stay with
 * the current active box. Returns the new fill position. The tablet applies the same rule live.
 */
export function advanceFillPosition(
  boxes: readonly Box[],
  fillOrder: readonly number[],
  currentPos: number,
  x: number,
  y: number,
  marginMm: number,
): number {
  // Prefer an exact hit; fall back to the margin-grown rectangle.
  for (const margin of [0, marginMm]) {
    for (let pos = 0; pos < fillOrder.length; pos++) {
      const b = boxes.find((box) => box.id === fillOrder[pos]);
      if (b && inBox(b, x, y, margin)) return Math.max(pos, currentPos);
    }
  }
  return currentPos;
}

export function assignStrokesToBoxes(
  strokes: readonly Stroke[],
  boxes: readonly Box[],
  fillOrder: readonly number[],
  marginMm: number,
): BoxAssignment {
  const strokesByBox = new Map<number, Stroke[]>();
  let currentPos = 0;
  for (const s of strokes) {
    const p0 = s.points[0]!;
    currentPos = advanceFillPosition(boxes, fillOrder, currentPos, p0.x, p0.y, marginMm);
    const boxId = fillOrder[currentPos]!;
    const list = strokesByBox.get(boxId) ?? [];
    list.push(s);
    strokesByBox.set(boxId, list);
  }
  let lastWritten = -1;
  fillOrder.forEach((id, i) => {
    if (strokesByBox.has(id)) lastWritten = i;
  });
  const skipped = fillOrder.filter((id, i) => i < lastWritten && !strokesByBox.has(id));
  return { strokesByBox, skipped };
}
