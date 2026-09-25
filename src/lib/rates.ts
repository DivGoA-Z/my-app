// src/lib/rates.ts
//
// CRUD for the rate card (`rate_cards` table — see supabase/schema.sql).
// Same shape as lib/handles.ts and lib/finishes.ts: row interface, two
// mappers, async functions, no caching. The store holds the value.
//
// The one departure from those files: there is no create and no delete.
// The rate card is a single seeded row that is edited, never added to
// or removed — a business always has rates, even if they are the
// placeholders. fetchRateCard therefore falls back rather than
// returning null, so no caller has to handle "this business has no
// prices" as a distinct state.

import { supabase } from './Supabaseclient';
import { defaultRateCard, sanitizeRateCard, type RateCard } from '../types/rates';

interface RateCardRow {
  id: string;
  label: string;
  labor_rate_per_sqft: number;
  // The four hardware rates are one JSONB column rather than four
  // columns, matching how layouts stores fixtures. The set of hardware
  // types is defined in TypeScript (HardwareSpec) and has already grown
  // once — 'shelf' arrived with parametric fronts. A column per type
  // would mean a migration every time it grows again, for data that is
  // never queried or aggregated in SQL.
  hardware_rates: RateCard['hardware'];
  // Same one-JSONB-column reasoning as hardware_rates above, and same
  // growth history — MaterialType has already grown once (BWP, added
  // alongside this column) with more to come as businesses stock more
  // substrates.
  material_rates: RateCard['materialRates'] | null;
  // Plain numeric columns, not JSONB — each is a single scalar, not a
  // set of keys that grows over time the way hardware/material rates
  // do, so there's no per-key migration story to design for here.
  fabrication_rate_per_unit: number;
  others_rate_per_unit: number;
  business_id: string;
  created_at: string;
  updated_at: string;
}

function rowToRateCard(row: RateCardRow): RateCard {
  return {
    id: row.id,
    label: row.label,
    laborRatePerSqFt: row.labor_rate_per_sqft,
    hardware: row.hardware_rates,
    // Cast, not a lie: this can genuinely be undefined for a row
    // saved before this column existed, and sanitizeRateCard (always
    // called right after this, in fetchRateCard) is what actually
    // supplies the zeros via its own `card.materialRates?.HDMR`
    // optional-chaining — one fallback path, not two disagreeing ones.
    materialRates: (row.material_rates ?? undefined) as RateCard['materialRates'],
    fabricationRatePerUnit: row.fabrication_rate_per_unit,
    othersRatePerUnit: row.others_rate_per_unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rateCardToRow(card: RateCard, businessId: string): RateCardRow {
  return {
    id: card.id,
    label: card.label,
    labor_rate_per_sqft: card.laborRatePerSqFt,
    hardware_rates: card.hardware,
    material_rates: card.materialRates,
    fabrication_rate_per_unit: card.fabricationRatePerUnit,
    others_rate_per_unit: card.othersRatePerUnit,
    business_id: businessId,
    created_at: card.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

// No `.eq('id', ...)` filter — there is no longer one fixed well-known
// id to look up (see defaultRateCard's comment in types/rates.ts). RLS
// already scopes this table to the caller's own business, and there is
// exactly one row per business, so "my row, if it exists" is simply
// the unfiltered select. Falls back to the placeholder card when
// there's no row yet (a business that hasn't saved rates for the first
// time). Note this does NOT swallow a genuine connection error — that
// still throws, same as fetchHandles. The distinction matters: "no row
// yet" is an expected state, while "cannot reach Supabase" is a
// failure the user needs to see rather than have papered over with
// numbers that look real.
export async function fetchRateCard(): Promise<RateCard> {
  const { data, error } = await supabase.from('rate_cards').select('*').maybeSingle();

  if (error) throw new Error(`Failed to load rate card: ${error.message}`);
  if (!data) return defaultRateCard();
  return sanitizeRateCard(rowToRateCard(data as RateCardRow));
}

// Upsert rather than update so the first save for a business with no
// row yet creates one instead of silently affecting zero rows and
// reporting success — see defaultRateCard's comment for why `card.id`
// is safe to upsert on directly without a separate existence check.
export async function saveRateCard(card: RateCard, businessId: string): Promise<void> {
  const { error } = await supabase
    .from('rate_cards')
    .upsert(rateCardToRow(sanitizeRateCard(card), businessId));
  if (error) throw new Error(`Failed to save rate card: ${error.message}`);
}
