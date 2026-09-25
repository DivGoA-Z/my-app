// src/lib/hitTest.ts
//
// Everything at a point on the floor plan, in one place.
//
// WHY THIS EXISTS: selection used to be per-layer, each Konva layer
// handling its own click with cancelBubble. At any overlapping point
// that meant WHICHEVER LAYER DREW LAST won — arbitrary, undiscoverable,
// and impossible to reach past. A base cabinet under a wall cabinet, a
// strip fixed under one and a cove strip on top of it, a toaster on the
// counter between them: all at the same x/y, and only one of them
// reachable.
//
// PLAN GEOMETRY ONLY, deliberately. A top-down click carries no height
// information, so height cannot decide what you meant — it only ORDERS
// the results. The practical consequence is worth stating: a base
// cabinet with a wall cabinet above it IS an overlap here, even though
// the two never physically collide, because in plan they occupy the
// same rectangle. In a real kitchen that's most of the run.
//
// Each type's footprint comes from the SAME helper the renderer and the
// costing use, so what you can click is exactly what you can see and
// exactly what gets charged.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { RoomLayout } from '../types/layout';
import type { FixtureCatalogItem } from '../types/fixture';
import { isLinear, isVisibleWhenClosed } from '../types/fixture';
import type { SelectableType } from '../types/selection';
import { currentFootprintRect } from './footprint';
import { applianceFootprint } from './applianceGeometry';
import { openingToRoomRect } from './openings';
import { resolveAllFixtures } from './fixtures';

export interface HitCandidate {
  type: SelectableType;
  id: string;
  // What to show in the chooser.
  label: string;
  // Height off the floor, in mm. Orders the list and disambiguates two
  // otherwise identical rows — "top of the wall cabinet" versus
  // "underneath it" is exactly this number.
  heightMm: number;
}

interface Rect {
  x: number;
  y: number
  widthMm: number;
  depthMm: number;
}

function contains(rect: Rect, xMm: number, yMm: number, padMm = 0): boolean {
  return (
    xMm >= rect.x - padMm &&
    xMm <= rect.x + rect.widthMm + padMm &&
    yMm >= rect.y - padMm &&
    yMm <= rect.y + rect.depthMm + padMm
  );
}

// 'base-cabinet' -> 'Base cabinet'
function humanise(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// A point fixture has no footprint to speak of, so it gets a grab
// square. Generous, because a light is a small marker and hunting for
// it pixel-by-pixel is the opposite of what this whole change is for.
const FIXTURE_GRAB_MM = 90;

export interface HitTestInput {
  layout: RoomLayout;
  cabinets: PlacedCabinetItem[];
  appliances: PlacedApplianceItem[];
  fixtureCatalog: FixtureCatalogItem[];
}

// Everything whose plan footprint contains the point, ordered by height
// DESCENDING — so the thing highest off the floor is listed first.
//
// That ordering is chosen to match how the ambiguity is usually
// described out loud: "the one on top of the wall unit" versus "the one
// underneath it". Ties break on type then id, so the list never
// reorders between renders on the same click.
export function hitTestAt(xMm: number, yMm: number, input: HitTestInput): HitCandidate[] {
  const { layout, cabinets, appliances, fixtureCatalog } = input;
  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = layout.dimensions;
  const hits: HitCandidate[] = [];

  for (const cabinet of cabinets) {
    if (!contains(currentFootprintRect(cabinet), xMm, yMm)) continue;
    hits.push({
      type: 'cabinet',
      id: cabinet.id,
      label: `${humanise(cabinet.moduleType)} ${cabinet.widthMm}mm`,
      heightMm: cabinet.elevationMm,
    });
  }

  for (const appliance of appliances) {
    if (!contains(applianceFootprint(appliance), xMm, yMm)) continue;
    hits.push({
      type: 'appliance',
      id: appliance.id,
      label: `${humanise(appliance.applianceType)} ${appliance.widthMm}mm`,
      heightMm: appliance.elevationMm,
    });
  }

  for (const obstacle of layout.obstacles) {
    if (!contains(currentFootprintRect(obstacle), xMm, yMm)) continue;
    hits.push({
      type: 'obstacle',
      id: obstacle.id,
      label: humanise(obstacle.type),
      heightMm: obstacle.floorToCeiling ? 0 : obstacle.elevationMm,
    });
  }

  for (const wall of layout.walls) {
    for (const opening of wall.openings ?? []) {
      const rect = openingToRoomRect(opening, roomWidthMm, roomDepthMm);
      if (!contains(rect, xMm, yMm)) continue;
      hits.push({
        type: 'opening',
        id: opening.id,
        label: `${humanise(opening.kind)} on the ${wall.orientation} wall`,
        heightMm: opening.sillMm,
      });
    }
  }

  // Fixtures resolve through the same helper the 3D view uses, so a
  // cabinet-mounted strip is clickable exactly where it's drawn — which
  // is the front edge of its host, not the host's centre.
  for (const placement of resolveAllFixtures(layout, cabinets, fixtureCatalog)) {
    // An in-drawer light is drawn nowhere, so it must not be clickable
    // nowhere-in-particular either — it's reached from the toolbar list.
    if (!isVisibleWhenClosed(placement.item.kind)) continue;

    const linear = isLinear(placement.item.kind) && placement.runAxis !== 'vertical';
    const halfRun = linear ? placement.runLengthMm / 2 : FIXTURE_GRAB_MM / 2;
    const halfCross = FIXTURE_GRAB_MM / 2;
    const alongX = placement.runAxis === 'x';

    const rect = {
      x: placement.xMm - (alongX ? halfRun : halfCross),
      y: placement.yMm - (alongX ? halfCross : halfRun),
      widthMm: (alongX ? halfRun : halfCross) * 2,
      depthMm: (alongX ? halfCross : halfRun) * 2,
    };
    if (!contains(rect, xMm, yMm)) continue;

    hits.push({
      type: 'fixture',
      id: placement.fixture.id,
      label: placement.item.label,
      heightMm: placement.zMm,
    });
  }

  return hits.sort(
    (a, b) =>
      b.heightMm - a.heightMm || a.type.localeCompare(b.type) || a.id.localeCompare(b.id)
  );
}
