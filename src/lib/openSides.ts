// src/lib/openSides.ts
//
// An OPEN SIDE (§146): an edge of the room with no wall built on it. An
// L-shaped kitchen often opens onto the living room, so only two (or
// three) of the room's four edges are walls. The room rectangle stays
// the kitchen's footprint (placement, collision and aisles still use
// it); what an open side changes is that there is nothing THERE:
//
//   - no wall is drawn (plan: dashed edge; 3D: no wall; elevation: no
//     wall face behind the units),
//   - it has no surface, so no finish and nothing charged for it,
//   - it can't carry a door or window. Openings already on it are kept
//     in the data (re-close the side and they come back) but every
//     reader goes through wallOpenings(), which returns none.
//
// Stored as `Wall.open` in the walls JSONB, so no column.

import type { RoomLayout, Wall, WallOrientation } from '../types/layout';
import type { WallOpening } from '../types/opening';

export function isOpenSide(layout: Pick<RoomLayout, 'walls'> | null | undefined, orientation: WallOrientation): boolean {
  return !!layout?.walls?.find((w) => w.orientation === orientation)?.open;
}

export function openSides(layout: Pick<RoomLayout, 'walls'> | null | undefined): WallOrientation[] {
  return (layout?.walls ?? []).filter((w) => w.open).map((w) => w.orientation);
}

// The openings that exist: none on an open side.
export function wallOpenings(wall: Pick<Wall, 'open' | 'openings'> | undefined | null): WallOpening[] {
  return wall?.open ? [] : (wall?.openings ?? []);
}

// Every opening in the room that exists (skips open sides).
export function allOpenings(layout: Pick<RoomLayout, 'walls'> | null | undefined): WallOpening[] {
  return (layout?.walls ?? []).flatMap((w) => wallOpenings(w));
}
