// src/lib/standardSizes.ts
//
// One standard depth × height per kind of unit (§147): every base unit
// the same depth and height, every wall unit, every tall unit, so runs
// line up and the countertop, the wall-unit line and the cutting list
// stay regular. Width is what varies.
//
// A standard, not a lock: a catalogue cabinet that differs is FLAGGED
// (with "Use standard" / "Keep as exception"), never changed silently.
// Corner units follow the base HEIGHT, but their depth is exempt: their
// footprint is the corner's (900 × 900 in the library), not a run's.
//
// Stored per business in construction_settings.standard_sizes, beside
// (not inside) `settings`, like the style defaults (§117): a standard
// prices nothing, and `settings` is part of every quote's context.

import type { ModuleType } from '../types/cabinet';
import type { CatalogItem } from '../types/Catalog';

export type SizeGroup = 'base' | 'wall' | 'tall';

export interface DepthHeight {
  depthMm: number;
  heightMm: number;
}

export type StandardSizes = Record<SizeGroup, DepthHeight>;

// What the library catalogue already uses (schema.sql seeds).
export const DEFAULT_STANDARD_SIZES: StandardSizes = {
  base: { depthMm: 600, heightMm: 850 },
  wall: { depthMm: 300, heightMm: 700 },
  tall: { depthMm: 600, heightMm: 2100 },
};

export const SIZE_GROUP_LABELS: Record<SizeGroup, string> = {
  base: 'Base units',
  wall: 'Wall units',
  tall: 'Tall units',
};

const CORNERS: ModuleType[] = ['corner-blind', 'corner-magic', 'corner-carousel'];

export function sizeGroup(moduleType: ModuleType): SizeGroup {
  if (moduleType === 'wall-cabinet') return 'wall';
  if (moduleType === 'tall-unit' || moduleType === 'pantry-unit') return 'tall';
  return 'base';
}

// The standard for this kind of unit; `depthMm` is absent for a corner.
export function standardFor(moduleType: ModuleType, std: StandardSizes): { depthMm?: number; heightMm: number } {
  const g = std[sizeGroup(moduleType)];
  return CORNERS.includes(moduleType) ? { heightMm: g.heightMm } : { depthMm: g.depthMm, heightMm: g.heightMm };
}

// How the item differs from its standard, or null when it doesn't.
export function sizeDeviation(
  item: Pick<CatalogItem, 'moduleType' | 'depthMm' | 'heightMm'>,
  std: StandardSizes
): { depthMm?: number; heightMm?: number } | null {
  const s = standardFor(item.moduleType, std);
  const out: { depthMm?: number; heightMm?: number } = {};
  if (s.depthMm !== undefined && item.depthMm !== s.depthMm) out.depthMm = s.depthMm;
  if (item.heightMm !== s.heightMm) out.heightMm = s.heightMm;
  return Object.keys(out).length ? out : null;
}

// Catalogue cabinets off the standard that nobody has kept on purpose.
export function nonStandardItems<T extends Pick<CatalogItem, 'moduleType' | 'depthMm' | 'heightMm' | 'sizeException'>>(
  items: T[],
  std: StandardSizes
): T[] {
  return items.filter((i) => !i.sizeException && sizeDeviation(i, std));
}

// The item at its standard depth (unless a corner) and height.
export function withStandardSize<T extends Pick<CatalogItem, 'moduleType' | 'depthMm' | 'heightMm'>>(item: T, std: StandardSizes): T {
  const s = standardFor(item.moduleType, std);
  return { ...item, depthMm: s.depthMm ?? item.depthMm, heightMm: s.heightMm };
}

// A stored value is trusted only where it's a sane number; anything else
// falls back to the default, so a half-saved row can't break the page.
export function normalizeStandardSizes(raw: unknown): StandardSizes {
  const r = (raw ?? {}) as Partial<Record<SizeGroup, Partial<DepthHeight>>>;
  const ok = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback);
  const group = (g: SizeGroup): DepthHeight => ({
    depthMm: ok(r[g]?.depthMm, DEFAULT_STANDARD_SIZES[g].depthMm),
    heightMm: ok(r[g]?.heightMm, DEFAULT_STANDARD_SIZES[g].heightMm),
  });
  return { base: group('base'), wall: group('wall'), tall: group('tall') };
}
