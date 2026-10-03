// Tests for the depth convention's physical footprint (§61). The
// property that matters: the extra shutter depth grows toward the FRONT
// at every rotation, the back never moves, and dragging round-trips.

import { describe, expect, it } from 'vitest';
import {
  effectiveConstruction,
  frontDirection,
  physicalCabinet,
  physicalCabinets,
  storedPositionFromPhysicalCenter,
} from './physicalDepth';
import { getFootprint } from './footprint';
import { baseUnit, construction } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';

// The on-floor rectangle of an item, from lib/footprint.ts's own rules.
function rect(c: { x: number; y: number; widthMm: number; depthMm: number; rotationDeg: number }) {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(c.widthMm, c.depthMm, c.rotationDeg);
  const cx = c.x + c.widthMm / 2;
  const cy = c.y + c.depthMm / 2;
  return { left: cx - footprintWidthMm / 2, right: cx + footprintWidthMm / 2, top: cy - footprintHeightMm / 2, bottom: cy + footprintHeightMm / 2 };
}

describe('physical footprint under "carcass only" depth', () => {
  it('front directions match the clearance code: 0→+y, 90→−x, 180→−y, 270→+x', () => {
    expect([0, 90, 180, 270].map(frontDirection)).toEqual([
      { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 },
    ]);
  });

  for (const rotationDeg of [0, 90, 180, 270] as const) {
    it(`at ${rotationDeg}°, the extra 18mm is on the front and the back stays put`, () => {
      const stored = baseUnit({ x: 1000, y: 0, rotationDeg });
      const before = rect(stored);
      const after = rect(physicalCabinet(stored, 18));
      type Side = 'left' | 'right' | 'top' | 'bottom';
      const grownBy: Record<number, Partial<Record<Side, number>>> = {
        0: { bottom: 18 },
        90: { left: -18 },
        180: { top: -18 },
        270: { right: 18 },
      };
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(after[side] - before[side]).toBeCloseTo(grownBy[rotationDeg][side] ?? 0, 6);
      }
    });

    it(`at ${rotationDeg}°, dragging the physical cabinet saves the right stored position`, () => {
      const stored = baseUnit({ x: 700, y: 300, rotationDeg });
      const phys = physicalCabinet(stored, 18);
      // "Drag" by +50/+20 and write back.
      const back = storedPositionFromPhysicalCenter(stored, phys.x + phys.widthMm / 2 + 50, phys.y + phys.depthMm / 2 + 20, 18);
      expect(back.x).toBeCloseTo(stored.x + 50, 6);
      expect(back.y).toBeCloseTo(stored.y + 20, 6);
    });
  }

  it('changes nothing — same array — when depth includes the shutter', () => {
    const items = [baseUnit()];
    expect(physicalCabinets(items, true, defaultRateCard())).toBe(items);
  });

  it("grows by the cabinet's OWN shutter board thickness — 25mm, not 18 (§65)", () => {
    const rates = defaultRateCard();
    const withThick = { ...rates, boards: [...rates.boards, { id: 'hdmr-25', material: 'HDMR' as const, thicknessMm: 25, ratePerSqM: 1900 }] };
    const thick = baseUnit({ panels: { fronts: { boardId: 'hdmr-25' } } });
    expect(physicalCabinets([thick], false, withThick)[0].depthMm).toBe(625);
    expect(physicalCabinets([baseUnit()], false, withThick)[0].depthMm).toBe(618);
  });

  it('a project override wins over the business setting', () => {
    expect(effectiveConstruction(construction(), { depthIncludesFront: false }).depthIncludesFront).toBe(false);
    expect(effectiveConstruction(construction({ depthIncludesFront: false }), {}).depthIncludesFront).toBe(false);
    const s = construction();
    expect(effectiveConstruction(s, { depthIncludesFront: undefined })).toBe(s);
  });
});
