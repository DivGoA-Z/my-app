// src/lib/backdrop.ts
//
// The 3D wall view's backdrop, chosen to contrast with what's in front
// of it (§93): a mostly light wall of units (white or ivory fronts on
// plaster, the common case) gets a dark backdrop so its outline reads;
// a darker one (wood, a coloured wall) gets a light backdrop.
//
// "Light" is perceptual lightness (CIE L*, 0–1), not raw RGB, so a
// saturated yellow and a pale grey of similar brightness count alike.
// Each surface is weighted by the area it shows. A textured finish has
// no single colour; unless it carries a solid colour, its kind stands in
// (wood reads dark-to-mid, quartz and tile light, a photo mid). That's
// an estimate, but the choice is only light-or-dark, so it only has to
// land on the right side.

import type { SurfaceFinish } from '../types/finish';

export const BACKDROP_LIGHT = '#e8e5df';
export const BACKDROP_DARK = '#4f4b45';
// Above this average lightness the scene counts as light.
export const LIGHT_SCENE_L = 0.78;

// Bare plaster, as the 3D view draws an unfinished wall.
export const PLASTER_L = lightnessOfHex('#f5f3ef');

const TEXTURE_L: Record<NonNullable<SurfaceFinish['proceduralKind']>, number> = {
  wood: 0.45,
  quartz: 0.82,
  tile: 0.8,
};
const PHOTO_L = 0.55;

export function lightnessOfHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const l = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  return l / 100;
}

// How light a surface looks: an explicit colour override first, then
// the finish's solid colour, then its texture kind; no finish = plaster.
export function surfaceLightness(
  finish: Pick<SurfaceFinish, 'solidColor' | 'albedoUrl' | 'proceduralKind'> | undefined,
  colorOverride?: string
): number {
  if (colorOverride) return lightnessOfHex(colorOverride);
  if (!finish) return PLASTER_L;
  if (finish.solidColor && !finish.albedoUrl && !finish.proceduralKind) return lightnessOfHex(finish.solidColor);
  if (finish.proceduralKind) return TEXTURE_L[finish.proceduralKind];
  if (finish.albedoUrl) return finish.solidColor ? lightnessOfHex(finish.solidColor) : PHOTO_L;
  return finish.solidColor ? lightnessOfHex(finish.solidColor) : PLASTER_L;
}

export function contrastingBackdrop(samples: { lightness: number; weight: number }[]): string {
  const total = samples.reduce((t, s) => t + Math.max(0, s.weight), 0);
  if (total <= 0) return BACKDROP_DARK; // an empty wall is bare plaster: light
  const avg = samples.reduce((t, s) => t + s.lightness * Math.max(0, s.weight), 0) / total;
  return avg >= LIGHT_SCENE_L ? BACKDROP_DARK : BACKDROP_LIGHT;
}
