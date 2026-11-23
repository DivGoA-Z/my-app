import { describe, expect, it } from 'vitest';
import { wallCabinetsAbove } from './wallRunFromBase';
import { DEFAULT_STANDARD_SIZES } from './standardSizes';
import { cabinet, layout } from '../test/fixtures';
import type { PlacedApplianceItem } from '../types/appliance';
import type { Wall } from '../types/layout';

const room = (walls: Wall[] = []) => layout({ dimensions: { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 }, walls });
// A north run of three base units, fronts facing south (rotation 0).
const run = () => [
  cabinet('base-cabinet', 600, 600, 850, { id: 'b1', x: 0, y: 0, elevationMm: 0 }),
  cabinet('drawer-unit', 900, 600, 850, { id: 'b2', x: 600, y: 0, elevationMm: 0 }),
  cabinet('sink-unit', 800, 600, 850, { id: 'b3', x: 1500, y: 0, elevationMm: 0 }),
];
const hob = { id: 'hob', applianceType: 'stove', x: 750, y: 50, widthMm: 600, depthMm: 500, heightMm: 100, elevationMm: 890, rotationDeg: 0 } as PlacedApplianceItem;
let n = 0;
const ids = () => `w${++n}`;

describe('add wall cabinets above a base run (§150)', () => {
  it('one wall unit per base unit, same width, standard depth and height, at the chosen bottom', () => {
    const cabs = run();
    const r = wallCabinetsAbove({ from: cabs[0], cabinets: cabs, appliances: [], obstacles: [], layout: room(), standard: DEFAULT_STANDARD_SIZES, bottomMm: 1500, newId: ids });
    expect(r.wall).toBe('north');
    expect(r.created.map((c) => [c.x, c.y, c.widthMm, c.depthMm, c.heightMm, c.elevationMm])).toEqual([
      [0, 0, 600, 300, 700, 1500],
      [600, 0, 900, 300, 700, 1500],
      [1500, 0, 800, 300, 700, 1500],
    ]);
  });

  it('skips the hob, a window, and space already taken', () => {
    const cabs = run();
    const window: Wall = { id: 'n', orientation: 'north', lengthMm: 3000, openings: [{ id: 'w', wallId: 'north', kind: 'window', offsetMm: 1600, widthMm: 600, heightMm: 1000, sillMm: 1100, suppliedByUs: false }] };
    const r = wallCabinetsAbove({ from: cabs[0], cabinets: cabs, appliances: [hob], obstacles: [], layout: room([window]), standard: DEFAULT_STANDARD_SIZES, bottomMm: 1500, newId: ids });
    expect(r.created.map((c) => c.widthMm)).toEqual([600]);
    expect(r.skipped).toEqual([{ baseId: 'b2', reason: 'hob' }, { baseId: 'b3', reason: 'window' }]);
    const again = wallCabinetsAbove({ from: cabs[0], cabinets: [...cabs, ...r.created], appliances: [hob], obstacles: [], layout: room([window]), standard: DEFAULT_STANDARD_SIZES, bottomMm: 1500, newId: ids });
    expect(again.created).toEqual([]);
    expect(again.skipped[0]).toEqual({ baseId: 'b1', reason: 'occupied' });
  });

  it('works on a side wall: a west run, fronts facing east', () => {
    // rotation 270 → front +x (east), back to the west wall.
    const b = cabinet('base-cabinet', 600, 600, 850, { id: 'west', x: 0, y: 1000, elevationMm: 0, rotationDeg: 270 });
    const r = wallCabinetsAbove({ from: b, cabinets: [b], appliances: [], obstacles: [], layout: room(), standard: DEFAULT_STANDARD_SIZES, bottomMm: 1500, newId: ids });
    expect(r.wall).toBe('west');
    const u = r.created[0];
    // Rotated footprint: 300 deep from the west wall, 600 along it from y 1000.
    expect([u.rotationDeg, u.x + u.widthMm / 2, u.y + u.depthMm / 2]).toEqual([270, 150, 1300]);
  });
});
