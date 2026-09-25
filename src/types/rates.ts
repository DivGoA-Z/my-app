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

export interface RateCard {
  // One row per business now (business_id + RLS — see
  // supabase/schema.sql and defaultRateCard's own comment below for
  // how `id` is generated). Kept as a real primary key rather than a
  // bare settings blob, which is what let that move be an added
  // column and a changed lookup instead of a new table.
  id: string;
  label: string;

  // ₹ per sq ft of estimated cabinet area. Sq ft rather than sq m
  // because that is still the billing unit in the trade, even though
  // all geometry is stored in mm.
  laborRatePerSqFt: number;

  // ₹ per unit, where the unit differs per row and is NOT always a
  // piece — 'channel' is a PAIR of runners, which is how they are sold
  // and fitted. See HardwareSpec in types/cabinet.ts.
  hardware: HardwareRates;

  // See MaterialRates above.
  materialRates: MaterialRates;

  // ₹ per CABINET (flat, regardless of size) — box construction/
  // assembly labour: cutting, edge-banding and assembling the carcass
  // panels. Deliberately separate from `laborRatePerSqFt` above, which
  // is SITE installation/fitting labour, billed by area per the
  // trade's own convention — this one is workshop labour, billed flat
  // per unit because a workshop quotes "so much to build a box", not
  // by its surface area. See docs/DECISIONS.md §14 for why this field
  // exists: material+finish+hardware alone came to well under half of
  // what a real cabinet was priced at — this is the missing piece,
  // named rather than left invisible inside a catalogue's own
  // unitPrice the way it used to be.
  fabricationRatePerUnit: number;

  // ₹ per cabinet — a deliberate catch-all for whatever doesn't fit
  // the categories above (packing, delivery, a specific job's site
  // conditions, anything). Defaults to 0, unlike every other rate on
  // this card, because unlike them it has no real-world number behind
  // it at all — it exists so a business has somewhere to put one
  // without it silently vanishing into "fabrication."
  othersRatePerUnit: number;

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
  laborRatePerSqFt: 150,
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
  // A genuine placeholder in the fullest sense — unlike hinge/channel/
  // material above, nobody gave a real number for this one. ₹2,500 is
  // a round, plausible Delhi NCR workshop estimate for cutting,
  // edge-banding and assembling one cabinet box, picked so a fresh
  // quote isn't obviously broken (₹0 fabrication reads as "free to
  // build," which is a worse first impression than an order-of-
  // magnitude guess). Needs checking against a real workshop invoice
  // before any quote built on it goes to a customer, same as every
  // other rate on this card.
  fabricationRatePerUnit: 2500,
  othersRatePerUnit: 0,
};

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
    laborRatePerSqFt: nonNegative(card.laborRatePerSqFt),
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
    fabricationRatePerUnit: nonNegative(card.fabricationRatePerUnit),
    othersRatePerUnit: nonNegative(card.othersRatePerUnit),
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
