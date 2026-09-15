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

export const SNAP_THRESHOLD_MM = 40;

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
  const neighbors = allCabinets.filter((c) => c.id !== draggedId).map(getFootprintRect);

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

  return { footprintLeftMm, footprintTopMm };
}
