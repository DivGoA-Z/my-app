// src/types/layout.ts

import type { OtherRate } from './rates';
import type { ExtraPart } from './cabinet';
import type { CameraNode } from './Camera';
import type { WallOpening } from './opening';
import type { LightFixture, LightingMode } from './fixture';

export interface RoomDimensions {
  widthMm: number;           // e.g. 3000 — typical Delhi NCR kitchens run 1800-4200mm
  depthMm: number;
  ceilingHeightMm?: number;  // defaults to 2700mm if omitted, handled in UI logic
}

export type WallOrientation = 'north' | 'south' | 'east' | 'west';

export interface Wall {
  id: string;
  orientation: WallOrientation;
  lengthMm: number;
  // Doors, windows and pass-throughs on this wall — see
  // types/opening.ts. Lives here rather than on RoomLayout because an
  // opening is meaningless without the wall it's cut into, and because
  // `walls` is already a JSONB column, so the whole feature needed no
  // migration.
  openings?: WallOpening[];
  // DEPRECATED, superseded by `openings`. These were a yes/no flag with
  // no position, size or sill, so they could never subtract wall area
  // or check a door swing. Kept only so old rows deserialise; nothing
  // reads them. Remove once no saved layout still carries one.
  hasWindow?: boolean;
  hasDoor?: boolean;
  // FK -> SurfaceFinish.id (types/finish.ts) for the VISIBLE part of
  // this wall. Per-wall rather than per-room because kitchens routinely
  // tile one wall and paint the rest.
  finishId?: string;
  // FK -> SurfaceFinish.id for the part hidden behind cabinets and
  // appliances. A separate finish rather than a discount on the first
  // one, because it genuinely is a different product — nobody puts the
  // expensive tile where it can't be seen. Left unset, concealed area
  // isn't charged at all, which is the other common case (not tiled
  // behind units).
  concealedFinishId?: string;
  // A tint on the visible finish (§120), as on a cabinet: a paint shade,
  // or a tile/stone photo stained another tone. Unset/null = the
  // finish's own colour. In the walls JSONB, so no column.
  colorOverride?: string | null;
}

export type ObstacleType = 'pillar' | 'shaft' | 'exposed-pipe' | 'electrical-panel';

// Single source of truth for display labels — ObstacleToolbar,
// ObstacleInspector, and InventoryManager all show obstacle types to
// the user and need to agree on wording (mirrors
// APPLIANCE_TYPE_LABELS in types/appliance.ts).
// Whether an obstacle OCCUPIES the surface it stands against or is
// MOUNTED ON it. This is the distinction that makes wall/floor costing
// correct, and it is NOT the same as concealment:
//
//   occupies  a structural column or plumbing shaft. There is no wall
//             or floor behind it — that area doesn't exist as a
//             surface, so it is never tiled and never charged.
//   mounted   a length of exposed pipe or an electrical panel sits ON
//             the wall. The wall continues behind it, so that area is
//             concealed (cheap finish) rather than absent.
//
// Getting this backwards over-bills a client for tiling the inside of a
// pillar.
export type ObstacleSurfaceBehaviour = 'occupies' | 'mounted';

export const OBSTACLE_SURFACE_BEHAVIOUR: Record<ObstacleType, ObstacleSurfaceBehaviour> = {
  pillar: 'occupies',
  shaft: 'occupies',
  'exposed-pipe': 'mounted',
  'electrical-panel': 'mounted',
};

export const OBSTACLE_TYPE_LABELS: Record<ObstacleType, string> = {
  pillar: 'Pillar',
  shaft: 'Plumbing Shaft',
  'exposed-pipe': 'Exposed Pipe',
  'electrical-panel': 'Electrical Panel',
};

// Obstacles use the same X/Y grid (mm) as cabinets, so collision checks
// between cabinets and structural elements can reuse one geometry util,
// and both render on RoomCanvas.tsx at the same scale with no conversion.
export interface Obstacle {
  id: string;
  type: ObstacleType;
  x: number;          // mm, distance from room origin (top-left corner)
  y: number;
  widthMm: number;
  depthMm: number;
  floorToCeiling?: boolean; // false for e.g. a knee-height duct
  // Real, editable height — used for collision (lib/collision.ts) and
  // the 3D preview ONLY when floorToCeiling is false/unset (a
  // floor-to-ceiling pillar's actual height instead tracks the room's
  // own ceiling height, which can change per-room, so it isn't stored
  // here). Editable per-obstacle via ObstacleInspector after placement,
  // same as a cabinet's dimensions are via CabinetInspector. Older
  // obstacles saved before this field existed are backfilled to
  // PARTIAL_OBSTACLE_HEIGHT_MM on load — see normalizeObstacle in
  // lib/persistence.ts.
  heightMm: number;
  // Height of the obstacle's BOTTOM face off the floor — same
  // convention as PlacedCabinetItem.elevationMm (types/cabinet.ts) — 0
  // means it touches the floor. This is what lets an obstacle that
  // ISN'T floor-to-ceiling start mid-wall instead of always rising from
  // the floor: e.g. an electrical fixture or a length of exposed pipe
  // that's mounted partway up a wall, with nothing below it. ONLY
  // meaningful when floorToCeiling is false/unset (a floor-to-ceiling
  // obstacle always starts at the floor by definition, so this is
  // ignored — same treatment heightMm gets). Backfilled to 0 for
  // obstacles saved before this field existed — see normalizeObstacle
  // in lib/persistence.ts.
  elevationMm: number;
  // Quarter turn, same convention as PlacedCabinetItem.rotationDeg
  // (types/cabinet.ts) and the same footprint rules in lib/footprint.ts:
  // x/y stays the UNROTATED top-left corner, and a 90/270 turn swaps
  // which of widthMm/depthMm is the footprint's on-floor extent along
  // each axis. Most obstacles are square in plan (a pillar) where this
  // does nothing, but a rectangular duct or shaft against a wall often
  // needs its long side turned to match the wall it's against.
  // Backfilled to 0 for obstacles saved before this field existed — see
  // normalizeObstacle in lib/persistence.ts.
  rotationDeg: 0 | 90 | 180 | 270;
  // Suppresses the red collision highlight/warning for any overlap
  // involving THIS obstacle — see lib/collision.ts. For a known,
  // accepted overlap (e.g. a chimney duct that's expected to run
  // through this obstacle's box) rather than an actual mistake. Never
  // affects placement itself (Principle 6: warn, never block) — only
  // whether the warning is shown. Defaults to false/unset.
  ignoreOverlap?: boolean;
}

// One hand-entered lump sum on a project. `amount` is the SELLING
// price, deliberately not marked up by marginPercent: a business that
// types "₹20,000" for a service is naming what the customer pays, and
// silently turning it into ₹25,000 would put a number on the quote
// nobody chose. `id` is client-generated, used only to key editor rows.
// LEGACY shape — see RoomLayout.projectCharges.
export interface ProjectCharge {
  id: string;
  label: string;
  amount: number;
}

// Two lists so each lands in its own category on the quote — a labour
// lump sum prints with Labour, anything else with Other.
export interface ProjectCharges {
  labor: ProjectCharge[];
  other: ProjectCharge[];
}

export interface RoomLayout {
  id: string;
  projectId: string;        // FK -> CustomerProject.id
  name: string;              // e.g. "Kitchen - Ground Floor"
  dimensions: RoomDimensions;
  walls: Wall[];
  obstacles: Obstacle[];
  cameras: CameraNode[];      // Phase 2 bridge — saved 360° viewpoint nodes, see types/Camera.ts
  // Placed light fixtures (types/fixture.ts). Same array-on-the-layout
  // treatment as obstacles and cameras, since they're read and written
  // together with the layout and never queried individually.
  fixtures?: LightFixture[];
  // How the 3D view treats lighting — see LightingMode. Saved with the
  // layout rather than held in component state because it's part of how
  // the design is PRESENTED: a shared link should open in the mode the
  // designer chose, and a phone-friendly walkthrough should stay
  // phone-friendly after a reload.
  lightingMode?: LightingMode;
  // Viewing brightness for the 3D view, as the renderer's tone-mapping
  // exposure. Changes nothing about the design — not lumens, not colour
  // temperature, not price — so it is safe to adjust freely, which is
  // exactly what makes it the right control for "the render looks too
  // dark". Saved with the layout so a shared link opens as the
  // designer set it.
  exposure?: number;
  // Whether electrical work appears as a CHARGE on the quote.
  //
  // One global switch rather than per-fixture, matching how the trade
  // actually splits in India: either the electrician handles the whole
  // job separately, or the kitchen business does it and bills it
  // separately. Off (the default), fixtures still print in full as a
  // specification at zero — so the design is documented and the scope
  // is unambiguous, without claiming the money.
  priceElectrical?: boolean;
  // Room surface finishes (FK -> SurfaceFinish.id). Floor and ceiling
  // live here rather than on Wall since there's exactly one of each;
  // per-wall assignment is on Wall itself. Same exposed/concealed split
  // as walls: the floor under a run of base units gets cheaper tile
  // than the floor you walk on.
  floorFinishId?: string;
  floorConcealedFinishId?: string;
  // No concealed counterpart for the ceiling — nothing in a kitchen
  // hides ceiling area except a floor-to-ceiling unit, and that
  // OCCUPIES rather than conceals it.
  ceilingFinishId?: string;
  // One finish (FK -> SurfaceFinish.id) for every countertop in the
  // layout — a kitchen's slab is one continuous material in practice,
  // same reasoning as floor/ceiling being singular rather than per-run.
  countertopFinishId?: string;
  // A tint on the slab's finish, as on a cabinet (§119): replaces a solid
  // colour, stains a photo. Unset or null = the material's own colour
  // (null when cleared, so the save writes the clearing too).
  countertopColorOverride?: string | null;
  // The same for the floor and ceiling (§120).
  floorColorOverride?: string | null;
  ceilingColorOverride?: string | null;
  // Whether the countertop appears as a CHARGE on the quote.
  //
  // Same shape as priceElectrical, for the same market reason: in Delhi
  // NCR the kitchen business usually does NOT supply the slab — the
  // homeowner arranges stone separately. So the countertop is always
  // part of the DESIGN (it's real, it affects the render and the
  // walkthrough) but only OPTIONALLY part of the PRICE. Off (the
  // default), the countertop still prints on the quote as a
  // specification at zero, same as an unpriced fixture — not supplying
  // it is different from it being free.
  priceCountertop?: boolean;
  // Cost-plus markup (%) applied to this PROJECT's own quote —
  // deliberately per-project, not a single business-wide number on
  // the rate card (docs/DECISIONS.md §15): a big order and a rush
  // one-off job don't have to carry the same margin. Optional so an
  // older layout without one falls back to DEFAULT_MARGIN_PERCENT
  // (lib/bom.ts) rather than needing a migration.
  marginPercent?: number;
  // Per-project override of RateCard.sheetWasteFactor. Undefined means
  // "use the business default" — NOT the same as 1, which is a real
  // choice ("this job wastes nothing worth charging for"). Same
  // per-project reasoning as marginPercent above; see
  // docs/DECISIONS.md §35.
  sheetWasteFactor?: number;
  // This project's override of the business's depth convention
  // (ConstructionSettings.depthIncludesFront, §61): true = the stated
  // depth includes the shutter, false = carcass only. Undefined = follow
  // the business setting. Resolved by lib/physicalDepth.ts's
  // effectiveConstruction, which the cutting list, price, frozen quote,
  // 2D plan, 3D view and collision checks all use.
  depthIncludesFront?: boolean;
  // This project's own "Labour and other charges" list, overriding the
  // rate card's (RateCard.othersRates) wholesale. UNDEFINED means
  // "follow the business rates" — so a rate-card change keeps flowing
  // into every project that hasn't customised; an array (even an empty
  // one) means this project has its own list and no longer follows.
  // Same override-by-presence pattern as sheetWasteFactor above. Rows
  // have every option the rate card's do, plus "Add margin" (see
  // OtherRate.applyMargin). See docs/DECISIONS.md §39.
  chargeRates?: OtherRate[];
  // LEGACY (§36, superseded the same day by chargeRates above): hand-
  // entered lump sums, never marked up. No longer edited anywhere. Still
  // priced, as no-margin lump-sum rows (lib/bom.ts's
  // legacyProjectChargeRates), for a project saved while it existed;
  // folded into chargeRates and cleared the moment that project is
  // customised.
  projectCharges?: ProjectCharges;
  // Board parts for this project that don't belong to any one cabinet —
  // fillers, a plinth/skirting, end panels (§48). Edited on the Cutting
  // List page; listed there AND priced (real area × board rate × sheet
  // waste, inside Material). Undefined = none.
  looseParts?: ExtraPart[];
  gridSnapMm: number;        // e.g. 50 — controls drag-and-drop snapping
  createdAt: string;
  updatedAt: string;
}

/*
Example JSON:

{
  "id": "layout_001",
  "projectId": "proj_001",
  "name": "Kitchen - Ground Floor",
  "dimensions": { "widthMm": 3000, "depthMm": 4000, "ceilingHeightMm": 2700 },
  "walls": [
    { "id": "wall_n", "orientation": "north", "lengthMm": 3000 },
    { "id": "wall_e", "orientation": "east", "lengthMm": 4000, "hasWindow": true },
    { "id": "wall_s", "orientation": "south", "lengthMm": 3000, "hasDoor": true },
    { "id": "wall_w", "orientation": "west", "lengthMm": 4000 }
  ],
  "obstacles": [
    {
      "id": "obs_pillar_1",
      "type": "pillar",
      "x": 0,
      "y": 0,
      "widthMm": 300,
      "depthMm": 300,
      "floorToCeiling": true,
      "heightMm": 2700,
      "elevationMm": 0
    }
  ],
  "cameras": [
    {
      "id": "cam_001",
      "layoutId": "layout_001",
      "label": "Sink View",
      "x": 1500,
      "y": 800,
      "viewAngleDeg": 180,
      "heightMm": 1600,
      "createdAt": "2026-08-29T10:00:00.000Z",
      "updatedAt": "2026-08-29T10:00:00.000Z"
    }
  ],
  "gridSnapMm": 50,
  "createdAt": "2026-07-12T10:00:00.000Z",
  "updatedAt": "2026-08-15T11:20:00.000Z"
}
*/
