// src/lib/catalogDefaults.ts
//
// A business's own default catalogue (§107): "Save as my default" and "Go
// back to my default" on the Catalogue page. Both are database functions
// (supabase/schema.sql, "STARTER CATALOGUE AND EACH BUSINESS'S OWN
// DEFAULT"), not client code, because restoring touches six tables at once
// and must do so as one statement each, under RLS, as the signed-in member.
//
// A new business's first default is the starter catalogue it was approved
// with, so it can always go back to the starter.

import { supabase } from './Supabaseclient';

// The functions don't exist until schema.sql has been re-run; say so
// rather than surfacing Postgres's wording.
function friendly(message: string): string {
  return /could not find the function|does not exist/i.test(message)
    ? 'Default catalogues need the latest database update: re-run supabase/schema.sql.'
    : message;
}

// When the business last saved its default, or null if never (or the
// column isn't there yet).
export async function fetchDefaultSavedAt(businessId: string): Promise<string | null> {
  const { data, error } = await supabase.from('businesses').select('catalog_default_saved_at').eq('id', businessId).maybeSingle();
  if (error) return null;
  return (data as { catalog_default_saved_at?: string | null } | null)?.catalog_default_saved_at ?? null;
}

// Returns how many items were saved.
export async function saveMyCatalogDefault(): Promise<number> {
  const { data, error } = await supabase.rpc('save_my_catalog_default');
  if (error) throw new Error(friendly(error.message));
  return data as number;
}

// Returns how many items were restored.
export async function restoreMyCatalogDefault(): Promise<number> {
  const { data, error } = await supabase.rpc('restore_my_catalog_default');
  if (error) throw new Error(friendly(error.message));
  return data as number;
}
