// src/types/finish.ts
//
// A SurfaceFinish is one real product a business stocks and sells —
// "Merino Walnut 4102, gloss laminate" — not an abstract category. It
// replaces the old FinishType enum ('Acrylic' | 'Laminate' | ...), which
// conflated three genuinely independent things:
//
//   substrate    HDMR / Plywood / MDF — price and durability, and NEVER
//                visible on a finished cabinet. Stays on the cabinet as
//                `material`, used only for costing.
//   finish type  how the surface responds to light (gloss, clearcoat).
//   pattern      what you actually see: solid colour, wood grain,
//                marble, fabric weave, concrete.
//
// The old enum could not express "solid white laminate" vs "walnut
// laminate" — same finish type, completely different look — nor "white
// acrylic" vs "white PU", same colour with different gloss. Splitting
// pattern from optical response is what fixes both.
//
// finishTypeLabel is now DISPLAY/FILTER ONLY. The optical numbers below
// are stored per finish, so a business can stock two laminates with the
// same pattern at different gloss levels (which really is sold that way)
// without the code needing to know about it.

export type PatternCategory = 'solid' | 'wood' | 'stone' | 'fabric' | 'metallic' | 'concrete';

export const PATTERN_CATEGORY_LABELS: Record<PatternCategory, string> = {
  solid: 'Solid Colour',
  wood: 'Wood Grain',
  stone: 'Stone / Marble',
  fabric: 'Fabric / Textile',
  metallic: 'Metallic',
  concrete: 'Concrete',
};

// Seeds reliefStrength when a finish is created or its category changes.
// Deriving surface relief from an image's luminance is a heuristic that
// is only valid for SOME patterns, which is exactly why this is a
// per-category starting point and not a constant:
//   wood     dark grain lines genuinely ARE recessed pores -> strong
//   fabric   weave shadows are real depth -> strong
//   concrete pitting and aggregate -> moderate
//   stone    dark veins are FLUSH with a polished slab, so deriving
//            relief from them carves grooves that don't exist -> ~0
//   solid    nothing to derive
// Always overridable per finish via the slider (Stage 2).
export const PATTERN_RELIEF_PRESET: Record<PatternCategory, number> = {
  solid: 0,
  wood: 0.7,
  stone: 0.05,
  fabric: 0.5,
  metallic: 0.1,
  concrete: 0.35,
};

export type TilingMode = 'repeat' | 'mirror';

export type FinishSource = 'bundled' | 'uploaded';

export interface SurfaceFinish {
  id: string;
  label: string; // "Merino Walnut 4102"
  brand?: string; // "Merino"
  code?: string; // "4102"
  // Free text now, not an enum — shown in the quote and used to group
  // the picker. Any string is valid; COMMON_FINISH_TYPE_LABELS below is
  // a suggestion list for the UI, not a constraint.
  finishTypeLabel: string;
  patternCategory: PatternCategory;

  // Appearance — exactly one of these is meaningful. A finish is EITHER
  // a flat colour OR an image; they aren't layered. (A per-cabinet
  // colorOverride can tint an image, but that's a cabinet-level
  // override, not part of the finish itself — see
  // PlacedCabinetItem.colorOverride.)
  solidColor?: string; // hex
  albedoUrl?: string; // uploaded swatch or downloaded texture file
  // Falls back to one of the built-in generated textures in
  // lib/textures3d.ts when there's no photographed swatch yet. Keeps the
  // seeded default finishes (Veneer, wood-look Laminate) looking like
  // wood instead of flat colour before a business uploads anything.
  // Must match SurfaceKind in lib/textures3d.ts — kept as a literal
  // union rather than imported so this types file doesn't depend on lib.
  proceduralKind?: 'wood' | 'quartz' | 'tile';

  // Real PBR maps to accompany albedoUrl — from a downloaded CC0 set
  // (Poly Haven, ambientCG) dropped into public/textures/, or anywhere
  // else reachable by URL.
  //
  // These beat the luminance-derived relief in lib/textures3d.ts
  // whenever they're present, and it isn't close: a real normal map
  // encodes the actual surface direction, while deriving one from
  // brightness is a guess that happens to work for wood pores and fails
  // on anything where dark doesn't mean recessed. The derived map stays
  // as the fallback for a business that only has a phone photo.
  //
  // A roughness map is the bigger upgrade of the two, because a finish's
  // single roughness value can't express "glossy tile, matte grout" or
  // the varying sheen across real stone.
  normalMapUrl?: string;
  roughnessMapUrl?: string;

  // 0-1. See PATTERN_RELIEF_PRESET above for why this is per-finish.
  reliefStrength: number;

  // Optical response — how light behaves on this surface. Previously
  // derived from the finish enum; now stored per finish so two
  // laminates can differ in gloss.
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  metalness: number;

  // What real-world area one copy of albedoUrl covers. Without this a
  // 300mm photographed swatch tiles as though it were 1200mm and the
  // grain renders four times too large. Ignored for solid colours.
  swatchWidthMm: number;
  swatchHeightMm: number;
  // Photographed swatches don't tile seamlessly; 'mirror' flips
  // alternate copies so edges always match. Costs a little realism
  // (visible symmetry) but removes hard seams, which read as far worse.
  tilingMode: TilingMode;

  // Finish cost per square metre of finished (shutter) area, added on
  // top of the cabinet's own unitPrice — see calculateBOM. This is why
  // switching a cabinet from laminate to acrylic now moves the quote
  // instead of only the render.
  pricePerSqM: number;

  source: FinishSource;
  createdAt: string;
  updatedAt: string;
}

// Suggestions for the finish-type field. Not exhaustive and not
// enforced — a business selling something not on this list should be
// able to type it.
export const COMMON_FINISH_TYPE_LABELS = [
  'Laminate',
  'Acrylic',
  'PU',
  'Veneer',
  'Membrane',
] as const;

// Prefills the optical numbers when creating a finish of a given type,
// so a user picking "Acrylic" gets glossy defaults instead of having to
// know what clearcoat means. These are the same values the old
// materials3d.ts hardcoded per enum value.
export const FINISH_TYPE_OPTICAL_PRESET: Record<
  string,
  Pick<SurfaceFinish, 'roughness' | 'clearcoat' | 'clearcoatRoughness' | 'metalness'>
> = {
  Acrylic: { roughness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1, metalness: 0.05 },
  PU: { roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2, metalness: 0.05 },
  Laminate: { roughness: 0.45, clearcoat: 0, clearcoatRoughness: 0, metalness: 0.05 },
  Membrane: { roughness: 0.55, clearcoat: 0, clearcoatRoughness: 0, metalness: 0.05 },
  Veneer: { roughness: 0.6, clearcoat: 0, clearcoatRoughness: 0, metalness: 0.05 },
};

export const FALLBACK_OPTICAL_PRESET = FINISH_TYPE_OPTICAL_PRESET.Laminate;

// Seeded in supabase/schema.sql. Existing cabinets are backfilled to
// these during the migration, one per old enum value, so nothing loses
// its finish — see normalizeCabinet in lib/Persistence.ts.
export const DEFAULT_FINISH_IDS: Record<string, string> = {
  Acrylic: 'finish_default_acrylic',
  Laminate: 'finish_default_laminate',
  PU: 'finish_default_pu',
  Veneer: 'finish_default_veneer',
  Membrane: 'finish_default_membrane',
};

// What a cabinet falls back to when its finishId is missing or points at
// a deleted finish — the app must always be able to render something.
export const FALLBACK_FINISH_ID = DEFAULT_FINISH_IDS.Laminate;

export function findFinish(
  finishes: SurfaceFinish[],
  finishId: string | undefined
): SurfaceFinish | undefined {
  if (!finishId) return undefined;
  return finishes.find((f) => f.id === finishId);
}

// Resolves the finish actually used for rendering/costing: the one
// referenced, else the fallback, else the first available. Centralized
// so a dangling finishId degrades gracefully everywhere instead of
// crashing in one component and rendering black in another.
export function resolveFinish(
  finishes: SurfaceFinish[],
  finishId: string | undefined
): SurfaceFinish | undefined {
  return findFinish(finishes, finishId) ?? findFinish(finishes, FALLBACK_FINISH_ID) ?? finishes[0];
}
