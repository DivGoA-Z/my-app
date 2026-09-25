// src/lib/cabinetGeometry.ts
//
// Shared geometry helpers for editing a placed cabinet — rotating,
// resizing, duplicating. All three can push the cabinet's footprint
// outside the room, so all three get the same treatment: keep the
// center where possible, then clamp into bounds. Centralized here so
// CabinetLayer's double-click rotate and CabinetInspector's buttons
// never drift out of sync (this used to be a one-off function living
// inside CabinetLayer.tsx that only handled +90° rotation).
//
// x/y always mean "unrotated top-left corner" (see getCabinetBounds in
// lib/collision.ts), so the center is always item.x + item.widthMm/2,
// regardless of rotation.
//
// The rotation/clamping primitives themselves now live in
// lib/footprint.ts, shared with appliances — which became rotatable
// too. getFootprint is re-exported below so the existing importers of
// it (CabinetLayer, collision, surfaceAreas, Cabinet3DInspector) keep
// working unchanged.

import type { ModuleType, PlacedCabinetItem } from '../types/cabinet';
import {
  clampFootprintCenter,
  getFootprint,
  rotateFootprint,
} from './footprint';

export { getFootprint } from './footprint';

// Height of a cabinet's bottom face off the floor, per module type —
// used to seed PlacedCabinetItem.elevationMm when a new cabinet is
// added (see CabinetToolbar.tsx). Freely overridable afterward per
// cabinet via CabinetInspector; this is just a sensible starting point,
// not a hard rule (some kitchens use a taller/shorter wall-cabinet gap).
export const WALL_CABINET_DEFAULT_ELEVATION_MM = 1450;

export function getDefaultElevationMm(moduleType: ModuleType): number {
  return moduleType === 'wall-cabinet' ? WALL_CABINET_DEFAULT_ELEVATION_MM : 0;
}

// ---- Countertop ----
//
// Which module types carry a countertop slab on top. Wall cabinets are
// mounted above the counter and tall units run floor-to-ceiling, so
// neither gets one; everything else is a base-height module that does.
// Sink units included deliberately — the slab runs over them in reality
// too, with the basin cut into it (the cut-out isn't modeled).
//
// UPDATED: this was visual-only in Room3DCanvas, with a note here
// saying pricing it was "its own piece of work" — nothing fed
// lib/bom.ts. It's wired in now: one countertop finish for the whole
// layout (RoomLayout.countertopFinishId, same reasoning as floor/
// ceiling being singular), priced through countertopAreaSqM below at
// that finish's own pricePerSqM, same as every other SurfaceFinish.
// Charging for it is still OPTIONAL though (RoomLayout.priceCountertop,
// same shape as priceElectrical) — in Delhi NCR the kitchen business
// usually doesn't supply the slab, the homeowner arranges stone
// separately, so the countertop is always part of the design but only
// sometimes part of the price. See lib/bom.ts's buildCountertopLineItem.
const COUNTERTOP_MODULE_TYPES: ModuleType[] = [
  'base-cabinet',
  'sink-unit',
  'cylinder-trolley',
  'drawer-unit',
  // All three corner solutions are base-height, so the slab runs over
  // them exactly as it does any other base cabinet.
  'corner-blind',
  'corner-magic',
  'corner-carousel',
];

export const COUNTERTOP_THICKNESS_MM = 40;
// Slight overhang past the carcass on every side — a counter sitting
// exactly flush with the cabinet below reads as a lid rather than a
// worktop.
export const COUNTERTOP_OVERHANG_MM = 20;

export function hasCountertop(moduleType: ModuleType): boolean {
  return COUNTERTOP_MODULE_TYPES.includes(moduleType);
}

// Countertop area, in m², across every cabinet that carries a slab.
// Includes the same overhang CountertopMesh renders (Room3DCanvas.tsx)
// — the finish is charged on the slab as it's actually cut, not the
// carcass footprint underneath it. Rotation-invariant (width × depth),
// same as floor area for cabinets/appliances/obstacles in
// surfaceAreas.ts, so no footprint swap is needed here either.
//
// Exported from here rather than computed separately in lib/bom.ts and
// RoomSurfacesPanel.tsx — one function the price and the on-screen area
// readout both call, so they can't quietly disagree about how much
// countertop there is.
export function countertopAreaSqM(cabinets: PlacedCabinetItem[]): number {
  const overhangM = COUNTERTOP_OVERHANG_MM / 1000;
  return cabinets
    .filter((c) => hasCountertop(c.moduleType))
    .reduce(
      (total, c) =>
        total +
        (c.widthMm / 1000 + overhangM * 2) * (c.depthMm / 1000 + overhangM * 2) * c.quantity,
      0
    );
}

// Rotates by +-90°, keeping the same center where possible, and
// clamping so the newly rotated footprint stays inside the room.
// direction: 1 = clockwise (+90), -1 = counter-clockwise (-90).
//
// Thin wrapper over the shared primitive so cabinets and appliances
// can't drift apart — see the header note in lib/footprint.ts.
export function rotateCabinet(
  item: PlacedCabinetItem,
  direction: 1 | -1,
  roomWidthMm: number,
  roomDepthMm: number
): Pick<PlacedCabinetItem, 'rotationDeg' | 'x' | 'y'> {
  return rotateFootprint(item, direction, roomWidthMm, roomDepthMm);
}

// Resizes the cabinet (new width/depth/height), keeping the same
// center where possible and clamping so the new footprint stays
// inside the room.
export function resizeCabinet(
  item: PlacedCabinetItem,
  newWidthMm: number,
  newDepthMm: number,
  newHeightMm: number,
  roomWidthMm: number,
  roomDepthMm: number
): Pick<PlacedCabinetItem, 'widthMm' | 'depthMm' | 'heightMm' | 'x' | 'y'> {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(newWidthMm, newDepthMm, item.rotationDeg);

  const centerX = item.x + item.widthMm / 2;
  const centerY = item.y + item.depthMm / 2;
  const clamped = clampFootprintCenter(centerX, centerY, footprintWidthMm, footprintHeightMm, roomWidthMm, roomDepthMm);

  return {
    widthMm: newWidthMm,
    depthMm: newDepthMm,
    heightMm: newHeightMm,
    x: clamped.centerX - newWidthMm / 2,
    y: clamped.centerY - newDepthMm / 2,
  };
}

// Duplicates with a small position offset so the copy is visibly
// distinct from the original rather than stacked exactly on top of it
// (which would just be an instant collision), clamped into the room in
// case the offset pushes it out (e.g. original was near the edge).
export function duplicateCabinet(
  item: PlacedCabinetItem,
  roomWidthMm: number,
  roomDepthMm: number,
  offsetMm = 100
): PlacedCabinetItem {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(item.widthMm, item.depthMm, item.rotationDeg);
  const centerX = item.x + item.widthMm / 2 + offsetMm;
  const centerY = item.y + item.depthMm / 2 + offsetMm;
  const clamped = clampFootprintCenter(centerX, centerY, footprintWidthMm, footprintHeightMm, roomWidthMm, roomDepthMm);

  return {
    ...item,
    id: crypto.randomUUID(),
    x: clamped.centerX - item.widthMm / 2,
    y: clamped.centerY - item.depthMm / 2,
  };
}
