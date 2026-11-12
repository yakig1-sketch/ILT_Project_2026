// Canvas geometry and scoring profile schemas (DDD §7). All lengths in millimetres.
import { z } from 'zod';
import { CANVAS_TYPES, ROW_TYPES } from '@ilt/shared-types';

const mm = z.number().finite();
const point = z.tuple([mm, mm]);

export const DotSchema = z.object({
  id: z.string().min(1).max(4),
  x: mm,
  y: mm,
  diameter_mm: z.number().positive().default(2.6),
  role: z.enum(['START', 'TARGET', 'END']).optional(),
});
export type Dot = z.infer<typeof DotSchema>;

export const BoxSchema = z.object({
  id: z.number().int().min(0).max(254),
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  x: mm,
  y: mm,
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Box = z.infer<typeof BoxSchema>;

export const LineStyleSchema = z.enum(['SOLID', 'DASHED', 'DOTTED']);

export const LineSchema = z.object({
  y: mm,
  x1: mm,
  x2: mm,
  style: LineStyleSchema.default('SOLID'),
  weight_mm: z.number().positive().default(0.3),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1565c0'),
  role: z.enum(['BASE', 'MID', 'TOP', 'MARGIN']).optional(),
});
export type Line = z.infer<typeof LineSchema>;

export const LetterCellSchema = z.object({
  box_id: z.number().int(),
  row_type: z.enum(ROW_TYPES),
  letter: z.string().min(1).max(8),
  /** Dots in writing order (stroke starts, ends and corners); relative to the box, and may lie below it for a descender. */
  dots: z.array(DotSchema),
  /** The model's centre line as one polyline (all strokes joined), for the similarity hint. */
  model_path: z.array(point).default([]),
  /** The model's centre line per pen stroke, in writing order (Phase 5a). */
  model_strokes: z.array(z.array(point)).default([]),
  /** The model letter's filled outline (one polygon per stroke), drawn where `show_model` is set. */
  model_outline: z.array(z.array(point)).default([]),
  /** Show the model letter in this box for the child to trace over (row 1's first box on the sheets). */
  show_model: z.boolean().default(false),
  allow_internal_lifts: z.boolean().default(false),
});
export type LetterCell = z.infer<typeof LetterCellSchema>;

export const CanvasGeometrySchema = z.object({
  schema_version: z.literal(1),
  canvas_type: z.enum(CANVAS_TYPES),
  units: z.literal('mm'),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  boxes: z.array(BoxSchema).min(1),
  box_frame: z
    .object({ style: LineStyleSchema, weight_mm: z.number().positive(), color: z.string() })
    .default({ style: 'SOLID', weight_mm: 0.3, color: '#000000' }),
  /** Dots relative to each box, repeated in every box (ILT). */
  dots: z.array(DotSchema).default([]),
  lines: z.array(LineSchema).default([]),
  /** Per-box letters with their own dots (intervention sheets). */
  letters: z.array(LetterCellSchema).default([]),
  background: z
    .object({ asset_key: z.string(), x: mm, y: mm, width: z.number().positive(), height: z.number().positive() })
    .nullable()
    .default(null),
});
export type CanvasGeometry = z.infer<typeof CanvasGeometrySchema>;

export const DotRuleSchema = z.object({
  radius_mm: z.number().min(0).max(5),
  weight_pct: z.number().min(0).max(100),
  required: z.boolean(),
});
export type DotRule = z.infer<typeof DotRuleSchema>;

export const ScoringProfileSchema = z
  .object({
    dot_order: z.array(z.string()).min(1),
    dots: z.record(DotRuleSchema),
    expected_pen_lifts_per_block: z.number().int().positive(),
    fill_order: z.array(z.number().int().min(0)),
    normal_speed_mm_s: z.number().positive().nullable(),
    speed_flex_pct: z.number().min(0).max(100),
  })
  .superRefine((p, ctx) => {
    const total = Object.values(p.dots).reduce((sum, d) => sum + d.weight_pct, 0);
    if (Math.abs(total - 100) > 1e-9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Dot weights total ${total}, must total 100` });
    }
    for (const id of p.dot_order) {
      if (!p.dots[id]) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `dot_order names unknown dot ${id}` });
    }
  });
export type ScoringProfile = z.infer<typeof ScoringProfileSchema>;

export type FillDirection = 'RTL_ROWS' | 'LTR_ROWS';

/** Fill order generated from a language's fill direction, for canvases without a recorded sample (DDD §7.2). */
export function fillOrderFor(boxes: readonly Box[], direction: FillDirection): number[] {
  return [...boxes]
    .sort((a, b) => a.row - b.row || (direction === 'RTL_ROWS' ? b.col - a.col : a.col - b.col))
    .map((b) => b.id);
}

/**
 * Writing unit for forward-only locking and for the end of the page (FR-TAB-4): a box on the ILT
 * and letter sheets; a whole row on a notebook page, where letters are written freely along the
 * lines and do not fill the cells one by one.
 */
export const locksByRow = (geometry: CanvasGeometry): boolean => geometry.canvas_type === 'NOTEBOOK';

const rowOf = (geometry: CanvasGeometry, boxId: number | undefined) => geometry.boxes.find((b) => b.id === boxId)?.row;

/** True when a pen-down at (x, y) mm falls in a box (or notebook row) already passed in the fill order. */
export function isLocked(geometry: CanvasGeometry, fillOrder: readonly number[], fillPos: number, x: number, y: number): boolean {
  if (fillPos <= 0) return false;
  const hit = geometry.boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (!hit) return false;
  if (locksByRow(geometry)) return hit.row < (rowOf(geometry, fillOrder[fillPos]) ?? 0);
  const pos = fillOrder.indexOf(hit.id);
  return pos >= 0 && pos < fillPos;
}

/** True when the active box is the last box of the fill order (or, on a notebook page, in the last row). */
export function atLastUnit(geometry: CanvasGeometry, fillOrder: readonly number[], activeBoxId: number | null): boolean {
  if (activeBoxId === null || fillOrder.length === 0) return false;
  const last = fillOrder[fillOrder.length - 1];
  if (!locksByRow(geometry)) return activeBoxId === last;
  return rowOf(geometry, activeBoxId) === rowOf(geometry, last);
}

/** Mirrors each box's dot pattern and model paths horizontally (">" becomes "<"). The stored canvas never changes. */
export function mirrorCanvas(geometry: CanvasGeometry): CanvasGeometry {
  const boxW = geometry.boxes[0]!.w;
  const boxById = new Map(geometry.boxes.map((b) => [b.id, b]));
  return {
    ...geometry,
    dots: geometry.dots.map((d) => ({ ...d, x: boxW - d.x })),
    letters: geometry.letters.map((l) => {
      const w = boxById.get(l.box_id)?.w ?? boxW;
      const flip = (pts: [number, number][]) => pts.map(([x, y]) => [w - x, y] as [number, number]);
      return {
        ...l,
        dots: l.dots.map((d) => ({ ...d, x: w - d.x })),
        model_path: flip(l.model_path),
        model_strokes: l.model_strokes.map(flip),
        model_outline: l.model_outline.map(flip),
      };
    }),
  };
}

/**
 * An intervention letter's dot fits when it is inside its box, or (the end of a descender, as on ק)
 * below the box within its width, on the canvas and not inside another box.
 */
function letterDotFits(geometry: CanvasGeometry, box: Box, d: Dot): boolean {
  if (d.x < 0 || d.x > box.w) return false;
  if (d.y >= 0 && d.y <= box.h) return true;
  if (d.y < box.h) return false;
  const ax = box.x + d.x;
  const ay = box.y + d.y;
  if (ay > geometry.size.height) return false;
  return !geometry.boxes.some((b) => b.id !== box.id && ax >= b.x && ax <= b.x + b.w && ay >= b.y && ay <= b.y + b.h);
}

export interface CanvasIssue {
  code: 'DOES_NOT_FIT' | 'DOT_OUTSIDE_BOX' | 'DUPLICATE_ID' | 'BAD_FILL_ORDER' | 'BAD_PROFILE' | 'UNKNOWN_DOT' | 'NO_PROFILE';
  message: string;
}

/** Checks a canvas before activation (DDD §7.1). Screen size is the tablet's usable area in mm. */
export function validateCanvas(
  geometry: CanvasGeometry,
  screen: { width_mm: number; height_mm: number },
  fillOrder?: readonly number[],
): CanvasIssue[] {
  const issues: CanvasIssue[] = [];
  if (geometry.size.width > screen.width_mm || geometry.size.height > screen.height_mm) {
    issues.push({
      code: 'DOES_NOT_FIT',
      message: `Canvas ${geometry.size.width} x ${geometry.size.height} mm exceeds screen ${screen.width_mm} x ${screen.height_mm} mm`,
    });
  }
  const boxIds = new Set<number>();
  for (const b of geometry.boxes) {
    if (boxIds.has(b.id)) issues.push({ code: 'DUPLICATE_ID', message: `Box id ${b.id} appears twice` });
    boxIds.add(b.id);
  }
  // The dots repeat in every box: report each dot once, at the first box it does not fit.
  for (const d of geometry.dots) {
    const b = geometry.boxes.find((x) => d.x < 0 || d.x > x.w || d.y < 0 || d.y > x.h);
    if (b) issues.push({ code: 'DOT_OUTSIDE_BOX', message: `Dot ${d.id} lies outside box ${b.id}` });
  }
  const dotIds = new Set<string>();
  for (const d of geometry.dots) {
    if (dotIds.has(d.id)) issues.push({ code: 'DUPLICATE_ID', message: `Dot id ${d.id} appears twice` });
    dotIds.add(d.id);
  }
  for (const l of geometry.letters) {
    const box = geometry.boxes.find((b) => b.id === l.box_id);
    for (const d of l.dots) {
      if (!box || !letterDotFits(geometry, box, d)) {
        issues.push({ code: 'DOT_OUTSIDE_BOX', message: `Dot ${d.id} of letter in box ${l.box_id} lies outside its box` });
      }
    }
  }
  if (fillOrder) {
    const sorted = [...fillOrder].sort((a, b) => a - b);
    const ids = [...boxIds].sort((a, b) => a - b);
    if (sorted.length !== ids.length || sorted.some((v, i) => v !== ids[i])) {
      issues.push({ code: 'BAD_FILL_ORDER', message: 'Fill order is not a permutation of the box ids' });
    }
  }
  return issues;
}

/** Canvas types scored with a profile (FR-CAN-7); notebook pages are timed only. */
export const isScoredCanvas = (geometry: CanvasGeometry): boolean => geometry.canvas_type !== 'NOTEBOOK';

/**
 * Checks a scoring profile against its canvas: the schema (weights total 100, known dots in the
 * order), every profile dot drawn on the canvas, and a fill order that is empty (follow the
 * language direction) or a permutation of the box ids.
 */
export function validateProfile(geometry: CanvasGeometry, profile: unknown): CanvasIssue[] {
  if (!isScoredCanvas(geometry)) return [];
  if (profile === null || profile === undefined) return [{ code: 'NO_PROFILE', message: 'This canvas needs a scoring profile' }];
  const parsed = ScoringProfileSchema.safeParse(profile);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ code: 'BAD_PROFILE' as const, message: `${i.path.join('.') || 'profile'}: ${i.message}` }));
  const issues: CanvasIssue[] = [];
  if (geometry.canvas_type === 'ILT_GRID') {
    const drawn = new Set(geometry.dots.map((d) => d.id));
    for (const id of Object.keys(parsed.data.dots)) {
      if (!drawn.has(id)) issues.push({ code: 'UNKNOWN_DOT', message: `The profile scores dot ${id}, which is not on the canvas` });
    }
  }
  if (parsed.data.fill_order.length) {
    const sorted = [...parsed.data.fill_order].sort((a, b) => a - b);
    const ids = geometry.boxes.map((b) => b.id).sort((a, b) => a - b);
    if (sorted.length !== ids.length || sorted.some((v, i) => v !== ids[i])) {
      issues.push({ code: 'BAD_FILL_ORDER', message: 'Fill order is not a permutation of the box ids' });
    }
  }
  return issues;
}

/** A starting profile for a new canvas: its dots in order, equal weights, nothing required, one pen lift per box. */
export function starterProfile(geometry: CanvasGeometry): ScoringProfile | null {
  if (!isScoredCanvas(geometry)) return null;
  const ids = geometry.canvas_type === 'ILT_GRID' ? geometry.dots.map((d) => d.id) : [];
  const share = ids.length ? Math.floor(100 / ids.length) : 0;
  return {
    dot_order: ids.length ? ids : ['A'],
    dots: ids.length
      ? Object.fromEntries(ids.map((id, i) => [id, { radius_mm: 3.5, weight_pct: share + (i === 0 ? 100 - share * ids.length : 0), required: false }]))
      : { A: { radius_mm: 3.5, weight_pct: 100, required: false } },
    expected_pen_lifts_per_block: geometry.boxes.length,
    fill_order: [],
    normal_speed_mm_s: null,
    speed_flex_pct: 10,
  };
}

type Patch = { [key: string]: unknown };
const isPlain = (v: unknown): v is Patch => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The Domain's profile (FR-CAN-8): the canvas profile deep-merged with the Domain's patch; arrays are replaced whole. */
export function mergeProfile(base: ScoringProfile, patch: unknown): ScoringProfile {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isPlain(a) || !isPlain(b)) return b === undefined ? a : b;
    const out: Patch = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
    return out;
  };
  return merge(base, patch ?? {}) as ScoringProfile;
}

/** The smallest patch that turns `base` into `next` (only the values that differ). */
export function profilePatch(base: unknown, next: unknown): unknown {
  if (isPlain(base) && isPlain(next)) {
    const out: Patch = {};
    for (const [k, v] of Object.entries(next)) {
      const d = profilePatch(base[k], v);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(base) === JSON.stringify(next) ? undefined : next;
}
