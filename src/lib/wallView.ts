// src/lib/wallView.ts
//
// Which items the 3D wall elevation shows, and how (§84). The 3D wall
// view isn't a camera looking across the room: like an elevation drawing
// it takes the room apart and shows ONE wall and what stands against it.
//   - "full": against this wall, and it belongs to this wall
//   - "ghost": in a corner of this wall but belonging to the NEIGHBOURING
//     wall (its back is against that wall) — drawn as a translucent grey
//     block at the edge, so you see something turns the corner there
//   - everything else isn't drawn
// "Against a wall" is the same test the 2D elevation uses
// (isAgainstWall, 60mm tolerance), so the drawing and the 3D view agree.

import { currentFootprintRect, type RotatableFootprint } from './footprint';
import { isAgainstWall } from './surfaceAreas';
import { frontDirection } from './physicalDepth';
import type { WallOrientation } from '../types/layout';

export type WallViewRole = 'full' | 'ghost';

const NEIGHBOURS: Record<WallOrientation, [WallOrientation, WallOrientation]> = {
  north: ['west', 'east'],
  south: ['west', 'east'],
  west: ['north', 'south'],
  east: ['north', 'south'],
};

// The wall an item's BACK faces, from its rotation (front 0° faces +y,
// into the room from the north wall).
export function backWall(rotationDeg: number): WallOrientation {
  const f = frontDirection(rotationDeg);
  if (f.y === 1) return 'north';
  if (f.y === -1) return 'south';
  return f.x === 1 ? 'west' : 'east';
}

type Placed = RotatableFootprint & { id: string };

export function wallViewRoles(
  wall: WallOrientation,
  items: Placed[],
  roomWidthMm: number,
  roomDepthMm: number
): Map<string, WallViewRole> {
  const roles = new Map<string, WallViewRole>();
  for (const item of items) {
    const r = currentFootprintRect(item);
    const rect = { x: r.x, y: r.y, widthMm: r.widthMm, depthMm: r.depthMm };
    if (!isAgainstWall(wall, rect, roomWidthMm, roomDepthMm)) continue;
    const inCorner = NEIGHBOURS[wall].find((n) => isAgainstWall(n, rect, roomWidthMm, roomDepthMm));
    roles.set(item.id, inCorner && backWall(item.rotationDeg) === inCorner ? 'ghost' : 'full');
  }
  return roles;
}
