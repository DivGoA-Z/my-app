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

import type { HardwareSpec } from './cabinet';

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

export interface RateCard {
  // Single active row for now — see ACTIVE_RATE_CARD_ID. Kept as a
  // real primary key rather than a bare settings blob so that going
  // multi-business later is an added column and a changed lookup,
  // not a new table.
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
    hinge: 120,
    channel: 450,
    basket: 1400,
    shelf: 350,
  },
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
export function defaultRateCard(): RateCard {
  const now = new Date().toISOString();
  return { ...PLACEHOLDER_RATES, createdAt: now, updatedAt: now };
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
    },
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
