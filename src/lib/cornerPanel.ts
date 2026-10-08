// src/lib/cornerPanel.ts
//
// Where a blind/magic corner's fixed panel goes, and how wide it is
// (§116). The panel covers the part of the front that the meeting run
// (the cabinets on the other wall) sits in front of: it can't open, so
// it's a fixed panel, and only the rest of the width gets doors.
//
//   side  — the end where another floor cabinet stands in front of this
//           one (the meeting run); failing that, the end against a wall.
//   width — how far that meeting run reaches out from the wall, i.e. its
//           physical depth (618 when shutters add to a 600 carcass);
//           with no meeting run yet, the depth the kitchen's other base
//           cabinets use (the most common one), since one kitchen's runs
//           share a depth; with none placed yet, 600 + this unit's own
//           shutter allowance. NOT this unit's own depth: catalogue blind
//           corners are often 900 deep, which says nothing about the run
//           that will meet them.
//
// Called on PHYSICAL cabinets (§61): the meeting run's shutter is what
// the panel meets. Run when a corner unit is placed and from the
// inspector's "Fit to corner"; never silently on load, so a stored panel
// (and so a quote) only changes when someone asks.

import type { FrontLayout } from '../types/front';
import type { CornerPanel, PlacedCabinetItem } from '../types/cabinet';
import { defaultFrontLayout } from '../types/front';
import { currentFootprintRect } from './footprint';
import { touchesFloor } from './surfaceAreas';
import { MIN_CORNER_DOOR_MM } from './fronts';

// An end this close to a wall counts as against it.
const AGAINST_WALL_MM = 50;
// A cabinet whose box starts within this of our front counts as standing
// in front of it (it may be pushed out by a shutter's thickness).
const IN_FRONT_MM = 40;

// Blind and magic base corners, and wall cabinets (§118): a blind WALL
// corner is the same idea — the other wall's run of wall cabinets hangs in
// front of its end — and the most common wall corner sold. A wall cabinet
// only gets one where a run really meets it (see `metRun`).
export function hasCornerPanel(moduleType: PlacedCabinetItem['moduleType']): boolean {
  return moduleType === 'corner-blind' || moduleType === 'corner-magic' || moduleType === 'wall-cabinet';
}

// Whether two cabinets are in the same tier: both on the floor, or both
// hung at overlapping heights. A wall corner's run is the wall cabinets
// beside it, never the base cabinets below.
function sameTier(a: PlacedCabinetItem, b: PlacedCabinetItem): boolean {
  if (touchesFloor(a.elevationMm) || touchesFloor(b.elevationMm)) return touchesFloor(a.elevationMm) && touchesFloor(b.elevationMm);
  return a.elevationMm < b.elevationMm + b.heightMm && b.elevationMm < a.elevationMm + a.heightMm;
}

// Unit vectors in room space for a cabinet's width axis (towards its
// LEFT end, as you face it) and its front, by rotation. Front by
// rotation: 0→+y, 90→−x, 180→−y, 270→+x (CLAUDE.md); left is the front
// turned a quarter clockwise in plan (y down): 0 → −x.
function axes(rotationDeg: number) {
  const front = ({ 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } } as const)[
    rotationDeg as 0 | 90 | 180 | 270
  ];
  const left = { x: -front.y, y: front.x } as const;
  return { front, left };
}

export function fitCornerPanel(
  item: PlacedCabinetItem,
  room: { widthMm: number; depthMm: number },
  others: PlacedCabinetItem[]
): CornerPanel {
  return fitCornerPanelDetail(item, room, others).panel;
}

// The same, saying whether a meeting run was actually found (rather
// than the end against a wall and a usual depth being guessed).
export function fitCornerPanelDetail(
  item: PlacedCabinetItem,
  room: { widthMm: number; depthMm: number },
  others: PlacedCabinetItem[]
): { panel: CornerPanel; metRun: boolean } {
  const { front, left } = axes(item.rotationDeg);
  const cx = item.x + item.widthMm / 2;
  const cy = item.y + item.depthMm / 2;
  const maxPanel = item.widthMm - MIN_CORNER_DOOR_MM;

  const candidates = (['left', 'right'] as const).map((side) => {
    const u = side === 'left' ? left : { x: -left.x, y: -left.y };
    const end = { x: cx + (u.x * item.widthMm) / 2, y: cy + (u.y * item.widthMm) / 2 };
    const wallGap =
      u.x < 0 ? end.x : u.x > 0 ? room.widthMm - end.x : u.y < 0 ? end.y : room.depthMm - end.y;

    // How far in from this end other floor cabinets stand in front of us:
    // project each one's box onto our width axis (distance inwards from
    // the end) and our front axis (distance out from our front face).
    const frontFace = { x: cx + (front.x * item.depthMm) / 2, y: cy + (front.y * item.depthMm) / 2 };
    let reachMm = 0;
    for (const o of others) {
      if (o.id === item.id || !sameTier(item, o)) continue;
      const r = currentFootprintRect(o);
      const corners = [
        { x: r.x, y: r.y },
        { x: r.x + r.widthMm, y: r.y },
        { x: r.x, y: r.y + r.depthMm },
        { x: r.x + r.widthMm, y: r.y + r.depthMm },
      ];
      const inward = corners.map((p) => -((p.x - end.x) * u.x + (p.y - end.y) * u.y));
      const out = corners.map((p) => (p.x - frontFace.x) * front.x + (p.y - frontFace.y) * front.y);
      const nearOut = Math.min(...out);
      if (nearOut < -1 || nearOut > IN_FRONT_MM || Math.max(...out) <= 0) continue;
      // It must start at (or past) our end, i.e. come from the corner.
      if (Math.min(...inward) > AGAINST_WALL_MM) continue;
      reachMm = Math.max(reachMm, Math.max(...inward));
    }
    return { side, wallGap, reachMm };
  });

  const best =
    candidates.find((c) => c.reachMm > 0 && c.reachMm === Math.max(...candidates.map((d) => d.reachMm))) ??
    [...candidates].sort((a, b) => a.wallGap - b.wallGap)[0];
  const widthMm = Math.round(best.reachMm > 0 ? best.reachMm : usualRunDepthMm(others, item));
  return { panel: { side: best.side, widthMm: Math.max(0, Math.min(widthMm, maxPanel)) }, metRun: best.reachMm > 0 };
}

// The kitchen's usual base-run depth (physical): the most common depth
// among the other floor-standing base cabinets; ties go to the deeper.
// With none, a 600 run plus whatever this unit adds beyond its stored
// depth (its shutter, when "600" is the carcass alone) — the caller
// passes the unit physical, so that's its own extra.
const STANDARD_RUN_MM = 600;
const STANDARD_WALL_RUN_MM = 350;
function usualRunDepthMm(others: PlacedCabinetItem[], item: PlacedCabinetItem & { storedDepthMm?: number }): number {
  const counts = new Map<number, number>();
  for (const o of others) {
    if (o.id === item.id || !sameTier(item, o) || cabinetIsTall(o) || o.cornerPanel || o.moduleType === 'corner-blind' || o.moduleType === 'corner-magic' || o.moduleType === 'corner-carousel') continue;
    const d = Math.round(o.depthMm);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const standard = touchesFloor(item.elevationMm) ? STANDARD_RUN_MM : STANDARD_WALL_RUN_MM;
  if (counts.size === 0) return standard + (item.storedDepthMm !== undefined ? item.depthMm - item.storedDepthMm : 0);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

function cabinetIsTall(c: PlacedCabinetItem): boolean {
  return c.moduleType === 'tall-unit' || c.moduleType === 'pantry-unit';
}

// The doors that go beside a fitted panel: the default front for the
// width left over, hinged on the side AWAY from the panel, so the door
// swings open into free floor rather than across the meeting run.
export function doorsBesidePanel(item: PlacedCabinetItem, panel: CornerPanel): FrontLayout {
  const layout = defaultFrontLayout(item.moduleType, item.widthMm - panel.widthMm);
  return layout.kind === 'single-door' ? { ...layout, hinge: panel.side === 'left' ? 'right' : 'left' } : layout;
}
