// src/lib/Inventory.ts
//
// CRUD for the business's own inventory — cabinet catalog items,
// obstacle presets, and appliance catalog items — backed by Supabase
// tables (cabinet_catalog_items, obstacle_presets,
// appliance_catalog_items; see supabase/schema.sql). Same split as
// persistence.ts/customers.ts: this file only knows about rows and the
// Supabase client, layoutStore.ts owns the in-memory state and is what
// the rest of the app actually talks to.

import { supabase } from './Supabaseclient';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../types/Catalog';

interface CabinetCatalogRow {
  id: string;
  category: string;
  label: string;
  module_type: CatalogItem['moduleType'];
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  material: CatalogItem['material'];
  finish_id: string;
  // JSONB. A discriminated union whose fields differ per kind, so it
  // stays one document rather than being flattened into nullable
  // columns — see the note on CatalogItem.frontLayout.
  front_layout: CatalogItem['frontLayout'] | null;
  handle_id: string | null;
  unit_price: number;
  created_at: string;
  updated_at: string;
}

interface ObstaclePresetRow {
  id: string;
  label: string;
  type: ObstaclePreset['type'];
  width_mm: number;
  depth_mm: number;
  floor_to_ceiling: boolean;
  height_mm: number;
  elevation_mm: number;
  created_at: string;
  updated_at: string;
}

interface ApplianceCatalogRow {
  id: string;
  label: string;
  appliance_type: ApplianceCatalogItem['applianceType'];
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  default_elevation_mm: number;
  model_url: string | null;
  // Fixed correction for how the .glb was exported — see the note on
  // modelRotation*Deg in types/Catalog.ts. Nullable so existing rows
  // need no backfill; null reads as "no correction".
  model_rotation_x_deg: number | null;
  model_rotation_y_deg: number | null;
  model_rotation_z_deg: number | null;
  unit_price: number;
  created_at: string;
  updated_at: string;
}

function rowToCatalogItem(row: CabinetCatalogRow): CatalogItem {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    moduleType: row.module_type,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    material: row.material,
    finishId: row.finish_id,
    frontLayout: row.front_layout ?? undefined,
    handleId: row.handle_id ?? undefined,
    unitPrice: row.unit_price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function catalogItemToRow(item: CatalogItem): CabinetCatalogRow {
  return {
    id: item.id,
    category: item.category,
    label: item.label,
    module_type: item.moduleType,
    width_mm: item.widthMm,
    depth_mm: item.depthMm,
    height_mm: item.heightMm,
    material: item.material,
    finish_id: item.finishId,
    front_layout: item.frontLayout ?? null,
    handle_id: item.handleId ?? null,
    unit_price: item.unitPrice,
    created_at: item.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

function rowToObstaclePreset(row: ObstaclePresetRow): ObstaclePreset {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    floorToCeiling: row.floor_to_ceiling,
    heightMm: row.height_mm,
    elevationMm: row.elevation_mm,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function obstaclePresetToRow(preset: ObstaclePreset): ObstaclePresetRow {
  return {
    id: preset.id,
    label: preset.label,
    type: preset.type,
    width_mm: preset.widthMm,
    depth_mm: preset.depthMm,
    floor_to_ceiling: preset.floorToCeiling,
    height_mm: preset.heightMm,
    elevation_mm: preset.elevationMm,
    created_at: preset.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

function rowToApplianceCatalogItem(row: ApplianceCatalogRow): ApplianceCatalogItem {
  return {
    id: row.id,
    label: row.label,
    applianceType: row.appliance_type,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    defaultElevationMm: row.default_elevation_mm,
    modelUrl: row.model_url ?? undefined,
    modelRotationXDeg: row.model_rotation_x_deg ?? undefined,
    modelRotationYDeg: row.model_rotation_y_deg ?? undefined,
    modelRotationZDeg: row.model_rotation_z_deg ?? undefined,
    unitPrice: row.unit_price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applianceCatalogItemToRow(item: ApplianceCatalogItem): ApplianceCatalogRow {
  return {
    id: item.id,
    label: item.label,
    appliance_type: item.applianceType,
    width_mm: item.widthMm,
    depth_mm: item.depthMm,
    height_mm: item.heightMm,
    default_elevation_mm: item.defaultElevationMm,
    model_url: item.modelUrl ?? null,
    model_rotation_x_deg: item.modelRotationXDeg ?? null,
    model_rotation_y_deg: item.modelRotationYDeg ?? null,
    model_rotation_z_deg: item.modelRotationZDeg ?? null,
    unit_price: item.unitPrice,
    created_at: item.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

// ---- Cabinet catalog ----

export async function fetchCabinetCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from('cabinet_catalog_items')
    .select('*')
    .order('category', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch cabinet catalog: ${error.message}`);
  }
  return (data as CabinetCatalogRow[]).map(rowToCatalogItem);
}

// Upsert — used for both "add new" (caller generates a fresh id) and
// "edit existing" (same id, new field values).
export async function saveCabinetCatalogItem(item: CatalogItem): Promise<void> {
  const { error } = await supabase
    .from('cabinet_catalog_items')
    .upsert(catalogItemToRow(item));

  if (error) {
    throw new Error(`Failed to save catalog item: ${error.message}`);
  }
}

export async function deleteCabinetCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from('cabinet_catalog_items').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete catalog item: ${error.message}`);
  }
}

// ---- Obstacle presets ----

export async function fetchObstaclePresets(): Promise<ObstaclePreset[]> {
  const { data, error } = await supabase
    .from('obstacle_presets')
    .select('*')
    .order('label', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch obstacle presets: ${error.message}`);
  }
  return (data as ObstaclePresetRow[]).map(rowToObstaclePreset);
}

export async function saveObstaclePreset(preset: ObstaclePreset): Promise<void> {
  const { error } = await supabase
    .from('obstacle_presets')
    .upsert(obstaclePresetToRow(preset));

  if (error) {
    throw new Error(`Failed to save obstacle preset: ${error.message}`);
  }
}

export async function deleteObstaclePreset(id: string): Promise<void> {
  const { error } = await supabase.from('obstacle_presets').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete obstacle preset: ${error.message}`);
  }
}

// ---- Appliance catalog ----

export async function fetchApplianceCatalog(): Promise<ApplianceCatalogItem[]> {
  const { data, error } = await supabase
    .from('appliance_catalog_items')
    .select('*')
    .order('appliance_type', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch appliance catalog: ${error.message}`);
  }
  return (data as ApplianceCatalogRow[]).map(rowToApplianceCatalogItem);
}

export async function saveApplianceCatalogItem(item: ApplianceCatalogItem): Promise<void> {
  const { error } = await supabase
    .from('appliance_catalog_items')
    .upsert(applianceCatalogItemToRow(item));

  if (error) {
    throw new Error(`Failed to save appliance catalog item: ${error.message}`);
  }
}

export async function deleteApplianceCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from('appliance_catalog_items').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete appliance catalog item: ${error.message}`);
  }
}
