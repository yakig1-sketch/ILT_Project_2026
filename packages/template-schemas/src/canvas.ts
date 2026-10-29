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
  dots: z.array(DotSchema),
  model_path: z.array(point).default([]),
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

/** Mirrors each box's dot pattern and model paths horizontally (">" becomes "<"). The stored canvas never changes. */
export function mirrorCanvas(geometry: CanvasGeometry): CanvasGeometry {
  const boxW = geometry.boxes[0]!.w;
  const boxById = new Map(geometry.boxes.map((b) => [b.id, b]));
  return {
    ...geometry,
    dots: geometry.dots.map((d) => ({ ...d, x: boxW - d.x })),
    letters: geometry.letters.map((l) => {
      const w = boxById.get(l.box_id)?.w ?? boxW;
      return {
        ...l,
        dots: l.dots.map((d) => ({ ...d, x: w - d.x })),
        model_path: l.model_path.map(([x, y]) => [w - x, y] as [number, number]),
      };
    }),
  };
}

export interface CanvasIssue {
  code: 'DOES_NOT_FIT' | 'DOT_OUTSIDE_BOX' | 'DUPLICATE_ID' | 'BAD_FILL_ORDER';
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
    for (const d of geometry.dots) {
      if (d.x < 0 || d.x > b.w || d.y < 0 || d.y > b.h) {
        issues.push({ code: 'DOT_OUTSIDE_BOX', message: `Dot ${d.id} lies outside box ${b.id}` });
      }
    }
  }
  const dotIds = new Set<string>();
  for (const d of geometry.dots) {
    if (dotIds.has(d.id)) issues.push({ code: 'DUPLICATE_ID', message: `Dot id ${d.id} appears twice` });
    dotIds.add(d.id);
  }
  for (const l of geometry.letters) {
    const box = geometry.boxes.find((b) => b.id === l.box_id);
    for (const d of l.dots) {
      if (!box || d.x < 0 || d.x > box.w || d.y < 0 || d.y > box.h) {
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
