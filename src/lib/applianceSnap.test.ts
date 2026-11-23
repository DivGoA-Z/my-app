import { describe, expect, it } from 'vitest';
import { snapApplianceFootprint } from './cabinetSnapping';

// Wall cabinets 1500–2300 high: one 0–637, the next from 1237 (a 600 gap
// not on the 50 mm grid). Base unit under the gap, 0–850 high.
const wall = (id: string, x: number) => ({ id, x, y: 0, widthMm: 637, depthMm: 350, rotationDeg: 0 as const, elevationMm: 1500, heightMm: 800 });
const neighbours = [wall('w1', 0), wall('w2', 1237), { id: 'b', x: 637, y: 0, widthMm: 600, depthMm: 600, rotationDeg: 0 as const, elevationMm: 0, heightMm: 850 }];

describe('appliances snap to same-height neighbours (§150)', () => {
  it('a 600 chimney dropped near the gap lands flush between the wall cabinets', () => {
    const chimney = { id: 'c', x: 0, y: 0, widthMm: 600, depthMm: 400, rotationDeg: 0 as const, elevationMm: 1650, heightMm: 500 };
    const r = snapApplianceFootprint(chimney, 660, 20, 600, 400, neighbours, 3000, 3000, 50);
    expect(r).toEqual({ left: 637, top: 0 });
  });

  it('a hob on the counter ignores the wall cabinets above it', () => {
    const hob = { id: 'h', x: 0, y: 0, widthMm: 600, depthMm: 500, rotationDeg: 0 as const, elevationMm: 890, heightMm: 100 };
    // Near w2's left edge (1237) but at counter height: grid, not 1237 - 600.
    expect(snapApplianceFootprint(hob, 640, 20, 600, 500, neighbours, 3000, 3000, 50).left).toBe(650);
  });
});
