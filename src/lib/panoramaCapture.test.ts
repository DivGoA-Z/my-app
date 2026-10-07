import { describe, expect, it } from 'vitest';
import { panoramaStartView } from './panoramaCapture';

// The capture shader's own mapping, restated: the image column the viewer
// shows at yaw θ (u = 0.5 + θ/2π) looks along this world direction.
function shaderDirection(yaw: number, mirrorX: boolean): { x: number; z: number } {
  const lon = yaw; // (u − 0.5)·2π with u = 0.5 + yaw/2π
  return { x: Math.sin(lon) * (mirrorX ? -1 : 1), z: Math.cos(lon) };
}
// A camera heading (clockwise from north; north = world −Z) as a direction.
function headingDirection(deg: number) {
  const h = (deg * Math.PI) / 180;
  return { x: Math.sin(h), z: -Math.cos(h) };
}

describe('panoramaStartView (§109)', () => {
  it('opens looking where the camera faces, for every heading, mirrored or not', () => {
    for (const mirror of [true, false]) {
      for (const deg of [0, 45, 90, 135, 180, 225, 270, 315, 17.5]) {
        const d = shaderDirection(panoramaStartView(deg, 0, mirror).yaw, mirror);
        const want = headingDirection(deg);
        expect(d.x).toBeCloseTo(want.x, 6);
        expect(d.z).toBeCloseTo(want.z, 6);
      }
    }
  });

  it('a north-facing camera does NOT open on the image centre (which is south)', () => {
    expect(panoramaStartView(0).yaw).toBeCloseTo(Math.PI, 6);
  });

  it('passes the tilt through, + up', () => {
    expect(panoramaStartView(0, 10).pitch).toBeCloseTo((10 * Math.PI) / 180, 6);
  });
});
