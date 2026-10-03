// src/lib/physicalDepth.ts
//
// A cabinet's PHYSICAL footprint under the depth convention (§61).
//
// A cabinet's stored depthMm means whatever the business's convention
// says (ConstructionSettings.depthIncludesFront, overridable per project
// by RoomLayout.depthIncludesFront):
//   - includes the shutter (default) → stored depth IS the physical
//     depth; nothing changes anywhere.
//   - carcass only → the shutter sits IN FRONT of the stored depth, so
//     the cabinet physically reaches its shutter's thickness further into
//     the room — its own fronts board's thickness since §65 (18mm only
//     when it has none). The plan, the 3D view, collision, door-swing clearance,
//     kitchen checks, surface areas and the countertop must all see that
//     extra depth, or they'd draw — and check — a cabinet 18mm shallower
//     than the one built (the §47 known gap this closes).
//
// The extra depth is added on the FRONT side only: the back stays where
// it was, against the wall. That isn't simply "depth + 18": x/y are the
// UNROTATED top-left corner and rotation is about the centre
// (lib/footprint.ts rule 1), so growing depthMm alone would grow BOTH
// faces — a 180°-turned cabinet's back would push 9mm into the wall. So
// the centre moves forward by half the extra, along the cabinet's front
// direction, and the corner is re-derived from it.
//
// Geometry only. Pricing and the cutting list keep using STORED cabinets
// (the cutting list applies the convention itself, from the effective
// settings) — except the countertop and the floor area cabinets occupy,
// which are physical and so come through physicalCabinets in lib/bom.ts.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { ConstructionSettings } from '../types/construction';
import type { RoomLayout } from '../types/layout';
import { FRONT_THICKNESS_MM } from './fronts';
import { resolvePanels } from './panels';
import type { RateCard } from '../types/rates';

// The cabinet's front direction for each quarter turn — the same rule
// lib/cabinetClearance.ts already uses and verified (rotating the local
// front (0,1) clockwise: 0 → +y, 90 → −x, 180 → −y, 270 → +x). Rounded
// to whole numbers so no float residue creeps into stored positions.
export function frontDirection(rotationDeg: number): { x: number; y: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  // `+ 0` turns −0 (from −sin 0) into 0, so it never leaks into saved data.
  return { x: Math.round(-Math.sin(rad)) + 0, y: Math.round(Math.cos(rad)) + 0 };
}

// The business setting with this project's override applied — the ONE
// place the depth convention is resolved, used by the cutting list, the
// price, the frozen quote and the geometry alike, so they can't disagree.
export function effectiveConstruction(
  settings: ConstructionSettings,
  layout: Pick<RoomLayout, 'depthIncludesFront'> | null | undefined
): ConstructionSettings {
  const projectChoice = layout?.depthIncludesFront;
  return projectChoice === undefined || projectChoice === settings.depthIncludesFront
    ? settings
    : { ...settings, depthIncludesFront: projectChoice };
}

// A cabinet's shutter thickness: its FRONTS board (lib/panels.ts), so a
// 25mm shutter board draws, collides and inset-fits as 25mm (§65). Only
// a cabinet with no fronts board at all falls back to the standard 18.
export function frontThicknessMm(
  item: PlacedCabinetItem,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>
): number {
  return resolvePanels(item, rates).fronts.board?.thicknessMm ?? FRONT_THICKNESS_MM;
}

// How much further than its stored depth a cabinet physically reaches:
// nothing when the stated depth includes the shutter, its own shutter's
// thickness when it's the carcass only.
export function frontExtraMm(
  depthIncludesFront: boolean,
  item: PlacedCabinetItem,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>
): number {
  return depthIncludesFront ? 0 : frontThicknessMm(item, rates);
}

export function physicalCabinet(item: PlacedCabinetItem, extraMm: number): PlacedCabinetItem {
  if (!extraMm) return item;
  const f = frontDirection(item.rotationDeg);
  const depthMm = item.depthMm + extraMm;
  const centerX = item.x + item.widthMm / 2 + (f.x * extraMm) / 2;
  const centerY = item.y + item.depthMm / 2 + (f.y * extraMm) / 2;
  return { ...item, depthMm, x: centerX - item.widthMm / 2, y: centerY - depthMm / 2 };
}

// Same array back (same identity) when depth includes the shutter, so
// anything memoised on it doesn't recompute for the default convention.
// Otherwise each cabinet grows by its OWN shutter's thickness (§65).
export function physicalCabinets(
  items: PlacedCabinetItem[],
  depthIncludesFront: boolean,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>
): PlacedCabinetItem[] {
  return depthIncludesFront ? items : items.map((c) => physicalCabinet(c, frontThicknessMm(c, rates)));
}

// The inverse, for write-back: where a dragged PHYSICAL cabinet's centre
// ended up → the STORED unrotated corner to save. Without this, every
// drag in carcass-only mode would save the physical corner as the stored
// one, and the cabinet would creep forward by half a shutter each time.
export function storedPositionFromPhysicalCenter(
  stored: Pick<PlacedCabinetItem, 'widthMm' | 'depthMm' | 'rotationDeg'>,
  physicalCenterX: number,
  physicalCenterY: number,
  extraMm: number
): { x: number; y: number } {
  const f = frontDirection(stored.rotationDeg);
  const centerX = physicalCenterX - (f.x * extraMm) / 2;
  const centerY = physicalCenterY - (f.y * extraMm) / 2;
  return { x: centerX - stored.widthMm / 2, y: centerY - stored.depthMm / 2 };
}
