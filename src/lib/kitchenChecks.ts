// src/lib/kitchenChecks.ts
//
// Trade-specific design checks — NOT collision (lib/collision.ts:
// "do two things occupy the same space"), NOT clearance
// (lib/clearance.ts: "can this door actually swing open"). These are
// about whether the KITCHEN ITSELF works as a kitchen: is there room
// to stand between two counters, is the hob a safe distance from the
// sink, is there somewhere to set a hot pan down, is the hob sitting
// under a window.
//
// Every one of these is ADVISORY, never blocking — Principle 6, same
// as overlap/clearance: warn, never block. A design that fails one of
// these can still be exactly what a client wants or the room allows —
// a genuinely tiny room has no choice about aisle width, and this app
// already promises never to stop someone from designing what the site
// actually requires.
//
// CORRECTED: this used to say a real "work triangle" is
// sink/hob/refrigerator but this app had no fridge ApplianceType, so
// only the sink-hob leg below was checked. `fridge` was added to
// ApplianceType (types/appliance.ts) once appliance-dimensions-first
// needed it, which unblocks the other two legs —
// checkFridgeDistances below adds them, same one-leg-at-a-time
// distance pattern as checkSinkHobDistance, not a stricter perimeter-
// sum or mutual-angle "triangle" rule. It only fires when a fridge is
// actually PLACED: Indian kitchens overwhelmingly buy the fridge
// separately and it often doesn't even live in the kitchen, so an
// unplaced fridge correctly produces no finding rather than assuming
// one exists.

import type { RoomLayout, WallOrientation } from '../types/layout';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import { currentFootprintRect } from './footprint';
import type { FootprintRect } from './footprint';
import { extentAlongWall, startAlongWall, wallIncursionMm, touchesFloor } from './surfaceAreas';
import { openingsForWall } from './openings';

export interface KitchenCheckFinding {
  // Stable across re-renders for the same underlying condition, so a
  // banner list doesn't visually shuffle every time an unrelated item
  // moves — same reasoning collision/clearance ids get elsewhere.
  id: string;
  message: string;
  // Which placed item(s) this finding is "about", for
  // useDesignAlerts' selection filtering — empty for a room-level
  // finding with no single item to point at (aisle width: it's about
  // two WALLS, not an item). checkCounterBesideHob is deliberately
  // one-sided: there's no specific cabinet to blame for the ABSENCE
  // of a landing counter, only the hob itself.
  itemIds: string[];
}

const WALLS: WallOrientation[] = ['north', 'east', 'south', 'west'];

function footprintCenter(rect: FootprintRect): { x: number; y: number } {
  return { x: rect.x + rect.widthMm / 2, y: rect.y + rect.depthMm / 2 };
}

// Which single wall a placed item "belongs to", for the checks below —
// deliberately NOT surfaceAreas.ts's isAgainstWall (an edge-touch test,
// correct for ITS purpose: does this wall have concealment here). A
// cabinet run spanning a wall's full length always has an END whose
// edge coincides with the PERPENDICULAR wall too — isAgainstWall
// correctly says "yes" there for billing (that stretch of the side
// wall really is concealed), but it would wrongly turn an ordinary
// single-wall run into a phantom second counter run at the room's
// corners for the checks in this file. Nearest-by-CENTRE has no such
// corner ambiguity: a north-wall run's centre is close to the north
// plane and far from east/west, however close its END happens to sit
// to either.
function wallPlaneDistanceMm(
  orientation: WallOrientation,
  center: { x: number; y: number },
  roomWidthMm: number,
  roomDepthMm: number
): number {
  switch (orientation) {
    case 'north':
      return center.y;
    case 'south':
      return roomDepthMm - center.y;
    case 'west':
      return center.x;
    case 'east':
      return roomWidthMm - center.x;
  }
}

// How close a footprint's CENTRE must be to a wall's plane to count as
// "against" it here — generous enough for a deep base/corner unit's
// own half-depth (up to ~900mm deep, centre ~450mm off the wall) but
// not so generous that a mid-room island gets assigned to a wall at
// all, which is the point of using centre-distance in the first place.
const WALL_ASSIGNMENT_TOLERANCE_MM = 500;

function nearestWall(
  rect: FootprintRect,
  roomWidthMm: number,
  roomDepthMm: number
): WallOrientation | null {
  const center = footprintCenter(rect);
  let best: WallOrientation | null = null;
  let bestDistMm = Infinity;
  for (const w of WALLS) {
    const d = wallPlaneDistanceMm(w, center, roomWidthMm, roomDepthMm);
    if (d < bestDistMm) {
      bestDistMm = d;
      best = w;
    }
  }
  return best !== null && bestDistMm <= WALL_ASSIGNMENT_TOLERANCE_MM ? best : null;
}

// ---- Aisle width ----
//
// The clear walkway between two FACING counter runs — a galley
// kitchen's two walls, or a straight run facing an island. Only
// checked when BOTH opposite walls actually have something against
// them; an empty opposite wall isn't a galley constraint, it's just
// open room, and flagging it would be noise on the majority of small
// single-run kitchens this app is built for (docs/PRINCIPLES.md:
// "Rooms are compact — 6×8 ft to 12×14 ft").
export const MIN_AISLE_MM = 900;
// Below this, an "incursion" is noise (a 60mm obstacle nub already
// counted by isAgainstWall's own tolerance) rather than a real counter
// run — matches WALL_CONTACT_TOLERANCE_MM in surfaceAreas.ts, the same
// threshold that decides "against the wall" in the first place.
const MIN_MEANINGFUL_INCURSION_MM = 100;

function maxIncursionForWall(
  orientation: WallOrientation,
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[]
): number {
  const { widthMm, depthMm } = layout.dimensions;
  let max = 0;
  for (const cabinet of cabinets) {
    const rect = currentFootprintRect(cabinet);
    if (nearestWall(rect, widthMm, depthMm) !== orientation) continue;
    max = Math.max(max, wallIncursionMm(orientation, rect, widthMm, depthMm));
  }
  for (const obstacle of layout.obstacles) {
    const rect = currentFootprintRect(obstacle);
    if (nearestWall(rect, widthMm, depthMm) !== orientation) continue;
    max = Math.max(max, wallIncursionMm(orientation, rect, widthMm, depthMm));
  }
  return max;
}

export function checkAisleWidths(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[]
): KitchenCheckFinding[] {
  const { widthMm, depthMm } = layout.dimensions;
  const findings: KitchenCheckFinding[] = [];

  const incursions: Record<WallOrientation, number> = {
    north: maxIncursionForWall('north', layout, cabinets),
    south: maxIncursionForWall('south', layout, cabinets),
    east: maxIncursionForWall('east', layout, cabinets),
    west: maxIncursionForWall('west', layout, cabinets),
  };

  const pairs: [WallOrientation, WallOrientation, number][] = [
    ['north', 'south', depthMm],
    ['east', 'west', widthMm],
  ];

  for (const [a, b, roomSpanMm] of pairs) {
    if (incursions[a] < MIN_MEANINGFUL_INCURSION_MM || incursions[b] < MIN_MEANINGFUL_INCURSION_MM) {
      continue;
    }
    const aisleMm = roomSpanMm - incursions[a] - incursions[b];
    if (aisleMm < MIN_AISLE_MM) {
      findings.push({
        id: `aisle-${a}-${b}`,
        message: `Only ${Math.max(0, Math.round(aisleMm))}mm of walking space between the ${a} and ${b} counters — the trade minimum is ${MIN_AISLE_MM}mm.`,
        itemIds: [],
      });
    }
  }

  return findings;
}

// ---- Sink-to-hob distance (the one leg of the work triangle this app
// can actually see — see this file's own header comment) ----
const MIN_SINK_HOB_MM = 450; // splash near an open flame below this
const MAX_SINK_HOB_MM = 2700; // beyond this the workflow between them is a hike

export function checkSinkHobDistance(appliances: PlacedApplianceItem[]): KitchenCheckFinding[] {
  const sinks = appliances.filter((a) => a.applianceType === 'sink');
  const stoves = appliances.filter((a) => a.applianceType === 'stove');
  const findings: KitchenCheckFinding[] = [];

  for (const sink of sinks) {
    for (const stove of stoves) {
      const sinkCenter = footprintCenter(currentFootprintRect(sink));
      const stoveCenter = footprintCenter(currentFootprintRect(stove));
      const distMm = Math.hypot(sinkCenter.x - stoveCenter.x, sinkCenter.y - stoveCenter.y);

      if (distMm < MIN_SINK_HOB_MM) {
        findings.push({
          id: `sink-hob-close-${sink.id}-${stove.id}`,
          message: `Sink and hob are only ${Math.round(distMm)}mm apart — water splashing near an open flame. ${MIN_SINK_HOB_MM}mm is the usual minimum.`,
          itemIds: [sink.id, stove.id],
        });
      } else if (distMm > MAX_SINK_HOB_MM) {
        findings.push({
          id: `sink-hob-far-${sink.id}-${stove.id}`,
          message: `Sink and hob are ${Math.round(distMm)}mm apart — a long walk for the most common trip in the kitchen. Under ${MAX_SINK_HOB_MM}mm works better.`,
          itemIds: [sink.id, stove.id],
        });
      }
    }
  }

  return findings;
}

// ---- Hob under a window ----
//
// A window directly behind/above the hob is a real safety concern —
// curtains near an open flame, draft blowing the flame out. Checked
// only for a hob genuinely AGAINST a wall (a freestanding/island hob
// has no wall to be "under a window" of); matched against every
// WINDOW (not door/pass-through — those aren't behind a hob the same
// way) on that SAME wall whose along-wall span overlaps the hob's.
export function checkHobUnderWindow(
  layout: RoomLayout,
  appliances: PlacedApplianceItem[]
): KitchenCheckFinding[] {
  const { widthMm, depthMm } = layout.dimensions;
  const findings: KitchenCheckFinding[] = [];

  const stoves = appliances.filter((a) => a.applianceType === 'stove');

  for (const stove of stoves) {
    const rect = currentFootprintRect(stove);
    const wall = nearestWall(rect, widthMm, depthMm);
    if (!wall) continue;

    const hobStart = startAlongWall(wall, rect);
    const hobEnd = hobStart + extentAlongWall(wall, rect);
    const wallData = layout.walls.find((w) => w.orientation === wall);
    const windows = openingsForWall(wallData?.openings ?? [], wall).filter((o) => o.kind === 'window');

    for (const window of windows) {
      const windowStart = window.offsetMm;
      const windowEnd = window.offsetMm + window.widthMm;
      const overlaps = hobStart < windowEnd && hobEnd > windowStart;
      if (overlaps) {
        findings.push({
          id: `hob-under-window-${stove.id}-${window.id}`,
          message: `Hob sits under a window on the ${wall} wall — curtains near an open flame, and a draft can blow the flame out.`,
          itemIds: [stove.id, window.id],
        });
      }
    }
  }

  return findings;
}

// ---- Counter beside the hob ----
//
// Somewhere to land a hot pan, on at least one side. Checked only for
// a hob against a wall, against base-height cabinets ON THE SAME WALL
// — a cabinet on a different wall entirely isn't "beside" it no matter
// how close in plan coordinates the two happen to be.
//
// CORRECTED: this was 60mm, borrowed from WALL_CONTACT_TOLERANCE_MM's
// "is this touching the wall PLANE" reasoning in surfaceAreas.ts — the
// wrong precedent to borrow. That question is about a hard physical
// contact (a cabinet's side either touches the wall or it doesn't);
// this one is about whether a real landing counter reads as "right
// there" next to a hob, which tolerates the ordinary gaps a real
// installation has — a countertop scribe allowance, the hob's own
// bezel, a cabinet that isn't perfectly flush. 60mm flagged an actual
// base cabinet on both sides of a real hob as "no counter beside it"
// (caught by a real user, not a constructed scenario) simply because
// the gap was a few cm more than that.
const ADJACENT_GAP_TOLERANCE_MM = 150;

export function checkCounterBesideHob(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): KitchenCheckFinding[] {
  const { widthMm, depthMm } = layout.dimensions;
  const findings: KitchenCheckFinding[] = [];

  const stoves = appliances.filter((a) => a.applianceType === 'stove');

  for (const stove of stoves) {
    const rect = currentFootprintRect(stove);
    const wall = nearestWall(rect, widthMm, depthMm);
    if (!wall) continue;

    const hobStart = startAlongWall(wall, rect);
    const hobEnd = hobStart + extentAlongWall(wall, rect);

    const hasLandingSpace = cabinets.some((cabinet) => {
      if (!touchesFloor(cabinet.elevationMm)) return false;
      const cabRect = currentFootprintRect(cabinet);
      if (nearestWall(cabRect, widthMm, depthMm) !== wall) return false;
      const cabStart = startAlongWall(wall, cabRect);
      const cabEnd = cabStart + extentAlongWall(wall, cabRect);
      const adjacentOnLeft = Math.abs(cabEnd - hobStart) <= ADJACENT_GAP_TOLERANCE_MM;
      const adjacentOnRight = Math.abs(cabStart - hobEnd) <= ADJACENT_GAP_TOLERANCE_MM;
      return adjacentOnLeft || adjacentOnRight;
    });

    if (!hasLandingSpace) {
      findings.push({
        id: `no-landing-${stove.id}`,
        message: `No counter immediately beside the hob on the ${wall} wall — nowhere to set down a hot pan.`,
        itemIds: [stove.id],
      });
    }
  }

  return findings;
}

// ---- Chimney centred on the hob ----
//
// Compares footprint CENTRES directly in the floor plane rather than
// going through wall-alignment — a chimney is usually mounted well
// above counter height (defaultElevationMm ~1500mm in the starter
// appliance catalogue) but still placed at the same x/y as the hob
// it serves, so this doesn't need to know which wall either is
// against. Paired by nearest match rather than every stove against
// every chimney, so a kitchen with several hobs and chimneys doesn't
// get one finding per irrelevant cross-pairing.
const CHIMNEY_CENTRE_TOLERANCE_MM = 100;

export function checkChimneyCentredOnHob(appliances: PlacedApplianceItem[]): KitchenCheckFinding[] {
  const stoves = appliances.filter((a) => a.applianceType === 'stove');
  const chimneys = appliances.filter((a) => a.applianceType === 'chimney');
  if (chimneys.length === 0) return [];

  const findings: KitchenCheckFinding[] = [];

  for (const stove of stoves) {
    const stoveCenter = footprintCenter(currentFootprintRect(stove));

    let nearest: PlacedApplianceItem | null = null;
    let nearestDistMm = Infinity;
    for (const chimney of chimneys) {
      const chimneyCenter = footprintCenter(currentFootprintRect(chimney));
      const distMm = Math.hypot(chimneyCenter.x - stoveCenter.x, chimneyCenter.y - stoveCenter.y);
      if (distMm < nearestDistMm) {
        nearestDistMm = distMm;
        nearest = chimney;
      }
    }
    if (!nearest) continue;

    const chimneyCenter = footprintCenter(currentFootprintRect(nearest));
    const offsetMm = Math.hypot(chimneyCenter.x - stoveCenter.x, chimneyCenter.y - stoveCenter.y);
    if (offsetMm > CHIMNEY_CENTRE_TOLERANCE_MM) {
      findings.push({
        id: `chimney-offset-${stove.id}-${nearest.id}`,
        message: `Chimney is ${Math.round(offsetMm)}mm off-centre from its hob — extraction works best directly above it.`,
        itemIds: [stove.id, nearest.id],
      });
    }
  }

  return findings;
}

// ---- Fridge distances (the other two legs of the sink/hob/fridge
// work triangle, now that `fridge` exists as an ApplianceType) ----
//
// MAX only, no MIN, unlike checkSinkHobDistance: MIN_SINK_HOB_MM's
// reasoning is specifically about water splashing near an OPEN FLAME,
// which has no equivalent for a fridge. A fridge placed too close to
// the sink or hob is already caught by the existing overlap/clearance
// checks (a real physical conflict, not an ergonomics concern) — this
// file only adds what those don't already cover.
const MAX_SINK_FRIDGE_MM = 2700;
const MAX_HOB_FRIDGE_MM = 2700;

export function checkFridgeDistances(appliances: PlacedApplianceItem[]): KitchenCheckFinding[] {
  const sinks = appliances.filter((a) => a.applianceType === 'sink');
  const stoves = appliances.filter((a) => a.applianceType === 'stove');
  const fridges = appliances.filter((a) => a.applianceType === 'fridge');
  const findings: KitchenCheckFinding[] = [];

  for (const fridge of fridges) {
    const fridgeCenter = footprintCenter(currentFootprintRect(fridge));

    for (const sink of sinks) {
      const sinkCenter = footprintCenter(currentFootprintRect(sink));
      const distMm = Math.hypot(sinkCenter.x - fridgeCenter.x, sinkCenter.y - fridgeCenter.y);
      if (distMm > MAX_SINK_FRIDGE_MM) {
        findings.push({
          id: `sink-fridge-far-${sink.id}-${fridge.id}`,
          message: `Sink and fridge are ${Math.round(distMm)}mm apart — a long walk for a common trip. Under ${MAX_SINK_FRIDGE_MM}mm works better.`,
          itemIds: [sink.id, fridge.id],
        });
      }
    }

    for (const stove of stoves) {
      const stoveCenter = footprintCenter(currentFootprintRect(stove));
      const distMm = Math.hypot(stoveCenter.x - fridgeCenter.x, stoveCenter.y - fridgeCenter.y);
      if (distMm > MAX_HOB_FRIDGE_MM) {
        findings.push({
          id: `hob-fridge-far-${stove.id}-${fridge.id}`,
          message: `Hob and fridge are ${Math.round(distMm)}mm apart — a long walk for a common trip. Under ${MAX_HOB_FRIDGE_MM}mm works better.`,
          itemIds: [stove.id, fridge.id],
        });
      }
    }
  }

  return findings;
}

// One call for the UI — App.tsx renders a single banner off this
// rather than four separate ones, same reasoning CollisionWarningBanner
// merges cabinet+appliance collisions into one readout instead of two.
export function checkKitchenErgonomics(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): KitchenCheckFinding[] {
  return [
    ...checkAisleWidths(layout, cabinets),
    ...checkSinkHobDistance(appliances),
    ...checkFridgeDistances(appliances),
    ...checkHobUnderWindow(layout, appliances),
    ...checkCounterBesideHob(layout, cabinets, appliances),
    ...checkChimneyCentredOnHob(appliances),
  ];
}
