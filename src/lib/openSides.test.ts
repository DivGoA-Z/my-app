// §146: an open side has no wall — nothing drawn, finished, charged or
// cut into on it.
import { describe, expect, it } from 'vitest';
import { allOpenings, isOpenSide, openSides, wallOpenings } from './openSides';
import { computeRoomSurfaceAreas } from './surfaceAreas';
import { calculateBOM } from './bom';
import { checkBacksOnOpenSide } from './kitchenChecks';
import { baseUnit, cabinet, layout, pricing } from '../test/fixtures';
import type { Wall, WallOrientation } from '../types/layout';
import type { WallOpening } from '../types/opening';

const window1: WallOpening = { id: 'win', wallId: 'west', kind: 'window', offsetMm: 500, widthMm: 1000, heightMm: 1200, sillMm: 900, suppliedByUs: false };
const walls = (open: WallOrientation[], finishId?: string): Wall[] =>
  (['north', 'east', 'south', 'west'] as WallOrientation[]).map((o) => ({
    id: `w-${o}`,
    orientation: o,
    lengthMm: 3000,
    openings: o === 'west' ? [window1] : [],
    finishId,
    open: open.includes(o) || undefined,
  }));

describe('open sides (§146)', () => {
  it('an open side carries no openings, but keeps them for when it closes again', () => {
    const l = layout({ walls: walls(['west']) });
    expect(isOpenSide(l, 'west')).toBe(true);
    expect(openSides(l)).toEqual(['west']);
    expect(wallOpenings(l.walls[3])).toEqual([]);
    expect(allOpenings(l)).toEqual([]);
    expect(l.walls[3].openings).toEqual([window1]);
    expect(allOpenings(layout({ walls: walls([]) }))).toEqual([window1]);
  });

  it('has no surface area', () => {
    const areas = computeRoomSurfaceAreas(layout({ walls: walls(['east']), dimensions: { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 } }), [], []);
    expect(areas.walls.east.exposedSqM + areas.walls.east.concealedSqM + areas.walls.east.occupiedSqM).toBe(0);
    expect(areas.walls.north.exposedSqM).toBeGreaterThan(0);
  });

  it('is never charged, even with a wall finish chosen before it was opened', () => {
    const finishes = [{ id: 'paint', label: 'Paint', pricePerSqM: 100, patternCategory: 'solid' }] as never;
    const bom = (open: WallOrientation[]) =>
      calculateBOM([baseUnit()], [], { ...pricing({ layout: layout({ walls: walls(open, 'paint'), dimensions: { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 } }) }), finishes });
    const closed = bom([]);
    const oneOpen = bom(['east']);
    expect(oneOpen.surfaceSubtotal).toBeLessThan(closed.surfaceSubtotal);
    expect(closed.surfaceLineItems.map((l) => l.surface)).toContain('East wall');
    expect(oneOpen.surfaceLineItems.map((l) => l.surface)).not.toContain('East wall');
  });

  it('warns when units back onto an open side', () => {
    // A base unit against the north edge, front facing south (rotation 0).
    const l = layout({ walls: walls(['north']) });
    const found = checkBacksOnOpenSide(l, [cabinet('base-cabinet', 600, 600, 720, { id: 'b1', x: 0, y: 0, elevationMm: 0 })]);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/^1 unit backs onto the open north side/);
    expect(checkBacksOnOpenSide(layout({ walls: walls([]) }), [cabinet('base-cabinet', 600, 600, 720, { x: 0, y: 0, elevationMm: 0 })])).toEqual([]);
  });
});

describe('countertop only on floor units (§152)', () => {
  it('a base corner hung on the wall adds no slab area', async () => {
    const { countertopAreaSqM } = await import('./cabinetGeometry');
    const floor = cabinet('corner-blind', 850, 600, 850, { elevationMm: 0 });
    const hung = cabinet('corner-blind', 850, 600, 700, { elevationMm: 1450 });
    expect(countertopAreaSqM([floor, hung])).toBeCloseTo(countertopAreaSqM([floor]), 9);
    expect(countertopAreaSqM([floor])).toBeGreaterThan(0.5);
  });
});
