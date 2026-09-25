// src/lib/clearance.ts
//
// Clearance rules — things that don't physically overlap but still
// can't coexist. Distinct from lib/collision.ts, which answers "do
// these two solids intersect?"; this answers "can this kitchen
// actually be used?"
//
// The rule that matters most in this market: an in-swinging door
// sweeps floor no cabinet may occupy. In a 7x9 Delhi kitchen that arc
// is routinely the only place a cylinder trolley fits, and nothing in
// the collision system can catch it, because the door and the trolley
// never overlap — the door's SWING does. Discovering it on site means
// a rework, not a nudge.
//
// Kept separate from collision for a second reason: severity. A
// collision is an invalid layout. A clearance conflict is a real
// warning about a buildable-but-bad design, and the two shouldn't be
// rendered as the same red.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { RoomLayout } from '../types/layout';
import { OBSTACLE_SURFACE_BEHAVIOUR } from '../types/layout';
import type { WallOpening } from '../types/opening';
import { doorSwingZone, rectsOverlap } from './openings';
import type { RoomRect } from './openings';
import { currentFootprintRect } from './footprint';
import { applianceFootprint } from './applianceGeometry';

// A door swing only conflicts with something standing ON the floor. A
// wall cabinet at 1450mm is well above a door leaf's path... except a
// door is typically 2100mm tall, so a wall unit at 1450 IS in its way
// if it projects into the swing. Height is therefore checked, not
// assumed: an item conflicts if its vertical span overlaps the door
// leaf's.
function verticalOverlap(
  itemBottomMm: number,
  itemTopMm: number,
  opening: WallOpening
): boolean {
  const doorBottom = opening.sillMm;
  const doorTop = opening.sillMm + opening.heightMm;
  return itemBottomMm < doorTop && itemTopMm > doorBottom;
}

export interface ClearanceIssue {
  openingId: string;
  itemId: string;
  itemType: 'cabinet' | 'appliance' | 'obstacle';
  itemLabel: string;
  // What the swing is being measured against, for the message.
  swingReachMm: number;
}

// Which conflicts are UNFIXABLE by moving the item. A cabinet can be
// slid along the run; a structural pillar or a plumbing shaft cannot,
// so the only remedies are changing the door's swing or its position.
// Worth distinguishing because the two need different advice.
export function isStructural(issue: ClearanceIssue, layout: RoomLayout): boolean {
  if (issue.itemType !== 'obstacle') return false;
  const obstacle = layout.obstacles.find((o) => o.id === issue.itemId);
  return obstacle
    ? OBSTACLE_SURFACE_BEHAVIOUR[obstacle.type] === 'occupies'
    : false;
}

export interface ClearanceResult {
  issues: ClearanceIssue[];
  blockedCabinetIds: Set<string>;
  blockedApplianceIds: Set<string>;
  // Obstacles were missing from this check entirely, which was wrong in
  // both directions. A structural PILLAR in a door's swing is the worst
  // case of all — it can't be moved, so the door simply won't open and
  // the design is unbuildable. And a wall-mounted pipe or electrical
  // panel beside a door fouls the leaf just as surely as a cabinet
  // does, while being far easier to overlook on a plan.
  blockedObstacleIds: Set<string>;
  // Zones to draw on the 2D plan, whether or not anything conflicts —
  // seeing the arc BEFORE placing a cabinet is worth more than being
  // told afterwards.
  swingZones: { openingId: string; zone: RoomRect }[];
}

export function detectClearanceIssues(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[]
): ClearanceResult {
  const { widthMm, depthMm } = layout.dimensions;
  const issues: ClearanceIssue[] = [];
  const blockedCabinetIds = new Set<string>();
  const blockedApplianceIds = new Set<string>();
  const blockedObstacleIds = new Set<string>();
  const swingZones: { openingId: string; zone: RoomRect }[] = [];

  const openings = layout.walls.flatMap((w) => w.openings ?? []);

  for (const opening of openings) {
    const zone = doorSwingZone(opening, widthMm, depthMm);
    // Null for windows, pass-throughs, out-swinging and sliding doors,
    // and bare doorways — none of which sweep the kitchen floor. That
    // asymmetry is the point of modelling swing at all.
    if (!zone) continue;
    swingZones.push({ openingId: opening.id, zone });

    for (const cabinet of cabinets) {
      const rect = currentFootprintRect(cabinet);
      if (!rectsOverlap(zone, { ...rect, depthMm: rect.depthMm })) continue;
      if (
        !verticalOverlap(
          cabinet.elevationMm,
          cabinet.elevationMm + cabinet.heightMm,
          opening
        )
      ) {
        continue;
      }
      blockedCabinetIds.add(cabinet.id);
      issues.push({
        openingId: opening.id,
        itemId: cabinet.id,
        itemType: 'cabinet',
        itemLabel: cabinet.moduleType,
        swingReachMm: opening.widthMm,
      });
    }

    for (const appliance of appliances) {
      const rect = applianceFootprint(appliance);
      if (!rectsOverlap(zone, { ...rect, depthMm: rect.depthMm })) continue;
      if (
        !verticalOverlap(
          appliance.elevationMm,
          appliance.elevationMm + appliance.heightMm,
          opening
        )
      ) {
        continue;
      }
      blockedApplianceIds.add(appliance.id);
      issues.push({
        openingId: opening.id,
        itemId: appliance.id,
        itemType: 'appliance',
        itemLabel: appliance.applianceType,
        swingReachMm: opening.widthMm,
      });
    }

    for (const obstacle of layout.obstacles) {
      const rect = currentFootprintRect(obstacle);
      if (!rectsOverlap(zone, rect)) continue;

      // Obstacles carry their own vertical convention: a floor-to-
      // ceiling pillar blocks every height, so it always overlaps the
      // door leaf; a partial one (a knee-height duct, a mid-wall
      // electrical point) spans elevationMm upward and has to be
      // checked. Same rule getObstacleBounds uses in lib/collision.ts —
      // read from the same two fields rather than re-derived, so the
      // two can't disagree about how tall a pillar is.
      const bottomMm = obstacle.floorToCeiling ? 0 : obstacle.elevationMm;
      const topMm = obstacle.floorToCeiling
        ? Number.POSITIVE_INFINITY
        : obstacle.elevationMm + obstacle.heightMm;
      if (!verticalOverlap(bottomMm, topMm, opening)) continue;

      blockedObstacleIds.add(obstacle.id);
      issues.push({
        openingId: opening.id,
        itemId: obstacle.id,
        itemType: 'obstacle',
        itemLabel: obstacle.type,
        swingReachMm: opening.widthMm,
      });
    }
  }

  return { issues, blockedCabinetIds, blockedApplianceIds, blockedObstacleIds, swingZones };
}
