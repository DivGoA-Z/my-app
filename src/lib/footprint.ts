// src/lib/footprint.ts
//
// The rotation/footprint primitives shared by anything placed on the
// grid that can be turned in 90° steps — cabinets today, appliances as
// of this change.
//
// This exists because appliance rotation would otherwise have meant a
// second copy of the same three rules, and a second copy is exactly how
// a rotated appliance ends up drawn in one place, collision-checked in
// another, and priced against a third. The rules:
//
//   1. x/y ALWAYS mean the UNROTATED top-left corner. Rotation happens
//      about the item's center, so the center is always
//      x + widthMm/2, y + depthMm/2 no matter how it's turned.
//   2. A quarter turn (90/270) swaps which of widthMm/depthMm is the
//      on-floor footprint's extent along each axis. widthMm/depthMm
//      themselves never change.
//   3. Rotating can push the new footprint out of the room, so every
//      rotation keeps the center where it can and clamps.
//
// Everything downstream — Konva drag bounds, AABB collision,
// wall-contact tests, chargeable surface area — derives its rectangle
// from getFootprint, so all four agree by construction.

// The only rotations the app allows. Free angles are deliberately not
// supported: kitchens are built square to their walls, and quantising
// to quarter turns is what lets the footprint stay an axis-aligned
// rectangle. That keeps AABB collision valid and keeps wall-contact a
// simple edge comparison instead of a polygon intersection.
//
// If skewed rooms are ever added, the generalisation is to snap to the
// nearest WALL'S angle rather than to a fixed 90° lattice — which in a
// rectangular room reduces to exactly this.
export type QuarterTurnDeg = 0 | 90 | 180 | 270;

export interface FootprintRect {
  x: number;
  y: number;
  widthMm: number;
  depthMm: number;
}

// Anything this module can rotate: a rectangle plus its current turn.
export interface RotatableFootprint extends FootprintRect {
  rotationDeg: QuarterTurnDeg;
}

// Rule 2. Typed as a plain number rather than QuarterTurnDeg so
// existing callers holding a cabinet's or appliance's own rotation
// union pass straight through without a cast.
export function getFootprint(
  widthMm: number,
  depthMm: number,
  rotationDeg: number
): { footprintWidthMm: number; footprintHeightMm: number } {
  const isQuarterTurn = rotationDeg === 90 || rotationDeg === 270;
  return {
    footprintWidthMm: isQuarterTurn ? depthMm : widthMm,
    footprintHeightMm: isQuarterTurn ? widthMm : depthMm,
  };
}

export function clamp(value: number, min: number, max: number): number {
  // Item bigger than the room: center it rather than inverting the
  // range, which would snap it to a nonsensical edge.
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

export function clampFootprintCenter(
  centerX: number,
  centerY: number,
  footprintWidthMm: number,
  footprintHeightMm: number,
  roomWidthMm: number,
  roomDepthMm: number
): { centerX: number; centerY: number } {
  return {
    centerX: clamp(centerX, footprintWidthMm / 2, roomWidthMm - footprintWidthMm / 2),
    centerY: clamp(centerY, footprintHeightMm / 2, roomDepthMm - footprintHeightMm / 2),
  };
}

// Rule 3. direction: 1 = clockwise (+90), -1 = counter-clockwise.
//
// Returns only the three fields a rotation can change, so callers can
// spread it straight into their own update action without this module
// needing to know what else lives on the item.
export function rotateFootprint(
  item: RotatableFootprint,
  direction: 1 | -1,
  roomWidthMm: number,
  roomDepthMm: number
): { rotationDeg: QuarterTurnDeg; x: number; y: number } {
  // Double modulo: JS's % keeps the sign of the dividend, so a
  // counter-clockwise turn from 0 would otherwise land on -90.
  const nextRotation = ((((item.rotationDeg + direction * 90) % 360) + 360) % 360) as QuarterTurnDeg;

  const { footprintWidthMm, footprintHeightMm } = getFootprint(
    item.widthMm,
    item.depthMm,
    nextRotation
  );

  // Rule 1 — center is derived from the UNROTATED dimensions.
  const centerX = item.x + item.widthMm / 2;
  const centerY = item.y + item.depthMm / 2;
  const clamped = clampFootprintCenter(
    centerX,
    centerY,
    footprintWidthMm,
    footprintHeightMm,
    roomWidthMm,
    roomDepthMm
  );

  return {
    rotationDeg: nextRotation,
    x: clamped.centerX - item.widthMm / 2,
    y: clamped.centerY - item.depthMm / 2,
  };
}

// Keyboard arrow-key nudging (useSelectionShortcuts.ts) — moves the
// item by (dxMm, dyMm) in ROOM space, same clamp-to-room-bounds
// behaviour rotateFootprint already gives a turn, but without changing
// rotationDeg. Returns only x/y, same "just what changed" shape
// rotateFootprint returns, for the same reason: callers spread it
// straight into their own update action.
export function nudgeFootprint(
  item: RotatableFootprint,
  dxMm: number,
  dyMm: number,
  roomWidthMm: number,
  roomDepthMm: number
): { x: number; y: number } {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(
    item.widthMm,
    item.depthMm,
    item.rotationDeg
  );

  // Rule 1 — center is derived from the UNROTATED dimensions.
  const centerX = item.x + item.widthMm / 2 + dxMm;
  const centerY = item.y + item.depthMm / 2 + dyMm;
  const clamped = clampFootprintCenter(
    centerX,
    centerY,
    footprintWidthMm,
    footprintHeightMm,
    roomWidthMm,
    roomDepthMm
  );

  return {
    x: clamped.centerX - item.widthMm / 2,
    y: clamped.centerY - item.depthMm / 2,
  };
}

// The item's true on-floor rectangle for its CURRENT rotation, in the
// same top-left form the rest of the app uses. This is the function
// collision, wall-contact and surface-area code should reach for —
// never the raw widthMm/depthMm, which are pre-rotation.
export function currentFootprintRect(item: RotatableFootprint): FootprintRect {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(
    item.widthMm,
    item.depthMm,
    item.rotationDeg
  );
  const centerX = item.x + item.widthMm / 2;
  const centerY = item.y + item.depthMm / 2;

  return {
    x: centerX - footprintWidthMm / 2,
    y: centerY - footprintHeightMm / 2,
    widthMm: footprintWidthMm,
    depthMm: footprintHeightMm,
  };
}
