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
  defaultRateCard,
  sanitizeRateCard,
  sanitizeWasteFactor,
  DEFAULT_BACK_BOARD_ID,
  DEFAULT_LABOUR_RATES,
  LEGACY_BOARD_THICKNESS_MM,
  MATERIAL_RATE_KEYS,
  PLACEHOLDER_RATES,
  legacyBoardId,
  LABOUR_FABRICATION_ID,
  LABOUR_SITE_ID,
  type OtherRate,
  type RateCard,
} from '../types/rates';
import type { MaterialType } from '../types/cabinet';

interface RateCardRow {
  id: string;
  label: string;
  // LEGACY, like fabrication_rate_per_unit below — site labour is now
  // a row of others_rates (docs/DECISIONS.md §38). Read once to create
  // that row on an older card; written as 0 on every save so a business
  // that DELETES the labour row doesn't have it resurrected from this
  // column on the next load.
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
  // LEGACY (§13 → §42): one ₹/m² per material. Read only to migrate a
  // card saved before board_rates existed into 18mm board lines; never
  // written.
  material_rates?: Partial<Record<MaterialType, number>> | null;
  // JSONB array of BoardRate. Null on a row saved before §42.
  board_rates: RateCard['boards'] | null;
  default_back_board_id: string | null;
  // Same one-JSONB-column reasoning as material_rates above — priced
  // by TINT, which is a set of keys just like MaterialType is.
  glass_rates: RateCard['glassRates'] | null;
  // LEGACY — same story as labor_rate_per_sqft above: now the
  // fabrication row of others_rates, read once to migrate, written 0.
  fabrication_rate_per_unit: number;
  // LEGACY — superseded by others_rates below. Read only to migrate a
  // card saved before others_rates existed (see rowToRateCard); never
  // written, so it keeps whatever value it last had. Optional on this
  // interface because rateCardToRow deliberately leaves it out.
  others_rate_per_unit?: number;
  // JSONB — an array of OtherRate. Null on a row saved before it
  // existed. Can also be the short-lived two-list object shape (see
  // readOthersRates) on a card saved during the one session that shape
  // existed.
  others_rates: RateCard['othersRates'] | TwoListOthersRates | null;
  // Plain numeric — one scalar, no per-key growth to plan for.
  sheet_waste_factor: number | null;
  // 'approx' | 'calculated' (§53). NULL on an older row → 'approx'.
  waste_mode: string | null;
  // ₹ per running metre (§58). NULL on an older row → 0, not charged.
  edge_banding_rate_per_m: number | null;
  business_id: string;
  created_at: string;
  updated_at: string;
}

function rowToRateCard(row: RateCardRow): RateCard {
  return {
    id: row.id,
    label: row.label,
    hardware: row.hardware_rates,
    boards: row.board_rates ?? legacyBoards(row.material_rates),
    defaultBackBoardId: row.default_back_board_id ?? DEFAULT_BACK_BOARD_ID,
    glassRates: (row.glass_rates ?? undefined) as RateCard['glassRates'],
    othersRates: withLegacyLabour(
      readOthersRates(row.others_rates, row.others_rate_per_unit),
      row.labor_rate_per_sqft,
      row.fabrication_rate_per_unit
    ),
    // Null on an older row → 1 (no waste), via the same function
    // sanitizeRateCard uses, so there is still one fallback path.
    sheetWasteFactor: sanitizeWasteFactor(row.sheet_waste_factor ?? undefined),
    wasteMode: row.waste_mode === 'calculated' ? 'calculated' : 'approx',
    edgeBandingRatePerM: row.edge_banding_rate_per_m ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rateCardToRow(card: RateCard, businessId: string): RateCardRow {
  return {
    id: card.id,
    label: card.label,
    // Zeroed, not left alone — see this column's comment above.
    labor_rate_per_sqft: 0,
    hardware_rates: card.hardware,
    board_rates: card.boards,
    default_back_board_id: card.defaultBackBoardId,
    glass_rates: card.glassRates,
    fabrication_rate_per_unit: 0,
    others_rates: card.othersRates,
    sheet_waste_factor: card.sheetWasteFactor,
    waste_mode: card.wasteMode,
    edge_banding_rate_per_m: card.edgeBandingRatePerM,
    business_id: businessId,
    created_at: card.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

// A card saved before others_rates existed had one flat ₹/cabinet
// "others" number. Carried over as a single per-cabinet row so no
// quote total moves by a rupee on upgrade; the business can rename or
// split it from the rate card. Zero (the seeded default, and what
// nearly every card has) becomes no rows at all, so the placeholder
// check in types/rates.ts still recognises an untouched card.
//
// The row's id is a FIXED string, not crypto.randomUUID(). A random id
// here would be regenerated on every load until the card is re-saved,
// and the rate card is part of what computeQuoteFingerprint hashes
// (lib/quotes.ts) — so every frozen quote would read "design has
// changed" on every page load, the exact cry-wolf failure that
// fingerprint's own comment warns trains people to ignore it.
function legacyOthersRates(othersRatePerUnit: number | undefined): RateCard['othersRates'] {
  const rate = Number(othersRatePerUnit ?? 0);
  return rate > 0 ? [{ id: 'legacy-other', label: 'Other', rate, basis: 'cabinet', showOnQuote: false, applyMargin: true }] : [];
}

// The shape others_rates had for one session (docs/DECISIONS.md §35 →
// §37): two fixed lists instead of one list with a per-row basis.
// Rows kept their own ids, so converting is deterministic and a card
// saved that way doesn't change fingerprint on every load.
interface TwoListOthersRates {
  perSqFt?: Omit<OtherRate, 'basis' | 'showOnQuote' | 'applyMargin'>[];
  perUnit?: Omit<OtherRate, 'basis' | 'showOnQuote' | 'applyMargin'>[];
}

// A card saved before §42 had one ₹/m² per material. Each becomes an
// 18mm board line at the same rate, with the same fixed id the seed
// uses (legacyBoardId), so no 18mm part's price moves and the
// fingerprint is stable across loads. The seeded 6mm back line is
// added too: the old card had no back rate at all, and without one
// every back would price at ₹0. A material the old card had no rate for
// still gets a line, at ₹0 — the same "not priced yet" it meant before.
function legacyBoards(rates: Partial<Record<MaterialType, number>> | null | undefined): RateCard['boards'] {
  const seededBack = PLACEHOLDER_RATES.boards.find((b) => b.id === DEFAULT_BACK_BOARD_ID);
  return [
    ...MATERIAL_RATE_KEYS.map((material) => ({
      id: legacyBoardId(material),
      material,
      thicknessMm: LEGACY_BOARD_THICKNESS_MM,
      ratePerSqM: Number(rates?.[material] ?? 0),
    })),
    ...(seededBack ? [{ ...seededBack }] : []),
  ];
}

// Site labour and fabrication were their own columns until §38. A card
// whose columns still hold a value (never saved since) gets them as the
// two labour rows, at the TOP of the list, with the old values and the
// seeded labels/ids — so no total moves and the quote prints them as
// it always did. Skipped if a row with that id is already there, and
// skipped when the column is 0, which is what every save now writes:
// that's what stops a deleted labour row coming back.
function withLegacyLabour(
  rates: RateCard['othersRates'],
  laborRatePerSqFt: number | undefined,
  fabricationRatePerUnit: number | undefined
): RateCard['othersRates'] {
  const legacy: [string, number | undefined][] = [
    [LABOUR_SITE_ID, laborRatePerSqFt],
    [LABOUR_FABRICATION_ID, fabricationRatePerUnit],
  ];
  const added = legacy.flatMap(([id, value]) => {
    const rate = Number(value ?? 0);
    const seed = DEFAULT_LABOUR_RATES.find((r) => r.id === id);
    if (!seed || rate <= 0 || rates.some((r) => r.id === id)) return [];
    return [{ ...seed, rate }];
  });
  return [...added, ...rates];
}

// Three generations of storage, newest first. sanitizeRateCard runs
// after this and fills any missing/invalid basis with 'cabinet'.
function readOthersRates(
  stored: RateCardRow['others_rates'],
  legacyPerUnit: number | undefined
): RateCard['othersRates'] {
  if (Array.isArray(stored)) return stored;
  if (stored) {
    return [
      ...(stored.perSqFt ?? []).map((r) => ({ ...r, basis: 'sqft' as const, showOnQuote: false, applyMargin: true })),
      ...(stored.perUnit ?? []).map((r) => ({ ...r, basis: 'cabinet' as const, showOnQuote: false, applyMargin: true })),
    ];
  }
  return legacyOthersRates(legacyPerUnit);
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
