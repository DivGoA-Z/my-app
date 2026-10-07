// src/lib/cameraMove.ts
//
// One step of the Cameras panel's hold-to-move pad (§103). Directions are
// the CAMERA's, not the room's: "forward" is towards what it looks at,
// "left"/"right" are sideways to that, "up"/"down" change eye height.
// That's how you fix a framing — "a bit further back", "a bit higher" —
// without working out which compass direction "back" is.
//
// Plan axes: x east, y south. Heading is clockwise from north (CameraNode
// .viewAngleDeg), so forward is (sin h, −cos h) and right is (cos h, sin h).

import type { CameraNode } from '../types/Camera';

export type CameraMove = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

// Slow on purpose: these fine-tune a framing, the plan is for big moves.
export const CAMERA_MOVE_MM_PER_S = 300;
export const CAMERA_LIFT_MM_PER_S = 200;
// Clearances: off the walls, above the floor, below the ceiling.
const WALL_CLEARANCE_MM = 100;
const MIN_EYE_HEIGHT_MM = 300;
const CEILING_CLEARANCE_MM = 100;

export function moveCamera(
  camera: Pick<CameraNode, 'x' | 'y' | 'heightMm' | 'viewAngleDeg'>,
  move: CameraMove,
  seconds: number,
  room: { widthMm: number; depthMm: number; ceilingHeightMm: number }
): Pick<CameraNode, 'x' | 'y' | 'heightMm'> {
  const h = (camera.viewAngleDeg * Math.PI) / 180;
  const fwd = { x: Math.sin(h), y: -Math.cos(h) };
  const right = { x: Math.cos(h), y: Math.sin(h) };
  const d = CAMERA_MOVE_MM_PER_S * seconds;
  const lift = CAMERA_LIFT_MM_PER_S * seconds;
  let { x, y, heightMm } = camera;
  const along = move === 'forward' ? fwd : move === 'back' ? { x: -fwd.x, y: -fwd.y } : move === 'right' ? right : move === 'left' ? { x: -right.x, y: -right.y } : null;
  if (along) {
    x += along.x * d;
    y += along.y * d;
  }
  if (move === 'up') heightMm += lift;
  if (move === 'down') heightMm -= lift;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // Whole millimetres in saved data.
  return {
    x: Math.round(clamp(x, WALL_CLEARANCE_MM, room.widthMm - WALL_CLEARANCE_MM)),
    y: Math.round(clamp(y, WALL_CLEARANCE_MM, room.depthMm - WALL_CLEARANCE_MM)),
    heightMm: Math.round(clamp(heightMm, MIN_EYE_HEIGHT_MM, room.ceilingHeightMm - CEILING_CLEARANCE_MM)),
  };
}
