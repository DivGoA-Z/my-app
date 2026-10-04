import { describe, expect, it } from 'vitest';
import { CANVAS_PADDING_PX, computeRoomScale } from './canvasScale';

describe('computeRoomScale', () => {
  it('centres a tall room across a wide space (§89)', () => {
    // 3000 × 4000 mm in 1080 × 836 px: height decides the scale.
    const r = computeRoomScale(3000, 4000, 1080, 836);
    expect(r.originY).toBe(CANVAS_PADDING_PX);
    expect(r.originX).toBeCloseTo((1080 - r.roomWidthPx) / 2);
    expect(r.originX + r.roomWidthPx / 2).toBeCloseTo(540);
  });

  it('centres a wide room down a tall space', () => {
    const r = computeRoomScale(4000, 2000, 600, 900);
    expect(r.originX).toBe(CANVAS_PADDING_PX);
    expect(r.originY + r.roomHeightPx / 2).toBeCloseTo(450);
  });

  it('never puts the room closer to the edge than the padding', () => {
    const r = computeRoomScale(3000, 3000, 400, 400);
    expect(r.originX).toBeGreaterThanOrEqual(CANVAS_PADDING_PX);
    expect(r.originY).toBeGreaterThanOrEqual(CANVAS_PADDING_PX);
  });
});
