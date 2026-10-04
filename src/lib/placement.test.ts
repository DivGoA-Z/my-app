import { describe, expect, it } from 'vitest';
import { nearestWall, placeAt, placeCabinetAt } from './placement';
import { currentFootprintRect } from './footprint';
import { physicalCabinet } from './physicalDepth';
import { baseUnit, cabinet } from '../test/fixtures';

const room = { widthMm: 3000, depthMm: 4000 };
const unit = { widthMm: 900, depthMm: 600 };

// Where the unit's ROTATED outline ends up, which is what the eye sees.
const outline = (p: { x: number; y: number; rotationDeg: 0 | 90 | 180 | 270 }, size = unit) =>
  currentFootprintRect({ ...size, ...p });

describe('nearestWall', () => {
  it('picks the closest wall', () => {
    expect(nearestWall(1500, 150, room)).toEqual({ wall: 'north', distanceMm: 150 });
    expect(nearestWall(2900, 2000, room)).toEqual({ wall: 'east', distanceMm: 100 });
  });
});

describe('placeAt (§91)', () => {
  it('near the north wall: back to the wall, flush, centred on the pointer', () => {
    const p = placeAt(unit, 1500, 250, room, true);
    expect(p).toMatchObject({ rotationDeg: 0, wall: 'north', x: 1050, y: 0 });
  });

  it('near the west wall: turned to 270°, outline flush with the wall', () => {
    const p = placeAt(unit, 120, 2000, room, true);
    expect(p.rotationDeg).toBe(270);
    expect(p.wall).toBe('west');
    const o = outline(p);
    expect(o.x).toBe(0);
    expect(o.widthMm).toBe(600); // the depth now runs along x
    expect(o.y + o.depthMm / 2).toBe(2000); // still centred on the pointer along the wall
  });

  it('near the east wall: turned to 90°, outline flush with the far wall', () => {
    const p = placeAt(unit, 2800, 1000, room, true);
    expect(p.rotationDeg).toBe(90);
    const o = outline(p);
    expect(o.x + o.widthMm).toBe(3000);
  });

  it('near the south wall: turned to 180°, outline flush with the far wall', () => {
    const p = placeAt(unit, 1500, 3700, room, true);
    expect(p.rotationDeg).toBe(180);
    expect(outline(p).y + 600).toBe(4000);
  });

  it('in the open: keeps 0° and sits centred on the pointer', () => {
    const p = placeAt(unit, 1500, 2000, room, true);
    expect(p).toMatchObject({ rotationDeg: 0, wall: null, x: 1050, y: 1700 });
  });

  it('with auto-turn off, never turns and never pulls to a wall', () => {
    const p = placeAt(unit, 120, 2000, room, false);
    expect(p.rotationDeg).toBe(0);
    expect(p.wall).toBeNull();
    expect(p.x).toBe(0); // only clamped inside the room
  });

  it('a deep unit is pulled from as far out as its own depth', () => {
    const tall = { widthMm: 600, depthMm: 800 };
    expect(placeAt(tall, 1500, 750, room, true).wall).toBe('north');
    expect(placeAt(tall, 1500, 850, room, true).wall).toBeNull();
  });
});

describe('placeCabinetAt (§91)', () => {
  it('snaps flush beside a neighbour on the same wall', () => {
    const existing = baseUnit({ x: 0, y: 0 });
    const proto = baseUnit({ id: 'new' });
    // Pointer 50mm clear of the neighbour: the magnet closes the gap.
    const p = placeCabinetAt(proto, 950, 200, room, [existing], 0, 50, true);
    expect(p).toMatchObject({ x: 600, y: 0, rotationDeg: 0 });
  });

  it('carcass-only depth: the STORED back still lands on the wall (north and south)', () => {
    const proto = baseUnit({ id: 'new' });
    const north = placeCabinetAt(proto, 1500, 200, room, [], 18, 50, true);
    expect(north.y).toBe(0);
    // ...and the physical front reaches 618mm into the room.
    const phys = physicalCabinet({ ...proto, ...north }, 18);
    expect(currentFootprintRect(phys).depthMm).toBe(618);
    const south = placeCabinetAt(proto, 1500, 3800, room, [], 18, 50, true);
    expect(south.rotationDeg).toBe(180);
    expect(south.y + 600).toBe(4000);
  });

  it('a wall unit dropped over a base unit is not pushed aside by it', () => {
    const base = baseUnit({ x: 1200, y: 0 });
    const wallUnit = cabinet('wall-cabinet', 600, 300, 720, { id: 'new' });
    const p = placeCabinetAt(wallUnit, 1500, 150, room, [base], 0, 50, true);
    expect(p).toMatchObject({ x: 1200, y: 0 });
  });
});
