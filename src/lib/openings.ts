// src/lib/openings.ts
//
// Geometry for wall openings. Three jobs:
//
//   1. SUBTRACTION — decompose a wall into the rectangles that are
//      still wall, once its openings are removed. This is what lets a
//      wall have a real hole in it: a single plane can't have one, but
//      four or five rectangles arranged around an aperture can.
//   2. AREA — how much wall each opening removes, for the VOID
//      category in lib/surfaceAreas.ts.
//   3. CLEARANCE — the floor an in-swinging door sweeps, which no
//      cabinet may occupy.
//
// COORDINATES. Two frames, and keeping them straight is most of the
// work here:
//
//   WALL frame — `alongMm` from the wall's start, `bottomMm` off the
//     floor. This is a wall elevation, the way the trade draws one.
//   ROOM frame — the same x/y millimetre grid cabinets live in.
//
// `openingToRoomRect` is the only bridge between them, so the mapping
// from "600mm along the north wall" to "x=600, y=0" exists in exactly
// one place.

import type { WallOrientation } from '../types/layout';
import type { WallOpening } from '../types/opening';
import { swingBlocksFloor } from '../types/opening';

// ---- Wall-frame subtraction ----

export interface WallRect {
  // Left edge, measured along the wall from its start.
  alongMm: number;
  // Bottom edge, off the floor.
  bottomMm: number;
  widthMm: number;
  heightMm: number;
}

// Anything narrower or shorter than this is dropped rather than
// emitted. Sub-millimetre slivers come out of a door that reaches
// exactly to the ceiling or butts exactly against a neighbour, and
// they're invisible geometry that still costs a draw call and can
// z-fight.
const MIN_SEGMENT_MM = 1;

// An opening clipped to the wall it's on, as a rectangle in the wall's
// own frame. Returns null when nothing of it lands on the wall.
interface ClippedOpening {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clipToWall(
  opening: WallOpening,
  wallLengthMm: number,
  ceilingHeightMm: number
): ClippedOpening | null {
  if (opening.widthMm <= 0 || opening.heightMm <= 0) return null;

  const x0 = Math.max(0, opening.offsetMm);
  const x1 = Math.min(wallLengthMm, opening.offsetMm + opening.widthMm);
  const y0 = Math.max(0, opening.sillMm);
  const y1 = Math.min(ceilingHeightMm, opening.sillMm + opening.heightMm);

  // Entirely off the end of the wall, or entirely above the ceiling.
  // Ignored rather than clamped — clamping would slide a mis-entered
  // opening to the corner and make it look deliberate.
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function clippedOpenings(
  openings: WallOpening[],
  wallLengthMm: number,
  ceilingHeightMm: number
): ClippedOpening[] {
  return openings
    .map((o) => clipToWall(o, wallLengthMm, ceilingHeightMm))
    .filter((r): r is ClippedOpening => r !== null);
}

// The rectangles that remain wall after the openings are cut out.
//
// COORDINATE GRID decomposition: take every distinct x and y edge from
// the wall and its openings, treat them as a grid, keep the cells no
// opening covers, then merge horizontally adjacent survivors to keep
// the draw count down.
//
// REPLACED a left-to-right band sweep that was only 1-DIMENSIONAL, and
// the bug that forced the change is worth recording. The sweep advanced
// past an opening's full width regardless of its HEIGHT, so a transom
// window stacked directly above a door — completely legal, and common
// over a kitchen doorway — had one of the two silently deleted from the
// wall. A grid handles stacking, nesting and partial overlap without
// special cases, and it's exact rather than approximately right.
//
// Verified: for every arrangement, segment area + void area == wall
// area exactly, and no two segments overlap.
export function wallSegments(
  wallLengthMm: number,
  ceilingHeightMm: number,
  openings: WallOpening[]
): WallRect[] {
  if (wallLengthMm <= 0 || ceilingHeightMm <= 0) return [];

  const rects = clippedOpenings(openings, wallLengthMm, ceilingHeightMm);
  if (rects.length === 0) {
    return [{ alongMm: 0, bottomMm: 0, widthMm: wallLengthMm, heightMm: ceilingHeightMm }];
  }

  const xs = uniqueSorted([0, wallLengthMm, ...rects.flatMap((r) => [r.x0, r.x1])]);
  const ys = uniqueSorted([0, ceilingHeightMm, ...rects.flatMap((r) => [r.y0, r.y1])]);

  // A cell is covered if its CENTRE is inside any opening. Testing the
  // centre rather than an edge is what makes shared boundaries
  // unambiguous — two openings meeting exactly at 1100mm must not
  // produce a zero-width sliver that counts as both.
  const isCovered = (cx: number, cy: number) =>
    rects.some((r) => r.x0 <= cx && cx < r.x1 && r.y0 <= cy && cy < r.y1);

  const out: WallRect[] = [];

  for (let j = 0; j < ys.length - 1; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    const heightMm = ys[j + 1] - ys[j];

    let i = 0;
    while (i < xs.length - 1) {
      if (isCovered((xs[i] + xs[i + 1]) / 2, cy)) {
        i++;
        continue;
      }
      // Extend right while the run of surviving cells continues, so a
      // plain wall comes out as one rectangle instead of one per
      // opening edge.
      let k = i;
      while (k + 1 < xs.length - 1 && !isCovered((xs[k + 1] + xs[k + 2]) / 2, cy)) k++;

      const widthMm = xs[k + 1] - xs[i];
      if (widthMm >= MIN_SEGMENT_MM && heightMm >= MIN_SEGMENT_MM) {
        out.push({ alongMm: xs[i], bottomMm: ys[j], widthMm, heightMm });
      }
      i = k + 1;
    }
  }

  return out;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

// ---- Area ----

// Total wall area the openings remove — the UNION of their clipped
// rectangles, so two overlapping openings don't deduct the shared part
// twice.
//
// Computed on the same coordinate grid wallSegments uses, which is what
// guarantees the two agree: whatever area this reports as missing is
// exactly the area that has no segment drawn over it.
export function voidAreaMm2(
  wallLengthMm: number,
  ceilingHeightMm: number,
  openings: WallOpening[]
): number {
  const rects = clippedOpenings(openings, wallLengthMm, ceilingHeightMm);
  if (rects.length === 0) return 0;

  const xs = uniqueSorted(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqueSorted(rects.flatMap((r) => [r.y0, r.y1]));

  let total = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (rects.some((r) => r.x0 <= cx && cx < r.x1 && r.y0 <= cy && cy < r.y1)) {
        total += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return total;
}

// ---- Room-frame mapping ----

export interface RoomRect {
  x: number;
  y: number;
  widthMm: number;
  depthMm: number;
}

// The opening's footprint line on the floor plan, given as a thin
// rectangle lying in the wall. depthMm is the wall's own nominal
// thickness so the opening reads as sitting IN the wall rather than as
// a zero-area line.
//
// The single place the along-wall coordinate becomes room x/y. North
// and south walls run along +x; east and west along +y — matching
// extentAlongWall in lib/surfaceAreas.ts.
export function openingToRoomRect(
  opening: WallOpening,
  roomWidthMm: number,
  roomDepthMm: number,
  wallThicknessMm = 100
): RoomRect {
  const t = wallThicknessMm;
  switch (opening.wallId) {
    case 'north':
      return { x: opening.offsetMm, y: 0, widthMm: opening.widthMm, depthMm: t };
    case 'south':
      return {
        x: opening.offsetMm,
        y: roomDepthMm - t,
        widthMm: opening.widthMm,
        depthMm: t,
      };
    case 'west':
      return { x: 0, y: opening.offsetMm, widthMm: t, depthMm: opening.widthMm };
    case 'east':
      return {
        x: roomWidthMm - t,
        y: opening.offsetMm,
        widthMm: t,
        depthMm: opening.widthMm,
      };
  }
}

// ---- Door-swing clearance ----

// The floor an in-swinging door sweeps, as an axis-aligned rectangle
// extending into the room.
//
// SIMPLIFICATION, deliberate: the true swept region is a quarter disc
// of radius = door width. This returns its BOUNDING SQUARE, which is
// larger. Over-reporting is the correct direction for a clearance
// warning — it can nag about a corner that would just clear, but it
// will never quietly bless a cabinet the door actually hits. It also
// makes the test a plain rectangle overlap against footprints that are
// already axis-aligned rectangles, instead of arc/rectangle
// intersection.
//
// Returns null when nothing is swept: windows, pass-throughs,
// out-swinging doors, sliding doors, and bare doorways. That's the
// whole reason swing is modelled rather than assumed — an out-swinging
// door genuinely frees the floor, and in a small kitchen that's a
// design lever worth having.
export function doorSwingZone(
  opening: WallOpening,
  roomWidthMm: number,
  roomDepthMm: number
): RoomRect | null {
  if (opening.kind !== 'door') return null;
  if (!opening.swing || !swingBlocksFloor(opening.swing)) return null;

  const reach = opening.widthMm;

  switch (opening.wallId) {
    case 'north':
      return { x: opening.offsetMm, y: 0, widthMm: opening.widthMm, depthMm: reach };
    case 'south':
      return {
        x: opening.offsetMm,
        y: Math.max(0, roomDepthMm - reach),
        widthMm: opening.widthMm,
        depthMm: reach,
      };
    case 'west':
      return { x: 0, y: opening.offsetMm, widthMm: reach, depthMm: opening.widthMm };
    case 'east':
      return {
        x: Math.max(0, roomWidthMm - reach),
        y: opening.offsetMm,
        widthMm: reach,
        depthMm: opening.widthMm,
      };
  }
}

export function rectsOverlap(a: RoomRect, b: RoomRect): boolean {
  // Strict, matching boxesOverlap in lib/collision.ts — items exactly
  // flush against each other are touching, not overlapping.
  return (
    a.x < b.x + b.widthMm &&
    a.x + a.widthMm > b.x &&
    a.y < b.y + b.depthMm &&
    a.y + a.depthMm > b.y
  );
}

// Pairs of openings on the same wall that genuinely overlap — in BOTH
// axes, not just along the wall.
//
// Two dimensions matter, and getting it wrong is wrong in both
// directions. A transom window stacked above a door shares the door's
// along-wall extent but sits entirely above it: legal, common, and the
// old 1D check called it a conflict. A window cut into the middle of a
// door shares both extents: unbuildable, and that's what this reports.
//
// FULL pairwise sweep, not adjacent-only. Sorting by offset makes
// adjacency sufficient in 1D but not in 2D — a long band opening can
// overlap something far along the wall from it with unrelated openings
// in between, which an adjacent-only comparison never looks at.
export function overlappingOpeningPairs(
  openings: WallOpening[]
): [WallOpening, WallOpening][] {
  const byWall = new Map<WallOrientation, WallOpening[]>();
  for (const o of openings) {
    const list = byWall.get(o.wallId) ?? [];
    list.push(o);
    byWall.set(o.wallId, list);
  }

  const pairs: [WallOpening, WallOpening][] = [];
  for (const list of byWall.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (openingsOverlap(list[i], list[j])) pairs.push([list[i], list[j]]);
      }
    }
  }
  return pairs;
}

// Strict inequalities, matching boxesOverlap in lib/collision.ts: two
// openings exactly flush — a window whose sill is the door's head
// height — are touching, not overlapping, and that's a real detail
// rather than a rounding concern.
export function openingsOverlap(a: WallOpening, b: WallOpening): boolean {
  return (
    a.offsetMm < b.offsetMm + b.widthMm &&
    a.offsetMm + a.widthMm > b.offsetMm &&
    a.sillMm < b.sillMm + b.heightMm &&
    a.sillMm + a.heightMm > b.sillMm
  );
}

// Every opening on a wall, in wall order. Convenience for the UI, which
// wants them sorted the way they appear rather than the way they were
// added.
export function openingsForWall(
  openings: WallOpening[],
  wallId: WallOrientation
): WallOpening[] {
  return openings
    .filter((o) => o.wallId === wallId)
    .slice()
    .sort((a, b) => a.offsetMm - b.offsetMm);
}
