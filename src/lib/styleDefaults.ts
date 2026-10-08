// src/lib/styleDefaults.ts
//
// Kitchen style defaults (§117): finish, colour, handle and carcass board
// for the base, wall and tall cabinets of a kitchen, at three levels —
//
//   business  ConstructionSettings.styleDefaults: what a new kitchen starts with
//   project   RoomLayout.styleDefaults: this kitchen's own, once changed
//   unit      the cabinet's own fields, as always
//
// Every cabinet still STORES its actual finish/handle/board, so pricing,
// the cutting list and frozen-quote fingerprints read exactly what they
// did before; a default is only ever COPIED onto cabinets — when one is
// placed, and when the default changes. Copying (rather than a cabinet
// "inheriting" at read time) is what keeps PricingContext free of a new
// moving part (CLAUDE.md: nothing reachable from it may shift on load).
//
// A changed default moves the cabinets that were on the OLD default and
// leaves hand-set ones alone; the caller offers to change those too
// (`planStyleChange`). A field left unset in a default means "no
// default": a new cabinet keeps its catalogue item's own value.

import type { ModuleType, PlacedCabinetItem } from '../types/cabinet';

export type CabinetGroup = 'base' | 'wall' | 'tall';

export const CABINET_GROUP_LABELS: Record<CabinetGroup, string> = {
  base: 'Base cabinets',
  wall: 'Wall cabinets',
  tall: 'Tall units',
};

export interface CabinetStyle {
  finishId?: string;
  // Hex; null = the finish's own colour (clears a colour override);
  // unset = no colour default.
  colorOverride?: string | null;
  handleId?: string;
  // With its material, kept in step as on a cabinet (types/cabinet.ts).
  carcassBoardId?: string;
  material?: PlacedCabinetItem['material'];
}

export interface StyleDefaults {
  base: CabinetStyle;
  wall: CabinetStyle;
  // Unset = same as the base cabinets (two-tone kitchens often pair tall
  // units with the wall cabinets instead, hence its own entry).
  tall?: CabinetStyle;
}

export const EMPTY_STYLE_DEFAULTS: StyleDefaults = { base: {}, wall: {} };

export function cabinetGroup(moduleType: ModuleType): CabinetGroup {
  switch (moduleType) {
    case 'wall-cabinet':
      return 'wall';
    case 'tall-unit':
    case 'pantry-unit':
      return 'tall';
    default:
      return 'base';
  }
}

// The style a group actually uses (tall falls back to base).
export function styleFor(defaults: StyleDefaults, group: CabinetGroup): CabinetStyle {
  if (group === 'tall') return defaults.tall ?? defaults.base;
  return defaults[group];
}

// This kitchen's defaults: its own once set, otherwise the business's.
export function effectiveStyleDefaults(
  business: StyleDefaults | undefined,
  project: StyleDefaults | undefined
): StyleDefaults {
  return project ?? business ?? EMPTY_STYLE_DEFAULTS;
}

type StyleField = 'finishId' | 'colorOverride' | 'handleId' | 'carcassBoardId';
const FIELDS: StyleField[] = ['finishId', 'colorOverride', 'handleId', 'carcassBoardId'];

// A cabinet's value for a field, in a style's terms (no colour = null).
function cabinetValue(c: PlacedCabinetItem, f: StyleField): string | null | undefined {
  return f === 'colorOverride' ? (c.colorOverride ?? null) : c[f];
}

// The fields a style sets, as a cabinet patch. Unset fields are skipped:
// the cabinet keeps what it has.
function patchFrom(style: CabinetStyle, only: StyleField[] = FIELDS): Partial<PlacedCabinetItem> {
  const patch: Partial<PlacedCabinetItem> = {};
  for (const f of only) {
    const v = style[f];
    if (v === undefined) continue;
    if (f === 'colorOverride') patch.colorOverride = v ?? undefined;
    else if (f === 'carcassBoardId') {
      patch.carcassBoardId = v as string;
      if (style.material) patch.material = style.material;
    } else patch[f] = v as string;
  }
  return patch;
}

// A newly placed cabinet: its catalogue values, with the kitchen's
// defaults for its group on top.
export function withStyleDefaults(cabinet: PlacedCabinetItem, defaults: StyleDefaults): PlacedCabinetItem {
  return { ...cabinet, ...patchFrom(styleFor(defaults, cabinetGroup(cabinet.moduleType))) };
}

export interface StyleChangePlan {
  // Cabinets on the old default (or every cabinet in the group, when
  // there was no default for that field): patch to apply now.
  follow: { id: string; patch: Partial<PlacedCabinetItem> }[];
  // Cabinets set by hand to something else: left alone unless asked.
  handSet: { id: string; patch: Partial<PlacedCabinetItem> }[];
}

// What changing the defaults from `before` to `after` does to the
// cabinets, field by field: a cabinet follows if its value equals the
// old default (no old default → everyone follows). A default cleared to
// unset changes nobody.
export function planStyleChange(
  cabinets: PlacedCabinetItem[],
  defaultsBefore: StyleDefaults,
  defaultsAfter: StyleDefaults
): StyleChangePlan {
  const follow: StyleChangePlan['follow'] = [];
  const handSet: StyleChangePlan['handSet'] = [];
  for (const c of cabinets) {
    const group = cabinetGroup(c.moduleType);
    const before = styleFor(defaultsBefore, group);
    const after = styleFor(defaultsAfter, group);
    const onDefault: StyleField[] = [];
    const own: StyleField[] = [];
    for (const f of FIELDS) {
      if (before[f] === after[f] || after[f] === undefined) continue;
      const v = cabinetValue(c, f);
      if (v === after[f]) continue;
      (before[f] === undefined || v === before[f] ? onDefault : own).push(f);
    }
    if (onDefault.length) follow.push({ id: c.id, patch: patchFrom(after, onDefault) });
    if (own.length) handSet.push({ id: c.id, patch: patchFrom(after, own) });
  }
  return { follow, handSet };
}
