import { describe, expect, it } from 'vitest';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE } from '@ilt/template-schemas';
import { advanceFillPosition } from './segment.js';

const boxes = ILT_GRID_GEOMETRY.boxes;
const order = ILT_PROFILE_HE.fill_order;
const centre = (id: number) => {
  const b = boxes.find((x) => x.id === id)!;
  return [b.x + b.w / 2, b.y + b.h / 2] as const;
};

describe('advanceFillPosition (forward-only active box, FR-TAB-4)', () => {
  it('moves forward to a later box in the fill order', () => {
    const [x, y] = centre(order[3]!);
    expect(advanceFillPosition(boxes, order, 0, x, y, 2)).toBe(3);
  });

  it('never moves back to a finished box', () => {
    const [x, y] = centre(order[1]!);
    expect(advanceFillPosition(boxes, order, 4, x, y, 2)).toBe(4);
  });

  it('keeps the active box for a pen-down outside every box', () => {
    expect(advanceFillPosition(boxes, order, 2, -50, -50, 2)).toBe(2);
  });

  it('accepts a pen-down just outside a box within the entry margin', () => {
    const b = boxes.find((x) => x.id === order[5])!;
    expect(advanceFillPosition(boxes, order, 0, b.x + b.w / 2, b.y - 1, 2)).toBeGreaterThanOrEqual(1);
    expect(advanceFillPosition(boxes, order, 0, b.x + b.w / 2, b.y - 1, 0)).toBe(0);
  });
});
