// src/lib/fixtureCatalog.ts
//
// CRUD for the business's light fixture catalogue
// (`light_fixture_catalog` — see supabase/schema.sql). Same shape as
// lib/handles.ts and lib/finishes.ts: row interface, two mappers, three
// async functions, no state.
//
// A table rather than a fixed list because colour temperature and rate
// are exactly what varies between suppliers — a business stocks "3000K
// COB strip at ₹340/m" and "6500K strip at ₹310/m" as distinct products
// and prices them from its own invoices.

import { supabase } from './Supabaseclient';
import type { FixtureCatalogItem, FixtureKind } from '../types/fixture';

interface FixtureCatalogRow {
  id: string;
  label: string;
  kind: FixtureKind;
  color_temp_k: number;
  lumens: number;
  pricing_mode: FixtureCatalogItem['pricingMode'];
  price: number;
  // Optional GLB body — see FixtureCatalogItem.modelUrl in
  // types/fixture.ts. Nullable/absent, same convention as
  // appliance_catalog_items.
  model_url?: string | null;
  model_rotation_x_deg?: number | null;
  model_rotation_y_deg?: number | null;
  model_rotation_z_deg?: number | null;
  business_id: string;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: FixtureCatalogRow): FixtureCatalogItem {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    colorTempK: row.color_temp_k,
    lumens: row.lumens,
    pricingMode: row.pricing_mode,
    price: row.price,
    modelUrl: row.model_url ?? undefined,
    modelRotationXDeg: row.model_rotation_x_deg ?? undefined,
    modelRotationYDeg: row.model_rotation_y_deg ?? undefined,
    modelRotationZDeg: row.model_rotation_z_deg ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemToRow(item: FixtureCatalogItem, businessId: string): FixtureCatalogRow {
  return {
    id: item.id,
    label: item.label,
    kind: item.kind,
    color_temp_k: item.colorTempK,
    lumens: item.lumens,
    pricing_mode: item.pricingMode,
    price: item.price,
    model_url: item.modelUrl ?? null,
    model_rotation_x_deg: item.modelRotationXDeg ?? null,
    model_rotation_y_deg: item.modelRotationYDeg ?? null,
    model_rotation_z_deg: item.modelRotationZDeg ?? null,
    business_id: businessId,
    created_at: item.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

export async function fetchFixtureCatalog(): Promise<FixtureCatalogItem[]> {
  const { data, error } = await supabase
    .from('light_fixture_catalog')
    .select('*')
    .order('label');

  if (error) throw new Error(`Failed to load light fixtures: ${error.message}`);
  return (data as FixtureCatalogRow[]).map(rowToItem);
}

export async function saveFixtureCatalogItem(
  item: FixtureCatalogItem,
  businessId: string
): Promise<void> {
  const { error } = await supabase
    .from('light_fixture_catalog')
    .upsert(itemToRow(item, businessId));
  if (error) throw new Error(`Failed to save light fixture: ${error.message}`);
}

// One multi-row upsert, genuinely atomic — used by the fixture Excel
// import's "Commit" step. Same reasoning as
// saveCabinetCatalogItemsBulk in lib/Inventory.ts.
export async function saveFixtureCatalogItemsBulk(
  items: FixtureCatalogItem[],
  businessId: string
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase
    .from('light_fixture_catalog')
    .upsert(items.map((item) => itemToRow(item, businessId)));
  if (error) throw new Error(`Failed to save light fixtures: ${error.message}`);
}

// Deleting a catalogue row that placed fixtures still reference is
// allowed — a discontinued strip has to be retirable without editing
// every old layout. Those fixtures then resolve to null in
// resolveFixturePlacement, so they stop rendering AND stop being
// priced, which is the honest outcome: without a row there is no
// colour temperature, no brightness and no rate to use. The UI flags
// the count so it isn't silent.
export async function deleteFixtureCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from('light_fixture_catalog').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete light fixture: ${error.message}`);
}

// Same reasoning as saveFixtureCatalogItemsBulk — one statement, used
// by the Excel import's explicit "DELETE" column.
export async function deleteFixtureCatalogItemsBulk(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('light_fixture_catalog').delete().in('id', ids);
  if (error) throw new Error(`Failed to delete light fixtures: ${error.message}`);
}
