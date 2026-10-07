import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clockwiseDegToThreeY, lookAnglesFromDirection } from './scene3d';

// "Save this view" (§102) reads the live camera's direction back into
// CameraNode.viewAngleDeg / pitchDeg, and the walkthrough turns them into
// a camera rotation again. If those two don't round-trip, a saved view
// drifts every time it's saved and reopened.
function directionFor(headingDeg: number, pitchDeg: number): [number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), clockwiseDegToThreeY(headingDeg), 0, 'YXZ')
  );
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return [d.x, d.y, d.z];
}

describe('lookAnglesFromDirection', () => {
  it('reads the compass the plan uses: 0 north, 90 east, 180 south, 270 west', () => {
    expect(lookAnglesFromDirection([0, 0, -1]).headingDeg).toBe(0);
    expect(lookAnglesFromDirection([1, 0, 0]).headingDeg).toBe(90);
    expect(lookAnglesFromDirection([0, 0, 1]).headingDeg).toBe(180);
    expect(lookAnglesFromDirection([-1, 0, 0]).headingDeg).toBe(270);
  });

  it('round-trips a saved view through the walkthrough camera exactly', () => {
    for (const [h, p] of [[0, 0], [37.5, -12], [180, 20.3], [305.2, -45]]) {
      const back = lookAnglesFromDirection(directionFor(h, p));
      expect(back.headingDeg).toBeCloseTo(h, 1);
      expect(back.pitchDeg).toBeCloseTo(p, 1);
    }
  });

  it('gives + for looking up and − for looking down', () => {
    expect(lookAnglesFromDirection(directionFor(0, 10)).pitchDeg).toBeGreaterThan(0);
    expect(lookAnglesFromDirection(directionFor(0, -10)).pitchDeg).toBeLessThan(0);
  });
});
