// src/types/Catalog.ts
//
// The business's own INVENTORY of placeable pieces — cabinet SKUs,
// obstacle presets, and appliance models — distinct from a
// PlacedCabinetItem/Obstacle/PlacedApplianceItem (types/cabinet.ts,
// types/layout.ts, types/appliance.ts), which are INSTANCES already
// sitting on a specific layout at a specific x/y. CabinetToolbar/
// ObstacleToolbar/ApplianceToolbar read this inventory to render "add"
// buttons; clicking one creates a new placed item seeded from the
// matching row's defaults. InventoryManager is where a business adds,
// renames, and edits these rows — see lib/Inventory.ts for the
// Supabase CRUD.
//
// Rows are backed by Supabase tables (cabinet_catalog_items,
// obstacle_presets, appliance_catalog_items — see supabase/schema.sql)
// now, not a bundled static JSON file: every business builds and edits
// its own set instead of sharing one fixed catalog. The tables ship
// pre-seeded with the same starter pieces the app used to hardcode, as
// a convenient default — not something this type or lib/Inventory.ts
// need to keep in sync with going forward.

import type { ModuleType, MaterialType } from './cabinet';
import type { FrontLayout } from './front';
import type { ObstacleType } from './layout';
import type { ApplianceType } from './appliance';

export interface CatalogItem {
  id: string;
  category: string;   // free-form grouping label the business chooses, e.g. "Base", "Wall", "Premium Range"
  label: string;       // the business's own name for this piece, shown on the toolbar button
  moduleType: ModuleType;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  material: MaterialType;  // substrate — costing only, never visible
  // Default finish for cabinets added from this catalogue item
  // (FK -> SurfaceFinish.id, types/finish.ts). Placed cabinets can
  // override it individually.
  finishId: string;
  // Default front configuration for cabinets added from this row — see
  // types/front.ts. Absent falls back to defaultFrontLayout(moduleType,
  // widthMm), so a business that never touches this still gets sensible
  // doors and drawers rather than blank boxes.
  //
  // Stored as JSONB rather than flattened into columns because the
  // shape is a discriminated union whose fields differ per kind
  // (heightRatios only exists for drawers), and flattening a union
  // into nullable columns is how you end up with a drawer count on a
  // door.
  frontLayout?: FrontLayout;
  // FK -> HandleSpec.id (types/front.ts).
  handleId?: string;
  unitPrice: number;   // ₹ default base price before hardware/labor
  createdAt: string;
  updatedAt: string;
}

export interface ObstaclePreset {
  id: string;
  label: string;       // e.g. "Standard Column", "Kitchen Duct"
  type: ObstacleType;
  widthMm: number;
  depthMm: number;
  floorToCeiling: boolean;
  // Same meaning as Obstacle.heightMm (types/layout.ts) — ignored when
  // floorToCeiling is true, used as the new obstacle's starting height
  // otherwise. Freely editable afterward via ObstacleInspector.
  heightMm: number;
  // Same meaning as Obstacle.elevationMm (types/layout.ts) — ignored
  // when floorToCeiling is true. Lets a preset for something like a
  // mid-wall electrical fixture start above the floor by default.
  elevationMm: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplianceCatalogItem {
  id: string;
  label: string;       // the business's own name, e.g. "4-Burner Hob", "Slimline Chimney"
  applianceType: ApplianceType;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  // Stored per catalog row (rather than derived from applianceType by a
  // shared default-elevation rule, the way cabinets do via
  // getDefaultElevationMm) because appliance mounting height varies a
  // lot even within one type — e.g. a chimney's height above the hob
  // depends on the specific hob/chimney models a business stocks, not
  // just "it's a chimney". Editable per-row in InventoryManager.
  defaultElevationMm: number;
  // Optional .glb/.gltf path, e.g. '/models/hob-600.glb'. Null/absent
  // keeps the box, so models can be adopted one appliance at a time.
  modelUrl?: string;
  // Fixed correction, in degrees, for a model that was exported facing
  // the wrong way — applied about the model's own axes BEFORE it gets
  // measured and fitted (see ApplianceModel.tsx).
  //
  // This is a property of the FILE, not of any placement, which is why
  // it lives here: a Blender export is Z-up where glTF wants Y-up
  // (xDeg -90), and plenty of assets face right rather than front
  // (yDeg ±90). Set it once when adding the model and every appliance
  // placed from this row comes out correct; the designer's own
  // rotationDeg then turns the appliance on top of that, which is a
  // separate thing entirely.
  //
  // Absent means no correction, so existing rows need no backfill.
  modelRotationXDeg?: number;
  modelRotationYDeg?: number;
  modelRotationZDeg?: number;
  unitPrice: number;   // ₹ per unit
  createdAt: string;
  updatedAt: string;
}
