// src/types/cabinet.ts

import type { FrontLayout } from './front';

export type ModuleType =
  | 'base-cabinet'
  | 'wall-cabinet'
  | 'tall-unit'
  | 'sink-unit'
  | 'cylinder-trolley'
  | 'drawer-unit'
  // Three distinct corner solutions, not one generic 'corner-unit'
  // (which existed as an inert catalogue entry — a colour and a label,
  // nothing else — until this replaced it). They behave too
  // differently to share a type: a blind corner is a plain rectangular
  // carcass with fixed shelves behind an ordinary door; a magic corner
  // is the same plain rectangle but with a pull-out swinging-tray
  // mechanism inside instead; a carousel is the classic diagonal-front
  // cabinet with a rotating lazy-susan shelf. Kept separate so a future
  // "open this cabinet" animation has one switch-on-moduleType case per
  // mechanism instead of a flag inside a flag. See DECISIONS.md.
  | 'corner-blind'
  | 'corner-magic'
  | 'corner-carousel'
  // A tall pull-out pantry — same full-height carcass as 'tall-unit',
  // but its front is a multi-tier wire-basket TROLLEY (FrontKind
  // 'trolley', the same front cylinder-trolley uses for a single LPG
  // platform — see defaultFrontLayout in types/front.ts) instead of a
  // plain double door. Kept as its own moduleType rather than a
  // tall-unit with a hand-picked front, because the whole point of a
  // catalogue row is that a business can add "Pantry Pull-out Unit"
  // and get the right product WITHOUT knowing to configure a trolley
  // front themselves afterward.
  | 'pantry-unit';

// The carcass board. Drives price and durability — and NOT appearance:
// a finished cabinet never shows its substrate. Appearance now comes
// entirely from the referenced SurfaceFinish (types/finish.ts).
//
// 'BWP' (Boiling Water Proof plywood — moisture-resistant, priced
// above plain Plywood/HDMR) added 2026-09-25 alongside real material
// rates (docs/DECISIONS.md §13) — a real, separately-priced product
// in this market, not a rename of an existing option.
export type MaterialType = 'HDMR' | 'Plywood' | 'MDF' | 'Particle Board' | 'BWP';

// FinishType used to live here as an enum ('Acrylic' | 'Laminate' | ...).
// It's gone: finishes are now catalogue rows (types/finish.ts), because
// the enum couldn't distinguish "solid white laminate" from "walnut
// laminate". Cabinets carry finishId instead. See that file's header.

export interface HardwareSpec {
  // 'shelf' added with parametric fronts — an open-shelf unit's
  // shelves are real cut-and-edge-banded boards that nothing was
  // charging for. 'cornerMagic'/'cornerCarousel' price the mechanism
  // itself (see lib/fronts.ts's cornerMechanismHardware) — a real
  // component that exists regardless of which door front sits in
  // front of it, which is why it's keyed on moduleType rather than on
  // FrontKind like everything else here.
  type: 'hinge' | 'channel' | 'handle' | 'basket' | 'shelf' | 'cornerMagic' | 'cornerCarousel';
  // Quantity in THIS item's own unit: pieces for hinges, handles,
  // baskets and shelves; drawer channel PAIRS for 'channel'; and
  // running METRES for a gola or edge profile, which is sold by
  // length. bom.ts multiplies count x unitCost regardless, so the
  // arithmetic needs no special case — but the number is not always a
  // piece count. See lib/fronts.ts.
  count: number;
  unitCost: number; // ₹ per unit of the above
}

// The panels a cabinet is built from, for the cutting list AND the
// price (docs/DECISIONS.md §42). Left and right sides are separate
// because an exposed end side often gets a different (finished or
// thicker) board than the hidden one. 'shelves' covers fixed shelves
// and the dividers between a mixed front's rows; 'fronts' covers every
// board front (shutters, drawer/trolley/false fronts, tambour).
export type PanelRole = 'leftSide' | 'rightSide' | 'top' | 'bottom' | 'back' | 'shelves' | 'fronts' | 'drawerBoxes';

export const PANEL_ROLES: PanelRole[] = ['leftSide', 'rightSide', 'top', 'bottom', 'back', 'shelves', 'fronts', 'drawerBoxes'];

export const PANEL_ROLE_LABELS: Record<PanelRole, string> = {
  leftSide: 'Left side',
  rightSide: 'Right side',
  top: 'Top',
  bottom: 'Bottom',
  back: 'Back',
  shelves: 'Shelves & dividers',
  fronts: 'Fronts (shutters, drawer fronts)',
  // §56 — the boxes behind drawer fronts. Unticked = bought ready-made.
  drawerBoxes: 'Drawer boxes',
};

// One panel's choices. EVERY field optional, and absent means the
// default — so a cabinet with no `panels` at all (every cabinet saved
// before §42) is exactly "all panels included, default boards", which
// is what you asked new cabinets to start as too.
export interface PanelSpec {
  // false → this panel isn't built: not on the cutting list, not
  // priced. A sink unit without a back, a niche cabinet without a top.
  included?: boolean;
  // FK -> BoardRate.id on the rate card (types/rates.ts). Absent → the
  // default board for this role (lib/panels.ts's resolvePanels). A
  // dangling id (the line was deleted) also falls back to the default,
  // and the cutting list says so.
  boardId?: string;
  // 'top' only: a full panel, or two rails. Absent → rails for a base
  // unit (one a countertop sits on — the slab covers it), a full panel
  // for everything else. Lives here, with the cabinet, because it
  // changes the price (~₹300 on a 600mm base unit): it's which panels
  // the cabinet has, not how the workshop fits them.
  topStyle?: 'full' | 'rails';
  // 'shelves' only: shelves ADDED to whatever the front layout already
  // gives (an open-shelf or tambour front has its own). For the common
  // "one shelf inside a door cabinet" — the design model had no shelf
  // there at all before §48. Spread evenly through the cabinet's tallest
  // compartment that has no shelves of its own (lib/cutList.ts). Each
  // also adds a "Shelf supports & fitting" hardware line, like any shelf.
  extraCount?: number;
}

export type CabinetPanels = Partial<Record<PanelRole, PanelSpec>>;

// A board part the standard panels don't cover, entered by hand (§48):
// on a CABINET ("+ Add part" in the Cabinet Designer — a stiffener, a
// loft partition) or LOOSE on a project (RoomLayout.looseParts, on the
// Cutting List page — a filler, a plinth, an end panel). Listed on the
// cutting list AND priced like any panel: real area × its board's rate ×
// sheet waste — you agreed a part that's cut must be charged for.
export interface ExtraPart {
  id: string;
  name: string;
  lengthMm: number;
  widthMm: number;
  // On a cabinet: per cabinet (multiplied by the cabinet's quantity).
  quantity: number;
  // FK -> BoardRate.id. Absent on a cabinet part → that cabinet's
  // carcass board. A loose part always names one (there's no cabinet to
  // inherit from).
  boardId?: string;
  // How many LONG / SHORT edges are banded, 0-2 each (same meaning as
  // cutList's EdgeBanding). Default 1 long edge — a visible front edge.
  edgeLong: 0 | 1 | 2;
  edgeShort: 0 | 1 | 2;
}

// One row per cabinet placed on the 2D grid. This is the object Konva.js
// drag events read/write directly, and the same shape is what later gets
// consumed by the Phase 2 panorama renderer for wall-module placement.
// All spatial fields are in millimeters — matches how cabinet hardware,
// carcasses, and shutters are actually specified and cut in the trade.
export interface CornerPanel {
  side: 'left' | 'right';
  widthMm: number;
}

export interface PlacedCabinetItem {
  id: string;
  layoutId: string;          // FK -> RoomLayout.id
  moduleType: ModuleType;
  x: number;                 // mm, top-left corner on grid
  y: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  // Height of the cabinet's BOTTOM face off the floor — 0 for anything
  // floor-standing (base cabinets, tall units, etc.), a positive value
  // for wall-mounted cabinets. Needed so two cabinets sharing the same
  // X/Y footprint (a wall cabinet directly above a base cabinet, with a
  // countertop/appliance zone between them — completely normal in a
  // real kitchen) don't get flagged as colliding — see getCabinetBounds
  // in lib/collision.ts, which is Z-aware specifically because of this
  // field. Defaults come from getDefaultElevationMm() in
  // lib/cabinetGeometry.ts when a new cabinet is added; freely editable
  // per-cabinet afterward via CabinetInspector.
  elevationMm: number;
  rotationDeg: 0 | 90 | 180 | 270;
  material: MaterialType;     // substrate — costing only, never visible
  // The board line (types/rates.ts BoardRate.id) the carcass is cut
  // from — "HDMR 18mm", not just "HDMR". Added 2 Oct 2026 because a
  // material alone didn't say WHICH thickness a cabinet used: the
  // catalogue showed "HDMR" and silently meant "the thickest HDMR line".
  // Kept in sync with `material` (which the quote's Material column,
  // Excel import and the DB check constraint still read). Absent (every
  // cabinet before this) → the material's original 18mm line (see
  // lib/panels.ts's defaultCarcassBoard for why not "thickest"). A per-panel PanelSpec.boardId still overrides it for one
  // panel. See lib/panels.ts and docs/DECISIONS.md §44.
  carcassBoardId?: string;
  // FK -> SurfaceFinish.id (types/finish.ts). Seeded from the catalogue
  // item this cabinet was added from, then freely changed per cabinet
  // (CabinetInspector / the 3D view), which is why it lives here and not
  // only on the catalogue row.
  finishId: string;
  // Per-cabinet colour tweak, independent of the shared finish row —
  // without this, recolouring one cabinet in the 3D view would repaint
  // every cabinet using the same finish. Semantics depend on the
  // finish's pattern: for a SOLID finish it replaces the colour, for a
  // TEXTURED one it multiplies the image (i.e. acts as a stain tint,
  // which is why the default is no override rather than white).
  colorOverride?: string;     // hex
  unitPrice: number;          // ₹ base price per unit before hardware/labor
  quantity: number;           // usually 1; allows repeated identical modules
  // How the front is divided up — doors, drawers, a trolley pull-out —
  // see types/front.ts. This is STRUCTURE, orthogonal to finishId's
  // appearance: a walnut door and a white door are the same front.
  //
  // Optional because every cabinet saved before fronts existed has
  // none; those fall back to defaultFrontLayout(moduleType, widthMm)
  // at read time rather than being migrated, so changing the default
  // rule keeps improving old layouts instead of freezing them.
  frontLayout?: FrontLayout;
  // FK -> HandleSpec.id (types/front.ts). Absent uses the default
  // handle, which is why a legacy cabinet still draws handles.
  handleId?: string;
  // Blind and magic corners only (§116): the part of the front that runs
  // into the corner, behind the meeting run, as a FIXED panel — board and
  // finish like a false front, no hinges, no handle, no swing. The doors
  // (frontLayout) fill the rest of the width. `side` is as you face the
  // cabinet. Absent = the whole width is doors, which is what every corner
  // unit placed before this has, so their quotes don't move; a new one
  // gets it fitted on placement (lib/cornerPanel.ts).
  cornerPanel?: CornerPanel;
  // EXPLICIT hardware override. Nothing populates this — which is why
  // every quote before parametric fronts charged ₹0 of hardware. It's
  // kept so a genuine one-off (a lift-up mechanism, an imported
  // fitting) can be entered by hand, and when present it REPLACES the
  // counts derived from frontLayout. See effectiveHardware in
  // lib/fronts.ts.
  hardware?: HardwareSpec[];
  // Suppresses the red collision highlight/warning for any overlap
  // involving THIS cabinet — see lib/collision.ts. For a known,
  // accepted overlap (e.g. a chimney duct routed through this
  // cabinet's box) rather than an actual mistake. Never affects
  // placement itself (Principle 6: warn, never block) — only whether
  // the warning is shown. Defaults to false/unset.
  ignoreOverlap?: boolean;
  // Same idea as ignoreOverlap, but for the SEPARATE, softer warning
  // in lib/cabinetClearance.ts — this cabinet's door/drawer reach zone
  // crossing another cabinet's, at an L-corner or otherwise. A real
  // physical overlap and an unusable-but-not-overlapping door swing are
  // different problems (clearance.ts's own header comment already
  // makes this distinction for room doors), so they get independent
  // mutes rather than sharing one flag.
  ignoreClearance?: boolean;
  // Which panels this cabinet is built from, and from which boards —
  // see PanelSpec above. Snapshotted from the catalogue row when the
  // cabinet is added (same reasoning as frontLayout: a per-cabinet
  // design decision the designer then changes for this project), and
  // overridable per cabinet. Absent = every panel, default boards.
  panels?: CabinetPanels;
  // Hand-entered parts beyond the standard panels — see ExtraPart.
  // Snapshotted from the catalogue row like `panels`.
  extraParts?: ExtraPart[];
}

/*
Example JSON:

{
  "id": "cab_001",
  "layoutId": "layout_001",
  "moduleType": "sink-unit",
  "x": 600,
  "y": 0,
  "widthMm": 900,
  "depthMm": 600,
  "heightMm": 850,
  "elevationMm": 0,
  "rotationDeg": 0,
  "material": "HDMR",
  "finishId": "finish_default_acrylic",
  "colorOverride": "#E5E0D8",
  "unitPrice": 18500,
  "quantity": 1,
  "hardware": [
    { "type": "hinge", "count": 4, "unitCost": 120 },
    { "type": "channel", "count": 2, "unitCost": 450 }
  ]
}
*/
