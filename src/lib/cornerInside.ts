// src/lib/cornerInside.ts
//
// What's INSIDE a placed corner unit (§148), switchable on the cabinet
// itself instead of only by which catalogue item was placed. Each choice
// maps onto what the app already prices, so no new rate exists:
//
//   shelves   corner-blind: fixed shelves, no mechanism
//   magic     corner-magic: + the magic-corner pull-out (rate card)
//   carousel  corner-carousel: + the carousel / lazy susan (rate card)
//   cylinder  corner-blind with ONE trolley pull-out front: the LPG
//             cylinder on a pull-out, priced as a cylinder trolley unit
//             is (a channel pair and a basket, lib/fronts.ts 'trolley')
//
// Cylinder is not a module type of its own: a blind corner whose door is
// a single pull-out IS that unit, and a new type would ripple through
// every label table, the catalogue's type check and the cutting list.

import type { PlacedCabinetItem } from '../types/cabinet';

export type CornerInside = 'shelves' | 'magic' | 'carousel' | 'cylinder';

export const CORNER_INSIDE_LABELS: Record<CornerInside, string> = {
  shelves: 'Shelves (blind corner)',
  magic: 'Magic corner',
  carousel: 'Carousel',
  cylinder: 'Cylinder trolley',
};

export const CORNER_INSIDES: CornerInside[] = ['shelves', 'magic', 'carousel', 'cylinder'];

// Null for anything that isn't a corner unit.
export function cornerInsideOf(c: Pick<PlacedCabinetItem, 'moduleType' | 'frontLayout'>): CornerInside | null {
  switch (c.moduleType) {
    case 'corner-blind':
      return c.frontLayout?.kind === 'trolley' ? 'cylinder' : 'shelves';
    case 'corner-magic':
      return 'magic';
    case 'corner-carousel':
      return 'carousel';
    default:
      return null;
  }
}

// The change that makes it so. Leaving the cylinder drops its pull-out
// front back to the unit's default; any other front is kept.
export function cornerInsideChange(
  c: Pick<PlacedCabinetItem, 'moduleType' | 'frontLayout'>,
  inside: CornerInside
): Pick<PlacedCabinetItem, 'moduleType' | 'frontLayout'> {
  if (inside === 'cylinder') return { moduleType: 'corner-blind', frontLayout: { kind: 'trolley', count: 1 } };
  const moduleType = inside === 'magic' ? 'corner-magic' : inside === 'carousel' ? 'corner-carousel' : 'corner-blind';
  return { moduleType, frontLayout: cornerInsideOf(c) === 'cylinder' ? undefined : c.frontLayout };
}
