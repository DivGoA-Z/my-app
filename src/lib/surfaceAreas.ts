// src/lib/surfaceAreas.ts
//
// Splits each room surface (floor, ceiling, four walls) into three
// areas, because they are billed differently:
//
//   EXPOSED    visible when the kitchen is finished. Charged at the
//              assigned finish's rate.
//   CONCEALED  the surface continues but is hidden — behind a run of
//              base units, behind a wall-mounted electrical panel.
//              Still finished in practice, but with cheaper material,
//              so it's charged at the CONCEALED finish's rate (or not
//              at all, if none is assigned — also common).
//   OCCUPIED   there is no surface there at all. A structural pillar or
//              a plumbing shaft takes up that space; the wall behind it
//              doesn't exist. Never charged, at any rate.
//   VOID       a door or window. Like occupied, there's no surface —
//              but for a different reason worth keeping separate: a
//              pillar is something ADDED in front of the wall, a void
//              is wall that was never built. Reporting them apart is
//              what lets the quote say "1.89 m² deducted for the door"
//              rather than lumping it in with structure. Walls only:
//              floors and ceilings have no openings.
//
// That third category is the one that's easy to miss. Treating a pillar
// as "concealed wall" bills the client for tiling the inside of a
// concrete column. The distinction lives on the obstacle type — see
// OBSTACLE_SURFACE_BEHAVIOUR in types/layout.ts.
//
// KNOWN SIMPLIFICATION: overlapping items are counted twice, because
// these are sums of individual footprints rather than a true union of
// polygons. Two cabinets occupying the same space would over-report the
// concealed area — but that's already a collision the app flags
// (CollisionWarningBanner), so the layout is invalid before the numbers
// are. Every result is clamped so exposed area can't go negative.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { RoomLayout, WallOrientation } from '../types/layout';
import { OBSTACLE_SURFACE_BEHAVIOUR } from '../types/layout';
import { currentFootprintRect } from './footprint';
import type { FootprintRect } from './footprint';
import { applianceFootprint } from './applianceGeometry';
import { voidAreaMm2 } from './openings';

const MM2_PER_SQM = 1000 * 1000;

// How close an item has to be to a wall plane to count as against it.
// Cabinets are pushed to the wall but rarely land on it exactly — a
// grid snap of 50mm, a scribe gap, or a hand-dragged placement all
// leave a few millimetres.
const WALL_CONTACT_TOLERANCE_MM = 60;

const DEFAULT_CEILING_HEIGHT_MM = 2700;

export interface SurfaceAreaBreakdown {
  totalSqM: number;
  exposedSqM: number;
  concealedSqM: number;
  occupiedSqM: number;
  voidSqM: number;
}

export interface RoomSurfaceAreas {
  floor: SurfaceAreaBreakdown;
  ceiling: SurfaceAreaBreakdown;
  walls: Record<WallOrientation, SurfaceAreaBreakdown>;
}

// One rectangle's worth of surface being taken up, plus how.
interface Claim {
  areaMm2: number;
  behaviour: 'conceals' | 'occupies';
}

function breakdown(
  totalMm2: number,
  claims: Claim[],
  // Door/window area, already computed and clipped by lib/openings.ts.
  // Passed in rather than derived from a Claim because it's subtracted
  // FIRST and unconditionally — see the precedence note below.
  voidMm2 = 0
): SurfaceAreaBreakdown {
  const occupiedMm2 = claims
    .filter((c) => c.behaviour === 'occupies')
    .reduce((sum, c) => sum + c.areaMm2, 0);
  const concealedMm2 = claims
    .filter((c) => c.behaviour === 'conceals')
    .reduce((sum, c) => sum + c.areaMm2, 0);

  // PRECEDENCE: void, then occupied, then concealed, then whatever is
  // left is exposed.
  //
  // Void goes first because it's the most certain of the four — an
  // opening's size is measured, not estimated, whereas concealed area
  // is inferred from where cabinets happen to sit and can double-count
  // on overlap (see the header note). So if the numbers have to give,
  // they give on the softest estimate rather than on a door that
  // demonstrably exists.
  //
  // Note void and concealed CAN legitimately overlap in reality — a
  // base unit standing under a window sill hides wall that is partly
  // sill and partly nothing. The ordering resolves it in the client's
  // favour: the opening is deducted in full, and the concealed
  // estimate absorbs the difference.
  const clampedVoid = Math.min(totalMm2, voidMm2);
  const clampedOccupied = Math.min(totalMm2 - clampedVoid, occupiedMm2);
  const clampedConcealed = Math.min(
    totalMm2 - clampedVoid - clampedOccupied,
    concealedMm2
  );
  const exposedMm2 = totalMm2 - clampedVoid - clampedOccupied - clampedConcealed;

  return {
    totalSqM: totalMm2 / MM2_PER_SQM,
    exposedSqM: exposedMm2 / MM2_PER_SQM,
    concealedSqM: clampedConcealed / MM2_PER_SQM,
    occupiedSqM: clampedOccupied / MM2_PER_SQM,
    voidSqM: clampedVoid / MM2_PER_SQM,
  };
}

// A cabinet's on-floor rectangle, accounting for rotation — a 90°-turned
// 600x300 wall cabinet presents 300 along the wall, not 600.
//
// FIXED: this used to pair the rotated EXTENTS with the unrotated
// top-left corner (x: item.x, y: item.y), which is only correct at 0°
// and 180°. Since rotation pivots about the center, a quarter-turned
// cabinet's footprint corner moves — for a 600x300 at 90° it shifts by
// (+150, -150) — so the old rect could report a cabinet as against a
// wall it wasn't touching, or miss one it was. currentFootprintRect
// derives the corner from the center, which is the invariant.
function cabinetFootprint(item: PlacedCabinetItem): FootprintRect {
  return currentFootprintRect(item);
}

export function touchesFloor(elevationMm: number): boolean {
  return elevationMm <= WALL_CONTACT_TOLERANCE_MM;
}

// ---- Floor ----

function floorAreas(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): SurfaceAreaBreakdown {
  const { widthMm, depthMm } = layout.dimensions;
  const claims: Claim[] = [];

  for (const obstacle of layout.obstacles) {
    // A mid-wall electrical point doesn't touch the floor at all.
    if (!obstacle.floorToCeiling && !touchesFloor(obstacle.elevationMm)) continue;
    claims.push({
      areaMm2: obstacle.widthMm * obstacle.depthMm,
      behaviour:
        OBSTACLE_SURFACE_BEHAVIOUR[obstacle.type] === 'occupies' ? 'occupies' : 'conceals',
    });
  }

  for (const cabinet of cabinets) {
    // Wall cabinets hang above the floor and hide none of it.
    if (!touchesFloor(cabinet.elevationMm)) continue;
    const f = cabinetFootprint(cabinet);
    claims.push({ areaMm2: f.widthMm * f.depthMm, behaviour: 'conceals' });
  }

  for (const appliance of appliances) {
    if (!touchesFloor(appliance.elevationMm)) continue;
    // Rotation happens to be irrelevant to FLOOR area — w*d equals d*w
    // — but it's read through the same helper as everywhere else so
    // this doesn't quietly become wrong if the footprint rule is ever
    // generalised past quarter turns.
    const f = applianceFootprint(appliance);
    claims.push({ areaMm2: f.widthMm * f.depthMm, behaviour: 'conceals' });
  }

  return breakdown(widthMm * depthMm, claims);
}

// ---- Ceiling ----

function ceilingAreas(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[]
): SurfaceAreaBreakdown {
  const { widthMm, depthMm } = layout.dimensions;
  const ceilingHeightMm = layout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
  const claims: Claim[] = [];

  for (const obstacle of layout.obstacles) {
    if (!obstacle.floorToCeiling) continue;
    claims.push({
      areaMm2: obstacle.widthMm * obstacle.depthMm,
      behaviour:
        OBSTACLE_SURFACE_BEHAVIOUR[obstacle.type] === 'occupies' ? 'occupies' : 'conceals',
    });
  }

  // A tall unit that runs to the ceiling hides the plaster above it.
  for (const cabinet of cabinets) {
    if (cabinet.elevationMm + cabinet.heightMm < ceilingHeightMm - WALL_CONTACT_TOLERANCE_MM) {
      continue;
    }
    const f = cabinetFootprint(cabinet);
    claims.push({ areaMm2: f.widthMm * f.depthMm, behaviour: 'conceals' });
  }

  return breakdown(widthMm * depthMm, claims);
}

// ---- Walls ----

// North is the y=0 edge, south y=depth, west x=0, east x=width — the
// same convention RoomWalls uses in Room3DCanvas.
function isAgainstWall(
  orientation: WallOrientation,
  rect: { x: number; y: number; widthMm: number; depthMm: number },
  roomWidthMm: number,
  roomDepthMm: number
): boolean {
  const t = WALL_CONTACT_TOLERANCE_MM;
  switch (orientation) {
    case 'north':
      return rect.y <= t;
    case 'south':
      return rect.y + rect.depthMm >= roomDepthMm - t;
    case 'west':
      return rect.x <= t;
    case 'east':
      return rect.x + rect.widthMm >= roomWidthMm - t;
  }
}

// How much of the wall's LENGTH an item spans. North/south walls run
// along x, east/west along y.
function extentAlongWall(
  orientation: WallOrientation,
  rect: { widthMm: number; depthMm: number }
): number {
  return orientation === 'north' || orientation === 'south' ? rect.widthMm : rect.depthMm;
}

function wallAreas(
  orientation: WallOrientation,
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): SurfaceAreaBreakdown {
  const { widthMm, depthMm } = layout.dimensions;
  const ceilingHeightMm = layout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
  const wallLengthMm = orientation === 'north' || orientation === 'south' ? widthMm : depthMm;
  const claims: Claim[] = [];

  for (const obstacle of layout.obstacles) {
    const rect = currentFootprintRect(obstacle);
    if (!isAgainstWall(orientation, rect, widthMm, depthMm)) continue;

    const heightMm = obstacle.floorToCeiling ? ceilingHeightMm : obstacle.heightMm;
    claims.push({
      areaMm2: extentAlongWall(orientation, rect) * heightMm,
      behaviour:
        OBSTACLE_SURFACE_BEHAVIOUR[obstacle.type] === 'occupies' ? 'occupies' : 'conceals',
    });
  }

  for (const cabinet of cabinets) {
    const rect = cabinetFootprint(cabinet);
    if (!isAgainstWall(orientation, rect, widthMm, depthMm)) continue;
    claims.push({
      areaMm2: extentAlongWall(orientation, rect) * cabinet.heightMm,
      behaviour: 'conceals',
    });
  }

  for (const appliance of appliances) {
    // The ROTATED rectangle, not the stored one — this is where an
    // appliance's rotation reaches the quote. A 600x300 hob turned 90°
    // against the north wall hides 300mm of its length, not 600mm, so
    // reading widthMm directly would under-report exposed tile and
    // charge the client the cheap concealed rate for 300mm of visible
    // wall.
    const rect = applianceFootprint(appliance);
    if (!isAgainstWall(orientation, rect, widthMm, depthMm)) continue;
    claims.push({
      areaMm2: extentAlongWall(orientation, rect) * appliance.heightMm,
      behaviour: 'conceals',
    });
  }

  // Openings on THIS wall only. voidAreaMm2 clips exactly the way
  // wallSegments does, so the area deducted here and the geometry drawn
  // in the 3D view can never disagree about how much wall is missing.
  const wall = layout.walls.find((w) => w.orientation === orientation);
  const voidMm2 = voidAreaMm2(wallLengthMm, ceilingHeightMm, wall?.openings ?? []);

  return breakdown(wallLengthMm * ceilingHeightMm, claims, voidMm2);
}

export function computeRoomSurfaceAreas(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): RoomSurfaceAreas {
  return {
    floor: floorAreas(layout, cabinets, appliances),
    ceiling: ceilingAreas(layout, cabinets),
    walls: {
      north: wallAreas('north', layout, cabinets, appliances),
      east: wallAreas('east', layout, cabinets, appliances),
      south: wallAreas('south', layout, cabinets, appliances),
      west: wallAreas('west', layout, cabinets, appliances),
    },
  };
}

// ---- Remaining floor space along each wall ----
//
// "How much room is left to fit another cabinet" — the gaps between
// floor-touching cabinets/obstacles run along a wall, plus the leftover
// at each end. Genuinely different from the area functions above, which
// deliberately let overlapping footprints double-count (see the KNOWN
// SIMPLIFICATION note at the top of this file): a gap can't tolerate
// that — two occupants that overlap along the wall's run axis have to
// be merged into ONE occupied span first, or the "gap" between them
// would be negative or simply wrong.
//
// Which horizontal band along the wall this gap belongs to. A wall
// cabinet floating above a base run doesn't block anything at floor
// level and vice versa — they're two independent runs, and a business
// checking "does this fit" needs the numbers for the one it's actually
// placing next, not a floor-level number that happens to sit under a
// wall cabinet on the top-down plan (see the 'wall' band's own doc
// comment on computeWallGaps below for the bug this was confused with).
export type WallGapBand = 'floor' | 'wall';

export interface WallGap {
  orientation: WallOrientation;
  band: WallGapBand;
  // Position along the wall's run axis (x for north/south, y for
  // east/west) where the gap starts, and how long it runs — both in mm,
  // in the SAME room coordinates cabinets are placed in.
  startMm: number;
  lengthMm: number;
}

// Only excludes true floating-point noise (a "gap" of 0.0001mm from a
// footprint subtraction), never a real leftover strip. This used to be
// 20mm, on the reasoning that a small gap was probably snap-tolerance
// noise rather than something worth labelling — but that's Principle
// 10 in docs/PRINCIPLES.md backwards: a business trying to verify "does
// this all fit in 3371mm" by adding up the labelled numbers got 3367mm,
// because a genuine 4mm gap was silently dropped. Approximation is
// allowed here (mm-scale slop from a drag is real), but hiding it isn't
// — every gap that actually exists gets a label, however small.
const MIN_GAP_MM = 1;

function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

// band='floor': gaps between floor-touching items — the original
// behaviour, and the one RemainingSpaceLayer used to show exclusively.
// band='wall': gaps between WALL-MOUNTED cabinets (elevationMm above
// tolerance) along the same wall.
//
// These were conflated for a while by accident, not by design: a wall
// cabinet drawn in top-down plan view sits at the same x/y as whatever
// is (or isn't) on the floor beneath it, so a floor-band gap label can
// visually sit right next to a wall cabinet while describing something
// underneath it that has nothing to do with that cabinet. Reported as
// "the plan says 18mm, the wall elevation says 7mm for the same
// cabinet" — both numbers were correct, just for two different bands.
// Computing them as two explicit, separately-labelled passes instead
// of one band no one asked to disambiguate is the actual fix.
//
// A floor-to-ceiling obstacle occupies BOTH bands (it blocks a wall
// cabinet run exactly as much as it blocks a base run); anything else
// belongs to whichever single band its elevationMm puts it in.
export function computeWallGaps(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  band: WallGapBand = 'floor'
): WallGap[] {
  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = layout.dimensions;
  const orientations: WallOrientation[] = ['north', 'south', 'east', 'west'];
  const gaps: WallGap[] = [];

  for (const orientation of orientations) {
    const wallLengthMm = orientation === 'north' || orientation === 'south' ? roomWidthMm : roomDepthMm;

    const occupiedSpans: { start: number; end: number }[] = [];

    for (const cabinet of cabinets) {
      const inFloorBand = touchesFloor(cabinet.elevationMm);
      if (band === 'floor' ? !inFloorBand : inFloorBand) continue;
      const rect = cabinetFootprint(cabinet);
      if (!isAgainstWall(orientation, rect, roomWidthMm, roomDepthMm)) continue;
      const start = orientation === 'north' || orientation === 'south' ? rect.x : rect.y;
      occupiedSpans.push({ start, end: start + extentAlongWall(orientation, rect) });
    }

    for (const obstacle of layout.obstacles) {
      const inFloorBand = obstacle.floorToCeiling || touchesFloor(obstacle.elevationMm);
      const inWallBand = obstacle.floorToCeiling || !touchesFloor(obstacle.elevationMm);
      if (band === 'floor' ? !inFloorBand : !inWallBand) continue;
      const rect = currentFootprintRect(obstacle);
      if (!isAgainstWall(orientation, rect, roomWidthMm, roomDepthMm)) continue;
      const start = orientation === 'north' || orientation === 'south' ? rect.x : rect.y;
      occupiedSpans.push({ start, end: start + extentAlongWall(orientation, rect) });
    }

    const merged = mergeSpans(occupiedSpans);

    let cursor = 0;
    for (const span of merged) {
      if (span.start - cursor >= MIN_GAP_MM) {
        gaps.push({ orientation, band, startMm: cursor, lengthMm: span.start - cursor });
      }
      cursor = Math.max(cursor, span.end);
    }
    if (wallLengthMm - cursor >= MIN_GAP_MM) {
      gaps.push({ orientation, band, startMm: cursor, lengthMm: wallLengthMm - cursor });
    }
  }

  return gaps;
}

// ---- Wall elevation (front-on outline view) ----
//
// Everything on one wall, in the wall's own 2D frame: how far along the
// wall (from its start — see WallOpening.offsetMm's comment, same axis
// convention) and how high off the floor. This is genuinely different
// data from the plan's top-down x/y — it's what WallElevationView draws
// a straight-on outline from, so a wall-mounted cabinet's actual height
// is something you can SEE rather than infer from two numbers, which is
// what the top-down "remaining space" labels above structurally can't
// do (they have no way to express "this gap is only tall-unit-clear if
// nothing above it is in the way").
export type WallElevationItemKind = 'cabinet' | 'appliance' | 'obstacle' | 'opening';

export interface WallElevationItem {
  kind: WallElevationItemKind;
  id: string;
  label: string;
  alongMm: number; // distance from the wall's start to this item's near edge
  extentMm: number; // size along the wall
  bottomMm: number; // height of the bottom face off the floor
  topMm: number; // height of the top face off the floor
  // How far the item projects OUT from the wall — meaningless for an
  // opening (a hole has no depth), present for everything else.
  depthMm?: number;
}

export function computeWallElevationItems(
  orientation: WallOrientation,
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): WallElevationItem[] {
  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = layout.dimensions;
  const ceilingHeightMm = layout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
  const items: WallElevationItem[] = [];

  const alongOf = (rect: { x: number; y: number }): number =>
    orientation === 'north' || orientation === 'south' ? rect.x : rect.y;

  // How far the item projects OUT from the wall into the room — the
  // rotated footprint's extent on whichever axis ISN'T the wall's run
  // axis.
  const projectionOf = (rect: { widthMm: number; depthMm: number }): number =>
    orientation === 'north' || orientation === 'south' ? rect.depthMm : rect.widthMm;

  for (const cabinet of cabinets) {
    const rect = cabinetFootprint(cabinet);
    if (!isAgainstWall(orientation, rect, roomWidthMm, roomDepthMm)) continue;
    items.push({
      kind: 'cabinet',
      id: cabinet.id,
      label: cabinet.moduleType,
      alongMm: alongOf(rect),
      extentMm: extentAlongWall(orientation, rect),
      bottomMm: cabinet.elevationMm,
      topMm: cabinet.elevationMm + cabinet.heightMm,
      depthMm: projectionOf(rect),
    });
  }

  for (const appliance of appliances) {
    const rect = applianceFootprint(appliance);
    if (!isAgainstWall(orientation, rect, roomWidthMm, roomDepthMm)) continue;
    items.push({
      kind: 'appliance',
      id: appliance.id,
      label: appliance.applianceType,
      alongMm: alongOf(rect),
      extentMm: extentAlongWall(orientation, rect),
      bottomMm: appliance.elevationMm,
      topMm: appliance.elevationMm + appliance.heightMm,
      depthMm: projectionOf(rect),
    });
  }

  for (const obstacle of layout.obstacles) {
    const rect = currentFootprintRect(obstacle);
    if (!isAgainstWall(orientation, rect, roomWidthMm, roomDepthMm)) continue;
    items.push({
      kind: 'obstacle',
      id: obstacle.id,
      label: obstacle.type,
      alongMm: alongOf(rect),
      extentMm: extentAlongWall(orientation, rect),
      bottomMm: obstacle.floorToCeiling ? 0 : obstacle.elevationMm,
      topMm: obstacle.floorToCeiling ? ceilingHeightMm : obstacle.elevationMm + obstacle.heightMm,
      depthMm: projectionOf(rect),
    });
  }

  const wall = layout.walls.find((w) => w.orientation === orientation);
  for (const opening of wall?.openings ?? []) {
    items.push({
      kind: 'opening',
      id: opening.id,
      label: opening.kind,
      alongMm: opening.offsetMm,
      extentMm: opening.widthMm,
      bottomMm: opening.sillMm,
      topMm: opening.sillMm + opening.heightMm,
    });
  }

  return items;
}
