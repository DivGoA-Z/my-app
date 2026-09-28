// src/lib/cabinetClearance.ts
//
// "At the L point, a cabinet facing one wall should have a check
// mechanism to see if another wall's cabinet is placed so close their
// doors/drawers are in each other's way" — the cabinet-vs-cabinet
// counterpart to lib/clearance.ts's door-vs-item check. Same category
// of problem (a real warning about a buildable-but-bad design, not an
// invalid layout — see that file's own header comment). Deliberately
// NOT folded into lib/clearance.ts — that file's ClearanceIssue is
// keyed on a WallOpening; this conflict has no opening involved at
// all, just two cabinets.
//
// GEOMETRY: a swinging door's true reach is the exact quarter-circle
// it sweeps, approximated as an N-sided polygon fan (sectorPolygon
// below) and tested with the same Separating-Axis-Theorem overlap test
// used for a pull-out's rectangle — the SAME test either way, since a
// rectangle is just a 4-point convex polygon. This REPLACED an earlier
// version that used a conservative bounding BOX around each arc
// instead of the arc itself (matching lib/openings.ts's doorSwingZone
// for a room door) — cheaper, but it meant the check could correctly
// flag a real conflict while the on-screen arc (CabinetLayer.tsx,
// drawn from the true shape from the start) visibly didn't touch the
// other cabinet, which read as a false positive even when it wasn't.
// Found from a real report, not a hypothetical: a base-cabinet (3
// drawers) and a corner-carousel 150mm apart, correctly flagged by the
// box test, with no visible overlap in the arc. Fixed by making
// DETECTION use the exact same shape the RENDERING already draws —
// one calculation, not two independently-computed approximations of
// the same physical fact (this app's central pricing principle,
// applied here to geometry instead of money).
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
import type { FootprintRect } from './footprint';
import { touchesFloor } from './surfaceAreas';
import type { RoomRect } from './openings';

// How far a front kind reaches into the room when operated. A hinged
// leaf sweeps a quarter-circle of radius roughly its own width; a
// double door's two leaves each sweep half that. A drawer or trolley
// basket pulls straight out on full-extension runners, roughly its own
// depth — a materially longer reach than a door, which is physically
// correct. Everything else (a false front, a tambour, an open shelf,
// an appliance housing) never encroaches on the room at all.
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

export interface ReachRow {
  kind: FrontRowKind;
  hinge: 'left' | 'right';
  reachMm: number;
}

// A 'mixed' front's rows can sit at different heights in reality, but
// treating them separately would need the same height-banded modelling
// clearance.ts uses for a tall room door (see verticalOverlap there) —
// not worth it for a cabinet, where every row lives inside the same
// roughly-720-860mm base-cabinet band anyway. Simplified to "the
// biggest reach any row has governs the whole cabinet" — unchanged
// from before; what changed is that the WINNING row's kind/hinge is
// now tracked too (not just its mm value), so reachPolygons below can
// build that row's true shape instead of a generic box. Both
// cabinetReachMm (the exported mm value CabinetLayer.tsx still sizes
// its pull-out rectangle with) and reachPolygons read this same
// function, so the two can't disagree about which row is the biggest.
// Exported so CabinetLayer.tsx's rendering can ask the SAME question
// detection asks — "which row governs this cabinet's reach, and is it
// a swinging door" — rather than a second, independently-maintained
// guess. This is specifically what lets a 'mixed' front's door row get
// a real arc now instead of always falling back to the plain
// rectangle a pull-out is honestly shaped like.
export function winningReachRow(item: PlacedCabinetItem, layout: FrontLayout): ReachRow | null {
  const candidates: { kind: FrontRowKind; hinge?: 'left' | 'right' }[] =
    layout.kind === 'mixed'
      ? (layout.rows ?? []).map((row) => ({ kind: row.kind, hinge: row.hinge }))
      : [{ kind: layout.kind, hinge: layout.hinge }];

  let best: ReachRow | null = null;
  for (const c of candidates) {
    const reachMm = reachMmForRow(item, c.kind);
    if (reachMm > 0 && (!best || reachMm > best.reachMm)) {
      best = { kind: c.kind, hinge: c.hinge ?? 'left', reachMm };
    }
  }
  return best;
}

export function cabinetReachMm(item: PlacedCabinetItem, layout: FrontLayout): number {
  // A carousel's door is diagonal — sized here the same way a single
  // door is (its own widthMm) — but the DIRECTION and true SHAPE that
  // reach applies in is handled separately, by carouselDoorArc below,
  // since a carousel's swing isn't one of the four straight-edge cases
  // every other cabinet uses.
  if (item.moduleType === 'corner-carousel') return item.widthMm;

  return winningReachRow(item, layout)?.reachMm ?? 0;
}

export interface Point {
  x: number;
  y: number;
}

export interface CarouselDoorArc {
  pivotXMm: number;
  pivotYMm: number;
  radiusMm: number;
  // Konva Arc's own `rotation` prop value (a start-angle convention
  // specific to that primitive) — kept only because CabinetLayer.tsx's
  // rendering still uses it to draw the Arc; reachPolygons below does
  // NOT use this field, it builds its polygon straight from
  // pivot/closedEnd/leafEnd instead.
  rotationDeg: number;
  leafEndXMm: number;
  leafEndYMm: number;
  // The CLOSED-leaf endpoint, along the diagonal edge itself (p4 in
  // the derivation below) — added so reachPolygons can build the true
  // swept sector from the exact same pivot/edge this function already
  // computes for rendering, rather than a second, independently
  // re-derived approximation of the same physical door.
  closedEndXMm: number;
  closedEndYMm: number;
}

// Same value as Room3DCanvas.tsx's constant of the same name — the
// carousel's diagonal cut, as a fraction of its own footprint
// width/depth. Duplicated rather than imported (a lib file has no
// reason to depend on a canvas component), same "re-derived, kept in
// sync by comment" approach already used for cornerCutSign. If the cut
// proportion ever changes, both need updating together.
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

// ROOM-SPACE carousel door geometry. Relocated here from
// CabinetLayer.tsx (which now imports it) rather than duplicated —
// both the on-screen arc AND the clearance check need the exact same
// pivot/edge, and two independently-maintained copies of this math is
// exactly the kind of drift this app's pricing principle (one
// calculation feeds both the drawing and the check) exists to rule
// out. Pivots at the diagonal edge's own corner nearest (Xcut, Yother)
// and sweeps 90° to the outward normal, radius = the diagonal edge's
// own length. Verified numerically across all four rotations (see the
// bug history in docs/DECISIONS.md) rather than assumed.
export function carouselDoorArc(
  footprint: { x: number; y: number; widthMm: number; depthMm: number },
  rotationDeg: number
): CarouselDoorArc {
  const { signX, signY } = cornerCutSign(rotationDeg);
  const cutW = footprint.widthMm * CORNER_CAROUSEL_CUT_FRACTION;
  const cutD = footprint.depthMm * CORNER_CAROUSEL_CUT_FRACTION;
  const edgeLenMm = Math.hypot(cutW, cutD);

  const xCut = signX > 0 ? footprint.x + footprint.widthMm : footprint.x;
  const yCut = signY > 0 ? footprint.y + footprint.depthMm : footprint.y;
  const p3 = { x: xCut, y: yCut - signY * cutD };
  const p4 = { x: xCut - signX * cutW, y: yCut };

  const edgeAngleDeg = (Math.atan2(p4.y - p3.y, p4.x - p3.x) * 180) / Math.PI;
  const nx = (signX * cutD) / edgeLenMm;
  const ny = (signY * cutW) / edgeLenMm;
  const normalAngleDeg = (Math.atan2(ny, nx) * 180) / Math.PI;

  const rotationDeg2 = signX * signY > 0 ? normalAngleDeg : edgeAngleDeg;

  return {
    pivotXMm: p3.x,
    pivotYMm: p3.y,
    radiusMm: edgeLenMm,
    rotationDeg: rotationDeg2,
    leafEndXMm: p3.x + nx * edgeLenMm,
    leafEndYMm: p3.y + ny * edgeLenMm,
    closedEndXMm: p4.x,
    closedEndYMm: p4.y,
  };
}

// Clockwise rotation by `deg`, matching this app's own convention
// (CLAUDE.md: "Konva rotation is clockwise"). Verified against the
// already-shipped, already-correct per-rotation directions this file
// used to hardcode as four separate switch cases: rotating the local
// "front-facing" unit vector (0,1) by 0/90/180/270 here reproduces
// exactly +Y/-X/-Y/+X (south/west/north/east) for all four — the same
// four results those cases returned, just derived from one formula
// instead of read off by hand per case.
function rotateCW(v: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function angleOf(v: Point): number {
  return Math.atan2(v.y, v.x);
}

// To (-PI, PI].
function normalizeAngle(a: number): number {
  let r = a;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// A door's true swept shape — a quarter-circle sector — approximated
// as a fan of SECTOR_SEGMENTS triangles from the pivot. 8 segments is
// visually indistinguishable from a true arc at kitchen-plan scale;
// this polygon is only ever used for the overlap test below, never
// rendered directly (CabinetLayer draws its own arc primitive from the
// same pivot/closedDir/openDir this is built from), so it only needs
// to be accurate enough for that, not pixel-perfect.
const SECTOR_SEGMENTS = 8;

function sectorPolygon(pivot: Point, closedDir: Point, openDir: Point, radiusMm: number): Point[] {
  const a0 = angleOf(closedDir);
  const delta = normalizeAngle(angleOf(openDir) - a0);
  const points: Point[] = [pivot];
  for (let i = 0; i <= SECTOR_SEGMENTS; i++) {
    const a = a0 + (delta * i) / SECTOR_SEGMENTS;
    points.push({ x: pivot.x + radiusMm * Math.cos(a), y: pivot.y + radiusMm * Math.sin(a) });
  }
  return points;
}

function rectPolygon(rect: RoomRect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.widthMm, y: rect.y },
    { x: rect.x + rect.widthMm, y: rect.y + rect.depthMm },
    { x: rect.x, y: rect.y + rect.depthMm },
  ];
}

// A straight pull-out's true shape — already a rectangle, unchanged
// from the box this app has always used for drawers/trolley, since a
// basket really does travel in a straight line. Spans the cabinet's
// full front-edge width, same as before.
function pullOutRect(footprint: FootprintRect, reachMm: number, rotationDeg: 0 | 90 | 180 | 270): RoomRect {
  switch (rotationDeg) {
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

// One door leaf's true sector, in room space. `center` is the
// cabinet's rotation-invariant centre (CLAUDE.md: "an item's x/y is
// always the UNROTATED top-left corner; the centre is the
// rotation-invariant quantity") — computed from the ORIGINAL
// item.widthMm/depthMm, not the footprint's post-rotation swapped
// ones, which is what makes this correct at every rotation without a
// separate case per angle. hinge='left' means the pivot sits at the
// LEFT end of the front edge as drawn before any rotation (matching
// FrontLayout.hinge's own meaning) — rotateCW then carries that
// through to wherever "left" actually ends up in room space.
function doorSectorPolygon(item: PlacedCabinetItem, hinge: 'left' | 'right', radiusMm: number): Point[] {
  const center: Point = { x: item.x + item.widthMm / 2, y: item.y + item.depthMm / 2 };
  const hingedLeft = hinge !== 'right';
  const localPivot: Point = hingedLeft
    ? { x: -item.widthMm / 2, y: item.depthMm / 2 }
    : { x: item.widthMm / 2, y: item.depthMm / 2 };
  const localClosedDir: Point = hingedLeft ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const localOpenDir: Point = { x: 0, y: 1 }; // both leaves always open toward local +Y (into the room)

  const pivotOffset = rotateCW(localPivot, item.rotationDeg);
  const pivot: Point = { x: center.x + pivotOffset.x, y: center.y + pivotOffset.y };
  const closedDir = rotateCW(localClosedDir, item.rotationDeg);
  const openDir = rotateCW(localOpenDir, item.rotationDeg);

  return sectorPolygon(pivot, closedDir, openDir, radiusMm);
}

// The true swept shape(s) of a cabinet's door/drawer reach — 0, 1 or 2
// convex polygons (a double-door is two independent leaves, each its
// own sector). This is what detectCabinetReachConflicts tests for
// overlap, replacing the conservative bounding-box version this
// function used to return.
function reachPolygons(item: PlacedCabinetItem, layout: FrontLayout): Point[][] {
  if (item.moduleType === 'corner-carousel') {
    const footprint = currentFootprintRect(item);
    const arc = carouselDoorArc(footprint, item.rotationDeg);
    const pivot: Point = { x: arc.pivotXMm, y: arc.pivotYMm };
    const closedDir: Point = { x: arc.closedEndXMm - pivot.x, y: arc.closedEndYMm - pivot.y };
    const openDir: Point = { x: arc.leafEndXMm - pivot.x, y: arc.leafEndYMm - pivot.y };
    return [sectorPolygon(pivot, closedDir, openDir, arc.radiusMm)];
  }

  const row = winningReachRow(item, layout);
  if (!row) return [];

  switch (row.kind) {
    case 'single-door':
      return [doorSectorPolygon(item, row.hinge, row.reachMm)];
    case 'double-door':
      // row.reachMm is already widthMm/2 (reachMmForRow) — both leaves
      // share that same radius, one hinged at each end.
      return [
        doorSectorPolygon(item, 'left', row.reachMm),
        doorSectorPolygon(item, 'right', row.reachMm),
      ];
    case 'drawers':
    case 'trolley':
      return [rectPolygon(pullOutRect(currentFootprintRect(item), row.reachMm, item.rotationDeg))];
    default:
      return [];
  }
}

// Separating Axis Theorem — exact for any two CONVEX polygons, not
// just axis-aligned rectangles, which is what makes a many-sided
// sector fan usable here instead of only its bounding box. A rectangle
// is just a 4-point convex polygon, so rectPolygon's output and a
// sector's output are tested identically.
const OVERLAP_EPSILON_MM = 0.5; // same reasoning as collision.ts's boxesOverlap epsilon — a committed position has been through an mm->px->mm round trip and can carry ~1e-13mm of float noise.

function projectOntoAxis(points: Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const proj = p.x * axis.x + p.y * axis.y;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return [min, max];
}

function hasSeparatingAxis(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    const axis: Point = { x: -(p2.y - p1.y), y: p2.x - p1.x };
    const [aMin, aMax] = projectOntoAxis(a, axis);
    const [bMin, bMax] = projectOntoAxis(b, axis);
    // Lenient, not strict: two shapes merely TOUCHING (or overlapping
    // by less than the float-noise floor) must still count as
    // separated here — this was backwards in the first version of this
    // rewrite (required MORE than epsilon of real gap to count as
    // separated), which flagged every ordinary adjacent cabinet run as
    // conflicting, since two doors correctly meeting edge-to-edge with
    // zero true overlap were treated as overlapping. <= (not <) with
    // the epsilon on the permissive side is the fix.
    if (aMax <= bMin + OVERLAP_EPSILON_MM || bMax <= aMin + OVERLAP_EPSILON_MM) return true;
  }
  return false;
}

function polygonsOverlap(a: Point[], b: Point[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
}

function polygonEscapedWalls(points: Point[], roomWidthMm: number, roomDepthMm: number): string[] {
  const walls = new Set<string>();
  for (const p of points) {
    if (p.x < -OVERLAP_EPSILON_MM) walls.add('west');
    if (p.y < -OVERLAP_EPSILON_MM) walls.add('north');
    if (p.x > roomWidthMm + OVERLAP_EPSILON_MM) walls.add('east');
    if (p.y > roomDepthMm + OVERLAP_EPSILON_MM) walls.add('south');
  }
  return [...walls];
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

// Three ways two cabinets can be in each other's way, all checked:
//   - A's door/drawer swings into B's own box (a very tight corner —
//     B is close enough that A can't open at all).
//   - B's swings into A's box (the mirror case).
//   - Neither box is hit, but the two swing/pull-out paths cross each
//     other in the open floor between them — the classic L-corner
//     case, where two doors on perpendicular walls fight for the same
//     patch of floor without either cabinet touching the other.
// PLUS a fourth, against the room itself: a reach shape that extends
// past [0, roomWidthMm] x [0, roomDepthMm] is a door that would open
// into a wall — physically impossible, and previously undetected since
// nothing here compared a cabinet against the room boundary, only
// against other cabinets.
//
// Every test below is the TRUE shape (reachPolygons) via
// polygonsOverlap, not a bounding box — see this file's own header
// comment for why that distinction is the whole point of this pass.
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
        footprintPoly: rectPolygon(currentFootprintRect(item)),
        shapes: reachPolygons(item, layout),
      };
    });

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.item.ignoreClearance || b.item.ignoreClearance) continue;

      const conflict =
        a.shapes.some((shape) => polygonsOverlap(shape, b.footprintPoly)) ||
        b.shapes.some((shape) => polygonsOverlap(shape, a.footprintPoly)) ||
        a.shapes.some((sa) => b.shapes.some((sb) => polygonsOverlap(sa, sb)));

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
    if (entry.item.ignoreClearance || entry.shapes.length === 0) continue;
    // Named per edge rather than just a boolean, so the message can say
    // WHICH wall — the same room can have this happen on more than one
    // cabinet, on different walls, and "would open into a wall" alone
    // makes that impossible to tell apart at a glance.
    const crossedWalls = new Set<string>();
    for (const shape of entry.shapes) {
      for (const wall of polygonEscapedWalls(shape, roomWidthMm, roomDepthMm)) {
        crossedWalls.add(wall);
      }
    }

    if (crossedWalls.size > 0) {
      issues.push({
        cabinetId: entry.item.id,
        withId: 'wall',
        message: `This ${entry.item.moduleType}'s door/drawer would open into the ${[...crossedWalls].join('/')} wall.`,
      });
      blockedCabinetIds.add(entry.item.id);
    }
  }

  return { issues, blockedCabinetIds };
}
