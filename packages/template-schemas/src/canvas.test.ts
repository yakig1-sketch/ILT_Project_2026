import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CanvasGeometrySchema,
  DEFAULT_PROTOCOLS,
  ILT_GRID_GEOMETRY,
  ILT_PROFILE_EN,
  ILT_PROFILE_HE,
  ProtocolTemplateSchema,
  ScoringProfileSchema,
  mirrorCanvas,
  validateCanvas,
} from './index.js';

const geometryFile = fileURLToPath(
  new URL('../../../Documents/05_Measures/ILT_Day1_Grid_Geometry.json', import.meta.url),
);
const measured = JSON.parse(readFileSync(geometryFile, 'utf8'));
const DTH_A116_SCREEN = { width_mm: 242, height_mm: 158 };

describe('ILT seed canvas', () => {
  it('matches the measured 35 x 25 mm sheet (geometry v3)', () => {
    expect(measured.version).toBe(3);
    const g = CanvasGeometrySchema.parse(ILT_GRID_GEOMETRY);
    expect(g.size).toEqual({ width: measured.grid.width, height: measured.grid.height });
    expect(g.boxes.map((b) => b.x).slice(0, 5)).toEqual(measured.box_lefts);
    expect([0, 5, 10].map((i) => g.boxes[i]!.y)).toEqual(measured.row_tops);
    const dot = (id: string) => g.dots.find((d) => d.id === id)!;
    expect([dot('A').x, dot('A').y]).toEqual(measured.dots_in_box.A_top);
    expect([dot('B').x, dot('B').y]).toEqual(measured.dots_in_box.B_right);
    expect([dot('C').x, dot('C').y]).toEqual(measured.dots_in_box.C_bottom);
  });

  it('fits the DTH-A116 screen at true size and validates', () => {
    expect(validateCanvas(ILT_GRID_GEOMETRY, DTH_A116_SCREEN, ILT_PROFILE_HE.fill_order)).toEqual([]);
  });

  it('fills Hebrew right to left from the top-right box, English left to right', () => {
    expect(ILT_PROFILE_HE.fill_order).toEqual([4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 14, 13, 12, 11, 10]);
    expect(ILT_PROFILE_EN.fill_order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('has valid scoring profiles with B 1.3 mm / 90%', () => {
    const p = ScoringProfileSchema.parse(ILT_PROFILE_HE);
    expect(p.dots.B).toEqual({ radius_mm: 1.3, weight_pct: 90, required: true });
  });

  it('rejects weights that do not total 100', () => {
    const bad = { ...ILT_PROFILE_HE, dots: { ...ILT_PROFILE_HE.dots, B: { radius_mm: 1.3, weight_pct: 80, required: true } } };
    expect(ScoringProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('mirrors ">" into "<"', () => {
    const m = mirrorCanvas(ILT_GRID_GEOMETRY);
    const b = m.dots.find((d) => d.id === 'B')!;
    const a = m.dots.find((d) => d.id === 'A')!;
    expect(b.x).toBeCloseTo(15.0);
    expect(a.x).toBeCloseTo(20.5);
    expect(b.x).toBeLessThan(a.x);
  });

  it('flags a dot outside its box', () => {
    const g = { ...ILT_GRID_GEOMETRY, dots: [{ id: 'A', x: 40, y: 2, diameter_mm: 2.6 }] };
    expect(validateCanvas(g, DTH_A116_SCREEN).some((i) => i.code === 'DOT_OUTSIDE_BOX')).toBe(true);
  });
});

describe('protocol templates', () => {
  it('Day 1 has a warm-up plus 12 writing blocks and two videos', () => {
    const day1 = ProtocolTemplateSchema.parse(DEFAULT_PROTOCOLS.find((t) => t.code === 'DAY_1'));
    const writing = day1.steps.filter((s) => s.step_type !== 'VIDEO');
    expect(writing).toHaveLength(13);
    expect(day1.steps.filter((s) => s.step_type === 'VIDEO').map((s) => s.video_key)).toEqual(['intro', 'notebook_demo']);
  });
});
