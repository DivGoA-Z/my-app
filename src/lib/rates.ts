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
import {
  ACTIVE_RATE_CARD_ID,
  defaultRateCard,
  sanitizeRateCard,
  type RateCard,
} from '../types/rates';

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
  created_at: string;
  updated_at: string;
}

function rowToRateCard(row: RateCardRow): RateCard {
  return {
    id: row.id,
    label: row.label,
    laborRatePerSqFt: row.labor_rate_per_sqft,
    hardware: row.hardware_rates,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rateCardToRow(card: RateCard): RateCardRow {
  return {
    id: card.id,
    label: card.label,
    labor_rate_per_sqft: card.laborRatePerSqFt,
    hardware_rates: card.hardware,
    created_at: card.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

// Falls back to the placeholder card when the row is missing, which
// happens on a database seeded before this table existed. Note this
// does NOT swallow a genuine connection error — that still throws, the
// same as fetchHandles. The distinction matters: "no row yet" is an
// expected state during migration, while "cannot reach Supabase" is a
// failure the user needs to see rather than have papered over with
// numbers that look real.
export async function fetchRateCard(): Promise<RateCard> {
  const { data, error } = await supabase
    .from('rate_cards')
    .select('*')
    .eq('id', ACTIVE_RATE_CARD_ID)
    .maybeSingle();

  if (error) throw new Error(`Failed to load rate card: ${error.message}`);
  if (!data) return defaultRateCard();
  return sanitizeRateCard(rowToRateCard(data as RateCardRow));
}

// Upsert rather than update so the first save on a database seeded
// before this table existed creates the row instead of silently
// affecting zero rows and reporting success.
export async function saveRateCard(card: RateCard): Promise<void> {
  const { error } = await supabase
    .from('rate_cards')
    .upsert(rateCardToRow(sanitizeRateCard(card)));
  if (error) throw new Error(`Failed to save rate card: ${error.message}`);
}
