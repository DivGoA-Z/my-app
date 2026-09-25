// src/lib/collision.ts
//
// Axis-aligned bounding box (AABB) collision math for the 2D layout.
// This is a real 3D box test (X, Y, AND Z/elevation), not just a 2D
// footprint test — two items overlap only if they overlap on ALL THREE
// axes simultaneously. The Z axis matters specifically because a wall
// cabinet legitimately shares the same X/Y footprint as the base
// cabinet run beneath it (with a countertop/appliance zone between
// them) — without Z-awareness, that completely normal kitchen layout
// would get flagged as a false collision. Appliances (types/
// appliance.ts) plug into this exact same system for the exact same
// reason: a stove/OTG/toaster sitting flush on a countertop, or a
// chimney mounted above a hob, are ALSO legitimate same-X/Y,
// different-Z overlaps.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { Obstacle } from '../types/layout';
import type { PlacedApplianceItem } from '../types/appliance';
import { applianceFootprint } from './applianceGeometry';

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

// Default starting height for a newly created non-floor-to-ceiling
// obstacle (e.g. a knee-height duct), and the backfill value used for
// obstacles saved before Obstacle.heightMm existed (see
// normalizeObstacle in lib/Persistence.ts). Actual per-obstacle height
// is a real editable field now (ObstacleInspector) — this constant is
// just the sensible default, not a hardcoded universal height anymore.
export const PARTIAL_OBSTACLE_HEIGHT_MM = 900;

// Cabinets can be rotated 90/270°, which swaps their footprint's
// effective width and depth even though widthMm/depthMm in the data
// don't change. The rotation happens around the cabinet's center (see
// CabinetLayer's Group offset), so the center stays fixed and only the
// half-extents swap. Vertically, a cabinet spans from its elevationMm
// (bottom face off the floor) up to elevationMm + heightMm.
export function getCabinetBounds(item: PlacedCabinetItem): AABB {
  const centerX = item.x + item.widthMm / 2;
  const centerY = item.y + item.depthMm / 2;
  const isQuarterTurn = item.rotationDeg === 90 || item.rotationDeg === 270;
  const footprintWidth = isQuarterTurn ? item.depthMm : item.widthMm;
  const footprintHeight = isQuarterTurn ? item.widthMm : item.depthMm;

  return {
    minX: centerX - footprintWidth / 2,
    maxX: centerX + footprintWidth / 2,
    minY: centerY - footprintHeight / 2,
    maxY: centerY + footprintHeight / 2,
    minZ: item.elevationMm,
    maxZ: item.elevationMm + item.heightMm,
  };
}

// Appliances rotate in quarter turns now, exactly like cabinets, so
// X/Y comes from the ROTATED footprint rather than the stored
// widthMm/depthMm — a 90°-turned 600x300 hob occupies 300 across and
// 600 deep. Reading the raw dimensions here would collision-check a
// turned appliance against the wrong rectangle, letting it overlap a
// neighbour silently.
//
// Vertically: elevationMm is the SAME "bottom face off the floor"
// convention PlacedCabinetItem uses, so a stove at elevationMm 850
// sitting flush on a base cabinet's 850mm-tall carcass touches (not
// overlaps) it, and a chimney mounted well above the stove at a much
// higher elevationMm shares the stove's X/Y footprint without
// colliding.
export function getApplianceBounds(item: PlacedApplianceItem): AABB {
  const rect = applianceFootprint(item);

  return {
    minX: rect.x,
    maxX: rect.x + rect.widthMm,
    minY: rect.y,
    maxY: rect.y + rect.depthMm,
    minZ: item.elevationMm,
    maxZ: item.elevationMm + item.heightMm,
  };
}

// Obstacles rotate in quarter turns now, same convention as
// getCabinetBounds above: x/y is always the UNROTATED top-left corner,
// rotation happens about the center, and a 90/270 turn swaps which of
// widthMm/depthMm is the footprint's extent along each axis.
// Vertically: a floor-to-ceiling obstacle (a structural pillar) blocks
// every height, so it starts at the floor (minZ 0) and uses +Infinity
// as its top rather than needing the room's actual ceiling height
// threaded in here — any finite cabinet range will always overlap it,
// same as before Z-awareness existed. A partial-height obstacle instead
// spans from its own elevationMm up to elevationMm + heightMm — that
// elevation is what lets something like a mid-wall electrical fixture
// or a run of exposed pipe start above the floor with nothing below it,
// the same way a wall cabinet does.
export function getObstacleBounds(obstacle: Obstacle): AABB {
  const centerX = obstacle.x + obstacle.widthMm / 2;
  const centerY = obstacle.y + obstacle.depthMm / 2;
  const isQuarterTurn = obstacle.rotationDeg === 90 || obstacle.rotationDeg === 270;
  const footprintWidth = isQuarterTurn ? obstacle.depthMm : obstacle.widthMm;
  const footprintHeight = isQuarterTurn ? obstacle.widthMm : obstacle.depthMm;

  return {
    minX: centerX - footprintWidth / 2,
    maxX: centerX + footprintWidth / 2,
    minY: centerY - footprintHeight / 2,
    maxY: centerY + footprintHeight / 2,
    minZ: obstacle.floorToCeiling ? 0 : obstacle.elevationMm,
    maxZ: obstacle.floorToCeiling
      ? Number.POSITIVE_INFINITY
      : obstacle.elevationMm + obstacle.heightMm,
  };
}

// A real overlap has to clear this on every axis to count. Two items
// snapped flush (lib/cabinetSnapping.ts computes an exact touch, e.g.
// footprintTopMm === neighbor's bottom edge) still each go through an
// mm -> px -> mm round trip before landing in x/y (the drag's on-screen
// position, converted back via canvasScale's `scale`, which is
// essentially never a round number). That round trip lands within
// ~1e-10mm of the exact value, never exactly on it — and about half
// the time the rounding error points inward rather than outward. A
// strict `<`/`>` comparison has no room for that: an intended,
// pixel-perfect touch could register as a sub-nanometre "overlap" and
// get flagged red with no visible gap and nothing to fix — confirmed
// by sweeping realistic room sizes and drag positions through the
// exact px round trip CabinetLayer's dragBoundFunc/onDragEnd do.
// 0.5mm is far below manufacturing tolerance (so nothing a business
// would call "a real overlap" is masked) and many orders of magnitude
// above the float noise floor.
const COLLISION_EPSILON_MM = 0.5;

// Strict beyond the epsilon above: two boxes flush against each other
// (edges touching, zero overlap) are NOT a collision — only true
// overlap is.
export function boxesOverlap(a: AABB, b: AABB): boolean {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return overlapX > COLLISION_EPSILON_MM && overlapY > COLLISION_EPSILON_MM && overlapZ > COLLISION_EPSILON_MM;
}

export type CollisionPartnerType = 'cabinet' | 'obstacle' | 'appliance';
export type CollisionItemType = 'cabinet' | 'appliance';

export interface Collision {
  itemId: string;
  itemType: CollisionItemType;
  withId: string;
  withType: CollisionPartnerType;
}

export interface CollisionResult {
  collidingCabinetIds: Set<string>;
  collidingApplianceIds: Set<string>;
  collisions: Collision[];
}

// O(n²) over cabinets/obstacles/appliances — completely fine at
// kitchen-MVP scale (tens of items, not thousands). Revisit with a
// spatial grid only if that assumption stops holding.
//
// appliances defaults to [] so any existing call site that only knows
// about cabinets/obstacles keeps compiling — but every current caller
// in this app (useCollisions, CabinetLayer's live-drag preview) passes
// it explicitly.
export function detectCollisions(
  cabinets: PlacedCabinetItem[],
  obstacles: Obstacle[],
  appliances: PlacedApplianceItem[] = []
): CollisionResult {
  const collidingCabinetIds = new Set<string>();
  const collidingApplianceIds = new Set<string>();
  const collisions: Collision[] = [];

  const cabinetBoxes = cabinets.map((item) => ({ item, box: getCabinetBounds(item) }));
  const obstacleBoxes = obstacles.map((item) => ({ item, box: getObstacleBounds(item) }));
  const applianceBoxes = appliances.map((item) => ({ item, box: getApplianceBounds(item) }));

  // cabinet <-> cabinet
  for (let i = 0; i < cabinetBoxes.length; i++) {
    for (let j = i + 1; j < cabinetBoxes.length; j++) {
      if (cabinetBoxes[i].item.ignoreOverlap || cabinetBoxes[j].item.ignoreOverlap) continue;
      if (boxesOverlap(cabinetBoxes[i].box, cabinetBoxes[j].box)) {
        collidingCabinetIds.add(cabinetBoxes[i].item.id);
        collidingCabinetIds.add(cabinetBoxes[j].item.id);
        collisions.push({
          itemId: cabinetBoxes[i].item.id,
          itemType: 'cabinet',
          withId: cabinetBoxes[j].item.id,
          withType: 'cabinet',
        });
      }
    }
  }

  // cabinet <-> obstacle
  for (const { item: cabinet, box: cabinetBox } of cabinetBoxes) {
    for (const { item: obstacle, box: obstacleBox } of obstacleBoxes) {
      if (cabinet.ignoreOverlap || obstacle.ignoreOverlap) continue;
      if (boxesOverlap(cabinetBox, obstacleBox)) {
        collidingCabinetIds.add(cabinet.id);
        collisions.push({
          itemId: cabinet.id,
          itemType: 'cabinet',
          withId: obstacle.id,
          withType: 'obstacle',
        });
      }
    }
  }

  // appliance <-> appliance
  for (let i = 0; i < applianceBoxes.length; i++) {
    for (let j = i + 1; j < applianceBoxes.length; j++) {
      if (applianceBoxes[i].item.ignoreOverlap || applianceBoxes[j].item.ignoreOverlap) continue;
      if (boxesOverlap(applianceBoxes[i].box, applianceBoxes[j].box)) {
        collidingApplianceIds.add(applianceBoxes[i].item.id);
        collidingApplianceIds.add(applianceBoxes[j].item.id);
        collisions.push({
          itemId: applianceBoxes[i].item.id,
          itemType: 'appliance',
          withId: applianceBoxes[j].item.id,
          withType: 'appliance',
        });
      }
    }
  }

  // appliance <-> cabinet
  for (const { item: appliance, box: applianceBox } of applianceBoxes) {
    for (const { item: cabinet, box: cabinetBox } of cabinetBoxes) {
      if (appliance.ignoreOverlap || cabinet.ignoreOverlap) continue;
      if (boxesOverlap(applianceBox, cabinetBox)) {
        collidingApplianceIds.add(appliance.id);
        collidingCabinetIds.add(cabinet.id);
        collisions.push({
          itemId: appliance.id,
          itemType: 'appliance',
          withId: cabinet.id,
          withType: 'cabinet',
        });
      }
    }
  }

  // appliance <-> obstacle
  for (const { item: appliance, box: applianceBox } of applianceBoxes) {
    for (const { item: obstacle, box: obstacleBox } of obstacleBoxes) {
      if (appliance.ignoreOverlap || obstacle.ignoreOverlap) continue;
      if (boxesOverlap(applianceBox, obstacleBox)) {
        collidingApplianceIds.add(appliance.id);
        collisions.push({
          itemId: appliance.id,
          itemType: 'appliance',
          withId: obstacle.id,
          withType: 'obstacle',
        });
      }
    }
  }

  return { collidingCabinetIds, collidingApplianceIds, collisions };
}
