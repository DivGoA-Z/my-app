// src/types/construction.ts
//
// How the business's workshop BUILDS a cabinet — the carpenter's
// conventions a cutting list depends on. One row per business
// (`construction_settings` table, supabase/schema.sql).
//
// WHY THIS EXISTS
// docs/PRINCIPLES.md used to say the cutting list was blocked until the
// carpenter answered "is the bottom between the sides or under them? is
// the back grooved in or nailed on?" — because those answers change
// every panel dimension. Instead of waiting, each answer is a SETTING
// with every real alternative selectable, pre-filled with the common
// Delhi NCR modular-kitchen convention. The cutting list is then exact
// for whatever the settings say, and the carpenter's real answer is a
// settings change, never a code change. See docs/DECISIONS.md §41.
//
// WHY ITS OWN ROW, NOT A COLUMN ON THE RATE CARD
// Originally (§41) because construction didn't change the price and the
// rate card is hashed into every frozen quote's fingerprint. CORRECTED
// in §42: board is now priced on the cutting list's real part sizes, so
// construction DOES move the price — by a few millimetres' worth — and
// it is passed into pricing as PricingContext.construction and hashed
// into the fingerprint like every other priced input. It stays its own
// row anyway: it describes how the workshop builds, not what anything
// costs, and is edited on its own screen.

// Top and bottom panels, each set independently — a carpenter can
// capture the bottom between the sides but run the top over them.
//   'between-sides' → the sides run the full cabinet height and this
//                     panel fits between them: width = W − 2T.
//   'over-sides'    → this panel runs the full cabinet width and the
//                     sides stop short of it: side height loses T.
export type PanelFit = 'between-sides' | 'over-sides';

// How the back is fixed. Its THICKNESS is not here — it's the back's own
// board (PanelSpec in types/cabinet.ts, default the rate card's default
// back board).
//   'grooved'     → the back slides into a groove cut in the sides, top
//                   and bottom: back = inner opening + groove depth on
//                   each side.
//   'nailed-on'   → the back is nailed/screwed over the rear edges:
//                   back = full W × H, and the carcass loses the back's
//                   thickness from depth so the cabinet stays D deep.
//   'inset-full'  → the back is fitted INSIDE the carcass, between the
//                   sides, top and bottom (usually a full-thickness
//                   board); top, bottom and shelves lose its thickness
//                   of depth to make room. The id says "full" for
//                   history — §41 tied it to the carcass thickness; since
//                   §42 the back's board decides.
export type BackFit = 'grooved' | 'nailed-on' | 'inset-full';

// (BaseTop — "two rails vs full top on a base unit" — lived here in
// §41-§42. MOVED to the cabinet's own top panel (PanelSpec.topStyle in
// types/cabinet.ts) on 2 Oct 2026: it isn't how the workshop fits
// panels, it's WHICH panels a cabinet has, and it moves the price by
// ~₹300 on a 600mm base unit where every setting left on this page moves
// it by ₹0-30. Pricing choices live with the cabinet in the catalogue;
// this page is how the workshop builds. A stored row that still has
// `baseTop` is simply ignored.)

// Drawer boxes.
//   'tandem' → metal-sided boxes (the channel system supplies the
//              sides); the workshop cuts only the bottom and back.
//   'wooden' → the workshop cuts all four sides and the bottom.
// Used by the cutting list and price since §56 — see the drawer sizing
// fields on ConstructionSettings.
export type DrawerBox = 'tandem' | 'wooden';

// Where fronts (shutters, drawer fronts…) are cut from (§57).
//   'carcass-board' → the same plain board as the carcass, laminated
//                     after cutting: fronts share sheets with carcass
//                     parts of that board, and can turn on the sheet
//                     (plain HDMR/MDF has no grain; the laminate's grain
//                     is lined up when it's pressed on). Your answer.
//   'prelaminated'  → sheets already laminated: fronts get their own
//                     sheets per finish, and a patterned finish keeps
//                     its grain direction (only a solid colour can turn).
export type FrontsFrom = 'carcass-board' | 'prelaminated';

export interface ConstructionSettings {
  id: string;
  // (carcassThicknessMm and backThicknessMm lived here in §41. Removed in
  // §42: every panel's thickness is now its own board line's thickness,
  // so one number can't contradict the board a panel is actually cut
  // from. A stored row that still has them is simply ignored.)
  topFit: PanelFit;
  bottomFit: PanelFit;
  backFit: BackFit;
  // How far a 'grooved' back sits into each groove. Ignored otherwise.
  grooveDepthMm: number;
  // Width (front-to-back) of each rail, for any cabinet whose top panel
  // is rails (PanelSpec.topStyle).
  railWidthMm: number;
  // How far shelves and dividers stop short of the carcass front, so a
  // door closes past them.
  shelfSetbackMm: number;
  drawerBox: DrawerBox;
  frontsFrom: FrontsFrom;
  // ---- Drawer box sizing (§56) ----
  // Defaults follow the common tandem-box rules of thumb; every brand
  // publishes its own, so a workshop sets these once from its system's
  // sheet. Runner (nominal) length is picked automatically: the longest
  // standard length, 270–650mm in 50mm steps, that fits the cabinet's
  // inner depth with 10mm to spare.
  // Tandem: the workshop cuts a bottom and a back per drawer.
  tandemBottomWidthDeductionMm: number; // bottom width = inner width − this
  tandemBottomDepthDeductionMm: number; // bottom depth = runner length − this
  tandemBackWidthDeductionMm: number; // back width = inner width − this
  tandemBackHeightReductionMm: number; // back height = drawer front height − this
  // Wooden: two sides, an inner front, a back, and a bottom grooved in.
  woodenSlideClearanceMm: number; // total, both sides — box width = inner width − this
  woodenBoxHeightReductionMm: number; // box height = drawer front height − this
  // What a cabinet's stated depth (e.g. "600") measures.
  //   true  → the finished cabinet INCLUDING the shutter: the carcass
  //           behind it is 600 − shutter thickness (582). The app's
  //           original convention (lib/fronts.ts: fronts are inset into
  //           the stated depth).
  //   false → the CARCASS alone; the shutter adds its thickness in
  //           front (finished cabinet 618).
  // Many workshops say "600" for the carcass, so this is the most likely
  // real mismatch with a carpenter — and it moves every side, top,
  // bottom and shelf on the cutting list by a shutter's thickness (§47).
  //
  // Followed everywhere since §61 — cutting list, price, and the 2D plan,
  // 3D view, collision/clearance checks, countertop and floor areas (via
  // lib/physicalDepth.ts). A project can override it
  // (RoomLayout.depthIncludesFront). (Until §61 only the cutting list and
  // price followed it — the plan drew a carcass-only cabinet 18mm short.)
  depthIncludesFront: boolean;
  // Sheet nesting (lib/nesting.ts, §49): the saw blade's cut width
  // (kerf) and how much of each factory edge is trimmed off before
  // cutting — how THIS workshop cuts. (The sheet SIZE lived here too
  // until §52; it moved onto each board line, BoardRate.sheetSizes,
  // because different boards — and one board — come in different sizes.)
  kerfMm: number;
  sheetTrimMm: number;
  // False until the business says its carpenter has checked these.
  // While false, the cutting list shows an amber "assumed construction"
  // banner — same reasoning as the placeholder-rates banner: a workshop
  // must never cut from guesses without being told they are guesses.
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

// Your answers (29 Sep 2026) — the common Delhi NCR convention, and
// still ASSUMPTIONS until your carpenter confirms them. Numbers are
// typical, not measured: an 8mm groove, 100mm rails, 20mm shelf
// setback. Board thicknesses come from the rate card's board lines.
export const DEFAULT_CONSTRUCTION: Omit<ConstructionSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  topFit: 'between-sides',
  bottomFit: 'between-sides',
  backFit: 'grooved',
  grooveDepthMm: 8,
  railWidthMm: 100,
  shelfSetbackMm: 20,
  drawerBox: 'tandem',
  frontsFrom: 'carcass-board',
  tandemBottomWidthDeductionMm: 75,
  tandemBottomDepthDeductionMm: 10,
  tandemBackWidthDeductionMm: 87,
  tandemBackHeightReductionMm: 60,
  woodenSlideClearanceMm: 25,
  woodenBoxHeightReductionMm: 40,
  depthIncludesFront: true,
  kerfMm: 4,
  sheetTrimMm: 10,
  confirmed: false,
};

// Fresh id per call, same reasoning as defaultRateCard: a business with
// no row yet gets this, and saving it creates the row with this id.
export function defaultConstructionSettings(): ConstructionSettings {
  const now = new Date().toISOString();
  return { ...DEFAULT_CONSTRUCTION, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

// Worded per panel by the settings screen ("sits on top of the sides"
// for the top, "sides stand on it" for the bottom) — see
// TOP_FIT_LABELS/BOTTOM_FIT_LABELS below. One carcass top, one carcass
// bottom; these say how each MEETS the sides, nothing more.
export const TOP_FIT_LABELS: Record<PanelFit, string> = {
  'between-sides': 'Fitted between the two sides',
  'over-sides': 'Sits on top of the two sides (full width)',
};

export const BOTTOM_FIT_LABELS: Record<PanelFit, string> = {
  'between-sides': 'Fitted between the two sides',
  'over-sides': 'Sides stand on it (full width)',
};

export const BACK_FIT_LABELS: Record<BackFit, string> = {
  grooved: 'Back grooved in',
  'nailed-on': 'Back nailed on the rear',
  'inset-full': 'Back fitted inside the carcass (inset)',
};

// depthIncludesFront as a two-option picker. Keys are strings because
// the settings screen's dropdown works in strings.
export type DepthConvention = 'includes-front' | 'carcass-only';
export const DEPTH_CONVENTION_LABELS: Record<DepthConvention, string> = {
  'includes-front': 'Includes the shutter (600 = finished cabinet, carcass 582)',
  'carcass-only': 'Carcass only (600 = carcass, shutter adds in front)',
};

export const FRONTS_FROM_LABELS: Record<FrontsFrom, string> = {
  'carcass-board': 'Same board as the carcass, laminated after',
  prelaminated: 'Pre-laminated sheets (own sheets per finish)',
};

export const DRAWER_BOX_LABELS: Record<DrawerBox, string> = {
  tandem: 'Tandem / metal-sided (cut bottom + back only)',
  wooden: 'Wooden box (cut all sides + bottom)',
};

const PANEL_FITS = Object.keys(TOP_FIT_LABELS) as PanelFit[];
const BACK_FITS = Object.keys(BACK_FIT_LABELS) as BackFit[];
const DRAWER_BOXES = Object.keys(DRAWER_BOX_LABELS) as DrawerBox[];

// Clamp-don't-reject, same as sanitizeRateCard: an unknown enum value
// (a hand-edited row, a future option loaded by an older build) falls
// back to the default rather than throwing, and a thickness can't go to
// zero or negative — a 0mm board would produce a cutting list that
// looks fine and is physically nonsense.
export function sanitizeConstruction(s: Partial<ConstructionSettings> & { id: string }): ConstructionSettings {
  const d = DEFAULT_CONSTRUCTION;
  const pick = <T,>(value: T | undefined, allowed: T[], fallback: T) =>
    value !== undefined && allowed.includes(value) ? value : fallback;
  const positive = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const nonNegative = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
  const now = new Date().toISOString();
  return {
    id: s.id,
    topFit: pick(s.topFit, PANEL_FITS, d.topFit),
    bottomFit: pick(s.bottomFit, PANEL_FITS, d.bottomFit),
    backFit: pick(s.backFit, BACK_FITS, d.backFit),
    grooveDepthMm: nonNegative(s.grooveDepthMm, d.grooveDepthMm),
    railWidthMm: positive(s.railWidthMm, d.railWidthMm),
    shelfSetbackMm: nonNegative(s.shelfSetbackMm, d.shelfSetbackMm),
    drawerBox: pick(s.drawerBox, DRAWER_BOXES, d.drawerBox),
    frontsFrom: s.frontsFrom === 'prelaminated' ? 'prelaminated' : 'carcass-board',
    tandemBottomWidthDeductionMm: nonNegative(s.tandemBottomWidthDeductionMm, d.tandemBottomWidthDeductionMm),
    tandemBottomDepthDeductionMm: nonNegative(s.tandemBottomDepthDeductionMm, d.tandemBottomDepthDeductionMm),
    tandemBackWidthDeductionMm: nonNegative(s.tandemBackWidthDeductionMm, d.tandemBackWidthDeductionMm),
    tandemBackHeightReductionMm: nonNegative(s.tandemBackHeightReductionMm, d.tandemBackHeightReductionMm),
    woodenSlideClearanceMm: nonNegative(s.woodenSlideClearanceMm, d.woodenSlideClearanceMm),
    woodenBoxHeightReductionMm: nonNegative(s.woodenBoxHeightReductionMm, d.woodenBoxHeightReductionMm),
    // Missing (a row saved before §47) → the original convention.
    depthIncludesFront: s.depthIncludesFront !== false,
    kerfMm: nonNegative(s.kerfMm, d.kerfMm),
    sheetTrimMm: nonNegative(s.sheetTrimMm, d.sheetTrimMm),
    confirmed: s.confirmed === true,
    createdAt: s.createdAt ?? now,
    updatedAt: s.updatedAt ?? now,
  };
}
