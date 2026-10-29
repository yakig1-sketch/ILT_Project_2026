import { describe, expect, it } from 'vitest';
import {
  ILT_GRID_BOXES,
  ILT_GRID_GEOMETRY,
  ILT_PROFILE_EN,
  ILT_PROFILE_HE,
  mirrorCanvas,
  type ScoringProfile,
} from '@ilt/template-schemas';
import { PERFECT_ILT, synthBlock, type LetterSpec } from './fixtures.js';
import {
  DEFAULT_SCORING_SETTINGS,
  compositeScore,
  penLiftScore,
  round2,
  scoreBlock,
  speedScore,
} from './score.js';

const box = (id: number) => ILT_GRID_BOXES[id]!;
const heBlock = (specFor: (pos: number) => LetterSpec | null, opts?: Parameters<typeof synthBlock>[1]) =>
  synthBlock(
    ILT_PROFILE_HE.fill_order
      .map((id, pos) => ({ box: box(id), spec: specFor(pos) }))
      .filter((l): l is { box: (typeof ILT_GRID_BOXES)[number]; spec: LetterSpec } => l.spec !== null),
    opts,
  );
const withNormal = (n: number): ScoringProfile => ({ ...ILT_PROFILE_HE, normal_speed_mm_s: n });

describe('worked examples (DDD §8.8)', () => {
  it('speed in range scores 100', () => {
    expect(speedScore(20.0, 19.45, 10, 'CAP_100')).toBe(100);
  });
  it('speed below range: 100 / (L / X) with unrounded L = 17.505', () => {
    expect(round2(speedScore(15.0, 19.45, 10, 'CAP_100')!)).toBe(85.69);
  });
  it('speed above range is capped by default, penalised symmetrically when chosen', () => {
    expect(speedScore(30, 19.45, 10, 'CAP_100')).toBe(100);
    expect(speedScore(30, 19.45, 10, 'SYMMETRIC_PENALTY')!).toBeCloseTo((100 * 21.395) / 30, 9);
  });
  it('pen lifts 17 of 15 expected -> 88.24; 14 -> capped 100; 0 -> null', () => {
    expect(round2(penLiftScore(17, 15)!)).toBe(88.24);
    expect(penLiftScore(14, 15)).toBe(100);
    expect(penLiftScore(0, 15)).toBeNull();
  });
  it('composite from unrounded parts -> 88.65', () => {
    const c = compositeScore(speedScore(15, 19.45, 10, 'CAP_100'), 95, penLiftScore(17, 15), DEFAULT_SCORING_SETTINGS);
    expect(round2(c!)).toBe(88.65);
  });
});

describe('scoreBlock: perfect Hebrew block', () => {
  const result = scoreBlock(heBlock(() => PERFECT_ILT), ILT_GRID_GEOMETRY, withNormal(20));

  it('counts 15 pen lifts, all letters accurate, accuracy 100', () => {
    expect(result.pen_lifts).toBe(15);
    expect(result.internal_pen_lifts).toBe(0);
    expect(result.accurate_letters).toBe(15);
    expect(result.accuracy_score).toBeCloseTo(100, 9);
    expect(result.skipped_boxes).toBe(0);
    expect(result.last_box_completed).toBe(true);
  });

  it('measures width 11.0 mm and the A->B->C line', () => {
    const l = result.letters[0]!;
    expect(l.box_id).toBe(4); // Hebrew starts at the top-right box
    expect(l.width_mm).toBeCloseTo(11.0, 6);
    expect(l.width_in_band).toBe(true);
    expect(l.line_length_mm).toBeCloseTo(Math.hypot(5.5, 10) + Math.hypot(5.5, 10.1), 6);
    expect(l.line_start_fallback).toBe(false);
    expect(l.line_end_fallback).toBe(false);
    expect(l.dot_order_ok).toBe(true);
  });

  it('speed ~20 mm/s scores 100; composite and pass need a threshold', () => {
    expect(result.avg_speed_mm_s!).toBeCloseTo(20, 0);
    expect(result.speed_score).toBe(100);
    expect(result.pen_lift_score).toBe(100);
    expect(result.composite_score!).toBeCloseTo(100, 9);
    expect(result.pass).toBeNull();
    const withThreshold = scoreBlock(heBlock(() => PERFECT_ILT), ILT_GRID_GEOMETRY, withNormal(20), {
      ...DEFAULT_SCORING_SETTINGS,
      pass_threshold: 80,
    });
    expect(withThreshold.pass).toBe(true);
  });

  it('speed score is "not configured" until a normal speed is recorded', () => {
    const r = scoreBlock(heBlock(() => PERFECT_ILT), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.speed_score).toBeNull();
    expect(r.composite_score).toBeNull();
  });
});

describe('scoreBlock: dot B and order', () => {
  const passBAt = (dx: number): LetterSpec => ({ strokes: [[[14.5, 2.6], [20.0 - dx, 12.6], [14.5, 22.7]]] });

  it('line 1.5 mm from B misses it (radius 1.3): score 10, not accurate', () => {
    const r = scoreBlock(heBlock(() => passBAt(1.5)), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    const l = r.letters[0]!;
    expect(l.dots.B!.dist_mm).toBeCloseTo(1.5, 6);
    expect(l.dots.B!.hit).toBe(false);
    expect(l.accuracy_score).toBe(10);
    expect(l.is_accurate).toBe(false);
  });

  it('line 1.2 mm from B touches the printed dot: hit', () => {
    const r = scoreBlock(heBlock(() => passBAt(1.2)), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.letters[0]!.dots.B!.hit).toBe(true);
    expect(r.letters[0]!.is_accurate).toBe(true);
  });

  it('B hit, A missed, C hit, top-down: 95 and accurate', () => {
    const spec: LetterSpec = { strokes: [[[10.0, 6.0], [20.0, 12.6], [14.5, 22.7]]] };
    const l = scoreBlock(heBlock(() => spec), ILT_GRID_GEOMETRY, ILT_PROFILE_HE).letters[0]!;
    expect(l.dots.A!.hit).toBe(false);
    expect(l.accuracy_score).toBe(95);
    expect(l.dot_order_ok).toBe(true);
    expect(l.is_accurate).toBe(true);
  });

  it('written bottom-up C->B->A: 100 but not accurate (order required)', () => {
    const spec: LetterSpec = { strokes: [[[14.5, 22.7], [20.0, 12.6], [14.5, 2.6]]] };
    const l = scoreBlock(heBlock(() => spec), ILT_GRID_GEOMETRY, ILT_PROFILE_HE).letters[0]!;
    expect(l.accuracy_score).toBe(100);
    expect(l.dot_order_ok).toBe(false);
    expect(l.is_accurate).toBe(false);
    const orderOff = scoreBlock(heBlock(() => spec), ILT_GRID_GEOMETRY, ILT_PROFILE_HE, {
      ...DEFAULT_SCORING_SETTINGS,
      require_dot_order: false,
    });
    expect(orderOff.letters[0]!.is_accurate).toBe(true);
  });
});

describe('scoreBlock: pen lifts, skipped boxes, timing', () => {
  const twoStrokes: LetterSpec = {
    strokes: [[[14.5, 2.6], [20.0, 12.6]], [[20.0, 12.6], [14.5, 22.7]]],
    internal_gap_ms: 300,
  };

  it('two letters with an internal lift -> 17 pen lifts, score 88.24', () => {
    const r = scoreBlock(heBlock((pos) => (pos < 2 ? twoStrokes : PERFECT_ILT)), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.pen_lifts).toBe(17);
    expect(r.internal_pen_lifts).toBe(2);
    expect(round2(r.pen_lift_score!)).toBe(88.24);
  });

  it('a lift shorter than 50 ms is not a pen lift', () => {
    const r = scoreBlock(heBlock(() => ({ ...twoStrokes, internal_gap_ms: 30 })), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.pen_lifts).toBe(15);
    expect(r.raw_stroke_count).toBe(30);
  });

  it('a passed-over box is SKIPPED and scores 0', () => {
    const r = scoreBlock(heBlock((pos) => (pos === 3 ? null : PERFECT_ILT)), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.skipped_boxes).toBe(1);
    expect(r.letters[3]!.status).toBe('SKIPPED');
    expect(r.accuracy_score).toBeCloseTo((14 * 100) / 15, 9);
  });

  it('boxes after the last written one are EMPTY and the last box is not completed', () => {
    const r = scoreBlock(heBlock((pos) => (pos < 10 ? PERFECT_ILT : null)), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.letters[12]!.status).toBe('EMPTY');
    expect(r.last_box_completed).toBe(false);
  });

  it('total time = active writing + air time', () => {
    const r = scoreBlock(heBlock(() => PERFECT_ILT, { gap_between_letters_ms: 400 }), ILT_GRID_GEOMETRY, ILT_PROFILE_HE);
    expect(r.total_time_ms! - r.active_writing_time_ms - r.air_time_ms!).toBeCloseTo(0, 6);
    expect(r.air_time_ms!).toBeCloseTo(14 * 400, -1);
  });
});

describe('scoreBlock: mirrored English letter', () => {
  it('scores a mirrored "<" written left to right', () => {
    const canvas = mirrorCanvas(ILT_GRID_GEOMETRY);
    const mirrored: LetterSpec = { strokes: [[[20.5, 2.6], [15.0, 12.6], [20.5, 22.7]]] };
    const samples = synthBlock(ILT_PROFILE_EN.fill_order.map((id) => ({ box: box(id), spec: mirrored })));
    const r = scoreBlock(samples, canvas, ILT_PROFILE_EN);
    expect(r.letters[0]!.box_id).toBe(0);
    expect(r.accurate_letters).toBe(15);
    expect(r.letters[0]!.width_mm).toBeCloseTo(11.0, 6);
  });
});
