// src/lib/Persistence.ts
//
// All Supabase read/write logic + the row<->type mapping lives here,
// kept separate from layoutStore.ts on purpose — same reasoning as
// splitting out bom.ts and collision.ts: the store should own state
// shape and call out to plain functions, not embed DB/network logic
// inline. Makes this swappable later (different backend, offline mode,
// etc.) without touching the store's public API.

import { sanitizeOtherRates, type OtherRate } from '../types/rates';
import { supabase } from './Supabaseclient';
import type { CustomerProject, LeadStatus } from '../types/customer';
import type { RoomLayout, Wall, WallOrientation, Obstacle } from '../types/layout';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { CameraNode } from '../types/Camera';
import { getDefaultElevationMm } from './cabinetGeometry';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from './collision';
import { DEFAULT_FINISH_IDS, FALLBACK_FINISH_ID } from '../types/finish';
import { DEFAULT_LIGHTING_MODE } from '../types/fixture';
import { DEFAULT_EXPOSURE } from './lighting3d';
import type { LightFixture } from '../types/fixture';

// ---- DB row shapes (snake_case, matching schema.sql) ----

export interface ProjectRow {
  id: string;
  client_name: string;
  phone: string;
  email: string | null;
  address: string;
  locality: string;
  status: LeadStatus;
  assigned_to: string | null;
  notes: string | null;
  quote_total: number | null;
  // Required, no default — see the note on projectToRow's `businessId`
  // parameter. Not part of CustomerProject (types/customer.ts): this is
  // purely an RLS/ownership concern, not something the UI reads or
  // displays, so it's a row-shape-only field.
  business_id: string;
  created_at: string;
  updated_at: string;
}

interface LayoutRow {
  id: string;
  project_id: string;
  name: string;
  width_mm: number;
  depth_mm: number;
  ceiling_height_mm: number | null;
  walls: Wall[];
  obstacles: Obstacle[];
  cabinets: PlacedCabinetItem[];
  // Same top-level-column treatment as cabinets (not nested inside
  // RoomLayout) — appliances have a layoutId FK and are quoted/priced
  // the same way cabinets are, so they follow the cabinets pattern
  // rather than the obstacles/cameras one.
  appliances: PlacedApplianceItem[];
  cameras: CameraNode[];
  fixtures: LightFixture[];
  lighting_mode: string | null;
  exposure: number | null;
  price_electrical: boolean | null;
  floor_finish_id: string | null;
  floor_concealed_finish_id: string | null;
  ceiling_finish_id: string | null;
  countertop_finish_id: string | null;
  price_countertop: boolean | null;
  margin_percent: number | null;
  sheet_waste_factor: number | null;
  project_charges: RoomLayout['projectCharges'] | null;
  charge_rates: OtherRate[] | null;
  loose_parts: RoomLayout['looseParts'] | null;
  grid_snap_mm: number;
  // Same reasoning as ProjectRow.business_id.
  business_id: string;
  created_at: string;
  updated_at: string;
}

// ---- Mappers ----

// Exported — reused by lib/customers.ts (dashboard-level list/create/
// status-update operations) so there's one place that knows how
// CustomerProject maps onto the `projects` table.
//
// `businessId` is REQUIRED and has no default — same reasoning as
// calculateBOM's PricingContext (CLAUDE.md): a missing value here
// should be a compile error, not something that silently resolves to
// the wrong business or to NULL and gets rejected by the NOT NULL
// constraint at the last possible moment. RLS's `with check` is the
// server-side backstop, not the source of truth for this value.
export function projectToRow(project: CustomerProject, businessId: string): ProjectRow {
  return {
    id: project.id,
    client_name: project.clientName,
    phone: project.phone,
    email: project.email ?? null,
    address: project.address,
    locality: project.locality,
    status: project.status,
    assigned_to: project.assignedTo ?? null,
    notes: project.notes ?? null,
    quote_total: project.quoteTotal ?? null,
    business_id: businessId,
    created_at: project.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

export function rowToProject(row: ProjectRow): CustomerProject {
  return {
    id: row.id,
    clientName: row.client_name,
    phone: row.phone,
    email: row.email ?? undefined,
    address: row.address,
    locality: row.locality,
    status: row.status,
    assignedTo: row.assigned_to ?? undefined,
    notes: row.notes ?? undefined,
    quoteTotal: row.quote_total ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function layoutToRow(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[],
  businessId: string
): LayoutRow {
  return {
    id: layout.id,
    project_id: layout.projectId,
    business_id: businessId,
    name: layout.name,
    width_mm: layout.dimensions.widthMm,
    depth_mm: layout.dimensions.depthMm,
    ceiling_height_mm: layout.dimensions.ceilingHeightMm ?? null,
    walls: layout.walls,
    obstacles: layout.obstacles,
    cabinets,
    appliances,
    cameras: layout.cameras,
    fixtures: layout.fixtures ?? [],
    lighting_mode: layout.lightingMode ?? null,
    exposure: layout.exposure ?? null,
    price_electrical: layout.priceElectrical ?? null,
    floor_finish_id: layout.floorFinishId ?? null,
    floor_concealed_finish_id: layout.floorConcealedFinishId ?? null,
    ceiling_finish_id: layout.ceilingFinishId ?? null,
    countertop_finish_id: layout.countertopFinishId ?? null,
    price_countertop: layout.priceCountertop ?? null,
    margin_percent: layout.marginPercent ?? null,
    sheet_waste_factor: layout.sheetWasteFactor ?? null,
    project_charges: layout.projectCharges ?? null,
    charge_rates: layout.chargeRates ?? null,
    loose_parts: layout.looseParts ?? null,
    grid_snap_mm: layout.gridSnapMm,
    created_at: layout.createdAt,
    updated_at: new Date().toISOString(), // bumped on every save
  };
}

function rowToLayout(row: LayoutRow): RoomLayout {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    dimensions: {
      widthMm: row.width_mm,
      depthMm: row.depth_mm,
      ceilingHeightMm: row.ceiling_height_mm ?? undefined,
    },
    walls: normalizeWalls(row.walls, row.width_mm, row.depth_mm),
    obstacles: row.obstacles.map(normalizeObstacle),
    // Defensive fallback: a row saved before the cameras column existed
    // reads back as '[]' thanks to the column's DEFAULT (see the ALTER
    // TABLE in supabase/schema.sql), but this guards against a null
    // slipping through anyway.
    cameras: row.cameras ?? [],
    // Same defensive fallback as cameras: the column has a DEFAULT, but
    // a null slipping through would break every .map over this array.
    fixtures: row.fixtures ?? [],
    lightingMode: (row.lighting_mode as RoomLayout['lightingMode']) ?? DEFAULT_LIGHTING_MODE,
    exposure: row.exposure ?? DEFAULT_EXPOSURE,
    // Defaults to FALSE, not undefined — "is electrical charged?" has
    // a real answer for every project, and the answer is usually no.
    priceElectrical: row.price_electrical ?? false,
    floorFinishId: row.floor_finish_id ?? undefined,
    floorConcealedFinishId: row.floor_concealed_finish_id ?? undefined,
    ceilingFinishId: row.ceiling_finish_id ?? undefined,
    countertopFinishId: row.countertop_finish_id ?? undefined,
    // Same reasoning as priceElectrical — "is the countertop charged?"
    // has a real answer for every project, and it's usually no.
    priceCountertop: row.price_countertop ?? false,
    // Left undefined (not defaulted to a number here) when unset —
    // lib/bom.ts's DEFAULT_MARGIN_PERCENT is the single place that
    // fallback lives, so this file doesn't need its own copy of it.
    marginPercent: row.margin_percent ?? undefined,
    // Undefined when unset, same as marginPercent — the business
    // default on the rate card is the fallback, applied in lib/bom.ts.
    sheetWasteFactor: row.sheet_waste_factor ?? undefined,
    // Each list defaulted separately — same defensive reasoning as
    // cameras/fixtures above: a missing key would break every .map.
    // NULL → undefined → follow the business rates. Sanitised with the
    // rate card's own function so both lists obey the same rules.
    chargeRates: row.charge_rates ? sanitizeOtherRates(row.charge_rates) : undefined,
    looseParts: row.loose_parts ?? undefined,
    projectCharges: row.project_charges
      ? { labor: row.project_charges.labor ?? [], other: row.project_charges.other ?? [] }
      : undefined,
    gridSnapMm: row.grid_snap_mm,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The four walls are the surfaces you assign finishes to, so there has
// to be a row per wall for the UI to bind to — but `walls` has been
// optional up to now and is empty on most saved layouts (blankLayout
// below never populated it, and the 3D view drew four hardcoded boxes
// from the room dimensions instead).
//
// This fills in any missing wall, and refreshes lengths from the room's
// current dimensions: the room is resizable (RoomSettingsPanel), and a
// stale lengthMm would silently mis-cost the wall finish.
function normalizeWalls(walls: Wall[], roomWidthMm: number, roomDepthMm: number): Wall[] {
  const lengthFor = (orientation: WallOrientation) =>
    orientation === 'north' || orientation === 'south' ? roomWidthMm : roomDepthMm;

  return (['north', 'east', 'south', 'west'] as WallOrientation[]).map((orientation) => {
    const existing = (walls ?? []).find((w) => w.orientation === orientation);
    return {
      id: existing?.id ?? `wall_${orientation}`,
      orientation,
      lengthMm: lengthFor(orientation),
      // Openings default to an empty array rather than undefined so
      // every consumer can map over it without a guard — and so a
      // wall saved before openings existed behaves as "no openings"
      // rather than as missing data.
      openings: existing?.openings ?? [],
      hasWindow: existing?.hasWindow,
      hasDoor: existing?.hasDoor,
      finishId: existing?.finishId,
      concealedFinishId: existing?.concealedFinishId,
    };
  });
}

// Cabinets saved before elevationMm existed on PlacedCabinetItem come
// back from Supabase without that key at all (it's stored inside the
// `cabinets` JSONB array, not a real column with its own DEFAULT — see
// the note on the cameras column for how that differs). Backfill it
// with the same default a NEW cabinet of that type would get, so old
// layouts don't silently end up with elevationMm === undefined feeding
// into Z-aware collision math (lib/collision.ts).
function normalizeCabinet(item: PlacedCabinetItem): PlacedCabinetItem {
  // Cabinets saved before finishes became catalogue rows carry the old
  // `finish` enum string ('Acrylic' | 'Laminate' | ...) and no finishId.
  // Map it onto the matching seeded default so old layouts keep their
  // finish instead of silently rendering as the fallback. The legacy
  // field is read here and deliberately not carried forward.
  const legacy = item as PlacedCabinetItem & { finish?: string; color?: string };
  const finishId =
    item.finishId ?? (legacy.finish ? DEFAULT_FINISH_IDS[legacy.finish] : undefined) ?? FALLBACK_FINISH_ID;

  return {
    ...item,
    elevationMm: item.elevationMm ?? getDefaultElevationMm(item.moduleType),
    finishId,
    // `color` was an unused optional field before; it now has real
    // meaning as a per-cabinet override, so carry any old value over.
    colorOverride: item.colorOverride ?? legacy.color,
  };
}

// Same reasoning as normalizeCabinet above, for obstacles saved before
// heightMm existed on Obstacle (types/layout.ts) — backfills it with
// the same default a newly-created partial-height obstacle would get,
// so old layouts don't end up with heightMm === undefined feeding into
// Z-aware collision math (lib/collision.ts).
function normalizeObstacle(obstacle: Obstacle): Obstacle {
  return {
    ...obstacle,
    heightMm: obstacle.heightMm ?? PARTIAL_OBSTACLE_HEIGHT_MM,
    elevationMm: obstacle.elevationMm ?? 0,
    rotationDeg: obstacle.rotationDeg ?? 0,
  };
}

// A brand-new project (e.g. a fresh Lead) has no saved layout yet —
// this is what loadProjectBundle falls back to instead of erroring.
function blankLayout(projectId: string): RoomLayout {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId,
    name: 'New Layout',
    dimensions: { widthMm: 3000, depthMm: 4000, ceilingHeightMm: 2700 },
    walls: normalizeWalls([], 3000, 4000),
    obstacles: [],
    cameras: [],
    fixtures: [],
    lightingMode: DEFAULT_LIGHTING_MODE,
    exposure: DEFAULT_EXPOSURE,
    priceElectrical: false,
    priceCountertop: false,
    gridSnapMm: 50,
    createdAt: now,
    updatedAt: now,
  };
}

// ---- Public API ----

export interface ProjectBundle {
  project: CustomerProject;
  layout: RoomLayout;
  cabinets: PlacedCabinetItem[];
  appliances: PlacedApplianceItem[];
}

export async function saveProjectBundle(bundle: ProjectBundle, businessId: string): Promise<void> {
  const { project, layout, cabinets, appliances } = bundle;

  const { error: projectError } = await supabase
    .from('projects')
    .upsert(projectToRow(project, businessId));
  if (projectError) {
    throw new Error(`Failed to save project: ${projectError.message}`);
  }

  const { error: layoutError } = await supabase
    .from('layouts')
    .upsert(layoutToRow(layout, cabinets, appliances, businessId));
  if (layoutError) {
    throw new Error(`Failed to save layout: ${layoutError.message}`);
  }
}

// Links captured panoramas back to the leads they belong to via the
// REAL foreign-key chain that already exists — CameraNode.layoutId ->
// RoomLayout.projectId — rather than guessing off a timestamp. Used by
// CustomerDashboard.tsx to show a "360° Views" button per row without
// loading each project's full layout/cabinets/etc.
//
// Only the most-recently-updated layout row per project is considered
// (same "latest wins" rule loadProjectBundle uses via its own
// .order('updated_at').limit(1)) — a project could technically have
// older layout rows lying around, and their cameras shouldn't surface
// here since they aren't the layout that would actually load.
export async function fetchCapturedPanoramasByProject(): Promise<Record<string, CameraNode[]>> {
  const { data, error } = await supabase
    .from('layouts')
    .select('project_id, cameras, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch panoramas: ${error.message}`);
  }

  const latestByProject = new Map<string, CameraNode[]>();
  for (const row of data as { project_id: string; cameras: CameraNode[] }[]) {
    if (latestByProject.has(row.project_id)) continue; // a newer row for this project already won
    const captured = (row.cameras ?? []).filter((camera) => camera.panoramaUrl);
    if (captured.length > 0) {
      latestByProject.set(row.project_id, captured);
    }
  }
  return Object.fromEntries(latestByProject);
}

export async function loadProjectBundle(projectId: string): Promise<ProjectBundle> {
  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (projectError || !projectRow) {
    throw new Error(
      `Failed to load project ${projectId}: ${projectError?.message ?? 'not found'}`
    );
  }

  // maybeSingle(), not single() — a Lead with no saved layout yet is a
  // normal, expected case here, not an error.
  const { data: layoutRow, error: layoutError } = await supabase
    .from('layouts')
    .select('*')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (layoutError) {
    throw new Error(`Failed to load layout for project ${projectId}: ${layoutError.message}`);
  }

  const project = rowToProject(projectRow as ProjectRow);

  if (!layoutRow) {
    return { project, layout: blankLayout(projectId), cabinets: [], appliances: [] };
  }

  const typedLayoutRow = layoutRow as LayoutRow;
  return {
    project,
    layout: rowToLayout(typedLayoutRow),
    cabinets: typedLayoutRow.cabinets.map(normalizeCabinet),
    // Defensive fallback for a row saved before the appliances column
    // existed — same reasoning as the cameras ?? [] fallback in
    // rowToLayout above.
    appliances: (typedLayoutRow.appliances ?? []).map(normalizeAppliance),
  };
}

// Appliances live as JSONB on the layout row rather than in their own
// table, so a new field needs no migration — but it does need a
// backfill here, because every appliance saved before appliances could
// rotate has no rotationDeg at all. Left undefined it would reach
// getFootprint as NaN-adjacent garbage and, worse, reach Konva's
// rotation prop as undefined — which silently renders at 0 while the
// stored value stays absent, so the first rotate would jump from
// "nothing" rather than from 0.
function normalizeAppliance(item: PlacedApplianceItem): PlacedApplianceItem {
  return {
    ...item,
    rotationDeg: item.rotationDeg ?? 0,
    // Backfill for appliances placed via the tambour picker
    // (FrontPicker.tsx's pickTambourAppliance) before it started
    // setting this itself — that overlap with its host cabinet's
    // footprint is deliberate, not a real collision, and without this
    // every one of them reads as an unfixable collision warning.
    // `??` rather than unconditional, so an appliance that already has
    // an explicit value (including one deliberately un-muted back to
    // false) keeps it.
    ignoreOverlap: item.ignoreOverlap ?? item.mount?.kind === 'tambour',
  };
}
