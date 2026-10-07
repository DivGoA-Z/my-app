import { describe, expect, it } from 'vitest';
import { moveCamera, CAMERA_MOVE_MM_PER_S, CAMERA_LIFT_MM_PER_S } from './cameraMove';

const room = { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 };
const at = (viewAngleDeg: number) => ({ x: 1500, y: 1500, heightMm: 1600, viewAngleDeg });

describe('moveCamera', () => {
  it('moves the way the camera faces, not the way the room is drawn', () => {
    // Facing north (plan −y): forward lowers y.
    expect(moveCamera(at(0), 'forward', 1, room)).toEqual({ x: 1500, y: 1500 - CAMERA_MOVE_MM_PER_S, heightMm: 1600 });
    // Facing east (+x): forward raises x; right is south (+y).
    expect(moveCamera(at(90), 'forward', 1, room).x).toBe(1500 + CAMERA_MOVE_MM_PER_S);
    expect(moveCamera(at(90), 'right', 1, room).y).toBe(1500 + CAMERA_MOVE_MM_PER_S);
    // Facing south: back is north.
    expect(moveCamera(at(180), 'back', 1, room).y).toBe(1500 - CAMERA_MOVE_MM_PER_S);
    // Facing west: left is south.
    expect(moveCamera(at(270), 'left', 1, room).y).toBe(1500 + CAMERA_MOVE_MM_PER_S);
  });

  it('changes only the height for up and down', () => {
    expect(moveCamera(at(37), 'up', 0.5, room)).toEqual({ x: 1500, y: 1500, heightMm: 1600 + CAMERA_LIFT_MM_PER_S / 2 });
  });

  it('keeps the camera inside the room, off the floor and under the ceiling', () => {
    expect(moveCamera(at(0), 'forward', 100, room).y).toBe(100);
    expect(moveCamera(at(0), 'up', 100, room).heightMm).toBe(2600);
    expect(moveCamera(at(0), 'down', 100, room).heightMm).toBe(300);
  });
});

describe('orbitMove (§110)', () => {
  const pos: [number, number, number] = [0, 5, 5];
  const target: [number, number, number] = [0, 0, 0]; // looking north-and-down

  it('goes forward LEVEL toward what you look at, moving camera and target together', async () => {
    const { orbitMove, ORBIT_MOVE_M_PER_S } = await import('./cameraMove');
    const r = orbitMove(pos, target, 'forward', 1);
    expect(r.position[1]).toBe(5); // height unchanged
    expect(r.position[2]).toBeCloseTo(5 - ORBIT_MOVE_M_PER_S);
    expect(r.target[2]).toBeCloseTo(-ORBIT_MOVE_M_PER_S);
  });

  it('right is east when facing north; up only raises', async () => {
    const { orbitMove, ORBIT_MOVE_M_PER_S, ORBIT_LIFT_M_PER_S } = await import('./cameraMove');
    expect(orbitMove(pos, target, 'right', 1).position[0]).toBeCloseTo(ORBIT_MOVE_M_PER_S);
    expect(orbitMove(pos, target, 'left', 1).position[0]).toBeCloseTo(-ORBIT_MOVE_M_PER_S);
    const up = orbitMove(pos, target, 'up', 1);
    expect(up.position).toEqual([0, 5 + ORBIT_LIFT_M_PER_S, 5]);
    expect(up.target).toEqual([0, ORBIT_LIFT_M_PER_S, 0]);
  });

  it('copes with looking straight down', async () => {
    const { orbitMove } = await import('./cameraMove');
    const r = orbitMove([1, 5, 1], [1, 0, 1], 'forward', 1);
    expect(Number.isFinite(r.position[0]) && Number.isFinite(r.position[2])).toBe(true);
  });
});
