// src/lib/elevationDims.ts
//
// The running dimensions on a wall elevation drawing (§92): the chain
// of widths and gaps along the wall at base level and at wall-unit
// level, and the key heights up the side. The drawing exists to check
// sizes and the space between items; until §92 every number hid behind
// a click, so checking a wall meant clicking every piece and gap.
//
// Architectural convention, and the reason this doesn't clutter: the
// chains sit OUTSIDE the drawing, one line per level, so a 150mm filler
// can't collide with its neighbour's label the way labels drawn on the
// items did (the reason click-to-measure was chosen originally).
//
// Each cabinet is its own span (the carpenter builds each one). An
// appliance lying within the cabinet run (a hob or sink, even one
// straddling two cabinets) adds nothing; one standing on its own (a
// fridge) is a span. Openings are kept separate: a door or window in the
// run is a span you must not build into. A first version merged
// everything that overlapped, which turned two 600 cabinets under a
// straddling hob into one "1200" (seen on a real kitchen, now a test).

import type { WallElevationItem, WallElevationItemKind } from './surfaceAreas';

export interface Band {
  bottomMm: number;
  topMm: number;
}

// Counter level: anything standing up to worktop height. Wall-unit
// level: the band wall cabinets and a chimney hang in. A tall unit
// spans both, so it shows in both chains, which is right: it's in the
// way at both heights.
export const BASE_BAND: Band = { bottomMm: 100, topMm: 850 };
export const WALL_BAND: Band = { bottomMm: 1500, topMm: 2000 };

export type SegmentKind = 'item' | 'opening' | 'gap';

export interface ChainSegment {
  startMm: number;
  endMm: number;
  kind: SegmentKind;
}

// Gaps smaller than this are treated as touching (rounding in saved
// positions), not reported as a 1mm space.
export const MIN_GAP_MM = 2;

const overlapsBand = (i: WallElevationItem, b: Band) => i.bottomMm < b.topMm && i.topMm > b.bottomMm;

// The chain of item spans, opening spans and gaps covering the wall
// from 0 to wallLengthMm at one level. Empty when nothing is at that
// level (no chain worth drawing).
export function bandChain(items: WallElevationItem[], wallLengthMm: number, band: Band): ChainSegment[] {
  type Span = { start: number; end: number; kind: Exclude<SegmentKind, 'gap'> };
  const toSpan = (i: WallElevationItem): Span => ({
    start: Math.max(0, i.alongMm),
    end: Math.min(wallLengthMm, i.alongMm + i.extentMm),
    kind: i.kind === 'opening' ? 'opening' : 'item',
  });
  const atLevel = items.filter((i) => overlapsBand(i, band));
  const solid = atLevel.filter((i) => i.kind === 'cabinet' || i.kind === 'obstacle').map(toSpan);
  // Cabinets keep their own widths (the carpenter builds each one). An
  // appliance lying within the cabinet run — a hob or sink, even one
  // straddling two cabinets — is left out; one standing on its own
  // (a fridge, a dishwasher in a gap) is a span of its own.
  const covered = (a: Span) => {
    let reach = a.start;
    for (const c of [...solid].sort((x, y) => x.start - y.start)) {
      if (c.start <= reach + MIN_GAP_MM && c.end > reach) reach = c.end;
    }
    return reach >= a.end - MIN_GAP_MM;
  };
  const appliances = atLevel.filter((i) => i.kind === 'appliance').map(toSpan).filter((a) => !covered(a));
  const openings = atLevel.filter((i) => i.kind === 'opening').map(toSpan);
  const spans = [...solid, ...appliances, ...openings].filter((s) => s.end - s.start > 0).sort((a, b) => a.start - b.start);
  if (spans.length === 0) return [];

  // Only spans that truly overlap merge (two units drawn into each
  // other); touching ones stay separate. An item over an opening (rare)
  // is kept as an item.
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end - MIN_GAP_MM / 2) {
      last.end = Math.max(last.end, s.end);
      if (s.kind === 'item') last.kind = 'item';
    } else {
      merged.push({ ...s });
    }
  }

  const out: ChainSegment[] = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start - cursor >= MIN_GAP_MM) out.push({ startMm: cursor, endMm: s.start, kind: 'gap' });
    else if (out.length) out[out.length - 1].endMm = s.start; // close a sub-2mm sliver
    out.push({ startMm: Math.max(cursor, s.start), endMm: s.end, kind: s.kind });
    cursor = s.end;
  }
  if (wallLengthMm - cursor >= MIN_GAP_MM) out.push({ startMm: cursor, endMm: wallLengthMm, kind: 'gap' });
  else out[out.length - 1].endMm = wallLengthMm;
  return out;
}

const STANDING_KINDS: WallElevationItemKind[] = ['cabinet', 'appliance'];

// The heights worth dimensioning up the side: floor, top of the base
// run, underside and top of the wall units, ceiling. A level is left
// out when nothing defines it (a wall with no wall units).
export function heightLevels(items: WallElevationItem[], ceilingMm: number): number[] {
  const standing = items.filter((i) => STANDING_KINDS.includes(i.kind));
  const base = standing.filter((i) => i.bottomMm < 50 && i.topMm <= 1200);
  const hung = standing.filter((i) => i.bottomMm >= 1200);
  const levels = [0, ceilingMm];
  if (base.length) levels.push(Math.max(...base.map((i) => i.topMm)));
  if (hung.length) {
    levels.push(Math.min(...hung.map((i) => i.bottomMm)));
    levels.push(Math.max(...hung.map((i) => i.topMm)));
  }
  return [...new Set(levels.map((l) => Math.round(Math.min(ceilingMm, Math.max(0, l)))))].sort((a, b) => a - b);
}
