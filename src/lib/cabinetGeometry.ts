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

// ---- Countertop (3D preview only) ----
//
// Which module types carry a countertop slab on top. Wall cabinets are
// mounted above the counter and tall units run floor-to-ceiling, so
// neither gets one; everything else is a base-height module that does.
// Sink units included deliberately — the slab runs over them in reality
// too, with the basin cut into it (the cut-out isn't modeled).
//
// NOTE: this is currently a VISUAL-ONLY addition to Room3DCanvas — a
// countertop is a real, chargeable material in a kitchen quote, but
// nothing here feeds lib/bom.ts. Pricing countertops (per running foot
// or per sq ft, by material) is its own piece of work.
const COUNTERTOP_MODULE_TYPES: ModuleType[] = [
  'base-cabinet',
  'sink-unit',
  'cylinder-trolley',
  'corner-unit',
  'drawer-unit',
];

export const COUNTERTOP_THICKNESS_MM = 40;
// Slight overhang past the carcass on every side — a counter sitting
// exactly flush with the cabinet below reads as a lid rather than a
// worktop.
export const COUNTERTOP_OVERHANG_MM = 20;

export function hasCountertop(moduleType: ModuleType): boolean {
  return COUNTERTOP_MODULE_TYPES.includes(moduleType);
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
