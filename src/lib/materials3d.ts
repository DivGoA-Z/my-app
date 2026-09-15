// src/lib/materials3d.ts
//
// Turns a SurfaceFinish (types/finish.ts) plus an optional per-cabinet
// colour override into the concrete numbers Room3DCanvas hands to
// <meshPhysicalMaterial>.
//
// WHAT CHANGED AND WHY: this file used to map a MaterialType x
// FinishType enum pair to a preset, with the cabinet's COLOUR coming
// from its substrate (HDMR beige, Plywood tan). That was wrong twice
// over — a finished cabinet never shows its substrate, and one enum
// value like 'Laminate' can't represent both solid white and walnut,
// which are different products at different prices. Appearance now
// comes entirely from the finish row; substrate survives only as a
// costing input on the cabinet.
//
// clearcoat is still how gloss is modelled: real gloss on a kitchen
// shutter comes from LOW roughness plus a thin clear top coat, not from
// metalness. Matte finishes carry clearcoat 0, which makes
// MeshPhysicalMaterial render identically to MeshStandardMaterial — so
// Room3DCanvas can use one material type with no branching.

import type { SurfaceFinish } from '../types/finish';
import { FALLBACK_OPTICAL_PRESET } from '../types/finish';

export interface ResolvedMaterial {
  // Multiplied against the albedo map when there is one, so it must be
  // white for an untinted textured finish — see the comment on
  // colorOverride in types/cabinet.ts.
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  // True when this finish renders from an image rather than a flat
  // colour. Room3DCanvas uses it to decide whether to attach maps.
  isTextured: boolean;
  // Multiplier on the normal map's strength. Normal maps are baked once
  // at a fixed reference depth (both the procedural ones and those
  // derived from uploaded swatches), and this is what actually makes
  // the relief slider do something — re-baking per slider value would
  // mean regenerating and caching a texture on every 0.05 step, and
  // wouldn't work at all for the shared procedural maps.
  normalScale: number;
}

// reliefStrength value that corresponds to "as authored" — the wood
// preset, i.e. pronounced but not exaggerated relief. Below it the
// surface flattens; above it the bumps deepen past what the map was
// baked with.
const RELIEF_REFERENCE = 0.7;
const MAX_NORMAL_SCALE = 2;

function reliefToNormalScale(reliefStrength: number): number {
  return Math.min(MAX_NORMAL_SCALE, Math.max(0, reliefStrength / RELIEF_REFERENCE));
}

const NEUTRAL_FALLBACK_COLOR = '#dcd7cf';
const UNTINTED = '#ffffff';

export function resolveMaterial(
  finish: SurfaceFinish | undefined,
  colorOverride?: string
): ResolvedMaterial {
  // A cabinet can outlive the finish it referenced (deleted from the
  // catalogue), and the app still has to render something rather than
  // crash or go black.
  if (!finish) {
    return {
      color: colorOverride ?? NEUTRAL_FALLBACK_COLOR,
      ...FALLBACK_OPTICAL_PRESET,
      isTextured: false,
      normalScale: 0,
    };
  }

  const isTextured = Boolean(finish.albedoUrl || finish.proceduralKind);

  // Solid finish: the override replaces the colour outright.
  // Textured finish: the override MULTIPLIES the image, i.e. acts as a
  // stain tint — so with no override we must pass white, not the
  // finish's solidColor, or the texture would be tinted by a colour
  // that isn't part of the product.
  const color = isTextured
    ? colorOverride ?? UNTINTED
    : colorOverride ?? finish.solidColor ?? NEUTRAL_FALLBACK_COLOR;

  return {
    color,
    roughness: finish.roughness,
    metalness: finish.metalness,
    clearcoat: finish.clearcoat,
    clearcoatRoughness: finish.clearcoatRoughness,
    isTextured,
    normalScale: reliefToNormalScale(finish.reliefStrength),
  };
}

// Short human label for a finish, used in the quote and pickers —
// "Merino Walnut 4102 (Laminate)" when brand/code exist, else just the
// label and type.
export function describeFinish(finish: SurfaceFinish | undefined): string {
  if (!finish) return 'Unspecified finish';
  const name = [finish.brand, finish.label].filter(Boolean).join(' ');
  return finish.finishTypeLabel ? `${name} (${finish.finishTypeLabel})` : name;
}
