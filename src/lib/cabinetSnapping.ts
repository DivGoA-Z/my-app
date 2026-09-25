// src/lib/cabinetSnapping.ts
//
// "Magnetic" edge snapping while dragging a cabinet — makes it possible
// to place cabinets flush against each other (or against a wall)
// without needing pixel-perfect manual dragging, which is genuinely
// hard with a mouse/trackpad/touch. On each axis independently, tries:
//
//   1. touching a neighbor's opposite edge (so the two sit flush with
//      no gap — the main case: building a row of cabinets),
//   2. matching a neighbor's SAME edge (so a row lines up along one
//      edge even without touching — e.g. all flush against the back
//      wall at the same depth),
//   3. touching a room wall,
//
// and keeps whichever candidate is closest to where the cabinet was
// actually dragged, as long as it's within SNAP_THRESHOLD_MM. If
// nothing qualifies on that axis, falls back to rounding to the grid
// (gridSnapMm) instead of leaving the cabinet at a raw, un-tidy pixel
// position.
//
// Operates entirely in terms of the ROTATED footprint's on-screen
// edges (see getFootprint in cabinetGeometry.ts) — CabinetLayer.tsx is
// responsible for converting the result back to PlacedCabinetItem's
// x/y convention (the UNROTATED top-left corner), since that
// conversion depends on the dragged cabinet's own rotation.

import type { PlacedCabinetItem } from '../types/cabinet';
import { getFootprint } from './cabinetGeometry';

// Was 40mm — raised after finding that a small residual gap (a few
// cm or less, exactly the case where a designer is actively trying to
// drag two cabinets flush) gives almost no margin: an ordinary drag
// gesture easily stops, or overshoots, more than 40mm from the touch
// point before the mouse settles. Past that radius this falls all the
// way to blind grid-rounding (see bestSnapForAxis below), which has no
// idea a neighbor is there — landing at an arbitrary, un-flush gap
// (or, before the 2D overlap fix-up existed, an unresolved overlap).
// 100mm is still small next to real cabinet/room dimensions (a
// 300mm+ cabinet in a 1800mm+ room), so it doesn't start snapping to
// neighbors the drag was never actually headed toward.
export const SNAP_THRESHOLD_MM = 100;

interface FootprintRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getFootprintRect(item: PlacedCabinetItem): FootprintRect {
  const { footprintWidthMm, footprintHeightMm } = getFootprint(item.widthMm, item.depthMm, item.rotationDeg);
  const centerX = item.x + item.widthMm / 2;
  const centerY = item.y + item.depthMm / 2;
  return {
    left: centerX - footprintWidthMm / 2,
    right: centerX + footprintWidthMm / 2,
    top: centerY - footprintHeightMm / 2,
    bottom: centerY + footprintHeightMm / 2,
  };
}

// Finds the snap candidate closest to `proposedMin` (the dragged
// footprint's proposed left/top edge) out of: the room's two walls, and
// every neighbor's edges (both "touch" and "align" candidates for
// each). Falls back to grid-rounding if nothing is within threshold.
function bestSnapForAxis(
  proposedMin: number,
  footprintExtent: number,
  roomExtent: number,
  neighborMins: number[],
  neighborMaxs: number[],
  gridSnapMm: number
): number {
  const candidates: number[] = [
    0, // flush against the near wall
    roomExtent - footprintExtent, // flush against the far wall
  ];

  for (const neighborMin of neighborMins) {
    candidates.push(neighborMin); // align: dragged's edge matches neighbor's near edge
    candidates.push(neighborMin - footprintExtent); // touch: dragged sits just before neighbor
  }
  for (const neighborMax of neighborMaxs) {
    candidates.push(neighborMax); // touch: dragged sits just after neighbor
    candidates.push(neighborMax - footprintExtent); // align: dragged's far edge matches neighbor's far edge
  }

  let bestValue = Math.round(proposedMin / gridSnapMm) * gridSnapMm; // fallback: plain grid snap
  let bestDistance = SNAP_THRESHOLD_MM;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - proposedMin);
    if (distance < bestDistance) {
      bestValue = candidate;
      bestDistance = distance;
    }
  }

  return bestValue;
}

// True 2D overlap test — unlike bestSnapForAxis, which resolves X and Y
// independently and therefore can't tell "shares this neighbor's whole
// depth band, same as every other cabinet in the row" (fine) apart from
// "actually sits inside this neighbor's box" (not fine).
function rectsOverlap(a: FootprintRect, b: FootprintRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

interface ZRange {
  minZ: number;
  maxZ: number;
}

function zRangeOf(item: PlacedCabinetItem): ZRange {
  return { minZ: item.elevationMm, maxZ: item.elevationMm + item.heightMm };
}

// Same Z check getCabinetBounds/boxesOverlap use (lib/collision.ts) —
// a wall cabinet mounted directly above a base cabinet shares the
// exact same X/Y footprint ON PURPOSE and is never a collision,
// because the two occupy different height bands. resolveOverlaps must
// agree with that, or it would "fix" a perfectly normal stacked
// arrangement by shoving the base cabinet sideways away from the wall
// cabinet sitting above it — which is exactly what happened before
// this check existed: the safety net had no idea elevationMm was a
// thing, and treated it as a real overlap it needed to resolve.
function zOverlaps(a: ZRange, b: ZRange): boolean {
  return a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export interface SnapResult {
  footprintLeftMm: number;
  footprintTopMm: number;
}

// proposedFootprintLeftMm/TopMm: the dragged cabinet's proposed
// on-screen footprint edges (already room-clamped by the caller).
export function snapCabinetFootprint(
  draggedId: string,
  proposedFootprintLeftMm: number,
  proposedFootprintTopMm: number,
  footprintWidthMm: number,
  footprintHeightMm: number,
  allCabinets: PlacedCabinetItem[],
  roomWidthMm: number,
  roomDepthMm: number,
  gridSnapMm: number
): SnapResult {
  const draggedItem = allCabinets.find((c) => c.id === draggedId);
  const others = allCabinets.filter((c) => c.id !== draggedId);
  const neighbors = others.map(getFootprintRect);

  const footprintLeftMm = bestSnapForAxis(
    proposedFootprintLeftMm,
    footprintWidthMm,
    roomWidthMm,
    neighbors.map((n) => n.left),
    neighbors.map((n) => n.right),
    gridSnapMm
  );
  const footprintTopMm = bestSnapForAxis(
    proposedFootprintTopMm,
    footprintHeightMm,
    roomDepthMm,
    neighbors.map((n) => n.top),
    neighbors.map((n) => n.bottom),
    gridSnapMm
  );

  // A cabinet with ignoreOverlap set (see lib/collision.ts) is allowed
  // to sit inside a neighbor deliberately — the MTV fix-up below must
  // not fight that by shoving it back out. Same for a neighbor whose
  // height band doesn't actually overlap the dragged cabinet's (a wall
  // cabinet above a base cabinet) — see zOverlaps' comment.
  const draggedIgnoresOverlap = draggedItem?.ignoreOverlap ?? false;
  const draggedZRange = draggedItem ? zRangeOf(draggedItem) : { minZ: 0, maxZ: Infinity };
  const resolvableNeighbors = draggedIgnoresOverlap
    ? []
    : neighbors.filter(
        (_, i) => !others[i].ignoreOverlap && zOverlaps(draggedZRange, zRangeOf(others[i]))
      );

  return resolveOverlaps(
    { left: footprintLeftMm, top: footprintTopMm },
    footprintWidthMm,
    footprintHeightMm,
    resolvableNeighbors
  );
}

// bestSnapForAxis resolves X and Y independently, so it has no way to
// know that landing exactly on a neighbor's left/right edge is FINE
// (every cabinet in a wall run shares that band) while landing inside
// its top/bottom edge is NOT — that's a genuine 2D question. Nothing
// above ever produces an overlap when a neighbor's OWN edge is the
// chosen candidate, by construction; the one path that can is the
// grid-rounding fallback used when nothing was within
// SNAP_THRESHOLD_MM. That used to mean dragging to close a small gap
// (say 20mm) and overshooting the 40mm capture radius by even a few mm
// dumped the cabinet into an unresolved overlap instead of snapping
// back to flush — see docs/DECISIONS.md.
//
// Standard minimum-translation-vector fix-up: for any neighbor the
// snapped box still truly overlaps (both axes, not just one), push out
// along whichever axis has the SHALLOWER penetration — that's the
// natural "which edge did I actually cross" axis, e.g. a shared X band
// with only a few mm of Y overshoot resolves by nudging Y back to
// flush, not by shoving the cabinet off the shared wall. Bounded
// iteration because resolving one neighbor can occasionally reveal a
// second (a tightly packed row) — not because this can loop forever.
function resolveOverlaps(
  footprintTopLeft: { left: number; top: number },
  footprintWidthMm: number,
  footprintHeightMm: number,
  neighbors: FootprintRect[]
): SnapResult {
  let left = footprintTopLeft.left;
  let top = footprintTopLeft.top;

  for (let iteration = 0; iteration < neighbors.length + 1; iteration++) {
    const box: FootprintRect = { left, right: left + footprintWidthMm, top, bottom: top + footprintHeightMm };
    const hit = neighbors.find((n) => rectsOverlap(box, n));
    if (!hit) break;

    const overlapX = Math.min(box.right, hit.right) - Math.max(box.left, hit.left);
    const overlapY = Math.min(box.bottom, hit.bottom) - Math.max(box.top, hit.top);

    if (overlapX <= overlapY) {
      const centerX = left + footprintWidthMm / 2;
      const neighborCenterX = (hit.left + hit.right) / 2;
      left = centerX < neighborCenterX ? hit.left - footprintWidthMm : hit.right;
    } else {
      const centerY = top + footprintHeightMm / 2;
      const neighborCenterY = (hit.top + hit.bottom) / 2;
      top = centerY < neighborCenterY ? hit.top - footprintHeightMm : hit.bottom;
    }
  }

  return { footprintLeftMm: left, footprintTopMm: top };
}
