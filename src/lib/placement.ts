// src/lib/placement.ts
//
// Where a unit dragged from a tool panel lands on the plan (§91).
// Pure maths, so it's tested; the drag itself lives in
// components/editor/placeDrag.ts.
//
// Two rules beyond "under the pointer":
//   - Auto-turn: dropped near a wall, the unit turns so its BACK is
//     against that wall and its front faces into the room, and sits
//     flush. Front direction by rotation (physicalDepth.frontDirection):
//     0 → +y, 90 → −x, 180 → −y, 270 → +x, so the back is against
//     north / east / south / west respectively. Dropped in the open
//     (an island, a pillar) it keeps 0°.
//   - Cabinets then snap to neighbours exactly as a plan drag does
//     (snapCabinetFootprint), in PHYSICAL size (§61: under carcass-only
//     depth a cabinet reaches its shutter's thickness further forward),
//     and the result is converted back to the STORED corner. Skipping
//     that conversion would place every dropped cabinet half a shutter
//     off, the same creep §61 fixed for dragging.
//
// Positions follow the house rule: x/y is the UNROTATED top-left corner;
// the centre is what stays put under rotation.

import type { PlacedCabinetItem } from '../types/cabinet';
import { clampFootprintCenter, getFootprint, type QuarterTurnDeg } from './footprint';
import { snapCabinetFootprint } from './cabinetSnapping';
import { physicalCabinet, storedPositionFromPhysicalCenter } from './physicalDepth';

export type Wall = 'north' | 'east' | 'south' | 'west';

// The rotation that puts a unit's back against this wall.
export const ROTATION_FOR_WALL: Record<Wall, QuarterTurnDeg> = { north: 0, east: 90, south: 180, west: 270 };

// How close to a wall a drop must be to turn and pull the unit onto it:
// the unit's own depth, and never less than this — a 300mm-deep wall
// cabinet dropped 500mm out was still clearly meant for the wall.
export const WALL_PULL_MIN_MM = 600;

export interface RoomSize {
  widthMm: number;
  depthMm: number;
}

export interface Placement {
  x: number;
  y: number;
  rotationDeg: QuarterTurnDeg;
  wall: Wall | null; // the wall it was pulled onto, if any
}

// The nearest wall to a point in the room, and how far it is.
export function nearestWall(xMm: number, yMm: number, room: RoomSize): { wall: Wall; distanceMm: number } {
  const candidates: [Wall, number][] = [
    ['north', yMm],
    ['south', room.depthMm - yMm],
    ['west', xMm],
    ['east', room.widthMm - xMm],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return { wall: candidates[0][0], distanceMm: Math.max(0, candidates[0][1]) };
}

// Where a unit of this size lands for a pointer at (xMm, yMm) in room
// millimetres. The pointer is the unit's centre, except that a unit
// pulled onto a wall slides back until it's flush.
export function placeAt(
  size: { widthMm: number; depthMm: number },
  xMm: number,
  yMm: number,
  room: RoomSize,
  autoTurn: boolean
): Placement {
  let rotationDeg: QuarterTurnDeg = 0;
  let wall: Wall | null = null;
  if (autoTurn) {
    const near = nearestWall(xMm, yMm, room);
    if (near.distanceMm <= Math.max(WALL_PULL_MIN_MM, size.depthMm)) {
      wall = near.wall;
      rotationDeg = ROTATION_FOR_WALL[wall];
    }
  }
  const { footprintWidthMm: fw, footprintHeightMm: fh } = getFootprint(size.widthMm, size.depthMm, rotationDeg);
  let cx = xMm;
  let cy = yMm;
  if (wall === 'north') cy = fh / 2;
  if (wall === 'south') cy = room.depthMm - fh / 2;
  if (wall === 'west') cx = fw / 2;
  if (wall === 'east') cx = room.widthMm - fw / 2;
  const c = clampFootprintCenter(cx, cy, fw, fh, room.widthMm, room.depthMm);
  return { x: c.centerX - size.widthMm / 2, y: c.centerY - size.depthMm / 2, rotationDeg, wall };
}

// A cabinet drop: placeAt in physical size, snap against the other
// cabinets' physical footprints, then back to the stored corner.
// `others` must already be physical (usePhysicalCabinets).
export function placeCabinetAt(
  proto: PlacedCabinetItem,
  xMm: number,
  yMm: number,
  room: RoomSize,
  others: PlacedCabinetItem[],
  frontExtraMm: number,
  gridSnapMm: number,
  autoTurn: boolean
): Placement {
  const physicalSize = { widthMm: proto.widthMm, depthMm: proto.depthMm + frontExtraMm };
  const p = placeAt(physicalSize, xMm, yMm, room, autoTurn);
  const { footprintWidthMm: fw, footprintHeightMm: fh } = getFootprint(physicalSize.widthMm, physicalSize.depthMm, p.rotationDeg);
  const left = p.x + physicalSize.widthMm / 2 - fw / 2;
  const top = p.y + physicalSize.depthMm / 2 - fh / 2;
  // The new cabinet goes in the list so the snapper can read its own
  // height band (a wall unit doesn't snap out of a base unit's way).
  const physicalProto = physicalCabinet({ ...proto, rotationDeg: p.rotationDeg, x: 0, y: 0 }, frontExtraMm);
  const snapped = snapCabinetFootprint(proto.id, left, top, fw, fh, [...others, physicalProto], room.widthMm, room.depthMm, gridSnapMm);
  const stored = storedPositionFromPhysicalCenter(
    { widthMm: proto.widthMm, depthMm: proto.depthMm, rotationDeg: p.rotationDeg },
    snapped.footprintLeftMm + fw / 2,
    snapped.footprintTopMm + fh / 2,
    frontExtraMm
  );
  return { ...stored, rotationDeg: p.rotationDeg, wall: p.wall };
}
