import { describe, expect, it } from 'vitest';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE } from '@ilt/template-schemas';
import { PERFECT_ILT, synthBlock } from './fixtures.js';
import { deriveNormalSpeed, deriveSampleFill, firstRows } from './reference.js';

const boxes = ILT_GRID_GEOMETRY.boxes;
const box = (id: number) => boxes.find((b) => b.id === id)!;
const order = ILT_PROFILE_HE.fill_order;

describe('deriveSampleFill (FR-CAN-9)', () => {
  it('takes the fill order from the first stroke in each box and counts pen lifts', () => {
    const drawn = [...order].reverse();
    const samples = synthBlock(drawn.map((id) => ({ box: box(id), spec: PERFECT_ILT })));
    const r = deriveSampleFill(samples, ILT_GRID_GEOMETRY);
    expect(r.fill_order).toEqual(drawn);
    expect(r).toMatchObject({ pen_lifts: drawn.length, complete: true, boxes_written: boxes.length, boxes_total: boxes.length });
  });

  it('is incomplete when a box is left empty, and counts two-stroke letters as two lifts', () => {
    const twoStrokes = { strokes: [[[14.5, 2.6], [20.0, 12.6]], [[20.0, 12.6], [14.5, 22.7]]] as [number, number][][], internal_gap_ms: 200 };
    const samples = synthBlock(order.slice(0, 3).map((id) => ({ box: box(id), spec: twoStrokes })));
    const r = deriveSampleFill(samples, ILT_GRID_GEOMETRY);
    expect(r).toMatchObject({ fill_order: order.slice(0, 3), pen_lifts: 6, complete: false, boxes_written: 3 });
  });
});

describe('deriveNormalSpeed (FR-CAN-10)', () => {
  it('measures the first row of the fill order with the children\'s speed formula', () => {
    const row = firstRows(ILT_GRID_GEOMETRY, order, 1);
    expect(row.length).toBeGreaterThan(1);
    expect(new Set(row.map((id) => box(id).row)).size).toBe(1);
    const samples = synthBlock(row.map((id) => ({ box: box(id), spec: { ...PERFECT_ILT, speed_mm_s: 30 } })));
    const r = deriveNormalSpeed(samples, ILT_GRID_GEOMETRY, ILT_PROFILE_HE, order, 1);
    expect(r.complete).toBe(true);
    expect(r.letters_written).toBe(row.length);
    expect(r.normal_speed_mm_s).toBeGreaterThan(27);
    expect(r.normal_speed_mm_s).toBeLessThan(33);
  });

  it('is incomplete when the row is only partly written', () => {
    const row = firstRows(ILT_GRID_GEOMETRY, order, 1);
    const samples = synthBlock([{ box: box(row[0]!), spec: PERFECT_ILT }]);
    const r = deriveNormalSpeed(samples, ILT_GRID_GEOMETRY, ILT_PROFILE_HE, order, 1);
    expect(r).toMatchObject({ complete: false, letters_written: 1, letters_expected: row.length });
  });
});
