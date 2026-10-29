// Small geometry helpers. Coordinates in mm, times in microseconds.

export interface TimedPoint {
  x: number;
  y: number;
  t_us: number;
}

export interface Closest {
  dist_mm: number;
  /** Time at the closest point (interpolated along the segment). */
  t_us: number;
}

/** Closest distance from point p to segment a-b, with the interpolated time at that point. */
export function closestOnSegment(px: number, py: number, a: TimedPoint, b: TimedPoint): Closest {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let u = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
  u = Math.max(0, Math.min(1, u));
  const cx = a.x + u * dx;
  const cy = a.y + u * dy;
  return { dist_mm: Math.hypot(px - cx, py - cy), t_us: a.t_us + u * (b.t_us - a.t_us) };
}

export function segmentLength(a: TimedPoint, b: TimedPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
