// src/test/fixtures.ts
//
// Shared builders for the test suite (docs/DECISIONS.md §55). Kept
// deliberately plain: a cabinet is only the fields pricing and the
// cutting list read, a layout only what calculateBOM reads, and the
// rate card / construction are the app's own seeded defaults — so a test
// pins the app's real defaults, and changing a seeded rate on purpose
// makes the affected tests fail loudly, which is the point.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { RoomLayout } from '../types/layout';
import { defaultRateCard, type RateCard } from '../types/rates';
import { defaultConstructionSettings, type ConstructionSettings } from '../types/construction';
import type { PricingContext } from '../lib/bom';

let seq = 0;

export function cabinet(
  moduleType: PlacedCabinetItem['moduleType'],
  widthMm: number,
  depthMm: number,
  heightMm: number,
  extra: Partial<PlacedCabinetItem> = {}
): PlacedCabinetItem {
  seq += 1;
  return {
    id: `cab-${seq}`,
    layoutId: 'layout-1',
    moduleType,
    x: 0,
    y: 0,
    widthMm,
    depthMm,
    heightMm,
    elevationMm: moduleType === 'wall-cabinet' ? 1450 : 0,
    rotationDeg: 0,
    material: 'HDMR',
    finishId: 'none',
    unitPrice: 0,
    quantity: 1,
    ...extra,
  };
}

// The 600 × 600 × 720 HDMR base unit with one door that most numbers in
// docs/DECISIONS.md §42-§53 were worked out on.
export const baseUnit = (extra: Partial<PlacedCabinetItem> = {}) =>
  cabinet('base-cabinet', 600, 600, 720, { frontLayout: { kind: 'single-door' }, ...extra });

// A typical 11-cabinet L-shaped kitchen (83 pieces) — the nesting and
// calculated-waste figures in §49-§53 come from this exact set.
export function lShapedKitchen(): PlacedCabinetItem[] {
  return [
    baseUnit({ panels: { shelves: { extraCount: 1 } } }),
    cabinet('drawer-unit', 600, 600, 720, { frontLayout: { kind: 'drawers', count: 3 } }),
    cabinet('sink-unit', 900, 600, 720, { frontLayout: { kind: 'double-door' }, panels: { back: { included: false } } }),
    cabinet('base-cabinet', 450, 600, 720, { frontLayout: { kind: 'single-door' } }),
    cabinet('cylinder-trolley', 450, 600, 720, { frontLayout: { kind: 'trolley', count: 1 } }),
    cabinet('corner-blind', 900, 600, 720, { frontLayout: { kind: 'single-door' } }),
    cabinet('tall-unit', 600, 600, 2100, { frontLayout: { kind: 'double-door' }, panels: { shelves: { extraCount: 4 } } }),
    cabinet('wall-cabinet', 600, 350, 720, { frontLayout: { kind: 'double-door' } }),
    cabinet('wall-cabinet', 900, 350, 720, { frontLayout: { kind: 'double-door' } }),
    cabinet('wall-cabinet', 450, 350, 720, { frontLayout: { kind: 'single-door' } }),
    cabinet('wall-cabinet', 600, 350, 720, { frontLayout: { kind: 'open-shelf', count: 2 } }),
  ];
}

export function layout(extra: Partial<RoomLayout> = {}): RoomLayout {
  return {
    id: 'layout-1',
    projectId: 'project-1',
    name: 'Test kitchen',
    dimensions: { widthMm: 3000, depthMm: 3000 },
    walls: [],
    obstacles: [],
    cameras: [],
    fixtures: [],
    gridSnapMm: 50,
    createdAt: '',
    updatedAt: '',
    ...extra,
  } as RoomLayout;
}

export function pricing(
  overrides: { rates?: Partial<RateCard>; construction?: Partial<ConstructionSettings>; layout?: RoomLayout } = {}
): PricingContext {
  return {
    finishes: [],
    handles: [],
    fixtureCatalog: [],
    rates: { ...defaultRateCard(), ...overrides.rates },
    construction: { ...defaultConstructionSettings(), ...overrides.construction },
    layout: overrides.layout,
  };
}

export const construction = (extra: Partial<ConstructionSettings> = {}): ConstructionSettings => ({
  ...defaultConstructionSettings(),
  ...extra,
});
