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
