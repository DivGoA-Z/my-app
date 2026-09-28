// src/lib/cabinetClearance.ts
//
// "At the L point, a cabinet facing one wall should have a check
// mechanism to see if another wall's cabinet is placed so close their
// doors/drawers are in each other's way" — the cabinet-vs-cabinet
// counterpart to lib/clearance.ts's door-vs-item check. Same category
// of problem (a real warning about a buildable-but-bad design, not an
// invalid layout — see that file's own header comment), same
// conservative shape: a door's swing or a drawer's pull-out is
// approximated as a plain rectangle extending from the cabinet's front
// face into the room, exactly the simplification doorSwingZone already
// uses for room doors. Deliberately NOT folded into lib/clearance.ts —
// that file's ClearanceIssue is keyed on a WallOpening; this conflict
// has no opening involved at all, just two cabinets.
//
// Scoped to cabinet-vs-cabinet, PLUS the room's own walls (added
// after a real report: a cabinet whose door/drawer reach zone pokes
// past the room boundary — physically, a door that would open into a
// wall — produced no warning at all, since every check here used to
// compare cabinets against each other only). Extending this to
// obstacles/appliances would follow the same pattern if it's ever
// asked for, but isn't built speculatively here.
//
// FLOOR-TOUCHING CABINETS ONLY. First shipped without this filter and
// immediately lit up on a corner where every cabinet involved was
// wall-mounted (~1450mm up) — two ordinary wall-cabinet runs meeting
// at a corner, each with a reach zone roughly as wide as the cabinet
// itself, which is plenty to cross at that height with nothing
// actually wrong. A wall cabinet's door swings at head height; it
// doesn't block the floor-level walking/reaching space this check
// exists to protect, and the app already draws exactly this
// distinction elsewhere (touchesFloor, lib/surfaceAreas.ts, used for
// the floor-vs-wall remaining-space gap bands). Same reasoning applies
// here: a wall cabinet is simply out of scope, not a false positive to
// tolerate.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { FrontLayout, FrontRowKind } from '../types/front';
import { defaultFrontLayout } from '../types/front';
import { currentFootprintRect } from './footprint';
import { touchesFloor } from './surfaceAreas';
import type { RoomRect } from './openings';
import { rectsOverlap } from './openings';

// How far a front kind reaches into the room when operated — the same
// "treat it as a simple box, never narrower than the real arc" call
// doorSwingZone already makes for a hinged door. A hinged leaf sweeps
// a quarter-circle of radius roughly its own width; a double door's
// two leaves each sweep half that. A drawer or trolley basket pulls
// straight out on full-extension runners, roughly its own depth — a
// materially longer reach than a door, which is physically correct.
// Everything else (a false front, a tambour, an open shelf, an
// appliance housing) never encroaches on the room at all.
function reachMmForRow(item: PlacedCabinetItem, kind: FrontRowKind): number {
  switch (kind) {
    case 'single-door':
      return item.widthMm;
    case 'double-door':
      return item.widthMm / 2;
    case 'drawers':
    case 'trolley':
      return item.depthMm;
    case 'false-front':
    case 'appliance-housing':
    case 'open-shelf':
    case 'tambour':
      return 0;
  }
}

// A 'mixed' front's rows can sit at different heights in reality, but
// treating them separately would need the same height-banded modelling
// clearance.ts uses for a tall room door (see verticalOverlap there) —
// not worth it for a cabinet, where every row lives inside the same
// roughly-720-860mm base-cabinet band anyway. Simplified to "the
// biggest reach any row has," applied to the whole cabinet.
export function cabinetReachMm(item: PlacedCabinetItem, layout: FrontLayout): number {
  // A carousel's door is diagonal — sized here the same conservative
  // way a single door is (its own widthMm) — but the DIRECTION that
  // reach applies in is handled separately in cabinetReachZone below,
  // since a carousel's zone isn't one of the four straight-edge cases
  // every other cabinet uses.
  if (item.moduleType === 'corner-carousel') return item.widthMm;

  if (layout.kind === 'mixed') {
    return (layout.rows ?? []).reduce((max, row) => Math.max(max, reachMmForRow(item, row.kind)), 0);
  }
  return reachMmForRow(item, layout.kind);
}

// Same value as CabinetLayer.tsx's CORNER_CAROUSEL_CUT_FRACTION and
// Room3DCanvas.tsx's constant of the same name — the carousel's
// diagonal cut, as a fraction of its own footprint width/depth.
// Duplicated rather than imported (a lib file has no reason to depend
// on either canvas file, and those two can't import each other
// either), same "re-derived, kept in sync by comment" approach this
// file already uses for cornerCutSign and the front-direction switch
// below. If the cut proportion ever changes, all three need updating
// together.
const CORNER_CAROUSEL_CUT_FRACTION = 0.4;

// Which corner of a cabinet's room-space footprint its diagonal cut
// lands on, for a given rotationDeg — mirrors cornerCutSign in
// Room3DCanvas.tsx exactly (that file derives it for the countertop's
// own pentagon; re-derived here rather than imported, since a lib file
// has no reason to depend on a canvas component). See that function's
// comment for the algebra: the cut corner cycles bottom-right →
// bottom-left → top-left → top-right as rotationDeg goes 0→90→180→270.
export function cornerCutSign(rotationDeg: number): { signX: 1 | -1; signY: 1 | -1 } {
  switch (rotationDeg) {
    case 0:
      return { signX: 1, signY: 1 };
    case 90:
      return { signX: -1, signY: 1 };
    case 180:
      return { signX: -1, signY: -1 };
    case 270:
    default:
      return { signX: 1, signY: -1 };
  }
}

// Which way a cabinet's front actually faces, in room-space, follows
// rotationDeg exactly the way Room3DCanvas.tsx's faceZ does (local +Z
// = front, rotated by clockwiseDegToThreeY) — re-derived here in plain
// 2D terms rather than imported, since this file has no reason to pull
// in three.js: rotation 0 faces +Y (south), 90 faces -X (west), 180
// faces -Y (north), 270 faces +X (east).
export function cabinetReachZone(item: PlacedCabinetItem, layout: FrontLayout): RoomRect | null {
  const footprint = currentFootprintRect(item);

  // A carousel's door swings diagonally out of the corner it sits in
  // — not across any of the four straight edges the switch below
  // projects from. First shipped by exempting it entirely (reachMm=0),
  // which stopped the wrong-side zone but also stopped catching real
  // conflicts on the diagonal side, including a cabinet deliberately
  // placed in that path.
  //
  // Second attempt anchored the zone at (footprint.x + footprint.
  // widthMm, footprint.y + footprint.depthMm) — cornerCutSign's own
  // name says what that point actually is: the CUT corner, the
  // square's own vertex that the diagonal trims AWAY. It was never
  // part of the cabinet's visible shape, and the diagonal edge sits
  // inset from it by (widthMm, depthMm) x CORNER_CAROUSEL_CUT_FRACTION
  // — up to a few hundred mm for a real cabinet. Anchoring there left
  // the zone floating in open floor with a visible gap back to the
  // actual door edge, which is exactly the "appears in the middle of
  // free space" report.
  //
  // Anchored at the diagonal edge's own MIDPOINT instead — inset from
  // the cut corner by half of each cut dimension, same
  // CORNER_CAROUSEL_CUT_FRACTION cornerCarouselPoints/
  // cornerCarouselGeometry use, so it stays in sync with the shape
  // actually drawn — the zone now starts right where the visible door
  // is and extends outward from there, in the same two directions
  // (signX, signY) the cut opens toward. RoomRect/rectsOverlap can
  // only test axis-aligned rectangles, so the true swept quarter-circle
  // still isn't representable exactly — the square is a deliberately
  // conservative stand-in, same trade-off doorSwingZone already makes
  // for a real door.
  if (item.moduleType === 'corner-carousel') {
    const reachMm = cabinetReachMm(item, layout);
    const { signX, signY } = cornerCutSign(item.rotationDeg);
    const cutWMm = footprint.widthMm * CORNER_CAROUSEL_CUT_FRACTION;
    const cutDMm = footprint.depthMm * CORNER_CAROUSEL_CUT_FRACTION;
    const cutCornerX = signX > 0 ? footprint.x + footprint.widthMm : footprint.x;
    const cutCornerY = signY > 0 ? footprint.y + footprint.depthMm : footprint.y;
    const midX = cutCornerX - signX * (cutWMm / 2);
    const midY = cutCornerY - signY * (cutDMm / 2);
    return {
      x: signX > 0 ? midX : midX - reachMm,
      y: signY > 0 ? midY : midY - reachMm,
      widthMm: reachMm,
      depthMm: reachMm,
    };
  }

  const reachMm = cabinetReachMm(item, layout);
  if (reachMm <= 0) return null;

  switch (item.rotationDeg) {
    case 0:
      return { x: footprint.x, y: footprint.y + footprint.depthMm, widthMm: footprint.widthMm, depthMm: reachMm };
    case 180:
      return { x: footprint.x, y: footprint.y - reachMm, widthMm: footprint.widthMm, depthMm: reachMm };
    case 90:
      return { x: footprint.x - reachMm, y: footprint.y, widthMm: reachMm, depthMm: footprint.depthMm };
    case 270:
      return { x: footprint.x + footprint.widthMm, y: footprint.y, widthMm: reachMm, depthMm: footprint.depthMm };
  }
}

export interface CabinetReachIssue {
  cabinetId: string;
  // A real cabinet's id for a cabinet-vs-cabinet conflict, or the
  // literal string 'wall' for a reach zone that pokes past the room
  // boundary.
  withId: string;
  // Human explanation, for useDesignAlerts — computed here rather than
  // by the consuming hook, since only this function knows which of the
  // three cabinet-vs-cabinet cases fired or which room edge a wall
  // conflict crossed.
  message: string;
}

export interface CabinetReachResult {
  issues: CabinetReachIssue[];
  blockedCabinetIds: Set<string>;
}

// Float noise tolerance, same reasoning as collision.ts's own 0.5mm
// epsilon on boxesOverlap: a committed position has already been
// through an mm→px→mm round trip (canvasScale's scale is essentially
// never a round number), so a reach zone landing EXACTLY on the wall
// plane shouldn't flip this on 1e-13mm of rounding noise.
const WALL_ESCAPE_TOLERANCE_MM = 0.5;

// Three ways two cabinets can be in each other's way, all checked:
//   - A's door/drawer swings into B's own box (a very tight corner —
//     B is close enough that A can't open at all).
//   - B's swings into A's box (the mirror case).
//   - Neither box is hit, but the two swing/pull-out paths cross each
//     other in the open floor between them — the classic L-corner
//     case, where two doors on perpendicular walls fight for the same
//     patch of floor without either cabinet touching the other.
// PLUS a fourth, against the room itself: a reach zone that extends
// past [0, roomWidthMm] x [0, roomDepthMm] is a door that would open
// into a wall — physically impossible, and previously undetected since
// nothing here compared a cabinet against the room boundary, only
// against other cabinets.
export function detectCabinetReachConflicts(
  cabinets: PlacedCabinetItem[],
  roomWidthMm: number,
  roomDepthMm: number
): CabinetReachResult {
  const issues: CabinetReachIssue[] = [];
  const blockedCabinetIds = new Set<string>();

  const entries = cabinets
    .filter((item) => touchesFloor(item.elevationMm))
    .map((item) => {
      const layout = item.frontLayout ?? defaultFrontLayout(item.moduleType, item.widthMm);
      return {
        item,
        footprint: currentFootprintRect(item),
        zone: cabinetReachZone(item, layout),
      };
    });

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.item.ignoreClearance || b.item.ignoreClearance) continue;

      const conflict =
        (a.zone !== null && rectsOverlap(a.zone, b.footprint)) ||
        (b.zone !== null && rectsOverlap(b.zone, a.footprint)) ||
        (a.zone !== null && b.zone !== null && rectsOverlap(a.zone, b.zone));

      if (conflict) {
        issues.push({
          cabinetId: a.item.id,
          withId: b.item.id,
          message: `This ${a.item.moduleType}'s door/drawer swings into the ${b.item.moduleType} next to it.`,
        });
        blockedCabinetIds.add(a.item.id);
        blockedCabinetIds.add(b.item.id);
      }
    }
  }

  for (const entry of entries) {
    if (entry.item.ignoreClearance || !entry.zone) continue;
    const { x, y, widthMm, depthMm } = entry.zone;
    // Named per edge rather than just a boolean, so the message can say
    // WHICH wall — the same room can have this happen on more than one
    // cabinet, on different walls, and "would open into a wall" alone
    // makes that impossible to tell apart at a glance.
    const crossedWalls: string[] = [];
    if (x < -WALL_ESCAPE_TOLERANCE_MM) crossedWalls.push('west');
    if (y < -WALL_ESCAPE_TOLERANCE_MM) crossedWalls.push('north');
    if (x + widthMm > roomWidthMm + WALL_ESCAPE_TOLERANCE_MM) crossedWalls.push('east');
    if (y + depthMm > roomDepthMm + WALL_ESCAPE_TOLERANCE_MM) crossedWalls.push('south');

    if (crossedWalls.length > 0) {
      issues.push({
        cabinetId: entry.item.id,
        withId: 'wall',
        message: `This ${entry.item.moduleType}'s door/drawer would open into the ${crossedWalls.join('/')} wall.`,
      });
      blockedCabinetIds.add(entry.item.id);
    }
  }

  return { issues, blockedCabinetIds };
}
