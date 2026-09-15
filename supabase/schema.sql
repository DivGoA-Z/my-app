-- supabase/schema.sql
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query
-- -> paste -> Run. Two tables, matching the app's existing TypeScript
-- types directly:
--
--   projects  <-> CustomerProject (src/types/customer.ts)
--   layouts   <-> RoomLayout + PlacedCabinetItem[] (src/types/layout.ts,
--                 src/types/cabinet.ts) — cabinets/obstacles/walls are
--                 stored as JSONB arrays rather than their own tables.
--                 They're always read/written as a whole array together
--                 with the layout in this app, so normalizing them into
--                 separate tables would just mean extra round-trips for
--                 no benefit at this MVP stage. Revisit if you ever need
--                 to query/filter individual cabinets server-side.
--
-- IDs are `text`, not `uuid` — the app already generates its own ids
-- client-side (crypto.randomUUID(), or simple strings like "proj_001"
-- in the sample data), so Postgres doesn't need to generate or validate
-- them as true UUIDs.

create table if not exists public.projects (
  id text primary key,
  client_name text not null,
  phone text not null,
  email text,
  address text not null,
  locality text not null,
  status text not null default 'Lead'
    check (status in ('Lead', 'Layout Drafted', 'Quote Sent', 'Approved', 'In Production')),
  assigned_to text,
  notes text,
  quote_total numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.layouts (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  width_mm integer not null,
  depth_mm integer not null,
  ceiling_height_mm integer,
  -- Per-wall finish assignment lives inside this JSONB (Wall.finishId
  -- / concealedFinishId, src/types/layout.ts) rather than as columns,
  -- since there are four of them and they're always read with the
  -- layout. Floor and ceiling get real columns below — one each.
  walls jsonb not null default '[]'::jsonb,
  obstacles jsonb not null default '[]'::jsonb,
  cabinets jsonb not null default '[]'::jsonb,
  -- Placed appliances (src/types/appliance.ts) — stove/chimney/oven/
  -- OTG/toaster. Same top-level-column treatment as cabinets (not
  -- nested inside a `layout` JSON key) since appliances carry a
  -- layoutId FK and get quoted the same way cabinets do.
  appliances jsonb not null default '[]'::jsonb,
  -- Phase 2 bridge — saved 360° viewpoint nodes (src/types/Camera.ts).
  -- Same JSONB-array treatment as walls/obstacles/cabinets above, for
  -- the same reason: always read/written as a whole array with the
  -- layout, so no benefit to a separate table at this stage.
  cameras jsonb not null default '[]'::jsonb,
  -- Room surface finishes (-> surface_finishes.id). No FK constraint:
  -- deleting a finish that a layout referenced shouldn't block the
  -- delete, and resolveFinish (src/types/finish.ts) already degrades
  -- a dangling reference gracefully.
  floor_finish_id text,
  floor_concealed_finish_id text,
  ceiling_finish_id text,
  grid_snap_mm integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If `layouts` already existed from before cameras/appliances was
-- added (i.e. you ran an earlier version of this file), `create table
-- if not exists` above no-ops and skips the new column entirely —
-- these lines are what actually add them to an already-deployed table.
-- Safe to run either way: a no-op on a fresh install where the columns
-- are already there.
alter table public.layouts add column if not exists cameras jsonb not null default '[]'::jsonb;
alter table public.layouts add column if not exists appliances jsonb not null default '[]'::jsonb;
alter table public.layouts add column if not exists floor_finish_id text;
alter table public.layouts add column if not exists floor_concealed_finish_id text;
alter table public.layouts add column if not exists ceiling_finish_id text;

create index if not exists layouts_project_id_idx on public.layouts (project_id);

-- The business's finish catalogue (src/types/finish.ts) — one row per
-- real product they stock, e.g. "Merino Walnut 4102, gloss laminate".
--
-- REPLACES the old `finish` enum column that used to live on
-- cabinet_catalog_items and inside the cabinets JSONB. That enum
-- conflated three independent things: the substrate (invisible on a
-- finished cabinet), the optical response (gloss/clearcoat), and the
-- pattern (solid / wood / marble / fabric). It could not express
-- "solid white laminate" vs "walnut laminate" — same enum value,
-- different products at different prices — so appearance and pricing
-- both lived in the wrong place.
--
-- Substrate stays on the cabinet as `material` for costing only.
create table if not exists public.surface_finishes (
  id text primary key,
  label text not null,
  brand text,
  code text,
  -- Display/filter label only now, deliberately NOT a check constraint:
  -- a business selling something outside the usual five should be able
  -- to type it. Optical behaviour comes from the columns below instead.
  finish_type_label text not null,
  pattern_category text not null default 'solid'
    check (pattern_category in ('solid', 'wood', 'stone', 'fabric', 'metallic', 'concrete')),

  -- Appearance: a solid colour, an image, or one of the built-in
  -- generated textures. Exactly one is meaningful per row.
  solid_color text,
  albedo_url text,
  procedural_kind text check (procedural_kind in ('wood', 'quartz', 'tile')),
  -- Real PBR maps alongside albedo_url, from a downloaded CC0 set
  -- (Poly Haven / ambientCG) in public/textures/ or any reachable
  -- URL. A real normal map beats the luminance-derived guess in
  -- src/lib/textures3d.ts; a real roughness map is what expresses
  -- glossy tile against matte grout, which one scalar cannot.
  normal_map_url text,
  roughness_map_url text,

  -- 0-1. Seeded per pattern_category then adjusted by eye — deriving
  -- relief from an image's luminance is valid for wood/fabric and wrong
  -- for polished stone, where dark veins are flush, not recessed.
  relief_strength numeric not null default 0,

  -- Optical response, per finish rather than per enum value, so two
  -- laminates can carry the same pattern at different gloss levels.
  roughness numeric not null default 0.45,
  clearcoat numeric not null default 0,
  clearcoat_roughness numeric not null default 0,
  metalness numeric not null default 0.05,

  -- What real-world area one copy of albedo_url covers. Without it a
  -- 300mm photographed swatch tiles as though it were 1200mm.
  swatch_width_mm integer not null default 300,
  swatch_height_mm integer not null default 300,
  tiling_mode text not null default 'mirror'
    check (tiling_mode in ('repeat', 'mirror')),

  -- Added per square metre of finished (shutter) area on top of the
  -- cabinet's own unit price — this is what makes switching a cabinet
  -- to Acrylic move the quote and not just the render.
  price_per_sq_m numeric not null default 0,

  source text not null default 'bundled'
    check (source in ('bundled', 'uploaded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The business's own inventory (src/types/Catalog.ts), managed from
-- InventoryManager (src/components/inventory/InventoryManager.tsx) and
-- read by CabinetToolbar/ObstacleToolbar/ApplianceToolbar. Replaces
-- what used to be a static catalog_schema.json bundled into the app —
-- every business now builds and edits its own set instead of sharing
-- one fixed catalog.
--
-- NOTE: there's no business_id here (or on projects/layouts above) —
-- this schema currently assumes ONE business per Supabase project/app
-- deployment. If you later serve multiple businesses from one shared
-- database, add a `businesses` table and a `business_id` column to
-- all five tables here, plus real auth + RLS policies scoped to it
-- (see the security note below — this was left for later on purpose).
create table if not exists public.cabinet_catalog_items (
  id text primary key,
  category text not null,
  label text not null,
  module_type text not null
    check (module_type in (
      'base-cabinet', 'wall-cabinet', 'tall-unit', 'sink-unit',
      'cylinder-trolley', 'corner-unit', 'drawer-unit'
    )),
  width_mm integer not null,
  depth_mm integer not null,
  height_mm integer not null,
  material text not null
    check (material in ('HDMR', 'Plywood', 'MDF', 'Particle Board')),
  -- Was: finish text check (finish in ('Acrylic',...)). Finishes are
  -- now catalogue rows (see surface_finishes below) because the enum
  -- couldn't distinguish solid-white laminate from walnut laminate.
  finish_id text not null references public.surface_finishes(id),
  unit_price numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.obstacle_presets (
  id text primary key,
  label text not null,
  type text not null
    check (type in ('pillar', 'shaft', 'exposed-pipe', 'electrical-panel')),
  width_mm integer not null,
  depth_mm integer not null,
  floor_to_ceiling boolean not null default true,
  -- Only meaningful when floor_to_ceiling is false — a floor-to-ceiling
  -- obstacle's real height instead tracks the room's own ceiling
  -- height (see the matching note on Obstacle.heightMm, src/types/
  -- layout.ts).
  height_mm integer not null default 900,
  -- Also only meaningful when floor_to_ceiling is false — how far off
  -- the floor the obstacle's bottom face starts. Lets a preset for
  -- something like a mid-wall electrical fixture start above the floor
  -- with nothing below it (see Obstacle.elevationMm, src/types/
  -- layout.ts).
  elevation_mm integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same reasoning as the layouts.cameras/appliances columns above — adds
-- height_mm/elevation_mm to an obstacle_presets table that already
-- existed from before these fields were introduced. No-op on a fresh
-- install.
alter table public.obstacle_presets add column if not exists height_mm integer not null default 900;
alter table public.obstacle_presets add column if not exists elevation_mm integer not null default 0;

create table if not exists public.appliance_catalog_items (
  id text primary key,
  label text not null,
  appliance_type text not null
    check (appliance_type in ('stove', 'chimney', 'oven', 'otg', 'toaster', 'sink')),
  width_mm integer not null,
  depth_mm integer not null,
  height_mm integer not null,
  default_elevation_mm integer not null default 0,
  -- Path to a .glb/.gltf model (public/models/...) that replaces the
  -- plain box in the 3D view. Null keeps the box, so this is
  -- adopt-one-at-a-time rather than all-or-nothing.
  model_url text,
  unit_price numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive columns for databases created before real PBR maps and GLTF
-- models existed. `create table if not exists` above no-ops on an
-- existing table and would skip them, same as the cameras/appliances
-- ALTERs earlier. All nullable, so nothing needs backfilling and the
-- app keeps working with them empty.
-- 'sink' was added to ApplianceType after this table shipped. A CHECK
-- constraint isn't altered by `create table if not exists`, so an
-- existing database would reject sink rows without this.
alter table public.appliance_catalog_items
  drop constraint if exists appliance_catalog_items_appliance_type_check;
alter table public.appliance_catalog_items
  add constraint appliance_catalog_items_appliance_type_check
  check (appliance_type in ('stove', 'chimney', 'oven', 'otg', 'toaster', 'sink'));

alter table public.surface_finishes add column if not exists normal_map_url text;
alter table public.surface_finishes add column if not exists roughness_map_url text;
alter table public.appliance_catalog_items add column if not exists model_url text;

-- Fixed per-model orientation correction, in degrees, for a .glb that
-- was exported facing the wrong way — a Blender export is Z-up where
-- glTF expects Y-up (x = -90), and plenty of free assets face right
-- rather than front (y = +/-90). This belongs to the FILE, not to any
-- placement, so it's set once here and every appliance placed from the
-- row inherits it; the designer's own rotationDeg (stored inside the
-- layouts.appliances JSONB, so no migration needed for it) then turns
-- the appliance on top of this.
--
-- Left nullable with no default rather than `default 0` so an existing
-- row reads as "nothing set" instead of asserting a correction of zero
-- was deliberately chosen. Both mean the same to the renderer.
-- Parametric fronts. The default door/drawer configuration for
-- cabinets added from a catalogue row, plus its handle.
--
-- front_layout is JSONB rather than a set of columns because it's a
-- discriminated union: heightRatios only exists for drawers, hinge
-- only for a single door. Flattening a union into nullable columns is
-- how a door ends up carrying a drawer count.
--
-- Both nullable: absent means "use the default for this module type"
-- (defaultFrontLayout in src/types/front.ts), which is deliberately a
-- read-time fallback rather than a backfill — improving the default
-- rule then improves every existing layout instead of freezing the old
-- guess into the data.
--
-- Note there is no migration for a PLACED cabinet's own frontLayout or
-- handleId: placed cabinets live inside layouts.cabinets (JSONB), so
-- new fields on them need no schema change at all.
alter table public.cabinet_catalog_items add column if not exists front_layout jsonb;
alter table public.cabinet_catalog_items add column if not exists handle_id text;

alter table public.appliance_catalog_items add column if not exists model_rotation_x_deg numeric;
alter table public.appliance_catalog_items add column if not exists model_rotation_y_deg numeric;
alter table public.appliance_catalog_items add column if not exists model_rotation_z_deg numeric;

-- SECURITY NOTE: the app has no user authentication yet, so there's no
-- concept of "this row belongs to this logged-in user" to write a Row
-- Level Security policy against. RLS is disabled here so the anon key
-- (used from the browser) can read/write freely. This is fine for local
-- development and demos ONLY — before any real deployment, add
-- authentication and RLS policies scoped to the authenticated user/org,
-- or at minimum move writes behind a server-side API route using the
-- service role key instead of the public anon key.
alter table public.projects disable row level security;
alter table public.layouts disable row level security;
alter table public.surface_finishes disable row level security;
alter table public.cabinet_catalog_items disable row level security;
alter table public.obstacle_presets disable row level security;
alter table public.appliance_catalog_items disable row level security;


-- ============================================================
-- Seed data — matches src/sample-data.json, so "Open 2D Canvas"
-- on Ananya Sharma's row loads real data from Supabase immediately.
-- The other four are leads/drafts with no saved layout yet, which
-- loadProject() handles by falling back to a blank layout (see
-- src/lib/Persistence.ts).
-- ============================================================

insert into public.projects
  (id, client_name, phone, email, address, locality, status, assigned_to, notes, quote_total, created_at, updated_at)
values
  ('proj_001', 'Ananya Sharma', '+91-98765-43210', 'ananya.sharma@example.com',
   'B-42, Sector 21', 'Dwarka, Delhi', 'Quote Sent', 'designer_rahul',
   'Prefers acrylic finish, wants cylinder trolley near sink.', 61551,
   '2026-07-10T09:30:00.000Z', '2026-08-20T14:05:00.000Z'),

  ('proj_002', 'Rohan Mehta', '+91-98110-22334', null,
   'C-14, Sector 9', 'Rohini, Delhi', 'Lead', 'designer_rahul',
   'Called in after a site visit inquiry; layout not started.', null,
   '2026-08-18T11:00:00.000Z', '2026-08-18T11:00:00.000Z'),

  ('proj_003', 'Priya Kapoor', '+91-99887-65432', null,
   'Tower 4, DLF Phase 3', 'Gurgaon', 'Layout Drafted', 'designer_meera',
   'L-shaped kitchen, exposed pillar near the window.', null,
   '2026-08-05T09:15:00.000Z', '2026-08-22T16:40:00.000Z'),

  ('proj_004', 'Vikram Singh', '+91-97654-32109', null,
   'Sector 62', 'Noida', 'Approved', 'designer_rahul',
   'Approved with PU finish upgrade.', 84200,
   '2026-07-22T13:20:00.000Z', '2026-08-25T10:05:00.000Z'),

  ('proj_005', 'Neha Verma', '+91-96501-11223', null,
   'Sector 15', 'Faridabad', 'In Production', 'designer_meera',
   'Production started; cylinder trolley on backorder.', 132500,
   '2026-06-30T08:00:00.000Z', '2026-08-27T12:00:00.000Z')
on conflict (id) do nothing;

insert into public.layouts
  (id, project_id, name, width_mm, depth_mm, ceiling_height_mm, walls, obstacles, cabinets, appliances, cameras, grid_snap_mm, created_at, updated_at)
values
  ('layout_001', 'proj_001', 'Kitchen - Ground Floor', 3000, 4000, 2700,
   '[
     {"id": "wall_n", "orientation": "north", "lengthMm": 3000},
     {"id": "wall_e", "orientation": "east", "lengthMm": 4000, "hasWindow": true},
     {"id": "wall_s", "orientation": "south", "lengthMm": 3000, "hasDoor": true},
     {"id": "wall_w", "orientation": "west", "lengthMm": 4000}
   ]'::jsonb,
   '[
     {"id": "obs_pillar_1", "type": "pillar", "x": 0, "y": 0, "widthMm": 300, "depthMm": 300, "floorToCeiling": true, "heightMm": 2700}
   ]'::jsonb,
   '[
     {"id": "cab_001", "layoutId": "layout_001", "moduleType": "sink-unit", "x": 600, "y": 0, "widthMm": 900, "depthMm": 600, "heightMm": 850, "elevationMm": 0, "rotationDeg": 0, "material": "HDMR", "finishId": "finish_default_acrylic", "colorOverride": "#E5E0D8", "unitPrice": 18500, "quantity": 1, "hardware": [{"type": "hinge", "count": 4, "unitCost": 120}, {"type": "channel", "count": 2, "unitCost": 450}]},
     {"id": "cab_002", "layoutId": "layout_001", "moduleType": "cylinder-trolley", "x": 1500, "y": 0, "widthMm": 450, "depthMm": 600, "heightMm": 850, "elevationMm": 0, "rotationDeg": 0, "material": "Plywood", "finishId": "finish_default_laminate", "unitPrice": 9200, "quantity": 1, "hardware": [{"type": "basket", "count": 1, "unitCost": 1800}]},
     {"id": "cab_003", "layoutId": "layout_001", "moduleType": "wall-cabinet", "x": 600, "y": 1500, "widthMm": 900, "depthMm": 300, "heightMm": 600, "elevationMm": 1450, "rotationDeg": 0, "material": "MDF", "finishId": "finish_default_pu", "unitPrice": 12000, "quantity": 2, "hardware": [{"type": "hinge", "count": 4, "unitCost": 120}, {"type": "handle", "count": 2, "unitCost": 250}]}
   ]'::jsonb,
   -- Stove sits flush on the countertop above cab_002 (elevationMm 850
   -- matches that cabinet's own heightMm) and the chimney is mounted
   -- well above it, sharing the SAME x/y footprint at a different Z —
   -- exactly the case elevationMm-based collision is meant to allow
   -- without a false-positive overlap.
   '[
     {"id": "app_001", "layoutId": "layout_001", "applianceType": "stove", "x": 1500, "y": 0, "widthMm": 600, "depthMm": 550, "heightMm": 100, "elevationMm": 850, "unitPrice": 32000, "quantity": 1},
     {"id": "app_002", "layoutId": "layout_001", "applianceType": "chimney", "x": 1500, "y": 0, "widthMm": 600, "depthMm": 400, "heightMm": 500, "elevationMm": 1650, "unitPrice": 21000, "quantity": 1}
   ]'::jsonb,
   '[
     {"id": "cam_001", "layoutId": "layout_001", "label": "Sink View", "x": 1500, "y": 800, "viewAngleDeg": 180, "heightMm": 1600, "createdAt": "2026-08-29T10:00:00.000Z", "updatedAt": "2026-08-29T10:00:00.000Z"}
   ]'::jsonb,
   50, '2026-07-12T10:00:00.000Z', '2026-08-15T11:20:00.000Z')
on conflict (id) do update set cameras = excluded.cameras, cabinets = excluded.cabinets, appliances = excluded.appliances;


-- ============================================================
-- Seed data — a starter inventory so the toolbars aren't empty on
-- first run. Matches what used to be hardcoded in catalog_schema.json.
-- Everything here is freely editable/deletable from InventoryManager —
-- this is just a friendly default, not a fixture to keep in sync with.
-- ============================================================

-- Five default finishes, one per value of the enum this table replaced,
-- so every existing cabinet backfills cleanly (see DEFAULT_FINISH_IDS in
-- src/types/finish.ts and normalizeCabinet in src/lib/Persistence.ts).
--
-- Two of them carry procedural_kind = 'wood': Veneer is real wood by
-- definition, and the default laminate stands in for the wood-look
-- laminates that dominate this market. That keeps existing layouts
-- looking like wood rather than flat colour until real swatches are
-- uploaded. The other three are genuinely solid-coloured products.
--
-- APPEARANCE WILL SHIFT SLIGHTLY on existing layouts: cabinets used to
-- be tinted by their substrate (HDMR beige, Plywood tan), which is not
-- how a finished cabinet looks. These neutral finish colours are the
-- correction, not a regression.
--
-- price_per_sq_m reflects the usual ordering in this market (acrylic
-- dearest, laminate cheapest). Edit to match real rates.
insert into public.surface_finishes
  (id, label, finish_type_label, pattern_category, solid_color, procedural_kind,
   relief_strength, roughness, clearcoat, clearcoat_roughness, metalness,
   swatch_width_mm, swatch_height_mm, tiling_mode, price_per_sq_m, source)
values
  ('finish_default_acrylic', 'White Gloss', 'Acrylic', 'solid', '#f2f0ec', null,
   0, 0.15, 0.9, 0.10, 0.05, 300, 300, 'mirror', 2400, 'bundled'),
  ('finish_default_pu', 'Ivory Satin', 'PU', 'solid', '#ece7de', null,
   0, 0.25, 0.6, 0.20, 0.05, 300, 300, 'mirror', 1900, 'bundled'),
  ('finish_default_laminate', 'Natural Oak', 'Laminate', 'wood', null, 'wood',
   0.7, 0.45, 0, 0, 0.05, 1000, 1000, 'mirror', 900, 'bundled'),
  ('finish_default_membrane', 'Soft White', 'Membrane', 'solid', '#e8e4dc', null,
   0, 0.55, 0, 0, 0.05, 300, 300, 'mirror', 1200, 'bundled'),
  ('finish_default_veneer', 'Teak Veneer', 'Veneer', 'wood', null, 'wood',
   0.7, 0.60, 0, 0, 0.05, 1000, 1000, 'mirror', 2100, 'bundled')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- MIGRATION: cabinet_catalog_items.finish -> finish_id
--
-- `create table if not exists` above no-ops on a database where this
-- table already exists, so the new finish_id column never gets added
-- that way and the seed below fails with "column finish_id does not
-- exist". Same situation the layouts.cameras/appliances ALTERs handle.
--
-- Runs AFTER the surface_finishes seed on purpose: the backfill points
-- at those rows, and the foreign key would reject them otherwise.
-- Safe to re-run, and a no-op on a fresh install where create table
-- already built the column.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cabinet_catalog_items'
      and column_name = 'finish_id'
  ) then
    alter table public.cabinet_catalog_items add column finish_id text;
  end if;

  -- Map each old enum value onto its seeded default finish, then drop
  -- the dead column (clean cut — this is demo data).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cabinet_catalog_items'
      and column_name = 'finish'
  ) then
    update public.cabinet_catalog_items
       set finish_id = case finish
             when 'Acrylic'  then 'finish_default_acrylic'
             when 'Laminate' then 'finish_default_laminate'
             when 'PU'       then 'finish_default_pu'
             when 'Veneer'   then 'finish_default_veneer'
             when 'Membrane' then 'finish_default_membrane'
             else 'finish_default_laminate'
           end
     where finish_id is null;

    alter table public.cabinet_catalog_items drop column finish;
  end if;

  -- Anything still unset (rows added outside the old enum) gets the
  -- fallback, so the NOT NULL below can't fail.
  update public.cabinet_catalog_items
     set finish_id = 'finish_default_laminate'
   where finish_id is null;

  alter table public.cabinet_catalog_items alter column finish_id set not null;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'cabinet_catalog_items'
      and constraint_name = 'cabinet_catalog_items_finish_id_fkey'
  ) then
    alter table public.cabinet_catalog_items
      add constraint cabinet_catalog_items_finish_id_fkey
      foreign key (finish_id) references public.surface_finishes(id);
  end if;
end $$;

-- NOTE on layouts.cabinets: placed cabinets live inside a JSONB array,
-- and old entries still carry {"finish": "Acrylic", "color": "..."}.
-- Those are migrated in the APP rather than here — normalizeCabinet in
-- src/lib/Persistence.ts maps the legacy keys to finishId/colorOverride
-- on every load, and the new shape is written back on the next save.
-- Doing it in SQL as well would mean two places to keep in step for no
-- extra safety.

insert into public.cabinet_catalog_items
  (id, category, label, module_type, width_mm, depth_mm, height_mm, material, finish_id, unit_price)
values
  ('cat_base_600', 'Base', 'Base Cabinet (600mm)', 'base-cabinet', 600, 600, 850, 'HDMR', 'finish_default_laminate', 9500),
  ('cat_sink_900', 'Base', 'Sink Unit (900mm)', 'sink-unit', 900, 600, 850, 'HDMR', 'finish_default_acrylic', 18500),
  ('cat_cylinder_450', 'Base', 'Cylinder Trolley (450mm)', 'cylinder-trolley', 450, 600, 850, 'Plywood', 'finish_default_laminate', 9200),
  ('cat_corner_900', 'Base', 'Corner Unit (900mm)', 'corner-unit', 900, 900, 850, 'HDMR', 'finish_default_laminate', 15800),
  ('cat_drawer_450', 'Base', 'Drawer Unit (450mm)', 'drawer-unit', 450, 600, 850, 'MDF', 'finish_default_pu', 11200),
  ('cat_wall_600', 'Wall', 'Wall Cabinet (600mm)', 'wall-cabinet', 600, 300, 700, 'MDF', 'finish_default_laminate', 8200),
  ('cat_wall_900', 'Wall', 'Wall Cabinet (900mm)', 'wall-cabinet', 900, 300, 700, 'MDF', 'finish_default_pu', 12000),
  ('cat_tall_600', 'Tall', 'Tall Unit (600mm)', 'tall-unit', 600, 600, 2100, 'HDMR', 'finish_default_laminate', 24500),
  ('cat_tall_900', 'Tall', 'Tall Larder Unit (900mm)', 'tall-unit', 900, 600, 2100, 'HDMR', 'finish_default_pu', 32800)
on conflict (id) do nothing;

-- The electrical panel preset demonstrates elevation_mm directly: 300mm
-- tall, starting 1200mm off the floor (a typical switchboard mounting
-- height) — nothing below it, unlike the pillar/shaft above which both
-- start at the floor (elevation 0).
insert into public.obstacle_presets
  (id, label, type, width_mm, depth_mm, floor_to_ceiling, height_mm, elevation_mm)
values
  ('obs_preset_pillar_300', 'Standard Column', 'pillar', 300, 300, true, 2700, 0),
  ('obs_preset_shaft_300x450', 'Plumbing Shaft', 'shaft', 300, 450, false, 900, 0),
  ('obs_preset_elec_mid_wall', 'Mid-Wall Electrical Point', 'electrical-panel', 300, 100, false, 300, 1200)
on conflict (id) do nothing;

-- default_elevation_mm: stove/OTG/toaster sit flush on an 850mm
-- countertop; oven is built into a tall unit at a comfortable reach
-- height; chimney mounts well above the hob. All freely editable per
-- row in InventoryManager — these are just sensible starting points.
insert into public.appliance_catalog_items
  (id, label, appliance_type, width_mm, depth_mm, height_mm, default_elevation_mm, model_url, unit_price)
values
  ('app_cat_stove_600', '4-Burner Hob (600mm)', 'stove', 600, 550, 100, 850, null, 32000),
  ('app_cat_chimney_600', 'Slimline Chimney (600mm)', 'chimney', 600, 400, 500, 1650, null, 21000),
  ('app_cat_oven_600', 'Built-in Oven (600mm)', 'oven', 600, 550, 600, 850, null, 45000),
  ('app_cat_otg_450', 'OTG (450mm)', 'otg', 450, 400, 450, 850, null, 12000),
  ('app_cat_toaster_300', 'Toaster (300mm)', 'toaster', 300, 300, 300, 850, null, 3500),
  -- Sits at counter height inside a sink-unit cabinet's footprint.
  ('app_cat_sink_single', 'Single Bowl Sink (600mm)', 'sink', 600, 450, 200, 850,
   '/models/kitchen-sink.glb', 8500)
on conflict (id) do nothing;


-- ============================================================
-- Panorama storage — Step 2/3 of the walkthrough architecture
-- (src/lib/panoramaCapture.ts, src/lib/panoramaStorage.ts,
-- PanoramaViewerModal.tsx). Captured 360° equirectangular JPEGs are
-- uploaded here, one object per Camera Node, keyed
-- "<layoutId>/<cameraId>.jpg" — re-capturing a node overwrites its
-- previous panorama. No new TABLE or COLUMN is needed for this: the
-- resulting public URL is stored as CameraNode.panoramaUrl
-- (src/types/Camera.ts), and `cameras` is already a flexible JSONB
-- array column on `layouts` above, so an extra key on that JSON just
-- shows up automatically.
--
-- public: true is deliberate even though PanoramaViewerModal is
-- internal-only for now (opened from inside this app) — it means a
-- direct panorama URL will already work from a public/anonymous
-- client-facing route later, with no policy changes needed then.
--
-- Same MVP security posture as the SECURITY NOTE above: no auth yet,
-- so these policies are permissive (any anon request can read/write
-- this ONE bucket) rather than scoped to a logged-in user. Tighten
-- alongside the rest of this file's RLS story before a real launch.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('panoramas', 'panoramas', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to panoramas" on storage.objects;
create policy "Public read access to panoramas"
on storage.objects for select
using (bucket_id = 'panoramas');

drop policy if exists "Public upload access to panoramas" on storage.objects;
create policy "Public upload access to panoramas"
on storage.objects for insert
with check (bucket_id = 'panoramas');

drop policy if exists "Public overwrite access to panoramas" on storage.objects;
create policy "Public overwrite access to panoramas"
on storage.objects for update
using (bucket_id = 'panoramas');


-- ============================================================
-- Material swatch storage — photographed finish samples uploaded by the
-- business (src/lib/finishes.ts uploadSwatch). Separate bucket from
-- `panoramas`: a panorama belongs to one camera node in one layout,
-- while a swatch is business-wide inventory reused across every
-- project. Same permissive MVP policies and the same caveat as the
-- security note above.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('material-swatches', 'material-swatches', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to material swatches" on storage.objects;
create policy "Public read access to material swatches"
on storage.objects for select
using (bucket_id = 'material-swatches');

drop policy if exists "Public upload access to material swatches" on storage.objects;
create policy "Public upload access to material swatches"
on storage.objects for insert
with check (bucket_id = 'material-swatches');

drop policy if exists "Public overwrite access to material swatches" on storage.objects;
create policy "Public overwrite access to material swatches"
on storage.objects for update
using (bucket_id = 'material-swatches');

-- ============================================================
-- HANDLES
-- ============================================================
--
-- Cabinet front hardware, as a catalogue the business owns rather than
-- a fixed list in code (where it briefly lived). Same reasoning as
-- surface_finishes: an enum can't say what a business stocks, and the
-- same gola profile is different money at different suppliers.
--
-- pricing_mode is the field to get right. Bar handles and knobs are
-- bought per piece; gola and edge profiles are cut from stock and
-- billed per running METRE. src/lib/fronts.ts converts a per-metre
-- handle's total length into HardwareSpec.count so the quote's
-- count x unitCost arithmetic stays correct either way — but if this
-- column says 'per-unit' for a profile, a 2.4m run gets charged as one
-- handle.
create table if not exists public.handles (
  id text primary key,
  label text not null,
  kind text not null,
  length_mm numeric not null default 0,
  color_hex text not null default '#b8bcc0',
  metalness numeric not null default 0.9,
  roughness numeric not null default 0.35,
  pricing_mode text not null default 'per-unit',
  price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dropped and re-added rather than plain `add constraint` so re-running
-- this file is idempotent and so the allowed values can be widened
-- later without a hand-written migration — the same pattern
-- appliance_catalog_items' type check uses.
alter table public.handles drop constraint if exists handles_kind_check;
alter table public.handles
  add constraint handles_kind_check
  check (kind in ('bar', 'knob', 'edge-profile', 'gola', 'handleless'));

alter table public.handles drop constraint if exists handles_pricing_mode_check;
alter table public.handles
  add constraint handles_pricing_mode_check
  check (pricing_mode in ('per-unit', 'per-metre'));

alter table public.handles disable row level security;

-- Starter set. `on conflict do nothing` so re-running the schema never
-- overwrites a business's own edits to these rows — someone who has
-- repriced the steel bar handle to their actual buying price keeps it.
--
-- handle_bar_steel_128 is DEFAULT_HANDLE_ID in src/types/front.ts:
-- resolveHandle falls back to it when a cabinet's own handle has been
-- deleted, so HandleManager blocks deleting this one row.
insert into public.handles
  (id, label, kind, length_mm, color_hex, metalness, roughness, pricing_mode, price)
values
  ('handle_bar_steel_128', 'Bar handle 128mm — brushed steel', 'bar', 128, '#b8bcc0', 0.9, 0.35, 'per-unit', 180),
  ('handle_bar_black_192', 'Bar handle 192mm — matte black', 'bar', 192, '#2a2a2c', 0.6, 0.55, 'per-unit', 240),
  ('handle_knob_brass', 'Knob 32mm — antique brass', 'knob', 32, '#9a7b3f', 0.85, 0.4, 'per-unit', 150),
  ('handle_gola_profile', 'Gola profile — anodised aluminium', 'gola', 0, '#8f9296', 0.8, 0.45, 'per-metre', 620),
  ('handle_edge_profile', 'Edge profile — champagne', 'edge-profile', 0, '#c9b79a', 0.75, 0.4, 'per-metre', 540),
  -- Push-to-open needs a mechanism per front, which is a real cost but
  -- is a mechanism rather than a handle and isn't modelled yet. Left at
  -- 0 so the number is honestly absent instead of quietly wrong.
  ('handle_none', 'Handleless (push-to-open)', 'handleless', 0, '#000000', 0, 1, 'per-unit', 0)
on conflict (id) do nothing;

-- ============================================================
-- LIGHT FIXTURES
-- ============================================================
--
-- Placed fixtures live on the layout (the `fixtures` JSONB column
-- below), the same as obstacles and cameras. The CATALOGUE is its own
-- table, for the same reason handles and finishes are: colour
-- temperature and rate are exactly what differs between suppliers, so a
-- business prices "3000K COB strip" from its own invoices.
--
-- pricing_mode is the field to get right, third time this pattern has
-- appeared (finishes per sqm, handles per piece or metre, now
-- fixtures). Strip, cove and plinth runs are sold BY LENGTH; spots,
-- pendants and drawer lights by the piece. A 2.4m run charged as one
-- unit is a quote that is short by most of a strip.
create table if not exists public.light_fixture_catalog (
  id text primary key,
  label text not null,
  kind text not null,
  -- FIXED per fixture row, not adjustable per placement: you stock
  -- 3000K and 6500K as separate products at separate rates, so warmth
  -- belongs to the product.
  color_temp_k integer not null default 3000,
  -- Real photometric lumens, used for two things: how bright the
  -- fixture renders, and which fixtures win a slot in the renderer's
  -- real-light budget when a kitchen has more fixtures than a phone can
  -- draw (see MAX_REAL_FIXTURE_LIGHTS in src/lib/fixtures.ts).
  lumens integer not null default 800,
  pricing_mode text not null default 'per-metre',
  price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.light_fixture_catalog drop constraint if exists light_fixture_catalog_kind_check;
alter table public.light_fixture_catalog
  add constraint light_fixture_catalog_kind_check
  check (kind in ('strip', 'spot', 'cove', 'pendant', 'plinth', 'drawer'));

alter table public.light_fixture_catalog
  drop constraint if exists light_fixture_catalog_pricing_mode_check;
alter table public.light_fixture_catalog
  add constraint light_fixture_catalog_pricing_mode_check
  check (pricing_mode in ('per-unit', 'per-metre'));

alter table public.light_fixture_catalog disable row level security;

-- Placed fixtures, plus the two presentation/scope flags.
--
-- lighting_mode saves with the layout rather than living in component
-- state because it's part of how the design is PRESENTED: a shared link
-- should open in the mode the designer chose, and a phone-friendly
-- walkthrough should still be phone-friendly after a reload.
--
-- price_electrical is the single global switch for whether electrical
-- work is CHARGED. One switch rather than per-fixture, matching how the
-- trade splits in India: either the electrician handles the job
-- separately, or the kitchen business does it and bills it separately.
-- Either way the fixtures still print in full as a specification, so
-- the design is documented and the scope is unambiguous.
alter table public.layouts add column if not exists fixtures jsonb not null default '[]'::jsonb;
alter table public.layouts add column if not exists lighting_mode text;
alter table public.layouts add column if not exists price_electrical boolean default false;

-- Starter set, at plausible Delhi NCR retail. `on conflict do nothing`
-- so re-running never overwrites a business's own rates — same as the
-- handles seed.
--
-- Prices are PLACEHOLDERS in the same sense as HARDWARE_RATES in
-- src/lib/fronts.ts: right order of magnitude, not a price list.
insert into public.light_fixture_catalog
  (id, label, kind, color_temp_k, lumens, pricing_mode, price)
values
  ('fix_strip_warm',    'LED strip 3000K warm white',      'strip',   3000,  900, 'per-metre', 340),
  ('fix_strip_neutral', 'LED strip 4000K neutral white',   'strip',   4000, 1000, 'per-metre', 340),
  ('fix_strip_cool',    'LED strip 6500K cool white',      'strip',   6500, 1100, 'per-metre', 310),
  ('fix_profile_warm',  'Aluminium profile + 3000K strip', 'strip',   3000,  950, 'per-metre', 620),
  ('fix_spot_warm',     'Ceiling spot 8W 3000K',           'spot',    3000,  700, 'per-unit',  480),
  ('fix_spot_cool',     'Ceiling spot 8W 6500K',           'spot',    6500,  800, 'per-unit',  480),
  ('fix_cove_warm',     'Cove strip 2700K',                'cove',    2700,  700, 'per-metre', 380),
  ('fix_pendant',       'Pendant light (shade excluded)',  'pendant', 3000,  600, 'per-unit', 1850),
  ('fix_plinth',        'Plinth / toe-kick strip 4000K',   'plinth',  4000,  500, 'per-metre', 300),
  -- No visual in a still render: you only see it with the drawer open,
  -- and drawers are always modelled shut. A real BOM item all the same,
  -- so it's here rather than omitted.
  ('fix_drawer_sensor', 'In-drawer sensor light',          'drawer',  4000,  200, 'per-unit',  760)
on conflict (id) do nothing;

-- Viewing brightness for the 3D view (the renderer's tone-mapping
-- exposure). Design data is untouched by it — no lumens, no colour
-- temperature, no price — so it never affects a quote; it just records
-- how bright the designer wanted the picture, which matters once a
-- layout is shared and opens on someone else's screen.
alter table public.layouts add column if not exists exposure numeric;

-- ============================================================
-- RATE CARD
-- ============================================================
--
-- The prices that are NOT attached to a catalogue row.
--
-- Most prices in this app already live on the thing being priced —
-- surface_finishes.price_per_sqm, handles.price,
-- light_fixture_catalog.price, and the unit_price on cabinet and
-- appliance catalogue rows. Those were always editable by the
-- business. Two were not, and they were the last hardcoded numbers
-- reaching a customer-facing quote: labour, and the four consumable
-- hardware rates that src/lib/fronts.ts derives from a front layout.
--
-- Both carried comments promising "a future per-project settings
-- table". This is it. See src/types/rates.ts.
--
-- ONE ROW, EDITED IN PLACE — no version history. A quote freezes its
-- own snapshot when sent (see `quotes` below), so an old quote already
-- carries the numbers it was priced with and does not need an old rate
-- card to stay correct. Versioning here would be a second history of
-- the same facts, and the one nobody would maintain.
create table if not exists public.rate_cards (
  id text primary key,
  label text not null,
  -- Sq ft rather than sq m because that is still the billing unit in
  -- the trade, even though every dimension in this schema is mm.
  labor_rate_per_sqft numeric not null default 0,
  -- One JSONB column rather than a column per hardware type, matching
  -- layouts.fixtures. The set of types is defined in TypeScript
  -- (HardwareSpec in src/types/cabinet.ts) and has already grown once —
  -- 'shelf' arrived with parametric fronts. A column each would mean a
  -- migration every time it grows again, for data that is never queried
  -- or aggregated in SQL.
  --
  -- Units differ per key and are not all piece counts: 'channel' is a
  -- PAIR of runners, which is how they are sold and fitted.
  hardware_rates jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rate_cards disable row level security;

-- The single active row. Its id matches ACTIVE_RATE_CARD_ID in
-- src/types/rates.ts, and its values match PLACEHOLDER_RATES there
-- exactly — deliberately, so that introducing this table does not move
-- any existing quote total by a single rupee. The numbers only change
-- when a business edits them.
--
-- `on conflict do nothing` so re-running this file never overwrites a
-- business's own rates, same as the handles and fixture seeds.
--
-- These are PLACEHOLDERS: right order of magnitude for Delhi NCR
-- retail, not a price list. They need checking against real purchase
-- invoices before any quote built on them goes to a customer.
insert into public.rate_cards
  (id, label, labor_rate_per_sqft, hardware_rates)
values
  ('default', 'Default rates (placeholder)', 150,
   '{"hinge": 120, "channel": 450, "basket": 1400, "shelf": 350}'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- QUOTES (frozen snapshots)
-- ============================================================
--
-- A sent quote must not silently reprice.
--
-- Everything above this line is LIVE: change a rate, edit a finish,
-- drag a cabinet, and the sidebar total moves. That is correct while a
-- design is being worked on and wrong the moment a number has been
-- given to a customer. If labour goes from ₹150 to ₹180 next month, a
-- quote approved last month has to still read ₹150 — otherwise the
-- figure both parties agreed on changes behind their backs, and the
-- app quietly becomes untrustworthy at exactly the moment it matters.
--
-- So sending freezes. `summary` holds the fully computed BOMSummary,
-- and `pricing_context` holds the rate card and the catalogue rows it
-- referenced, so the snapshot is readable and auditable on its own
-- without joining to tables whose rows may since have been edited or
-- deleted. Reopening a frozen quote renders from here and never
-- recomputes.
--
-- Denormalised on purpose. The usual objection — that this duplicates
-- the catalogue — is the point: the catalogue is mutable and this must
-- not be.
create table if not exists public.quotes (
  -- text, not uuid, and generated client-side with crypto.randomUUID()
  -- like every other id in this schema. projects.id and layouts.id are
  -- both text; a uuid column here cannot carry a foreign key to a text
  -- primary key, and Postgres rejects the constraint outright rather
  -- than coercing.
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  -- 1, 2, 3... per project. A revision is a NEW ROW, never an edit to
  -- an existing one, so the history of what was actually sent survives.
  version integer not null,
  -- The full BOMSummary as computed at freeze time.
  summary jsonb not null,
  -- The rate card, finishes, handles and fixture rows used, plus the
  -- layout id and a FINGERPRINT of the priced inputs — that last one is
  -- what lets the UI say "the design has changed since this was sent".
  -- Not a timestamp: layouts.updated_at bumps on every save including
  -- price-irrelevant ones, and does NOT bump when a rate or a finish in
  -- another table is edited. See computeQuoteFingerprint in
  -- src/types/quote.ts.
  pricing_context jsonb not null,
  -- Copied out of summary for listing and sorting without parsing the
  -- JSONB. A derived value, so it must never be written independently.
  grand_total numeric not null,
  frozen_at timestamptz not null default now(),
  -- Free text: "Sent on WhatsApp 12 Aug", "revised after site visit".
  note text,
  created_at timestamptz not null default now()
);

-- One row per version per project, so a double-click on "Freeze & send"
-- cannot create two v2s.
create unique index if not exists quotes_project_version_idx
  on public.quotes (project_id, version);

create index if not exists quotes_project_idx
  on public.quotes (project_id, version desc);

alter table public.quotes disable row level security;
