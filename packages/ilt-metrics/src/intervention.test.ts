// Intervention sheet marks (DDD §8.7) on the ה letter sheet: row 1 dots, order and lifts; row 2's
// start point; row 3 left to the evaluator, with the similarity hint.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CanvasGeometry, LetterCell, ScoringProfile } from '@ilt/template-schemas';
import { synthBlock, type LetterSpec } from './fixtures.js';
import { liftsAllowed, sheetAccuracy, suggestSheetMarks } from './intervention.js';

const HE = JSON.parse(readFileSync(new URL('../../../Documents/05_Measures/Intervention_Letters/LETTER_HE_HE.json', import.meta.url), 'utf8')) as {
  geometry: CanvasGeometry; profile: ScoringProfile;
};
const { geometry, profile } = HE;
const box = (id: number) => geometry.boxes.find((b) => b.id === id)!;
const cell = (id: number) => geometry.letters.find((l) => l.box_id === id)!;
/** The model letter as the child should write it: its strokes, in order. */
const model = (id: number): LetterSpec => ({ strokes: cell(id).model_strokes.map((s) => s.map(([x, y]) => [x, y] as [number, number])) });
const sheet = (specs: Partial<Record<number, LetterSpec>>) =>
  synthBlock(profile.fill_order.filter((id) => specs[id]).map((id) => ({ box: box(id), spec: specs[id]! })));
const all = (f: (id: number) => LetterSpec | undefined) => Object.fromEntries(profile.fill_order.map((id) => [id, f(id)]));
const markOf = (marks: ReturnType<typeof suggestSheetMarks>, id: number) => marks.find((m) => m.box_id === id)!;

describe('intervention sheet marks', () => {
  it('suggests ✓ for rows 1 and 2 written like the model, and leaves row 3 to the evaluator', () => {
    const marks = suggestSheetMarks(sheet(all(model)), geometry, profile);
    expect(marks).toHaveLength(15);
    expect(marks.map((m) => m.box_id)).toEqual(profile.fill_order);
    for (const m of marks.filter((x) => x.row_type === 'TRACE_MODEL')) {
      expect(m).toMatchObject({ letter: 'ה', status: 'WRITTEN', auto_error: false, internal_pen_lifts: 1, lifts_allowed: 1, similarity_hint: null });
    }
    for (const m of marks.filter((x) => x.row_type === 'START_DOT')) expect(m).toMatchObject({ auto_error: false, start_point_ok: true });
    for (const m of marks.filter((x) => x.row_type === 'FREEHAND')) {
      expect(m.auto_error).toBeNull();
      expect(m.similarity_hint).toBeGreaterThan(90);
    }
  });

  it('row 1: more lifts than strokes − 1, a missed dot or the wrong order is ✗', () => {
    // Box 4: the arch drawn in three pieces (3 lifts inside the letter, 1 allowed).
    const [arch, leg] = model(4).strokes as [[number, number][], [number, number][]];
    const split = { strokes: [arch.slice(0, 4), arch.slice(3, 8), arch.slice(7), leg] };
    // Box 3: the whole letter 6 mm to the side, missing its dots.
    const shifted = { strokes: model(3).strokes.map((s) => s.map(([x, y]) => [x + 6, y] as [number, number])) };
    // Box 2: the leg first, then the arch (dots 3, 4 before 1, 2).
    const reversed = { strokes: [...model(2).strokes].reverse() };
    const marks = suggestSheetMarks(sheet({ ...all(model), 4: split, 3: shifted, 2: reversed }), geometry, profile);
    expect(markOf(marks, 4)).toMatchObject({ internal_pen_lifts: 3, auto_error: true });
    expect(markOf(marks, 3).auto_error).toBe(true);
    expect(markOf(marks, 2).auto_error).toBe(true);
    expect(markOf(marks, 1).auto_error).toBe(false);
  });

  it('row 2: a letter started away from the start dot is ✗; the form is the evaluator\'s', () => {
    // Box 9: the arch written from its other end.
    const [arch, leg] = model(9).strokes as [[number, number][], [number, number][]];
    const marks = suggestSheetMarks(sheet({ ...all(model), 9: { strokes: [[...arch].reverse(), leg] } }), geometry, profile);
    expect(markOf(marks, 9)).toMatchObject({ start_point_ok: false, auto_error: true });
    expect(markOf(marks, 8)).toMatchObject({ start_point_ok: true, auto_error: false });
  });

  it('row 3: the hint is low for a shape unlike the letter, and absent when switched off', () => {
    const scribble = { strokes: [[[3, 12], [26, 12]] as [number, number][]] };
    const marks = suggestSheetMarks(sheet({ ...all(model), 14: scribble }), geometry, profile);
    expect(markOf(marks, 14).similarity_hint).toBeLessThan(50);
    expect(markOf(marks, 14).auto_error).toBeNull();
    const off = suggestSheetMarks(sheet(all(model)), geometry, profile, undefined, { similarity: false });
    expect(off.every((m) => m.similarity_hint === null)).toBe(true);
  });

  it('an empty or skipped box is ✗ in rows 1 and 2, and still the evaluator\'s in row 3', () => {
    const marks = suggestSheetMarks(sheet(all((id) => (id === 0 || id === 5 || id === 10 ? undefined : model(id)))), geometry, profile);
    // Boxes 0 and 5 were passed over (skipped); box 10 is the last box, left empty.
    expect(markOf(marks, 0)).toMatchObject({ status: 'SKIPPED', auto_error: true });
    expect(markOf(marks, 5)).toMatchObject({ status: 'SKIPPED', auto_error: true, start_point_ok: false });
    expect(markOf(marks, 10)).toMatchObject({ status: 'EMPTY', auto_error: null, similarity_hint: null });
  });

  it('allows lifts only to letters written in several strokes', () => {
    expect(liftsAllowed(cell(4))).toBe(1);
    expect(liftsAllowed({ ...cell(4), allow_internal_lifts: false } as LetterCell)).toBe(0);
    expect(liftsAllowed({ ...cell(4), model_strokes: [] } as LetterCell)).toBe(0);
  });

  it('sheet accuracy counts decided marks only', () => {
    expect(sheetAccuracy([false, false, true, null])).toBeCloseTo(66.67, 2);
    expect(sheetAccuracy([null])).toBeNull();
  });
});
