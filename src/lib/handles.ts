// src/lib/handles.ts
//
// CRUD for the business's handle catalogue (`handles` table — see
// supabase/schema.sql). Deliberately the same shape as lib/finishes.ts:
// row interface, two mappers, three async functions, no caching. The
// store holds the array; nothing here keeps state.
//
// Handles started as a constant in types/front.ts. They're a table now
// for the same reason finishes stopped being an enum — a fixed list
// can't express what a business actually stocks, and a gola profile at
// one supplier's rate is a different product from another's.

import { supabase } from './Supabaseclient';
import type { HandleSpec, HandleKind } from '../types/front';

interface HandleRow {
  id: string;
  label: string;
  kind: HandleKind;
  length_mm: number;
  color_hex: string;
  metalness: number;
  roughness: number;
  pricing_mode: HandleSpec['pricingMode'];
  price: number;
  business_id: string;
  created_at: string;
  updated_at: string;
}

function rowToHandle(row: HandleRow): HandleSpec {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    lengthMm: row.length_mm,
    colorHex: row.color_hex,
    metalness: row.metalness,
    roughness: row.roughness,
    pricingMode: row.pricing_mode,
    price: row.price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function handleToRow(handle: HandleSpec, businessId: string): HandleRow {
  return {
    id: handle.id,
    label: handle.label,
    kind: handle.kind,
    length_mm: handle.lengthMm,
    color_hex: handle.colorHex,
    metalness: handle.metalness,
    roughness: handle.roughness,
    pricing_mode: handle.pricingMode,
    price: handle.price,
    business_id: businessId,
    created_at: handle.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

export async function fetchHandles(): Promise<HandleSpec[]> {
  const { data, error } = await supabase.from('handles').select('*').order('label');

  if (error) throw new Error(`Failed to load handles: ${error.message}`);
  return (data as HandleRow[]).map(rowToHandle);
}

export async function saveHandle(handle: HandleSpec, businessId: string): Promise<void> {
  const { error } = await supabase.from('handles').upsert(handleToRow(handle, businessId));
  if (error) throw new Error(`Failed to save handle: ${error.message}`);
}

// One multi-row upsert, genuinely atomic — used by the handle Excel
// import's "Commit" step. Same reasoning as
// saveCabinetCatalogItemsBulk in lib/Inventory.ts.
export async function saveHandlesBulk(handles: HandleSpec[], businessId: string): Promise<void> {
  if (handles.length === 0) return;
  const { error } = await supabase
    .from('handles')
    .upsert(handles.map((handle) => handleToRow(handle, businessId)));
  if (error) throw new Error(`Failed to save handles: ${error.message}`);
}

// Deleting a handle that placed cabinets still reference is allowed
// rather than blocked: resolveHandle (types/front.ts) falls those
// cabinets back to the default, so they keep drawing and keep pricing.
// Blocking the delete would mean a business could never retire a
// discontinued handle without first editing every old layout.
export async function deleteHandle(id: string): Promise<void> {
  const { error } = await supabase.from('handles').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete handle: ${error.message}`);
}

// Same reasoning as saveHandlesBulk — one statement, used by the
// Excel import's explicit "DELETE" column.
export async function deleteHandlesBulk(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('handles').delete().in('id', ids);
  if (error) throw new Error(`Failed to delete handles: ${error.message}`);
}
