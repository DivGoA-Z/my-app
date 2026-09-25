// src/lib/finishes.ts
//
// CRUD for the business's finish catalogue (surface_finishes table —
// see supabase/schema.sql). Same split as Inventory.ts/Persistence.ts:
// this file only knows about rows and the Supabase client; layoutStore
// owns the in-memory state everything else reads.
//
// Swatch image UPLOAD lives here too rather than in panoramaStorage.ts,
// even though both talk to Supabase Storage — they're different buckets
// with different lifecycles (a panorama belongs to one camera node in
// one layout; a finish swatch is business-wide inventory reused across
// every project).

import { supabase } from './Supabaseclient';
import type { SurfaceFinish, PatternCategory, TilingMode, FinishSource } from '../types/finish';

const SWATCH_BUCKET = 'material-swatches';

interface SurfaceFinishRow {
  id: string;
  label: string;
  brand: string | null;
  code: string | null;
  finish_type_label: string;
  pattern_category: PatternCategory;
  solid_color: string | null;
  albedo_url: string | null;
  procedural_kind: string | null;
  normal_map_url: string | null;
  roughness_map_url: string | null;
  relief_strength: number;
  roughness: number;
  clearcoat: number;
  clearcoat_roughness: number;
  metalness: number;
  swatch_width_mm: number;
  swatch_height_mm: number;
  tiling_mode: TilingMode;
  price_per_sq_m: number;
  source: FinishSource;
  business_id: string;
  created_at: string;
  updated_at: string;
}

function rowToFinish(row: SurfaceFinishRow): SurfaceFinish {
  return {
    id: row.id,
    label: row.label,
    brand: row.brand ?? undefined,
    code: row.code ?? undefined,
    finishTypeLabel: row.finish_type_label,
    patternCategory: row.pattern_category,
    solidColor: row.solid_color ?? undefined,
    albedoUrl: row.albedo_url ?? undefined,
    proceduralKind: (row.procedural_kind as SurfaceFinish['proceduralKind']) ?? undefined,
    normalMapUrl: row.normal_map_url ?? undefined,
    roughnessMapUrl: row.roughness_map_url ?? undefined,
    reliefStrength: row.relief_strength,
    roughness: row.roughness,
    clearcoat: row.clearcoat,
    clearcoatRoughness: row.clearcoat_roughness,
    metalness: row.metalness,
    swatchWidthMm: row.swatch_width_mm,
    swatchHeightMm: row.swatch_height_mm,
    tilingMode: row.tiling_mode,
    pricePerSqM: row.price_per_sq_m,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function finishToRow(finish: SurfaceFinish, businessId: string): SurfaceFinishRow {
  return {
    id: finish.id,
    business_id: businessId,
    label: finish.label,
    brand: finish.brand ?? null,
    code: finish.code ?? null,
    finish_type_label: finish.finishTypeLabel,
    pattern_category: finish.patternCategory,
    solid_color: finish.solidColor ?? null,
    albedo_url: finish.albedoUrl ?? null,
    procedural_kind: finish.proceduralKind ?? null,
    normal_map_url: finish.normalMapUrl ?? null,
    roughness_map_url: finish.roughnessMapUrl ?? null,
    relief_strength: finish.reliefStrength,
    roughness: finish.roughness,
    clearcoat: finish.clearcoat,
    clearcoat_roughness: finish.clearcoatRoughness,
    metalness: finish.metalness,
    swatch_width_mm: finish.swatchWidthMm,
    swatch_height_mm: finish.swatchHeightMm,
    tiling_mode: finish.tilingMode,
    price_per_sq_m: finish.pricePerSqM,
    source: finish.source,
    created_at: finish.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

export async function fetchFinishes(): Promise<SurfaceFinish[]> {
  const { data, error } = await supabase
    .from('surface_finishes')
    .select('*')
    .order('finish_type_label', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch finishes: ${error.message}`);
  }
  return (data as SurfaceFinishRow[]).map(rowToFinish);
}

export async function saveFinish(finish: SurfaceFinish, businessId: string): Promise<void> {
  const { error } = await supabase
    .from('surface_finishes')
    .upsert(finishToRow(finish, businessId));
  if (error) {
    throw new Error(`Failed to save finish: ${error.message}`);
  }
}

export async function deleteFinish(id: string): Promise<void> {
  const { error } = await supabase.from('surface_finishes').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete finish: ${error.message}`);
  }
}

// Uploads a swatch photo and returns its public URL, ready to store as
// SurfaceFinish.albedoUrl.
//
// Keyed by finish id so re-uploading replaces that finish's swatch
// rather than accumulating orphans. Carries the same cache-busting
// version param as panorama uploads, and for the same reason: the path
// is stable, so without it the CDN and browser keep serving the
// previous image and a replaced swatch looks like it did nothing.
export async function uploadSwatch(finishId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${finishId}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(SWATCH_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
    cacheControl: '60',
  });
  if (uploadError) {
    throw new Error(`Failed to upload swatch: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(SWATCH_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function deleteSwatch(finishId: string, albedoUrl: string): Promise<void> {
  // Recover the stored object name from the public URL (strip the query
  // string the cache-buster added, then take the last path segment).
  const withoutQuery = albedoUrl.split('?')[0];
  const path = withoutQuery.substring(withoutQuery.lastIndexOf('/') + 1) || `${finishId}.jpg`;

  const { error } = await supabase.storage.from(SWATCH_BUCKET).remove([path]);
  if (error) {
    throw new Error(`Failed to delete swatch: ${error.message}`);
  }
}
