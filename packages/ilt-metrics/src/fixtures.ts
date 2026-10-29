// Synthetic pen recordings for golden tests and the mock stylus. 240 Hz, straight segments.
import { StrokeFlag, type PenSample } from '@ilt/shared-types';
import type { Box } from '@ilt/template-schemas';

export interface LetterSpec {
  /** Waypoints relative to the box's top-left, in mm. Each inner array is one stroke. */
  strokes: [number, number][][];
  speed_mm_s?: number;
  /** Pen-up time between this letter's strokes, ms. */
  internal_gap_ms?: number;
}

const RATE_HZ = 240;

/** Builds samples for letters written in the given boxes, in order, with an air gap between letters. */
export function synthBlock(
  letters: { box: Box; spec: LetterSpec }[],
  opts: { gap_between_letters_ms?: number; pressure?: number } = {},
): PenSample[] {
  const gapUs = (opts.gap_between_letters_ms ?? 400) * 1000;
  const pressure = opts.pressure ?? 0.6;
  const dtUs = 1e6 / RATE_HZ;
  const out: PenSample[] = [];
  let t = 0;
  for (const { box, spec } of letters) {
    const speed = spec.speed_mm_s ?? 20;
    spec.strokes.forEach((stroke, si) => {
      if (si > 0) t += (spec.internal_gap_ms ?? 200) * 1000;
      const pts = stroke.map(([x, y]) => ({ x: box.x + x, y: box.y + y }));
      const strokeSamples: { x: number; y: number }[] = [pts[0]!];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.round((len / speed) * RATE_HZ));
        for (let k = 1; k <= steps; k++) strokeSamples.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
      }
      strokeSamples.forEach((p, i) => {
        let flags: number = StrokeFlag.CONTACT;
        if (i === 0) flags |= StrokeFlag.STROKE_START;
        if (i === strokeSamples.length - 1) flags |= StrokeFlag.STROKE_END;
        out.push({ sample_seq: out.length, t_us: Math.round(t), x_mm: p.x, y_mm: p.y, pressure, tilt_x: 0, tilt_y: 0, flags, box_id: box.id });
        if (i < strokeSamples.length - 1) t += dtUs;
      });
    });
    t += gapUs;
  }
  return out;
}

/** The ILT letter ">" through the dot centres A (14.5, 2.6) -> B (20.0, 12.6) -> C (14.5, 22.7). */
export const PERFECT_ILT: LetterSpec = { strokes: [[[14.5, 2.6], [20.0, 12.6], [14.5, 22.7]]] };
