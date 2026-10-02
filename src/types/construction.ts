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
// WHY NOT ON THE RATE CARD
// The rate card is hashed into every frozen quote's fingerprint
// (types/quote.ts). Construction doesn't change a single rupee of the
// price (pricing is area-based — Principle 2), so storing it there would
// mark every frozen quote "design has changed" whenever someone adjusted
// a groove depth. Separate row, separate store field, never reaches
// PricingContext.

// Top and bottom panels, each set independently — a carpenter can
// capture the bottom between the sides but run the top over them.
//   'between-sides' → the sides run the full cabinet height and this
//                     panel fits between them: width = W − 2T.
//   'over-sides'    → this panel runs the full cabinet width and the
//                     sides stop short of it: side height loses T.
export type PanelFit = 'between-sides' | 'over-sides';

// How the back is fixed.
//   'grooved'     → a thin back slides into a groove cut in the sides,
//                   top and bottom: back = inner opening + groove depth
//                   on each side, at backThicknessMm.
//   'nailed-on'   → a thin back nailed/screwed over the rear edges:
//                   back = full W × H, and the carcass loses its
//                   thickness from depth so the cabinet stays D deep.
//   'inset-full'  → a full-thickness back (same board as the carcass)
//                   fitted between the sides, top and bottom; top,
//                   bottom and shelves lose T of depth to make room.
export type BackFit = 'grooved' | 'nailed-on' | 'inset-full';

// Top of a BASE cabinet (one the countertop sits on). Wall and tall
// units always get a full top — nothing covers them.
//   'rails' → a front and a back rail of railWidthMm instead of a full
//             panel; the countertop hides the gap and it saves board.
//   'full'  → a full top panel, same as a wall unit.
export type BaseTop = 'rails' | 'full';

// Drawer boxes.
//   'tandem' → metal-sided boxes (the channel system supplies the
//              sides); the workshop cuts only the bottom and back.
//   'wooden' → the workshop cuts all four sides and the bottom.
// NOT YET USED by the cutting list — drawer box parts are phase 3
// (docs/STATUS.md). Stored now so the choice is recorded, and labelled
// as not-yet-applied in the settings screen rather than silently
// ignored (Principle 10).
export type DrawerBox = 'tandem' | 'wooden';

export interface ConstructionSettings {
  id: string;
  // Carcass board thickness — sides, top, bottom, rails, shelves,
  // dividers. 18mm is the local standard for HDMR/ply.
  carcassThicknessMm: number;
  topFit: PanelFit;
  bottomFit: PanelFit;
  backFit: BackFit;
  // Thickness of a 'grooved' or 'nailed-on' back. Ignored for
  // 'inset-full', which uses carcassThicknessMm.
  backThicknessMm: number;
  // How far a 'grooved' back sits into each groove. Ignored otherwise.
  grooveDepthMm: number;
  baseTop: BaseTop;
  // Width (front-to-back) of each base-unit rail when baseTop = 'rails'.
  railWidthMm: number;
  // How far shelves and dividers stop short of the carcass front, so a
  // door closes past them.
  shelfSetbackMm: number;
  drawerBox: DrawerBox;
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
// typical, not measured: 6mm back in an 8mm groove, 100mm rails, 20mm
// shelf setback.
export const DEFAULT_CONSTRUCTION: Omit<ConstructionSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  carcassThicknessMm: 18,
  topFit: 'between-sides',
  bottomFit: 'between-sides',
  backFit: 'grooved',
  backThicknessMm: 6,
  grooveDepthMm: 8,
  baseTop: 'rails',
  railWidthMm: 100,
  shelfSetbackMm: 20,
  drawerBox: 'tandem',
  confirmed: false,
};

// Fresh id per call, same reasoning as defaultRateCard: a business with
// no row yet gets this, and saving it creates the row with this id.
export function defaultConstructionSettings(): ConstructionSettings {
  const now = new Date().toISOString();
  return { ...DEFAULT_CONSTRUCTION, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

export const PANEL_FIT_LABELS: Record<PanelFit, string> = {
  'between-sides': 'Between the sides',
  'over-sides': 'Over / under the sides (full width)',
};

export const BACK_FIT_LABELS: Record<BackFit, string> = {
  grooved: 'Thin back, grooved in',
  'nailed-on': 'Thin back, nailed on the rear',
  'inset-full': 'Full-thickness back, inset',
};

export const BASE_TOP_LABELS: Record<BaseTop, string> = {
  rails: 'Two rails (front and back)',
  full: 'Full top panel',
};

export const DRAWER_BOX_LABELS: Record<DrawerBox, string> = {
  tandem: 'Tandem / metal-sided (cut bottom + back only)',
  wooden: 'Wooden box (cut all sides + bottom)',
};

const PANEL_FITS = Object.keys(PANEL_FIT_LABELS) as PanelFit[];
const BACK_FITS = Object.keys(BACK_FIT_LABELS) as BackFit[];
const BASE_TOPS = Object.keys(BASE_TOP_LABELS) as BaseTop[];
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
    carcassThicknessMm: positive(s.carcassThicknessMm, d.carcassThicknessMm),
    topFit: pick(s.topFit, PANEL_FITS, d.topFit),
    bottomFit: pick(s.bottomFit, PANEL_FITS, d.bottomFit),
    backFit: pick(s.backFit, BACK_FITS, d.backFit),
    backThicknessMm: positive(s.backThicknessMm, d.backThicknessMm),
    grooveDepthMm: nonNegative(s.grooveDepthMm, d.grooveDepthMm),
    baseTop: pick(s.baseTop, BASE_TOPS, d.baseTop),
    railWidthMm: positive(s.railWidthMm, d.railWidthMm),
    shelfSetbackMm: nonNegative(s.shelfSetbackMm, d.shelfSetbackMm),
    drawerBox: pick(s.drawerBox, DRAWER_BOXES, d.drawerBox),
    confirmed: s.confirmed === true,
    createdAt: s.createdAt ?? now,
    updatedAt: s.updatedAt ?? now,
  };
}
