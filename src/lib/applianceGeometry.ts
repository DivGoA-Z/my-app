// src/lib/applianceGeometry.ts
//
// Appliance equivalents of lib/cabinetGeometry — rotation and model
// resolution for a placed appliance.
//
// Both concerns live here because they answer the same question from
// two directions: "which way is this appliance facing?" One half is the
// PLACEMENT turn the designer chose (rotationDeg); the other is the
// fixed correction for a model that was exported facing the wrong way
// to begin with. Keeping them in one file makes it obvious that they
// compose rather than compete — see resolveApplianceModel below.

import type { PlacedApplianceItem } from '../types/appliance';
import type { ApplianceCatalogItem } from '../types/Catalog';
import { rotateFootprint, currentFootprintRect } from './footprint';
import type { FootprintRect } from './footprint';

// Rotates by ±90°, keeping the center where possible and clamping the
// new footprint into the room — identical semantics to rotateCabinet,
// via the same shared primitive.
export function rotateAppliance(
  item: PlacedApplianceItem,
  direction: 1 | -1,
  roomWidthMm: number,
  roomDepthMm: number
): Pick<PlacedApplianceItem, 'rotationDeg' | 'x' | 'y'> {
  return rotateFootprint(item, direction, roomWidthMm, roomDepthMm);
}

// The appliance's real on-floor rectangle for its current rotation.
// Collision and surface-area code must use this rather than reading
// widthMm/depthMm directly — those are pre-rotation.
export function applianceFootprint(item: PlacedApplianceItem): FootprintRect {
  return currentFootprintRect(item);
}

// ---- Model resolution ----

// Degrees, applied in XYZ order about the model's own axes, to fix an
// asset that was authored facing the wrong way. Two cases cover almost
// everything found in free asset libraries:
//
//   Z-up export (Blender's default, glTF expects Y-up):  x = -90
//   Right facing instead of front:                       y = 90 / -90
//
// This is a property of the FILE, not of the placement, which is why it
// belongs on the catalogue row: fix it once when the model is added and
// every appliance placed from it is correct forever. Mixing the two
// would mean re-fixing the same bad export in every layout.
//
// Defined in lib/fittedModel.ts (shared with FixtureModel.tsx) and
// re-exported here so existing imports of ModelOrientation/
// NO_MODEL_ORIENTATION from this file keep working.
import type { ModelOrientation } from './fittedModel';
import { NO_MODEL_ORIENTATION } from './fittedModel';
export type { ModelOrientation };
export { NO_MODEL_ORIENTATION };

export interface ResolvedApplianceModel {
  modelUrl?: string;
  orientation: ModelOrientation;
}

// Resolution order, most specific first:
//
//   1. item.modelUrl        per-placement override (rare, deliberate)
//   2. catalogItemId match  the row this was actually placed from
//   3. applianceType match  legacy fallback for items saved before
//                           catalogItemId existed
//
// Step 3 is the loose one — it takes the FIRST row of that type, so a
// business with two chimneys may get the other one's model. That was
// the only behaviour before catalogItemId, so it's kept for old
// layouts rather than leaving them with no model at all; anything
// placed from now on takes step 2.
//
// Note a per-placement modelUrl override (step 1) carries the
// orientation of whichever catalogue row we matched, since the
// override names a file but nothing about how it was exported. If that
// ever needs to differ, the override belongs in the catalogue as its
// own row.
export function resolveApplianceModel(
  item: PlacedApplianceItem,
  catalog: ApplianceCatalogItem[]
): ResolvedApplianceModel {
  const row =
    (item.catalogItemId
      ? catalog.find((c) => c.id === item.catalogItemId)
      : undefined) ?? catalog.find((c) => c.applianceType === item.applianceType);

  return {
    modelUrl: item.modelUrl ?? row?.modelUrl,
    orientation: {
      xDeg: row?.modelRotationXDeg ?? 0,
      yDeg: row?.modelRotationYDeg ?? 0,
      zDeg: row?.modelRotationZDeg ?? 0,
    },
  };
}
