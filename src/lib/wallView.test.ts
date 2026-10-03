// Tests for which items the 3D wall elevation shows (§84).

import { describe, expect, it } from 'vitest';
import { backWall, wallViewRoles } from './wallView';

const W = 3000;
const D = 2400;
const item = (id: string, x: number, y: number, w: number, d: number, rotationDeg: 0 | 90 | 180 | 270) => ({ id, x, y, widthMm: w, depthMm: d, rotationDeg });

describe('wall view roles', () => {
  it('back walls follow rotation', () => {
    expect([0, 90, 180, 270].map((r) => backWall(r))).toEqual(['north', 'east', 'south', 'west']);
  });
  it('items against the wall are full; a neighbour-wall item in the corner is a ghost; the rest are hidden', () => {
    const roles = wallViewRoles(
      'north',
      [
        item('mid', 1200, 0, 600, 600, 0), // on the north wall
        item('cornerN', 0, 0, 900, 600, 0), // NW corner, back on north
        // NW corner along the west wall: a 900-wide unit turned 270° (back
        // on west). x/y are the UNROTATED corner — rotation is about the
        // centre — so its 600 × 900 footprint at (0,0) is stored at (-150, 150).
        item('cornerW', -150, 150, 900, 600, 270),
        item('westOnly', 0, 1200, 600, 600, 270), // west wall, not touching north
        item('island', 1200, 1200, 900, 600, 0),
      ],
      W,
      D
    );
    expect(roles.get('mid')).toBe('full');
    expect(roles.get('cornerN')).toBe('full');
    expect(roles.get('cornerW')).toBe('ghost');
    expect(roles.has('westOnly')).toBe(false);
    expect(roles.has('island')).toBe(false);
  });
});
