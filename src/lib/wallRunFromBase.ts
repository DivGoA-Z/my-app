// src/lib/wallRunFromBase.ts
//
// "Add wall cabinets above" (§150): one wall cabinet over each base unit
// on the same wall, same width, at the standard wall-unit depth and
// height (§147), at a bottom height the designer chooses (1,500 mm
// offered). A starting point to edit, so it SKIPS rather than guesses:
//
//   - the base unit under a hob: that space is the chimney's,
//   - anywhere a window would be covered,
//   - anywhere something already is (a wall cabinet, a chimney, a tall
//     unit, a pillar): checked with the same 3D boxes as collisions.
//
// Works on STORED cabinets (§61), like every editor action; the caller
// adds the results through the normal placement path (style defaults,
// corner panel fit).

import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { Obstacle, RoomLayout, WallOrientation } from '../types/layout';
import { currentFootprintRect } from './footprint';
import { backWall } from './wallView';
import { isAgainstWall, touchesFloor } from './surfaceAreas';
import { boxesOverlap, getApplianceBounds, getCabinetBounds, getObstacleBounds } from './collision';
import { sizeGroup, type StandardSizes } from './standardSizes';
import { wallOpenings } from './openSides';

export const DEFAULT_WALL_RUN_BOTTOM_MM = 1500;

export type SkipReason = 'hob' | 'window' | 'occupied' | 'ceiling';

export const SKIP_REASON_WORDS: Record<SkipReason, string> = {
  hob: 'over the hob (left for the chimney)',
  window: 'would cover a window',
  occupied: 'something is already there',
  ceiling: 'no room below the ceiling',
};

export interface WallRunResult {
  wall: WallOrientation | null;
  created: PlacedCabinetItem[];
  skipped: { baseId: string; reason: SkipReason }[];
}

const MIN_WALL_UNIT_MM = 200;

export function wallCabinetsAbove(args: {
  from: PlacedCabinetItem;
  cabinets: PlacedCabinetItem[];
  appliances: PlacedApplianceItem[];
  obstacles: Obstacle[];
  layout: Pick<RoomLayout, 'dimensions' | 'walls'>;
  standard: StandardSizes;
  bottomMm: number;
  newId?: () => string;
}): WallRunResult {
  const { cabinets, appliances, obstacles, layout, standard, bottomMm } = args;
  const newId = args.newId ?? (() => crypto.randomUUID());
  const roomW = layout.dimensions.widthMm;
  const roomD = layout.dimensions.depthMm;
  const ceiling = layout.dimensions.ceilingHeightMm ?? 2700;
  const wall = backWall(args.from.rotationDeg);
  if (!isAgainstWall(wall, currentFootprintRect(args.from), roomW, roomD)) return { wall: null, created: [], skipped: [] };

  const onWall = (c: PlacedCabinetItem) =>
    sizeGroup(c.moduleType) === 'base' &&
    touchesFloor(c.elevationMm) &&
    backWall(c.rotationDeg) === wall &&
    isAgainstWall(wall, currentFootprintRect(c), roomW, roomD);
  const horizontal = wall === 'north' || wall === 'south';
  const depthMm = standard.wall.depthMm;
  const heightMm = Math.min(standard.wall.heightMm, ceiling - bottomMm);

  const created: PlacedCabinetItem[] = [];
  const skipped: WallRunResult['skipped'] = [];
  const hobs = appliances.filter((a) => a.applianceType === 'stove');
  const windows = (layout.walls.find((w) => w.orientation === wall) ? wallOpenings(layout.walls.find((w) => w.orientation === wall)) : []).filter(
    (o) => o.kind === 'window'
  );

  for (const base of cabinets.filter(onWall).sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y))) {
    const r = currentFootprintRect(base);
    const a0 = horizontal ? r.x : r.y;
    const len = horizontal ? r.widthMm : r.depthMm;
    if (heightMm < MIN_WALL_UNIT_MM) {
      skipped.push({ baseId: base.id, reason: 'ceiling' });
      continue;
    }
    if (hobs.some((h) => {
      const hr = currentFootprintRect(h);
      const cx = hr.x + hr.widthMm / 2;
      const cy = hr.y + hr.depthMm / 2;
      return cx >= r.x && cx <= r.x + r.widthMm && cy >= r.y && cy <= r.y + r.depthMm;
    })) {
      skipped.push({ baseId: base.id, reason: 'hob' });
      continue;
    }
    // Openings measure from the wall's START (low x or y), as stored.
    if (windows.some((o) => o.offsetMm < a0 + len && o.offsetMm + o.widthMm > a0 && o.sillMm < bottomMm + heightMm && o.sillMm + o.heightMm > bottomMm)) {
      skipped.push({ baseId: base.id, reason: 'window' });
      continue;
    }

    // The new unit's rotated footprint against the same wall, then back to
    // the stored (unrotated top-left) convention via its centre.
    const fp = horizontal
      ? { x: a0, y: wall === 'north' ? 0 : roomD - depthMm, w: len, d: depthMm }
      : { x: wall === 'west' ? 0 : roomW - depthMm, y: a0, w: depthMm, d: len };
    const cx = fp.x + fp.w / 2;
    const cy = fp.y + fp.d / 2;
    const unit: PlacedCabinetItem = {
      id: newId(),
      layoutId: base.layoutId,
      moduleType: 'wall-cabinet',
      x: cx - len / 2,
      y: cy - depthMm / 2,
      widthMm: len,
      depthMm,
      heightMm,
      elevationMm: bottomMm,
      rotationDeg: base.rotationDeg,
      material: base.material,
      finishId: base.finishId,
      unitPrice: 0,
      quantity: 1,
    };
    const box = getCabinetBounds(unit);
    const taken =
      [...cabinets, ...created].some((c) => boxesOverlap(box, getCabinetBounds(c))) ||
      appliances.some((a) => boxesOverlap(box, getApplianceBounds(a))) ||
      obstacles.some((o) => boxesOverlap(box, getObstacleBounds(o)));
    if (taken) {
      skipped.push({ baseId: base.id, reason: 'occupied' });
      continue;
    }
    created.push(unit);
  }
  return { wall, created, skipped };
}
