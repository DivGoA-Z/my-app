// src/types/front.ts
//
// What the FRONT of a cabinet is made of — doors, drawers, a trolley
// pull-out, open shelves — as data rather than as geometry.
//
// WHY THIS EXISTS, and it isn't mainly the 3D view: drawer hardware is
// the largest single hardware cost in an Indian modular kitchen. A
// 600mm three-drawer unit on soft-close tandem channels can cost more
// than its own carcass. Until now nothing in the app knew how many
// drawers a cabinet had, so lib/bom.ts charged ZERO hardware on every
// cabinet ever quoted — PlacedCabinetItem.hardware existed but nothing
// ever populated it. Describing the front is what lets hinges, channels
// and handles be COUNTED, and the same description then draws the
// cabinet. One input, two outputs, which is why the price and the
// picture can't drift apart.
//
// The three axes already established for appearance (substrate /
// finish type / pattern — see types/finish.ts) are untouched by this.
// A front is about STRUCTURE: how the box opens. A walnut door and a
// white door are the same front with different finishes.

import type { ModuleType } from './cabinet';

// ---- Front layout ----

export type FrontKind =
  | 'single-door'
  | 'double-door'
  | 'drawers'
  | 'trolley'
  | 'open-shelf'
  // Looks like a door, doesn't open — the panel across the front of a
  // sink cabinet where the basin and plumbing leave no usable opening.
  // Costs a shutter's worth of material and finish, but no hinges and
  // no handle, which is exactly why it can't just be modelled as a
  // door.
  | 'false-front'
  // An open aperture for a built-in oven or microwave to slide into.
  // No shutter at all, so no material, no finish, no hardware — the
  // appliance itself is priced separately as an appliance.
  | 'appliance-housing'
  // A roll-up (garage-style) shutter, the small-appliance-garage front:
  // a real, priced panel like a false-front (material + finish, cut and
  // edge-banded), but no hinges and no handle — a tambour slides on its
  // own track rather than swinging or being pulled by a bar/knob.
  // Visually distinct in the 3D view (a ridged/slatted panel) so it
  // doesn't read as a plain flat door.
  | 'tambour'
  // A vertical stack of independently-configured rows — a shelf
  // compartment over a drawer stack, a door over an appliance housing,
  // whatever the trade actually builds. See `rows` below.
  | 'mixed';

// What a 'mixed' row can be. Excludes 'mixed' itself — a row is one
// band of the stack, not another stack — which is what stops this from
// needing to be a recursive tree for a feature nobody asked for deeper
// than one level.
export type FrontRowKind = Exclude<FrontKind, 'mixed'>;

export interface FrontRowLayout {
  kind: FrontRowKind;
  // Same meaning as FrontLayout.count below, scoped to this row.
  count?: number;
  // Same meaning as FrontLayout.hinge below, scoped to this row.
  hinge?: 'left' | 'right';
  // Same meaning as FrontLayout.heightRatios below — a drawers row can
  // still have its OWN graduated drawer heights, independent of how
  // tall the row itself is relative to the other rows.
  heightRatios?: number[];
  // This row's share of the cabinet's total front height, relative to
  // the other rows' shares — same "ratio, not millimetres" reasoning
  // as heightRatios, and normalised the same way (computeFrontBreakdown
  // reuses normaliseRatios for both).
  heightRatio: number;
}

export const MIN_MIXED_ROWS = 2;
export const MAX_MIXED_ROWS = 4;

export interface FrontLayout {
  kind: FrontKind;
  // drawers / trolley / open-shelf: how many drawers, tiers, or
  // shelves. Ignored by the door kinds. Clamped when read, so a bad
  // stored value can't produce zero or a thousand fronts.
  count?: number;
  // single-door only: which edge the hinges are on, which is also what
  // decides the side the handle goes.
  hinge?: 'left' | 'right';
  // drawers only: relative heights, TOP to BOTTOM. Absent means equal.
  //
  // Graduated is the norm rather than the exception here — a shallow
  // cutlery drawer on top over deeper pan drawers below — so it's worth
  // being able to express. Values are ratios, not millimetres, so they
  // survive the cabinet being resized; they're normalised on use, so
  // [1,2,3] and [0.5,1,1.5] mean the same thing.
  heightRatios?: number[];
  // 'mixed' only: the rows, top to bottom. computeFrontBreakdown
  // (lib/fronts.ts) splits the face into bands by heightRatio, then
  // recurses — calling itself once per row with that row's own kind
  // against that band's own height — and offsets the results back into
  // place. Nothing downstream (the 3D renderer, the hardware/pricing
  // counts) needed to change for this: both already just consume
  // FrontBreakdown's panels/shelves/hardware arrays generically, never
  // switching on the layout's kind themselves.
  rows?: FrontRowLayout[];
}

// A sensible starting point for a freshly-chosen 'mixed' front — one
// open shelf compartment over a small drawer stack, equal shares. Not
// a defaultFrontLayout() case: 'mixed' is never a module type's
// default, only something a designer opts into per cabinet via
// FrontPicker.
export function defaultMixedRows(): FrontRowLayout[] {
  return [
    { kind: 'open-shelf', count: 1, heightRatio: 1 },
    { kind: 'drawers', count: 2, heightRatio: 1 },
  ];
}

export const MIN_FRONT_COUNT = 1;
export const MAX_FRONT_COUNT = 8;

// Above this width a single door sags on its hinges and its swing
// starts fouling whatever is next to it, so the trade splits it into a
// pair. Used only to pick a DEFAULT — nothing stops a business
// choosing otherwise.
export const DOUBLE_DOOR_MIN_WIDTH_MM = 800;

// The front a module gets when nothing else is specified. Derived from
// moduleType rather than stored on it, so it stays a suggestion the
// designer can override per cabinet instead of a property of the type.
export function defaultFrontLayout(
  moduleType: ModuleType,
  widthMm: number
): FrontLayout {
  const wide = widthMm >= DOUBLE_DOOR_MIN_WIDTH_MM;

  switch (moduleType) {
    case 'drawer-unit':
      // Three graduated drawers: shallow on top, deepest at the
      // bottom. The most common configuration sold, and the ratios
      // read as deliberate rather than as three identical boxes.
      return { kind: 'drawers', count: 3, heightRatios: [0.8, 1, 1.2] };

    case 'cylinder-trolley':
      // A cylinder trolley is one shutter in front of a single
      // heavy-duty pull-out platform carrying the LPG cylinder — not a
      // stack of baskets. Count is the pull-out, so 1.
      return { kind: 'trolley', count: 1 };

    case 'sink-unit':
      // Two shutters below the sink is the Indian standard (western
      // false-front sink drawers are rare here) — but the plumbing
      // means the usable opening is shallower than the carcass. Doors,
      // not drawers.
      return { kind: 'double-door' };

    case 'tall-unit':
      // Tall units are almost always a pair of full-height doors.
      return { kind: 'double-door' };

    // All three corner solutions default to a plain door here too — the
    // mechanism inside (fixed shelves, a magic-corner pull-out, a
    // carousel) is priced separately (see cornerMechanismHardware in
    // lib/fronts.ts) and isn't a front kind. A carousel's door is
    // really diagonal in real cabinetry, but nothing here models a
    // non-rectangular front panel yet — a flat door is the honest
    // interim default until that's built, not a wrong one.
    case 'wall-cabinet':
    case 'base-cabinet':
    case 'corner-blind':
    case 'corner-magic':
    case 'corner-carousel':
    default:
      return wide ? { kind: 'double-door' } : { kind: 'single-door', hinge: 'left' };
  }
}

// How many fronts a layout actually produces. Doors are fixed; the
// rest are driven by count, clamped so stored rubbish can't break the
// geometry or the quote.
export function frontCount(layout: FrontLayout): number {
  switch (layout.kind) {
    case 'single-door':
    case 'false-front':
    case 'tambour':
      return 1;
    case 'double-door':
      return 2;
    case 'appliance-housing':
      return 0; // an aperture, not a panel
    case 'trolley':
      return 1; // one shutter, however many tiers behind it
    case 'drawers':
    case 'open-shelf':
      return clampCount(layout.count);
    case 'mixed':
      return (layout.rows ?? []).reduce(
        (sum, row) => sum + frontCount({ kind: row.kind, count: row.count }),
        0
      );
  }
}

export function clampCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return MIN_FRONT_COUNT;
  return Math.min(MAX_FRONT_COUNT, Math.max(MIN_FRONT_COUNT, Math.round(count as number)));
}

// A tambour's shelf count is allowed down to ZERO, unlike every other
// count-driven kind this shares MIN_FRONT_COUNT with — a drawer unit
// with 0 drawers or an open-shelf with 0 shelves isn't that kind of
// cabinet at all, but a tambour appliance garage can reasonably have
// nothing placed on the cabinet's own floor with no shelf in between.
// Defaults to 1 (something to rest on) only when genuinely unset, same
// "sensible default until told otherwise" as clampCount's own fallback.
export function clampTambourShelfCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_FRONT_COUNT, Math.max(0, Math.round(count as number)));
}

export const FRONT_KIND_LABELS: Record<FrontKind, string> = {
  'single-door': 'Single door',
  'double-door': 'Double door',
  drawers: 'Drawers',
  trolley: 'Trolley pull-out',
  'open-shelf': 'Open shelves',
  'false-front': 'False front (sink)',
  'appliance-housing': 'Appliance housing (open)',
  tambour: 'Tambour (roll-up shutter)',
  mixed: 'Mixed (stacked rows)',
};

// ---- Handles ----

export type HandleKind =
  | 'bar'          // the common D/bar handle, screwed through the front
  | 'knob'         // single round knob
  | 'edge-profile' // a profile along the front's top edge
  | 'gola'         // continuous G/J aluminium profile between fronts
  | 'handleless';  // push-to-open, nothing on the front at all

export interface HandleSpec {
  id: string;
  label: string;
  kind: HandleKind;
  // bar/edge-profile/gola: length along the front. knob: diameter.
  // handleless: unused.
  lengthMm: number;
  // Hardware finish. Deliberately its own colour rather than a
  // SurfaceFinish reference — handles are solid metal, priced per unit
  // or per metre, and share none of a laminate's pattern/tiling
  // machinery. Reusing SurfaceFinish here would mean carrying texture
  // fields that never apply.
  colorHex: string;
  metalness: number;
  roughness: number;
  // Bar handles and knobs are bought per piece; gola and edge profiles
  // are cut from stock and billed by running metre. Both are real,
  // and charging a per-metre profile as "one handle" is how a quote
  // ends up thousands short on a large kitchen.
  pricingMode: 'per-unit' | 'per-metre';
  price: number; // ₹ per piece, or ₹ per running metre
  createdAt: string;
  updatedAt: string;
}

// Handles are a Supabase table (`handles` — see supabase/schema.sql),
// fetched into the store the same way finishes are, so a business can
// add its own rather than being limited to a fixed set. They were
// briefly seeded in code; the starter set now lives as seed rows in
// the schema instead, which is what makes them editable.
//
// Lookups take the array rather than reaching for a module-level
// constant, deliberately mirroring findFinish/resolveFinish in
// types/finish.ts — that's what keeps this file free of any data
// fetching and makes the handle source swappable.
export const DEFAULT_HANDLE_ID = 'handle_bar_steel_128';

export function findHandle(
  handles: HandleSpec[],
  handleId: string | undefined
): HandleSpec | undefined {
  if (!handleId) return undefined;
  return handles.find((h) => h.id === handleId);
}

// Falls back to the seeded default, then to whatever the catalogue's
// first row is, so a cabinet whose handle was DELETED from the
// catalogue still draws and still prices instead of silently losing
// its handle cost.
//
// Returns undefined only when the catalogue is genuinely empty — which
// also covers the moment before loadInventory resolves. Callers treat
// that as "no handle": no geometry, no charge. That's the honest
// reading; inventing a price for a handle nobody has chosen would put
// a number in a quote that no product backs.
export function resolveHandle(
  handles: HandleSpec[],
  handleId: string | undefined
): HandleSpec | undefined {
  return (
    findHandle(handles, handleId) ??
    handles.find((h) => h.id === DEFAULT_HANDLE_ID) ??
    handles[0]
  );
}
