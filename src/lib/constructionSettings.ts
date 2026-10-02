// src/lib/constructionSettings.ts
//
// CRUD for the business's construction settings (`construction_settings`
// table — see supabase/schema.sql and types/construction.ts). Same shape
// as lib/rates.ts: one row per business, no create/delete, a fetch that
// falls back to defaults when no row exists yet, and an upsert on save.

import { supabase } from './Supabaseclient';
import {
  defaultConstructionSettings,
  sanitizeConstruction,
  type ConstructionSettings,
} from '../types/construction';

interface ConstructionRow {
  id: string;
  // Everything except id/timestamps in ONE jsonb column rather than a
  // column per setting: the set of settings will grow (drawer box
  // sizing, plinths, edge-band thickness) and is never queried in SQL —
  // the same reasoning hardware_rates is one column.
  settings: Omit<ConstructionSettings, 'id' | 'createdAt' | 'updatedAt'>;
  business_id: string;
  created_at: string;
  updated_at: string;
}

// Same RLS-scoped, unfiltered select as fetchRateCard: one row per
// business. A missing row is an expected state (defaults); a failed
// request is not, and throws.
export async function fetchConstructionSettings(): Promise<ConstructionSettings> {
  const { data, error } = await supabase.from('construction_settings').select('*').maybeSingle();
  if (error) throw new Error(`Failed to load construction settings: ${error.message}`);
  if (!data) return defaultConstructionSettings();
  const row = data as ConstructionRow;
  return sanitizeConstruction({
    ...row.settings,
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function saveConstructionSettings(
  settings: ConstructionSettings,
  businessId: string
): Promise<void> {
  const c = sanitizeConstruction(settings);
  const row: ConstructionRow = {
    id: c.id,
    // Listed field by field rather than spread-minus-keys, so a field
    // added to ConstructionSettings is a compile error here until it's
    // deliberately persisted — not silently dropped or silently stored.
    settings: {
      topFit: c.topFit,
      bottomFit: c.bottomFit,
      backFit: c.backFit,
      grooveDepthMm: c.grooveDepthMm,
      railWidthMm: c.railWidthMm,
      shelfSetbackMm: c.shelfSetbackMm,
      drawerBox: c.drawerBox,
      confirmed: c.confirmed,
    },
    business_id: businessId,
    created_at: c.createdAt,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('construction_settings').upsert(row);
  if (error) throw new Error(`Failed to save construction settings: ${error.message}`);
}
