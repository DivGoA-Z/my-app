// src/types/rates.ts
//
// The business's rate card: the prices that are NOT attached to a
// catalogue row.
//
// Most prices in this app already live on the thing being priced — a
// finish carries pricePerSqM, a handle carries price + pricingMode, an
// appliance and a cabinet each carry unitPrice. Those were always
// editable. Two things never were, and they were the last hardcoded
// numbers in a quote:
//
//   - labour, charged per sq ft of cabinet area (lib/bom.ts)
//   - the four consumable hardware rates (lib/fronts.ts)
//
// Both were module constants with comments promising "a future
// per-project settings table". This is that table.
//
// WHY ONE ROW AND NOT A VERSION HISTORY
// A quote freezes its own snapshot when it is sent (see types/quote.ts),
// so an old quote does not need an old rate card to stay correct — it
// already carries the numbers it was priced with. That makes versioning
// here redundant for correctness, and a version history nobody needs is
// a table nobody maintains. The rate card is edited in place; the
// snapshots are the history.

import type { HardwareSpec, MaterialType } from './cabinet';
import type { GlassTint } from './front';

// The hardware types the rate card prices. Deliberately derived from
// HardwareSpec rather than written out, and deliberately excluding
// 'handle' — a handle's price comes from its own catalogue row
// (HandleSpec.price), because two bar handles are genuinely different
// products at different prices, while a hinge is a hinge.
//
// The payoff is that adding a hardware type to HardwareSpec makes this
// a compile error until a rate exists for it, rather than silently
// pricing the new type at ₹0 the way `item.hardware` once did.
export type CardPricedHardware = Exclude<HardwareSpec['type'], 'handle'>;

export type HardwareRates = Record<CardPricedHardware, number>;

// ₹ per sq m of a cabinet's own estimated CARCASS area (lib/bom.ts's
// carcassAreaSqM — the same rough front-face-plus-side-allowance
// estimate already used for labour, not an accurate per-panel figure;
// see docs/DECISIONS.md §13 for why that distinction matters and what
// it would take to make this exact instead of estimated). Added
// alongside real material-cost estimates so materialCost stops being
// a stand-in for the catalogue's own unitPrice and becomes what its
// name says: the substrate, priced by how much of it the cabinet
// actually uses.
export type MaterialRates = Record<MaterialType, number>;

// ₹ per sq ft of a glass door's own area (lib/fronts.ts's 'open-shelf'
// case, when FrontLayout.glass is set) — keyed by TINT rather than one
// flat number, because tinted/lacquered glass genuinely costs more
// than plain clear toughened glass in the local market, same
// "different products, different rates" reasoning MaterialRates above
// already uses for substrates. Priced separately from materialRates:
// glass is bought and cut as glass, not the cabinet's own board
// substrate.
export type GlassRates = Record<GlassTint, number>;

// What one "others" row is charged on:
//   'sqft'    ₹ per sq ft of estimated cabinet area (lib/bom.ts's
//             estimateAreaSqFt — the same area site labour uses).
//             For things that grow with cabinet size: edge banding.
//   'cabinet' ₹ per cabinet, flat regardless of size. The default for
//             a new row — the most common case, and what the single
//             othersRatePerUnit number this replaced always was.
//   'lumpsum' ₹ once per PROJECT, however many cabinets — a delivery
//             or site-visit fee the business charges on every job.
export type OtherRateBasis = 'sqft' | 'cabinet' | 'lumpsum';

export const OTHER_RATE_BASES: OtherRateBasis[] = ['sqft', 'cabinet', 'lumpsum'];

export const OTHER_RATE_BASIS_LABELS: Record<OtherRateBasis, string> = {
  sqft: 'Per sq ft',
  cabinet: 'Per cabinet',
  lumpsum: 'Lump sum',
};

// One named line of the "others" rate — see RateCard.othersRates.
// `id` is client-generated purely so the editor can key its rows; it
// has no meaning outside this card.
export interface OtherRate {
  id: string;
  label: string;
  rate: number;
  basis: OtherRateBasis;
  // true → printed as its own line on the customer's quote, under this
  // row's label; false → summed into the single "Other" line. A choice
  // about PRESENTATION only — the amount charged is identical either
  // way, and margin applies either way. Off for a new row (most
  // consumables aren't worth a line of their own); on for the two
  // labour rows, which is how they always printed before.
  showOnQuote: boolean;
  // false → the amount is the SELLING price, never marked up by the
  // project's margin — for a price the business has already fixed ("extra
  // service ₹20,000" stays ₹20,000). Editable on both the business rate
  // card and a project's own list (RoomLayout.chargeRates) — §39 made it
  // project-only, §40 made both sides match. On for every seeded row
  // and every new one.
  applyMargin: boolean;
}

// The two labour charges that used to be their own rate-card fields
// (see RateCard's comment where they were), now seeded as the first two
// "others" rows with the same values and units, both shown on the
// quote as they always were.
//
// FIXED ids, not crypto.randomUUID(): these rows are also created on
// load when migrating an older card (lib/rates.ts), and the rate card
// feeds the quote fingerprint — a random id there would mark every
// frozen quote "changed" on every page load (docs/DECISIONS.md §35).
//
// Values are the old placeholders, and still placeholders: ₹150/sq ft
// site labour, and ₹2,500 per cabinet to cut, edge-band and assemble
// a box — a plausible Delhi NCR workshop figure nobody has checked
// against a real invoice (docs/DECISIONS.md §14).
export const LABOUR_SITE_ID = 'labour-site';
export const LABOUR_FABRICATION_ID = 'labour-fabrication';

export const DEFAULT_LABOUR_RATES: OtherRate[] = [
  {
    id: LABOUR_SITE_ID,
    label: 'Labour — site installation',
    rate: 150,
    basis: 'sqft',
    showOnQuote: true,
    applyMargin: true,
  },
  {
    id: LABOUR_FABRICATION_ID,
    label: 'Labour — fabrication',
    rate: 2500,
    basis: 'cabinet',
    showOnQuote: true,
    applyMargin: true,
  },
];

export interface RateCard {
  // One row per business now (business_id + RLS — see
  // supabase/schema.sql and defaultRateCard's own comment below for
  // how `id` is generated). Kept as a real primary key rather than a
  // bare settings blob, which is what let that move be an added
  // column and a changed lookup instead of a new table.
  id: string;
  label: string;

  // Site-installation labour (₹/sq ft) and workshop fabrication
  // (₹/cabinet) used to be two fields here, laborRatePerSqFt and
  // fabricationRatePerUnit. They are now the first two rows of
  // othersRates below — DEFAULT_LABOUR_RATES — so every charge that
  // isn't a material/hardware/glass rate is edited in one place, the
  // same way, with the same "show on quote" choice. Their units didn't
  // change: site labour is still per sq ft (the trade's billing unit),
  // fabrication still per cabinet. See docs/DECISIONS.md §38.

  // ₹ per unit, where the unit differs per row and is NOT always a
  // piece — 'channel' is a PAIR of runners, which is how they are sold
  // and fitted. See HardwareSpec in types/cabinet.ts.
  hardware: HardwareRates;

  // See MaterialRates above.
  materialRates: MaterialRates;

  // See GlassRates above.
  glassRates: GlassRates;

  // Every charge that isn't a material, hardware or glass rate: labour
  // (site installation and fabrication — DEFAULT_LABOUR_RATES), edge
  // banding, glue, packing, delivery. Itemised catch-all for whatever doesn't fit the categories above —
  // whatever else. ONE list, each row carrying its own basis (OtherRateBasis above),
  // because those things genuinely scale differently — edge banding
  // with cabinet size, a handling fee per cabinet, delivery once per
  // job — but a business thinks of them as one heading, "others".
  //
  // (First built as two separate lists, perSqFt and perUnit, the same
  // day. You found two headings harder to read than one list with a
  // per-row choice, and asked for a third basis — lump sum — that two
  // fixed lists had no room for. lib/rates.ts still reads that shape
  // in case a card was saved with it. See docs/DECISIONS.md §37.)
  //
  // REPLACED `othersRatePerUnit`, a single flat ₹/cabinet number. One
  // number couldn't say what was in it, and it forced size-dependent
  // costs like edge banding into a flat fee that overcharged a 300mm
  // filler and undercharged a 1200mm tall unit. See docs/DECISIONS.md
  // §35. A card saved before this existed is migrated on load (see
  // lib/rates.ts's rowToRateCard) into one per-cabinet row labelled
  // "Other", so no quote total moves.
  //
  // On the quote, each row is either its own line or part of one
  // rolled-up "Other" — the business's choice per row (showOnQuote).
  // (§35-§37 made the whole list internal-only; §38 made that a per-row
  // choice when labour moved in, since labour always printed.)
  //
  // Seeded with the two labour rows only. Nothing else has a real-
  // world number behind it, so nothing else is invented here.
  othersRates: OtherRate[];

  // Multiplier on substrate cost for whole-sheet purchasing: a
  // business buys 8×4 sheets, not square metres, and the offcuts are
  // paid for too. 1.1 means "buy 10% more board than the cabinets
  // use." Applied to materialCost ONLY — not finish (laminate is
  // bought separately and has its own waste, not modelled), not glass
  // (cut to order).
  //
  // This is the BUSINESS default. A project can override it
  // (RoomLayout.sheetWasteFactor) — a job that's all 600mm units nests
  // much better than one full of odd widths. The override lives on the
  // layout for the same reason marginPercent does (docs/DECISIONS.md
  // §15), but unlike margin the DEFAULT lives here rather than as a
  // code constant: how well a workshop nests its cuts is a fact about
  // that workshop, the same everywhere it works, which is exactly what
  // this card holds.
  //
  // Never below 1 — a factor under 1 would claim the cabinets use less
  // board than their own area. Clamped in sanitizeRateCard.
  sheetWasteFactor: number;

  // Cost-plus margin used to live here as `marginPercent` — a single
  // business-wide number. Moved to `RoomLayout.marginPercent`
  // (types/layout.ts) instead, per-project rather than per-business:
  // a big order and a rush one-off don't have to carry the same
  // margin, and unlike every rate above (which price a real, physical
  // thing the same way regardless of which job it's for), margin is a
  // business decision about THIS job specifically. See
  // docs/DECISIONS.md §15.

  createdAt: string;
  updatedAt: string;
}

export const ACTIVE_RATE_CARD_ID = 'default';

// The values that were hardcoded in lib/bom.ts and lib/fronts.ts up to
// this change, carried over verbatim so that introducing the rate card
// does not silently move a single existing quote total. Editing them is
// now a UI action rather than a code change.
//
// They remain PLACEHOLDERS. They are the right order of magnitude for
// Delhi NCR retail, but they are not a price list — a business buying
// tandem channels in volume pays materially less, and labour varies by
// city and by crew. Every figure here needs review against real
// purchase invoices before a quote built on it goes to a customer.
export const PLACEHOLDER_RATES: Omit<RateCard, 'createdAt' | 'updatedAt'> = {
  id: ACTIVE_RATE_CARD_ID,
  label: 'Default rates (placeholder)',
  hardware: {
    // A soft-close hinge SET (a pair) runs about ₹450 in the local
    // market, but this rate is priced per PIECE (see this file's own
    // comment on HardwareRates, and HardwareSpec in types/cabinet.ts —
    // a door gets 2-4 individual hinges, unlike 'channel' below which
    // really is priced per pair) — so ₹450 / 2 = ₹225 per piece, not
    // ₹450. Using ₹450 directly would double every hinge line.
    hinge: 225,
    // "Tandem Box Drawers: ₹2,500/set" is the SAME real-world thing
    // this key already prices (a pair of drawer runners) — a tandem-
    // box system is a specific premium type/brand of channel, not a
    // new hardware category, so this is a value update, not a new key.
    channel: 2500,
    basket: 1400,
    shelf: 350,
    // Real component costs, one per cabinet regardless of front kind
    // — see cornerMechanismHardware in lib/fronts.ts. Magic-corner
    // pull-out systems retail well above a plain lazy susan, which
    // these placeholders reflect; both still need checking against
    // real purchase invoices like every other rate here.
    cornerMagic: 12000,
    cornerCarousel: 6000,
  },
  // Real Delhi NCR market estimates (2026-09-25) for HDMR/Plywood and
  // BWP; MDF and Particle Board are MY OWN placeholder guesses (not
  // given by the business), scaled down from the given figures in the
  // usual retail ordering (MDF cheaper than plywood-grade boards,
  // particle board cheapest) — flagged separately because they carry
  // less confidence than the other four numbers on this object, all
  // of which came from a real local-market source. See
  // docs/DECISIONS.md §13.
  materialRates: {
    HDMR: 1400,
    Plywood: 1400,
    BWP: 2200,
    MDF: 1100,
    'Particle Board': 850,
  },
  othersRates: DEFAULT_LABOUR_RATES,
  // 1 — no waste — rather than a realistic 1.1, deliberately:
  // introducing this field must not silently move every open quote's
  // material cost by 10%, same rule this whole object was built under
  // (see its header comment). A business turns it up once it knows its
  // own offcut rate; the placeholder banner stays up until it does.
  sheetWasteFactor: 1,
  // Genuine placeholders, same footing as fabrication labour
  // (DEFAULT_LABOUR_RATES)
  // — no business has given a real number for glass yet. Ordered
  // clear < brown/black < yellow, the usual local retail pattern for
  // toughened lacquered glass (yellow/gold-tint stock tends to run a
  // shade above brown/black), and picked so a fresh glass door isn't
  // obviously broken at ₹0. Needs checking against a real glass
  // supplier's invoice before any quote built on it goes to a
  // customer, same as every other rate on this card.
  glassRates: {
    clear: 180,
    black: 230,
    brown: 230,
    yellow: 240,
  },
};

// Shared with RateCardManager (which renders one input per key) and
// with FirstRunChecklist's "add your rates" step (which only needs to
// know if EVERY key still matches the seed) — one list rather than two
// so a hardware/material type added to HardwareSpec/MaterialType only
// needs updating here.
export const HARDWARE_RATE_KEYS: CardPricedHardware[] = [
  'hinge',
  'channel',
  'basket',
  'shelf',
  'cornerMagic',
  'cornerCarousel',
];

export const MATERIAL_RATE_KEYS: MaterialType[] = ['HDMR', 'Plywood', 'BWP', 'MDF', 'Particle Board'];

export const GLASS_RATE_KEYS: GlassTint[] = ['clear', 'black', 'brown', 'yellow'];

// Whether a rate card is still on every seeded number. Compared by
// value rather than a flag, same reasoning as RateCardManager's own
// original comment: editing a rate back to its placeholder value
// honestly counts as still-placeholder, because the point is what the
// number IS, not whether someone has visited the rates screen.
export function isPlaceholderRateCard(card: RateCard): boolean {
  return (
    // Order-sensitive on purpose: the seed is exactly these rows in
    // this order, and anything else — a row added, removed, renamed,
    // re-priced or re-ticked — is the business making it its own.
    sameOtherRates(card.othersRates, PLACEHOLDER_RATES.othersRates) &&
    card.sheetWasteFactor === PLACEHOLDER_RATES.sheetWasteFactor &&
    HARDWARE_RATE_KEYS.every((k) => card.hardware[k] === PLACEHOLDER_RATES.hardware[k]) &&
    MATERIAL_RATE_KEYS.every((k) => card.materialRates[k] === PLACEHOLDER_RATES.materialRates[k]) &&
    GLASS_RATE_KEYS.every((k) => card.glassRates[k] === PLACEHOLDER_RATES.glassRates[k])
  );
}

// Used when the rate card has not loaded yet, or when a caller builds a
// BOM outside the app (tests, scripts).
//
// This returning real numbers rather than zeros is a deliberate choice
// with a tradeoff: a quote rendered in the split second before
// loadInventory resolves shows plausible figures rather than a total
// that is visibly wrong and then jumps. The cost is that a genuine
// failure to load the rate card looks like success. That is the safer
// side to err on here only because the numbers are identical to the
// seeded row — if the seed ever diverges from PLACEHOLDER_RATES, this
// choice becomes a silent-wrong-price bug and should be revisited.
//
// `id` is a FRESH crypto.randomUUID() on every call, not
// ACTIVE_RATE_CARD_ID — since business_id + RLS landed (see
// supabase/schema.sql), `id` is no longer a fixed well-known value
// every business could collide on; it only matters as a genuinely
// unique primary key. A business with no rate_cards row yet gets this
// fallback from fetchRateCard() (lib/rates.ts), and if they save, THAT
// id is what the new row is created with — no separate "does a row
// exist yet" check needed. The ONE pre-existing seeded row (from
// before multi-tenancy) keeps its historical id, ACTIVE_RATE_CARD_ID,
// which is why that constant is still exported below.
export function defaultRateCard(): RateCard {
  const now = new Date().toISOString();
  return { ...PLACEHOLDER_RATES, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

// Labels for the rate card editor. Separate from HARDWARE_LABELS in
// lib/bom.ts because these name the RATE ("₹ per hinge") while those
// name the line item ("Hinges") — same words would be a coincidence,
// not a shared source of truth.
export const RATE_LABELS: Record<CardPricedHardware, string> = {
  hinge: 'Hinge (each)',
  channel: 'Drawer channel (per pair)',
  basket: 'Wire basket (each)',
  shelf: 'Shelf, cut and edge-banded (each)',
  cornerMagic: 'Magic corner pull-out mechanism (each)',
  cornerCarousel: 'Carousel / lazy susan mechanism (each)',
};

// Same reasoning as RATE_LABELS above — names the RATE, not the
// substrate itself (that's just the bare MaterialType string, shown
// on a catalogue row's own "Material" field).
export const MATERIAL_RATE_LABELS: Record<MaterialType, string> = {
  HDMR: 'HDMR',
  Plywood: 'Commercial Plywood',
  BWP: 'BWP (boiling water proof) Plywood',
  MDF: 'MDF',
  'Particle Board': 'Particle Board',
};

// A rate of 0 is legitimate — a business that does not charge
// separately for shelves should be able to say so. A NEGATIVE rate is
// not, and neither is a missing one, which is what a blank input
// produces. Clamped rather than rejected so the editor never traps a
// half-typed value.
export function sanitizeRateCard(card: RateCard): RateCard {
  return {
    ...card,
    hardware: {
      hinge: nonNegative(card.hardware.hinge),
      channel: nonNegative(card.hardware.channel),
      basket: nonNegative(card.hardware.basket),
      shelf: nonNegative(card.hardware.shelf),
      // nonNegative(undefined) -> 0, so a rate card saved before these
      // two existed (missing keys in its JSONB) loads as "not priced
      // yet" rather than throwing — same graceful growth 'shelf' itself
      // went through.
      cornerMagic: nonNegative(card.hardware.cornerMagic),
      cornerCarousel: nonNegative(card.hardware.cornerCarousel),
    },
    materialRates: {
      // Same graceful-growth reasoning as cornerMagic/cornerCarousel
      // above — a rate card saved before materialRates existed loads
      // as "not priced yet" (0) for every key rather than throwing.
      HDMR: nonNegative(card.materialRates?.HDMR),
      Plywood: nonNegative(card.materialRates?.Plywood),
      BWP: nonNegative(card.materialRates?.BWP),
      MDF: nonNegative(card.materialRates?.MDF),
      'Particle Board': nonNegative(card.materialRates?.['Particle Board']),
    },
    glassRates: {
      // Same graceful-growth reasoning as materialRates above — a rate
      // card saved before glassRates existed loads as "not priced yet"
      // (0) for every tint rather than throwing.
      clear: nonNegative(card.glassRates?.clear),
      black: nonNegative(card.glassRates?.black),
      brown: nonNegative(card.glassRates?.brown),
      yellow: nonNegative(card.glassRates?.yellow),
    },
    othersRates: sanitizeOtherRates(card.othersRates),
    sheetWasteFactor: sanitizeWasteFactor(card.sheetWasteFactor),
  };
}

// Same clamp-don't-reject reasoning as nonNegative below. A blank label
// is kept rather than dropped — the editor would otherwise delete a row
// the moment its label is cleared to retype — but reads as "Other" on
// the rate card rather than as nothing.
//
// A missing id (only possible in hand-edited JSONB) falls back to its
// position, not crypto.randomUUID() — a random one would change on
// every load, and this card feeds the quote fingerprint. See
// legacyOthersRates in lib/rates.ts for the same trap.
export function sanitizeOtherRates(rates: OtherRate[] | undefined): OtherRate[] {
  return (rates ?? []).map((r, i) => ({
    id: r.id || `row-${i}`,
    label: r.label ?? '',
    rate: nonNegative(r.rate),
    basis: OTHER_RATE_BASES.includes(r.basis) ? r.basis : 'cabinet',
    showOnQuote: r.showOnQuote === true,
    // Missing (every row saved before §39) → true: rate-card rows were
    // always marked up.
    applyMargin: r.applyMargin !== false,
  }));
}

// Field-by-field rather than JSON.stringify — stringify depends on key
// ORDER, and rows built by different code paths (the seed, the loader,
// the editor) don't promise the same order, which would make an
// untouched card look edited.
export function sameOtherRates(a: OtherRate[], b: OtherRate[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const o = b[i];
      return (
        r.id === o.id &&
        r.label === o.label &&
        r.rate === o.rate &&
        r.basis === o.basis &&
        r.showOnQuote === o.showOnQuote &&
        r.applyMargin === o.applyMargin
      );
    })
  );
}

// Shared with the per-project override (layoutStore's
// setSheetWasteFactor) so the two can never disagree about what a
// legal factor is. Missing, non-numeric or below 1 → 1 (no waste).
export function sanitizeWasteFactor(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 1 ? value : 1;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
