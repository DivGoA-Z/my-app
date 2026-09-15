// src/lib/scene3d.ts
//
// Shared conversions between the app's 2D layout data (millimeters,
// top-left/room-origin, Y increasing "south"/down the screen — see
// canvasScale.ts) and the 3D scene's world units (meters, Y-up,
// following Three.js convention) used by Room3DCanvas.
//
// - 1mm = 0.001 world units (i.e. the scene is modeled in meters) —
//   keeps numbers small and sane, since most three.js/drei defaults
//   (camera near/far planes, control damping, light ranges) assume a
//   roughly human/room scale, not raw millimeters.
// - A 2D (x, y) point maps onto the 3D GROUND PLANE as (x, z) — 3D y is
//   reserved for vertical height. 2D "y" (distance from the north wall)
//   becomes 3D "z" (depth into the scene).
// - Rotation: PlacedCabinetItem.rotationDeg and CameraNode.viewAngleDeg
//   are both CLOCKWISE degrees, matching Konva's rotation convention
//   used throughout the 2D canvas (see CabinetLayer.tsx, CameraLayer.tsx
//   for where that convention is established). Three.js's rotation.y is
//   COUNTERCLOCKWISE-positive when viewed from above (+Y looking down —
//   the same bird's-eye view as the 2D floor plan), so converting
//   between the two means NEGATING the angle. Getting this backwards is
//   the single easiest mistake to make when wiring up new 3D pieces
//   here — that's exactly the kind of bug Phase 1's geometry pass is
//   meant to surface early, by eye, before layering in anything else.

export const MM_TO_M = 0.001;

export function mmToWorld(mm: number): number {
  return mm * MM_TO_M;
}

// Returns [worldX, worldZ] for a 2D grid point (mm).
export function groundPosition(xMm: number, yMm: number): [number, number] {
  return [mmToWorld(xMm), mmToWorld(yMm)];
}

// Converts a clockwise 2D-canvas degrees value into the radians Three.js
// expects for rotation.y.
export function clockwiseDegToThreeY(degrees: number): number {
  return -(degrees * Math.PI) / 180;
}
