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

// ---- Free orbit (§110) ----
//
// The same six moves for the 3D view's free orbit, where there's no saved
// camera: the view itself (camera + the point it orbits) glides. Forward
// is where you're looking, kept LEVEL (looking down at the room, forward
// should carry you across it, not into the floor); left/right are
// sideways to that; up/down raise and lower. Camera and target move
// together, so orbiting afterwards still turns around what you were
// looking at. World metres, Y-up (lib/scene3d.ts). No room clamp: free
// orbit is allowed outside the room.

export const ORBIT_MOVE_M_PER_S = 1.0;
export const ORBIT_LIFT_M_PER_S = 0.6;

type Vec3 = [number, number, number];

export function orbitMove(
  position: Vec3,
  target: Vec3,
  move: CameraMove,
  seconds: number
): { position: Vec3; target: Vec3 } {
  let fx = target[0] - position[0];
  let fz = target[2] - position[2];
  const len = Math.hypot(fx, fz);
  // Looking straight down: no level direction; treat "forward" as north.
  if (len < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  // Right of a level forward (fx, fz): (−fz, fx). Facing north (0, −1)
  // that's east (1, 0).
  const d = ORBIT_MOVE_M_PER_S * seconds;
  const lift = ORBIT_LIFT_M_PER_S * seconds;
  const delta: Vec3 =
    move === 'forward' ? [fx * d, 0, fz * d]
    : move === 'back' ? [-fx * d, 0, -fz * d]
    : move === 'right' ? [-fz * d, 0, fx * d]
    : move === 'left' ? [fz * d, 0, -fx * d]
    : move === 'up' ? [0, lift, 0]
    : [0, -lift, 0];
  const add = (v: Vec3): Vec3 => [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]];
  return { position: add(position), target: add(target) };
}

// Applies one orbitMove step to a live camera and its orbit controls,
// then asks for a redraw (the 3D view draws on demand, §108). Kept here,
// not in the component, so the mutation of three.js objects happens in a
// plain function the bridge calls at event time.
export function applyOrbitStep(
  camera: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown } },
  controls: { target: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; update(): unknown },
  move: CameraMove,
  seconds: number,
  invalidate: () => void
): void {
  const r = orbitMove(
    [camera.position.x, camera.position.y, camera.position.z],
    [controls.target.x, controls.target.y, controls.target.z],
    move,
    seconds
  );
  camera.position.set(...r.position);
  controls.target.set(...r.target);
  controls.update();
  invalidate();
}
