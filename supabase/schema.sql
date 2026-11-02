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

-- ============================================================
-- BUSINESSES + AUTH (multi-tenancy foundation)
-- ============================================================
--
-- Every table below gets a `business_id` column (added right after its
-- own `create table`) and, near the end of this file, RLS policies
-- scoped to it. Split across two places rather than one because a
-- column can only be added AFTER its table exists, but the backfill
-- that follows needs to run AFTER every table's seed data has been
-- inserted — otherwise freshly-seeded rows would still be null when
-- the NOT NULL constraint lands. See the "BUSINESS ISOLATION (RLS)"
-- block at the end of this file for that half.
--
-- One business exists today (seeded below as 'biz_default'). There is
-- deliberately no self-serve sign-up here — see docs/PRINCIPLES.md's
-- "honest sequencing problem": building onboarding for OTHER
-- businesses before one actually exists is exactly the speculative
-- work that section warns against. Your own login and business
-- membership are a short manual step — see docs/SUPABASE_SETUP.md.
create table if not exists public.businesses (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- Join table, not a single business_id column on auth.users — a user
-- belonging to a business is a fact that can change (a second person
-- joins, someone leaves, a role changes) independently of the user's
-- own identity. `role` exists from day one so adding a second person
-- to a business later, or giving someone a different level of access,
-- is a new ROW here, never a schema change — that's the concrete
-- reason this table exists even though it holds exactly one row today.
-- Nothing in the app enforces `role` yet (see docs/PRINCIPLES.md); it
-- is reserved for when a business has more than one login.
create table if not exists public.business_users (
  business_id text not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- businesses had no RLS until 3 Oct 2026 (§70): with RLS off, Supabase
-- serves a table to anyone holding the public anon key, so every
-- business's name was readable. Members now read only their own row; the
-- software owner (super_admins) reads all. Defined further down, after
-- is_super_admin() exists — see "BUSINESSES RLS" below.

alter table public.business_users enable row level security;
drop policy if exists "Users can read their own membership" on public.business_users;
create policy "Users can read their own membership" on public.business_users
  for select using (user_id = auth.uid());

-- The one thing every other table's RLS policy needs to ask: "which
-- business is the signed-in user in?" A plain (not security definer)
-- function is enough — it runs as the calling role, and that role
-- already has read access to its OWN row via the policy just above.
create or replace function public.current_business_id()
returns text
language sql
stable
as $$
  select business_id from public.business_users where user_id = auth.uid() limit 1;
$$;

insert into public.businesses (id, name) values ('biz_default', 'My Business')
on conflict (id) do nothing;

-- Support/debugging access for you as the SOFTWARE owner, distinct
-- from being a member of any one business (that's business_users
-- above). Locked down harder than every other table here: RLS is
-- enabled with NO policies at all, so nothing can read this table
-- directly through the API, not even the row's own user — only the
-- security-definer function below can, which is what makes it safe to
-- expose "am I a super admin" without also exposing who else is.
create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id)
);
alter table public.super_admins enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;

-- BUSINESSES RLS (see the note above business_users).
alter table public.businesses enable row level security;
drop policy if exists "Members read their own business" on public.businesses;
create policy "Members read their own business" on public.businesses
  for select using (id = public.current_business_id());
-- Settings → Business lets a member rename their own business (§78).
drop policy if exists "Members rename their own business" on public.businesses;
create policy "Members rename their own business" on public.businesses
  for update using (id = public.current_business_id()) with check (id = public.current_business_id());

-- Business profile printed on the quote PDF (§94): phone, logo, GSTIN,
-- and whether to print the GSTIN (not every business is registered, or
-- wants it on a quote). The "rename" policy above covers updating these
-- too: it scopes the row, not the columns.
alter table public.businesses add column if not exists phone text;
alter table public.businesses add column if not exists logo_url text;
alter table public.businesses add column if not exists gstin text;
alter table public.businesses add column if not exists show_gstin boolean not null default false;

create table if not exists public.projects (
  id text primary key,
  client_name text not null,
  phone text not null,
  email text,
  address text not null,
  locality text not null,
  status text not null default 'Lead'
    check (status in ('Lead', 'Layout Drafted', 'Quote Sent', 'Approved', 'In Production', 'Installed', 'Lost')),
  assigned_to text,
  notes text,
  quote_total numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists business_id text references public.businesses(id);

-- Pipeline end stages (docs/DECISIONS.md §69, 3 Oct 2026). 'Installed'
-- ends a job; 'Lost' takes a reason. The status check above only applies
-- to a FRESH table (create table if not exists never alters an existing
-- one), so the constraint is dropped and re-added here, which is safe to
-- re-run. status_changed_at drives follow-ups ("quote sent 3+ days ago")
-- and "installed in the last 30 days"; it's backfilled from updated_at
-- once. These columns are written only by lib/customers.ts's dedicated
-- updates, never by the project save, so a save works before this runs.
alter table public.projects add column if not exists lost_reason text;
alter table public.projects add column if not exists lost_note text;
alter table public.projects add column if not exists install_date date;
alter table public.projects add column if not exists status_changed_at timestamptz;
update public.projects set status_changed_at = updated_at where status_changed_at is null;
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('Lead', 'Layout Drafted', 'Quote Sent', 'Approved', 'In Production', 'Installed', 'Lost'));
alter table public.projects drop constraint if exists projects_lost_reason_check;
alter table public.projects add constraint projects_lost_reason_check
  check (lost_reason is null or lost_reason in ('price', 'went-elsewhere', 'postponed', 'other'));

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
  -- One finish for every countertop in the layout (src/types/layout.ts
  -- has the reasoning: a kitchen's slab is one continuous material).
  countertop_finish_id text,
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
alter table public.layouts add column if not exists countertop_finish_id text;
alter table public.layouts add column if not exists business_id text references public.businesses(id);

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

alter table public.surface_finishes add column if not exists business_id text references public.businesses(id);

-- The business's own inventory (src/types/Catalog.ts), managed from
-- InventoryManager (src/components/inventory/InventoryManager.tsx) and
-- read by CabinetToolbar/ObstacleToolbar/ApplianceToolbar. Replaces
-- what used to be a static catalog_schema.json bundled into the app —
-- every business now builds and edits its own set instead of sharing
-- one fixed catalog.
--
-- CORRECTED: this comment used to say there was no business_id here
-- and that this schema assumed one business per deployment. That is
-- no longer true — see the BUSINESSES + AUTH block near the top of
-- this file and BUSINESS ISOLATION (RLS) near the end. Left the
-- history here rather than silently deleting it, per CLAUDE.md's own
-- rule about correcting a wrong document in place.
create table if not exists public.cabinet_catalog_items (
  id text primary key,
  category text not null,
  label text not null,
  -- 'corner-unit' replaced by three distinct corner solutions — see
  -- the ModuleType comment in src/types/cabinet.ts and DECISIONS.md's
  -- "Three corner solutions" entry. `create table if not exists`
  -- never touches an already-existing table's constraint, so an
  -- existing database is migrated by the drop/re-add block further
  -- down this file (search "three-corner-solution change"), not by
  -- this inline definition.
  module_type text not null
    check (module_type in (
      'base-cabinet', 'wall-cabinet', 'tall-unit', 'sink-unit',
      'cylinder-trolley', 'drawer-unit',
      'corner-blind', 'corner-magic', 'corner-carousel',
      'pantry-unit'
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

alter table public.cabinet_catalog_items add column if not exists business_id text references public.businesses(id);
-- Default panels for cabinets added from this row (docs/DECISIONS.md
-- §42): {leftSide: {included, boardId}, ..., top: {..., topStyle}}.
-- JSONB like front_layout; NULL = every panel included, default boards.
alter table public.cabinet_catalog_items add column if not exists panels jsonb;
-- The exact board line (rate_cards.board_rates[].id) the carcass is cut
-- from — "HDMR 18mm", not just "HDMR" (§44). NULL = the material's
-- original 18mm line, which every row before this column was priced on.
alter table public.cabinet_catalog_items add column if not exists carcass_board_id text;
-- Hand-entered extra parts for cabinets from this row (§48):
-- [{id, name, lengthMm, widthMm, quantity, boardId?, edgeLong, edgeShort}].
-- Listed on the cutting list and priced like any panel. NULL = none.
alter table public.cabinet_catalog_items add column if not exists extra_parts jsonb;

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
alter table public.obstacle_presets add column if not exists business_id text references public.businesses(id);

create table if not exists public.appliance_catalog_items (
  id text primary key,
  label text not null,
  appliance_type text not null
    check (appliance_type in ('stove', 'chimney', 'oven', 'otg', 'toaster', 'sink', 'fridge', 'microwave', 'dishwasher', 'water-purifier')),
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
-- Widened again for 'fridge'/'microwave'/'dishwasher'/'water-purifier'
-- (docs/DECISIONS.md, appliance-dimensions-first).
alter table public.appliance_catalog_items
  drop constraint if exists appliance_catalog_items_appliance_type_check;
alter table public.appliance_catalog_items
  add constraint appliance_catalog_items_appliance_type_check
  check (appliance_type in ('stove', 'chimney', 'oven', 'otg', 'toaster', 'sink', 'fridge', 'microwave', 'dishwasher', 'water-purifier'));

alter table public.surface_finishes add column if not exists normal_map_url text;
alter table public.surface_finishes add column if not exists roughness_map_url text;
alter table public.appliance_catalog_items add column if not exists model_url text;
alter table public.appliance_catalog_items add column if not exists business_id text references public.businesses(id);

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

-- Sink rows only: the hole cut into the countertop for that sink,
-- smaller than the sink's own width_mm/depth_mm by whatever rim that
-- model needs. Nullable, no default — null means "no cutout", the
-- pre-existing behaviour (basin sits on top of an uncut slab).
alter table public.appliance_catalog_items add column if not exists sink_cutout_width_mm numeric;
alter table public.appliance_catalog_items add column if not exists sink_cutout_depth_mm numeric;

-- CORRECTED: this used to disable RLS on these six tables, back when
-- there was no auth to write a policy against. That's no longer true —
-- real auth exists now (see BUSINESSES + AUTH above) and these six
-- tables' business_id backfill + NOT NULL + RLS policies are set up
-- together with the other four tables in the BUSINESS ISOLATION (RLS)
-- block at the end of this file, once every table's seed data (below)
-- has actually run. Left this note in place rather than deleting it
-- silently, per CLAUDE.md's rule on correcting a wrong document.


-- ============================================================
-- Seed data — matches src/sample-data.json, so "Open 2D Canvas"
-- on Ananya Sharma's row loads real data from Supabase immediately.
-- The other four are leads/drafts with no saved layout yet, which
-- loadProject() handles by falling back to a blank layout (see
-- src/lib/Persistence.ts).
-- ============================================================

-- business_id is set explicitly to 'biz_default' on every row below,
-- not left to a column default — a column default would mean an app
-- code path that forgot to pass businessId fails silently into
-- 'biz_default' instead of a hard NOT NULL error, exactly the anti-
-- pattern this file's PRICING RULES section already rejected once for
-- calculateBOM's context parameter. These 9 seed inserts are the only
-- place that's meant to write 'biz_default' by name.
--
-- Also fixes a real idempotency bug: `on conflict (id) do nothing`
-- only suppresses a UNIQUE-constraint conflict — it does NOT suppress
-- a NOT NULL violation, which Postgres checks before conflict
-- resolution even runs. On a FRESH database this insert used to work
-- by accident (business_id was still nullable at this point in the
-- file); re-running the whole file against a database that already
-- went through BUSINESS ISOLATION (RLS) below — where business_id was
-- made NOT NULL — failed on every seed insert, even for rows that
-- already existed and "on conflict do nothing" should have skipped
-- outright.
insert into public.projects
  (id, client_name, phone, email, address, locality, status, assigned_to, notes, quote_total, created_at, updated_at, business_id)
values
  ('proj_001', 'Ananya Sharma', '+91-98765-43210', 'ananya.sharma@example.com',
   'B-42, Sector 21', 'Dwarka, Delhi', 'Quote Sent', 'designer_rahul',
   'Prefers acrylic finish, wants cylinder trolley near sink.', 61551,
   '2026-07-10T09:30:00.000Z', '2026-08-20T14:05:00.000Z', 'biz_default'),

  ('proj_002', 'Rohan Mehta', '+91-98110-22334', null,
   'C-14, Sector 9', 'Rohini, Delhi', 'Lead', 'designer_rahul',
   'Called in after a site visit inquiry; layout not started.', null,
   '2026-08-18T11:00:00.000Z', '2026-08-18T11:00:00.000Z', 'biz_default'),

  ('proj_003', 'Priya Kapoor', '+91-99887-65432', null,
   'Tower 4, DLF Phase 3', 'Gurgaon', 'Layout Drafted', 'designer_meera',
   'L-shaped kitchen, exposed pillar near the window.', null,
   '2026-08-05T09:15:00.000Z', '2026-08-22T16:40:00.000Z', 'biz_default'),

  ('proj_004', 'Vikram Singh', '+91-97654-32109', null,
   'Sector 62', 'Noida', 'Approved', 'designer_rahul',
   'Approved with PU finish upgrade.', 84200,
   '2026-07-22T13:20:00.000Z', '2026-08-25T10:05:00.000Z', 'biz_default'),

  ('proj_005', 'Neha Verma', '+91-96501-11223', null,
   'Sector 15', 'Faridabad', 'In Production', 'designer_meera',
   'Production started; cylinder trolley on backorder.', 132500,
   '2026-06-30T08:00:00.000Z', '2026-08-27T12:00:00.000Z', 'biz_default')
on conflict (id) do nothing;

-- business_id explicit here too, same reasoning as the projects seed
-- above (this file's own note on it, just above that insert).
insert into public.layouts
  (id, project_id, name, width_mm, depth_mm, ceiling_height_mm, walls, obstacles, cabinets, appliances, cameras, grid_snap_mm, created_at, updated_at, business_id)
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
   50, '2026-07-12T10:00:00.000Z', '2026-08-15T11:20:00.000Z', 'biz_default')
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
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.surface_finishes
  (id, label, finish_type_label, pattern_category, solid_color, procedural_kind,
   relief_strength, roughness, clearcoat, clearcoat_roughness, metalness,
   swatch_width_mm, swatch_height_mm, tiling_mode, price_per_sq_m, source, business_id)
values
  ('finish_default_acrylic', 'White Gloss', 'Acrylic', 'solid', '#f2f0ec', null,
   0, 0.15, 0.9, 0.10, 0.05, 300, 300, 'mirror', 2400, 'bundled', 'biz_default'),
  ('finish_default_pu', 'Ivory Satin', 'PU', 'solid', '#ece7de', null,
   0, 0.25, 0.6, 0.20, 0.05, 300, 300, 'mirror', 1900, 'bundled', 'biz_default'),
  ('finish_default_laminate', 'Natural Oak', 'Laminate', 'wood', null, 'wood',
   0.7, 0.45, 0, 0, 0.05, 1000, 1000, 'mirror', 900, 'bundled', 'biz_default'),
  ('finish_default_membrane', 'Soft White', 'Membrane', 'solid', '#e8e4dc', null,
   0, 0.55, 0, 0, 0.05, 300, 300, 'mirror', 1200, 'bundled', 'biz_default'),
  ('finish_default_veneer', 'Teak Veneer', 'Veneer', 'wood', null, 'wood',
   0.7, 0.60, 0, 0, 0.05, 1000, 1000, 'mirror', 2100, 'bundled', 'biz_default'),
  -- Two more, added when the placeholder rates below were replaced
  -- with real Delhi NCR market estimates (2026-09-25) — a business's
  -- entry-grade shutter option, and a countertop-grade stone. Quartz
  -- uses procedural_kind 'quartz' (real generator in lib/textures3d.ts,
  -- same as the wood ones above), not a flat solid_color guess — the
  -- countertop slab actually looks like quartz instead of a beige box.
  ('finish_default_basic', 'Basic Laminate / Acrylic', 'Laminate', 'solid', '#e5e0d8', null,
   0, 0.40, 0.3, 0.15, 0.05, 300, 300, 'mirror', 1200, 'bundled', 'biz_default'),
  ('finish_default_quartz', 'Quartz', 'Quartz', 'stone', null, 'quartz',
   0.3, 0.25, 0.3, 0.15, 0.05, 600, 600, 'mirror', 2800, 'bundled', 'biz_default')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Room-surface library (§120): floors, walls and ceilings — tiles, marble,
-- granite, terrazzo, stone, wooden flooring, microcement, plaster, brick —
-- from ambientCG (CC0; credits in public/textures/CREDITS_FINISHES.md),
-- plus paint shades and plain-colour placeholders for Indian stones no
-- free library has ("(add your photo)"). Every price is a PLACEHOLDER per
-- m² of visible area: edit them on the Catalogue page. Sizes are each
-- texture's real-world size (ambientCG's where it records one, else
-- counted tiles x a standard tile size), so tiles come out life-size.
-- Inserted for biz_default; `on conflict do nothing` never overwrites a
-- row you've edited. New businesses get them once the starter catalogue
-- is refreshed: select public.refresh_starter_catalog('biz_default');
insert into public.surface_finishes
  (id, label, finish_type_label, pattern_category, solid_color, albedo_url, normal_map_url, roughness_map_url,
   relief_strength, roughness, clearcoat, clearcoat_roughness, metalness,
   swatch_width_mm, swatch_height_mm, tiling_mode, price_per_sq_m, source, business_id)
values
  ('surf_tile_plain_white', 'White Vitrified 600×600 (tint to any shade)', 'Vitrified tile', 'solid', null, '/textures/tile-plain-white/color.jpg', '/textures/tile-plain-white/normal.jpg', '/textures/tile-plain-white/roughness.jpg',
   0.25, 0.15, 0.3, 0.1, 0.02, 4800, 4800, 'repeat', 1000, 'bundled', 'biz_default'),
  ('surf_tile_glossy_black', 'Glossy Black Vitrified 600×600', 'Vitrified tile', 'solid', null, '/textures/tile-glossy-black/color.jpg', '/textures/tile-glossy-black/normal.jpg', '/textures/tile-glossy-black/roughness.jpg',
   0.25, 0.12, 0.3, 0.1, 0.02, 4800, 4800, 'repeat', 1100, 'bundled', 'biz_default'),
  ('surf_tile_beige_stone_rect', 'Beige Stone-look Tile', 'Vitrified tile', 'stone', null, '/textures/tile-beige-stone-rect/color.jpg', '/textures/tile-beige-stone-rect/normal.jpg', '/textures/tile-beige-stone-rect/roughness.jpg',
   0.35, 0.45, 0, 0.1, 0.02, 2000, 2000, 'repeat', 1100, 'bundled', 'biz_default'),
  ('surf_tile_cream_matt', 'Cream Matt Floor Tile', 'Ceramic tile', 'stone', null, '/textures/tile-cream-matt/color.jpg', '/textures/tile-cream-matt/normal.jpg', '/textures/tile-cream-matt/roughness.jpg',
   0.35, 0.55, 0, 0.1, 0.02, 2000, 2000, 'repeat', 900, 'bundled', 'biz_default'),
  ('surf_tile_checker_marble', 'Black & Cream Checker Marble Tile', 'Vitrified tile', 'stone', null, '/textures/tile-checker-marble/color.jpg', '/textures/tile-checker-marble/normal.jpg', '/textures/tile-checker-marble/roughness.jpg',
   0.15, 0.15, 0.3, 0.1, 0.02, 2100, 2100, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_tile_black_marble', 'Black Marble-look Tile', 'Vitrified tile', 'stone', null, '/textures/tile-black-marble/color.jpg', '/textures/tile-black-marble/normal.jpg', '/textures/tile-black-marble/roughness.jpg',
   0.15, 0.15, 0.3, 0.1, 0.02, 1350, 1350, 'repeat', 1400, 'bundled', 'biz_default'),
  ('surf_tile_botticino_marble', 'Botticino-look Marble Tile', 'Vitrified tile', 'stone', null, '/textures/tile-botticino-marble/color.jpg', '/textures/tile-botticino-marble/normal.jpg', '/textures/tile-botticino-marble/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1800, 1800, 'repeat', 1300, 'bundled', 'biz_default'),
  ('surf_tile_bw_pattern_marble', 'Black & White Patterned Marble Tile', 'Vitrified tile', 'stone', null, '/textures/tile-bw-pattern-marble/color.jpg', '/textures/tile-bw-pattern-marble/normal.jpg', '/textures/tile-bw-pattern-marble/roughness.jpg',
   0.15, 0.15, 0.3, 0.1, 0.02, 1600, 1600, 'repeat', 2000, 'bundled', 'biz_default'),
  ('surf_tile_dark_grey_stone', 'Dark Grey Stone-look Tile', 'Vitrified tile', 'stone', null, '/textures/tile-dark-grey-stone/color.jpg', '/textures/tile-dark-grey-stone/normal.jpg', '/textures/tile-dark-grey-stone/roughness.jpg',
   0.35, 0.5, 0, 0.1, 0.02, 2000, 2000, 'repeat', 1100, 'bundled', 'biz_default'),
  ('surf_tile_white_square_wall', 'White Square Wall Tile 150×150', 'Wall tile', 'solid', null, '/textures/tile-white-square-wall/color.jpg', '/textures/tile-white-square-wall/normal.jpg', '/textures/tile-white-square-wall/roughness.jpg',
   0.3, 0.2, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 700, 'bundled', 'biz_default'),
  ('surf_tile_white_small_square', 'White Small Square Wall Tile 100×100', 'Wall tile', 'solid', null, '/textures/tile-white-small-square/color.jpg', '/textures/tile-white-small-square/normal.jpg', '/textures/tile-white-small-square/roughness.jpg',
   0.3, 0.15, 0.3, 0.1, 0.02, 1100, 1100, 'repeat', 750, 'bundled', 'biz_default'),
  ('surf_tile_white_subway', 'White Subway Tile 75×150', 'Wall tile', 'solid', null, '/textures/tile-white-subway/color.jpg', '/textures/tile-white-subway/normal.jpg', '/textures/tile-white-subway/roughness.jpg',
   0.35, 0.15, 0.3, 0.1, 0.02, 1200, 1200, 'repeat', 900, 'bundled', 'biz_default'),
  ('surf_tile_green_subway', 'Bottle Green Subway Tile 75×300', 'Wall tile', 'solid', null, '/textures/tile-green-subway/color.jpg', '/textures/tile-green-subway/normal.jpg', '/textures/tile-green-subway/roughness.jpg',
   0.35, 0.12, 0.3, 0.1, 0.02, 1200, 1200, 'repeat', 1400, 'bundled', 'biz_default'),
  ('surf_tile_white_hexagon', 'White Hexagon Mosaic', 'Mosaic', 'solid', null, '/textures/tile-white-hexagon/color.jpg', '/textures/tile-white-hexagon/normal.jpg', '/textures/tile-white-hexagon/roughness.jpg',
   0.35, 0.2, 0.3, 0.1, 0.02, 450, 450, 'repeat', 2200, 'bundled', 'biz_default'),
  ('surf_tile_black_penny', 'Black Penny-round Mosaic', 'Mosaic', 'solid', null, '/textures/tile-black-penny/color.jpg', '/textures/tile-black-penny/normal.jpg', '/textures/tile-black-penny/roughness.jpg',
   0.4, 0.15, 0.3, 0.1, 0.02, 480, 480, 'repeat', 2500, 'bundled', 'biz_default'),
  ('surf_tile_encaustic', 'Encaustic Patterned Tile', 'Ceramic tile', 'stone', null, '/textures/tile-encaustic/color.jpg', '/textures/tile-encaustic/normal.jpg', '/textures/tile-encaustic/roughness.jpg',
   0.2, 0.4, 0, 0.1, 0.02, 1500, 1500, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_tile_blue_white_painted', 'Blue & White Painted Tile', 'Wall tile', 'solid', null, '/textures/tile-blue-white-painted/color.jpg', '/textures/tile-blue-white-painted/normal.jpg', '/textures/tile-blue-white-painted/roughness.jpg',
   0.15, 0.2, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1600, 'bundled', 'biz_default'),
  ('surf_tile_white_large_matt', 'White Matt Tile 300×300', 'Ceramic tile', 'stone', null, '/textures/tile-white-large-matt/color.jpg', '/textures/tile-white-large-matt/normal.jpg', '/textures/tile-white-large-matt/roughness.jpg',
   0.3, 0.6, 0, 0.1, 0.02, 2400, 2400, 'repeat', 800, 'bundled', 'biz_default'),
  ('surf_tile_terrazzo_white', 'White Terrazzo Tile', 'Terrazzo', 'stone', null, '/textures/tile-terrazzo-white/color.jpg', '/textures/tile-terrazzo-white/normal.jpg', '/textures/tile-terrazzo-white/roughness.jpg',
   0.2, 0.3, 0, 0.1, 0.02, 2400, 2400, 'repeat', 2000, 'bundled', 'biz_default'),
  ('surf_tile_charcoal_large', 'Charcoal Matt Tile', 'Vitrified tile', 'stone', null, '/textures/tile-charcoal-large/color.jpg', '/textures/tile-charcoal-large/normal.jpg', '/textures/tile-charcoal-large/roughness.jpg',
   0.3, 0.55, 0, 0.1, 0.02, 2400, 2400, 'repeat', 1100, 'bundled', 'biz_default'),
  ('surf_marble_grey_veined', 'Grey-veined White Marble', 'Marble', 'stone', null, '/textures/marble-grey-veined/color.jpg', '/textures/marble-grey-veined/normal.jpg', '/textures/marble-grey-veined/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 3000, 'bundled', 'biz_default'),
  ('surf_marble_black_white_vein', 'Black Marble, White Veins', 'Marble', 'stone', null, '/textures/marble-black-white-vein/color.jpg', '/textures/marble-black-white-vein/normal.jpg', '/textures/marble-black-white-vein/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 3500, 'bundled', 'biz_default'),
  ('surf_marble_cream', 'Cream Marble', 'Marble', 'stone', null, '/textures/marble-cream/color.jpg', '/textures/marble-cream/normal.jpg', '/textures/marble-cream/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 2500, 'bundled', 'biz_default'),
  ('surf_marble_rose_beige', 'Rose Beige Marble', 'Marble', 'stone', null, '/textures/marble-rose-beige/color.jpg', '/textures/marble-rose-beige/normal.jpg', '/textures/marble-rose-beige/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 2800, 'bundled', 'biz_default'),
  ('surf_marble_yellow_cream', 'Yellow Cream Marble', 'Marble', 'stone', null, '/textures/marble-yellow-cream/color.jpg', '/textures/marble-yellow-cream/normal.jpg', '/textures/marble-yellow-cream/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 2200, 'bundled', 'biz_default'),
  ('surf_marble_dark_green', 'Dark Green Marble', 'Marble', 'stone', null, '/textures/marble-dark-green/color.jpg', '/textures/marble-dark-green/normal.jpg', '/textures/marble-dark-green/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 2500, 'bundled', 'biz_default'),
  ('surf_marble_taupe', 'Taupe Marble', 'Marble', 'stone', null, '/textures/marble-taupe/color.jpg', '/textures/marble-taupe/normal.jpg', '/textures/marble-taupe/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 3200, 'bundled', 'biz_default'),
  ('surf_marble_white', 'White Marble, Light Veins', 'Marble', 'stone', null, '/textures/marble-white/color.jpg', '/textures/marble-white/normal.jpg', '/textures/marble-white/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 2800, 'bundled', 'biz_default'),
  ('surf_marble_golden_brown', 'Golden Brown Marble', 'Marble', 'stone', null, '/textures/marble-golden-brown/color.jpg', '/textures/marble-golden-brown/normal.jpg', '/textures/marble-golden-brown/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 3500, 'bundled', 'biz_default'),
  ('surf_marble_blue_grey', 'Blue-grey Marble', 'Marble', 'stone', null, '/textures/marble-blue-grey/color.jpg', '/textures/marble-blue-grey/normal.jpg', '/textures/marble-blue-grey/roughness.jpg',
   0.05, 0.12, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 3000, 'bundled', 'biz_default'),
  ('surf_granite_rosy_pink', 'Rosy Pink Granite', 'Granite', 'stone', null, '/textures/granite-rosy-pink/color.jpg', '/textures/granite-rosy-pink/normal.jpg', '/textures/granite-rosy-pink/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1600, 'bundled', 'biz_default'),
  ('surf_granite_grey_speckled', 'Grey Speckled Granite', 'Granite', 'stone', null, '/textures/granite-grey-speckled/color.jpg', '/textures/granite-grey-speckled/normal.jpg', '/textures/granite-grey-speckled/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1500, 'bundled', 'biz_default'),
  ('surf_granite_brown', 'Brown Granite', 'Granite', 'stone', null, '/textures/granite-brown/color.jpg', '/textures/granite-brown/normal.jpg', '/textures/granite-brown/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_granite_light_grey', 'Light Grey Granite', 'Granite', 'stone', null, '/textures/granite-light-grey/color.jpg', '/textures/granite-light-grey/normal.jpg', '/textures/granite-light-grey/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1500, 'bundled', 'biz_default'),
  ('surf_granite_red', 'Red Granite', 'Granite', 'stone', null, '/textures/granite-red/color.jpg', '/textures/granite-red/normal.jpg', '/textures/granite-red/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 1900, 'bundled', 'biz_default'),
  ('surf_granite_black_gold', 'Black & Gold Granite', 'Granite', 'stone', null, '/textures/granite-black-gold/color.jpg', '/textures/granite-black-gold/normal.jpg', '/textures/granite-black-gold/roughness.jpg',
   0.1, 0.15, 0.3, 0.1, 0.02, 1000, 1000, 'repeat', 2200, 'bundled', 'biz_default'),
  ('surf_terrazzo_multicolour', 'Multicolour Terrazzo', 'Terrazzo', 'stone', null, '/textures/terrazzo-multicolour/color.jpg', '/textures/terrazzo-multicolour/normal.jpg', '/textures/terrazzo-multicolour/roughness.jpg',
   0.1, 0.3, 0, 0.1, 0.02, 1000, 1000, 'repeat', 2800, 'bundled', 'biz_default'),
  ('surf_terrazzo_beige', 'Beige Terrazzo', 'Terrazzo', 'stone', null, '/textures/terrazzo-beige/color.jpg', '/textures/terrazzo-beige/normal.jpg', '/textures/terrazzo-beige/roughness.jpg',
   0.1, 0.3, 0, 0.1, 0.02, 650, 650, 'repeat', 2600, 'bundled', 'biz_default'),
  ('surf_terrazzo_black_chips', 'White Terrazzo, Black Chips', 'Terrazzo', 'stone', null, '/textures/terrazzo-black-chips/color.jpg', '/textures/terrazzo-black-chips/normal.jpg', '/textures/terrazzo-black-chips/roughness.jpg',
   0.1, 0.3, 0, 0.1, 0.02, 1000, 1000, 'repeat', 2600, 'bundled', 'biz_default'),
  ('surf_terrazzo_deep_green', 'Deep Green Terrazzo', 'Terrazzo', 'stone', null, '/textures/terrazzo-deep-green/color.jpg', '/textures/terrazzo-deep-green/normal.jpg', '/textures/terrazzo-deep-green/roughness.jpg',
   0.1, 0.3, 0, 0.1, 0.02, 1000, 1000, 'repeat', 3000, 'bundled', 'biz_default'),
  ('surf_travertine_cream', 'Cream Travertine', 'Natural stone', 'stone', null, '/textures/travertine-cream/color.jpg', '/textures/travertine-cream/normal.jpg', '/textures/travertine-cream/roughness.jpg',
   0.2, 0.4, 0, 0.1, 0.02, 1200, 1200, 'repeat', 3500, 'bundled', 'biz_default'),
  ('surf_travertine_silver', 'Silver Travertine', 'Natural stone', 'stone', null, '/textures/travertine-silver/color.jpg', '/textures/travertine-silver/normal.jpg', '/textures/travertine-silver/roughness.jpg',
   0.2, 0.4, 0, 0.1, 0.02, 1200, 1200, 'repeat', 3800, 'bundled', 'biz_default'),
  ('surf_onyx_honey', 'Honey Onyx', 'Natural stone', 'stone', null, '/textures/onyx-honey/color.jpg', '/textures/onyx-honey/normal.jpg', '/textures/onyx-honey/roughness.jpg',
   0.05, 0.1, 0.3, 0.1, 0.02, 1500, 1500, 'repeat', 7000, 'bundled', 'biz_default'),
  ('surf_woodfloor_oak_natural', 'Natural Oak Planks', 'Wooden flooring', 'wood', null, '/textures/woodfloor-oak-natural/color.jpg', '/textures/woodfloor-oak-natural/normal.jpg', '/textures/woodfloor-oak-natural/roughness.jpg',
   0.4, 0.45, 0, 0.1, 0.02, 1800, 1800, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_woodfloor_walnut_parquet', 'Walnut Basketweave Parquet', 'Wooden flooring', 'wood', null, '/textures/woodfloor-walnut-parquet/color.jpg', '/textures/woodfloor-walnut-parquet/normal.jpg', '/textures/woodfloor-walnut-parquet/roughness.jpg',
   0.4, 0.4, 0, 0.1, 0.02, 1500, 1500, 'repeat', 3500, 'bundled', 'biz_default'),
  ('surf_woodfloor_oak_herringbone', 'Oak Herringbone', 'Wooden flooring', 'wood', null, '/textures/woodfloor-oak-herringbone/color.jpg', '/textures/woodfloor-oak-herringbone/normal.jpg', '/textures/woodfloor-oak-herringbone/roughness.jpg',
   0.4, 0.45, 0, 0.1, 0.02, 1900, 1900, 'repeat', 3500, 'bundled', 'biz_default'),
  ('surf_woodfloor_dark_walnut', 'Dark Walnut Planks', 'Wooden flooring', 'wood', null, '/textures/woodfloor-dark-walnut/color.jpg', '/textures/woodfloor-dark-walnut/normal.jpg', '/textures/woodfloor-dark-walnut/roughness.jpg',
   0.4, 0.35, 0, 0.1, 0.02, 1300, 1300, 'repeat', 2000, 'bundled', 'biz_default'),
  ('surf_woodfloor_pale_ash', 'Pale Ash Planks', 'Wooden flooring', 'wood', null, '/textures/woodfloor-pale-ash/color.jpg', '/textures/woodfloor-pale-ash/normal.jpg', '/textures/woodfloor-pale-ash/roughness.jpg',
   0.4, 0.45, 0, 0.1, 0.02, 1500, 1500, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_woodfloor_teak_tone', 'Teak-tone Planks', 'Wooden flooring', 'wood', null, '/textures/woodfloor-teak-tone/color.jpg', '/textures/woodfloor-teak-tone/normal.jpg', '/textures/woodfloor-teak-tone/roughness.jpg',
   0.4, 0.4, 0, 0.1, 0.02, 1500, 1500, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_microcement_ivory', 'Ivory Microcement', 'Microcement', 'concrete', null, '/textures/microcement-ivory/color.jpg', '/textures/microcement-ivory/normal.jpg', '/textures/microcement-ivory/roughness.jpg',
   0.2, 0.7, 0, 0.1, 0.02, 2400, 2400, 'repeat', 3000, 'bundled', 'biz_default'),
  ('surf_microcement_grey', 'Grey Microcement', 'Microcement', 'concrete', null, '/textures/microcement-grey/color.jpg', '/textures/microcement-grey/normal.jpg', '/textures/microcement-grey/roughness.jpg',
   0.2, 0.7, 0, 0.1, 0.02, 1500, 1500, 'repeat', 3000, 'bundled', 'biz_default'),
  ('surf_plaster_white_textured', 'White Textured Plaster', 'Plaster', 'concrete', null, '/textures/plaster-white-textured/color.jpg', '/textures/plaster-white-textured/normal.jpg', '/textures/plaster-white-textured/roughness.jpg',
   0.5, 0.9, 0, 0.1, 0.02, 1000, 1000, 'repeat', 700, 'bundled', 'biz_default'),
  ('surf_brick_white_painted', 'White Painted Brick', 'Brick', 'stone', null, '/textures/brick-white-painted/color.jpg', '/textures/brick-white-painted/normal.jpg', '/textures/brick-white-painted/roughness.jpg',
   0.7, 0.85, 0, 0.1, 0.02, 1050, 1050, 'repeat', 1500, 'bundled', 'biz_default'),
  ('surf_brick_red_exposed', 'Exposed Red Brick', 'Brick', 'stone', null, '/textures/brick-red-exposed/color.jpg', '/textures/brick-red-exposed/normal.jpg', '/textures/brick-red-exposed/roughness.jpg',
   0.7, 0.85, 0, 0.1, 0.02, 1100, 1100, 'repeat', 1500, 'bundled', 'biz_default'),
  ('surf_paint_white', 'White Paint', 'Paint', 'solid', '#f4f2ee', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_off_white', 'Off-white Paint', 'Paint', 'solid', '#ede6d8', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_light_grey', 'Light Grey Paint', 'Paint', 'solid', '#d9d9d6', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_warm_beige', 'Warm Beige Paint', 'Paint', 'solid', '#e3d3bb', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_sage_green', 'Sage Green Paint', 'Paint', 'solid', '#b7c4a8', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_powder_blue', 'Powder Blue Paint', 'Paint', 'solid', '#c5d5e2', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_terracotta', 'Terracotta Paint', 'Paint', 'solid', '#c97a5a', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_paint_charcoal', 'Charcoal Paint', 'Paint', 'solid', '#4a4a4a', null, null, null,
   0, 0.85, 0, 0, 0, 1000, 1000, 'repeat', 250, 'bundled', 'biz_default'),
  ('surf_kota_stone', 'Kota Stone (add your photo)', 'Natural stone', 'stone', '#6f7a7a', null, null, null,
   0, 0.5, 0, 0, 0.02, 600, 600, 'repeat', 900, 'bundled', 'biz_default'),
  ('surf_jaisalmer_yellow', 'Jaisalmer Yellow (add your photo)', 'Natural stone', 'stone', '#d8b56b', null, null, null,
   0, 0.3, 0, 0, 0.02, 600, 600, 'repeat', 1800, 'bundled', 'biz_default'),
  ('surf_rajasthan_green', 'Rajasthan Green Marble (add your photo)', 'Marble', 'stone', '#3d5a45', null, null, null,
   0, 0.15, 0, 0, 0.02, 600, 600, 'repeat', 2200, 'bundled', 'biz_default'),
  ('surf_makrana_white', 'Makrana White Marble (add your photo)', 'Marble', 'stone', '#f0eee8', null, null, null,
   0, 0.15, 0, 0, 0.02, 600, 600, 'repeat', 4500, 'bundled', 'biz_default'),
  ('surf_italian_look_gvt', 'Italian Marble-look GVT (add your photo)', 'Vitrified tile', 'stone', '#e9e3d9', null, null, null,
   0, 0.15, 0, 0, 0.02, 600, 600, 'repeat', 1500, 'bundled', 'biz_default')
on conflict (id) do nothing;

-- One tile's size in a tile PHOTO (§122), so a floor can be laid at
-- another tile size by rescaling the photo. NULL for seamless materials
-- (the app draws their grout). Filled for the library's tile photos only
-- where still NULL, so a size you've set is never overwritten.
alter table public.surface_finishes add column if not exists tile_width_mm integer;
alter table public.surface_finishes add column if not exists tile_height_mm integer;
update public.surface_finishes set tile_width_mm = 600, tile_height_mm = 600 where id = 'surf_tile_plain_white' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 600, tile_height_mm = 600 where id = 'surf_tile_glossy_black' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 333, tile_height_mm = 333 where id = 'surf_tile_cream_matt' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 350, tile_height_mm = 350 where id = 'surf_tile_checker_marble' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 600, tile_height_mm = 600 where id = 'surf_tile_botticino_marble' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 400, tile_height_mm = 400 where id = 'surf_tile_bw_pattern_marble' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 150, tile_height_mm = 150 where id = 'surf_tile_white_square_wall' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 100, tile_height_mm = 100 where id = 'surf_tile_white_small_square' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 150, tile_height_mm = 75 where id = 'surf_tile_white_subway' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 300, tile_height_mm = 75 where id = 'surf_tile_green_subway' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 300, tile_height_mm = 300 where id = 'surf_tile_white_large_matt' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 300, tile_height_mm = 300 where id = 'surf_tile_terrazzo_white' and tile_width_mm is null;
update public.surface_finishes set tile_width_mm = 300, tile_height_mm = 300 where id = 'surf_tile_charcoal_large' and tile_width_mm is null;

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

-- A database created before the three-corner-solution change
-- (DECISIONS.md, "Three corner solutions, not one generic
-- corner-unit") still has the OLD module_type check constraint,
-- allowing 'corner-unit'. `create table if not exists` above is a
-- no-op against a table that already exists, so it never applies the
-- tightened constraint by itself — this drop/re-add is what actually
-- does it. The one seed row that used to carry the old value
-- (cat_corner_900) is removed first so `validate constraint` below
-- has nothing left to fail on; a business's OWN catalog rows can't be
-- affected, since the app's UI has never offered 'corner-unit' as an
-- option to save one with. Safe to re-run: a database that already
-- has the new constraint just re-validates the same, already-true one.
delete from public.cabinet_catalog_items
  where id = 'cat_corner_900' and module_type = 'corner-unit';

-- Widened again for 'pantry-unit' (docs/DECISIONS.md §23, cabinet
-- library breadth) — same drop/re-add mechanism, same reason: this
-- constraint is only set correctly on a BRAND NEW database by the
-- `create table if not exists` above; an existing one needs the
-- constraint itself replaced.
do $$
begin
  alter table public.cabinet_catalog_items
    drop constraint if exists cabinet_catalog_items_module_type_check;
  alter table public.cabinet_catalog_items
    add constraint cabinet_catalog_items_module_type_check
    check (module_type in (
      'base-cabinet', 'wall-cabinet', 'tall-unit', 'sink-unit',
      'cylinder-trolley', 'drawer-unit',
      'corner-blind', 'corner-magic', 'corner-carousel',
      'pantry-unit'
    )) not valid;
  alter table public.cabinet_catalog_items
    validate constraint cabinet_catalog_items_module_type_check;
end $$;

-- Same situation, same fix, for 'BWP' joining the material enum
-- (docs/DECISIONS.md §13) — `create table if not exists` above is a
-- no-op against an already-existing table, so this drop/re-add is
-- what actually widens the constraint on one.
do $$
begin
  alter table public.cabinet_catalog_items
    drop constraint if exists cabinet_catalog_items_material_check;
  alter table public.cabinet_catalog_items
    add constraint cabinet_catalog_items_material_check
    check (material in ('HDMR', 'Plywood', 'MDF', 'Particle Board', 'BWP'))
    not valid;
  alter table public.cabinet_catalog_items
    validate constraint cabinet_catalog_items_material_check;
end $$;

-- NOTE on layouts.cabinets: placed cabinets live inside a JSONB array,
-- and old entries still carry {"finish": "Acrylic", "color": "..."}.
-- Those are migrated in the APP rather than here — normalizeCabinet in
-- src/lib/Persistence.ts maps the legacy keys to finishId/colorOverride
-- on every load, and the new shape is written back on the next save.
-- Doing it in SQL as well would mean two places to keep in step for no
-- extra safety.

-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.cabinet_catalog_items
  (id, category, label, module_type, width_mm, depth_mm, height_mm, material, finish_id, unit_price, business_id)
values
  ('cat_base_600', 'Base', 'Base Cabinet (600mm)', 'base-cabinet', 600, 600, 850, 'HDMR', 'finish_default_laminate', 9500, 'biz_default'),
  ('cat_sink_900', 'Base', 'Sink Unit (900mm)', 'sink-unit', 900, 600, 850, 'HDMR', 'finish_default_acrylic', 18500, 'biz_default'),
  ('cat_cylinder_450', 'Base', 'Cylinder Trolley (450mm)', 'cylinder-trolley', 450, 600, 850, 'Plywood', 'finish_default_laminate', 9200, 'biz_default'),
  ('cat_corner_blind_900', 'Base', 'Corner Blind Unit (900mm)', 'corner-blind', 900, 900, 850, 'HDMR', 'finish_default_laminate', 15800, 'biz_default'),
  ('cat_corner_magic_900', 'Base', 'Corner Magic Unit (900mm)', 'corner-magic', 900, 900, 850, 'HDMR', 'finish_default_laminate', 15800, 'biz_default'),
  ('cat_corner_carousel_900', 'Base', 'Corner Carousel Unit (900mm)', 'corner-carousel', 900, 900, 850, 'HDMR', 'finish_default_laminate', 15800, 'biz_default'),
  ('cat_drawer_450', 'Base', 'Drawer Unit (450mm)', 'drawer-unit', 450, 600, 850, 'MDF', 'finish_default_pu', 11200, 'biz_default'),
  ('cat_wall_600', 'Wall', 'Wall Cabinet (600mm)', 'wall-cabinet', 600, 300, 700, 'MDF', 'finish_default_laminate', 8200, 'biz_default'),
  ('cat_wall_900', 'Wall', 'Wall Cabinet (900mm)', 'wall-cabinet', 900, 300, 700, 'MDF', 'finish_default_pu', 12000, 'biz_default'),
  ('cat_tall_600', 'Tall', 'Tall Unit (600mm)', 'tall-unit', 600, 600, 2100, 'HDMR', 'finish_default_laminate', 24500, 'biz_default'),
  ('cat_tall_900', 'Tall', 'Tall Larder Unit (900mm)', 'tall-unit', 900, 600, 2100, 'HDMR', 'finish_default_pu', 32800, 'biz_default')
on conflict (id) do nothing;

-- The electrical panel preset demonstrates elevation_mm directly: 300mm
-- tall, starting 1200mm off the floor (a typical switchboard mounting
-- height) — nothing below it, unlike the pillar/shaft above which both
-- start at the floor (elevation 0).
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.obstacle_presets
  (id, label, type, width_mm, depth_mm, floor_to_ceiling, height_mm, elevation_mm, business_id)
values
  ('obs_preset_pillar_300', 'Standard Column', 'pillar', 300, 300, true, 2700, 0, 'biz_default'),
  ('obs_preset_shaft_300x450', 'Plumbing Shaft', 'shaft', 300, 450, false, 900, 0, 'biz_default'),
  ('obs_preset_elec_mid_wall', 'Mid-Wall Electrical Point', 'electrical-panel', 300, 100, false, 300, 1200, 'biz_default')
on conflict (id) do nothing;

-- default_elevation_mm: stove/OTG/toaster sit flush on an 850mm
-- countertop; oven is built into a tall unit at a comfortable reach
-- height; chimney mounts well above the hob. All freely editable per
-- row in InventoryManager — these are just sensible starting points.
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.appliance_catalog_items
  (id, label, appliance_type, width_mm, depth_mm, height_mm, default_elevation_mm, model_url, unit_price, business_id)
values
  ('app_cat_stove_600', '4-Burner Hob (600mm)', 'stove', 600, 550, 100, 850, null, 32000, 'biz_default'),
  ('app_cat_chimney_600', 'Slimline Chimney (600mm)', 'chimney', 600, 400, 500, 1650, null, 21000, 'biz_default'),
  ('app_cat_oven_600', 'Built-in Oven (600mm)', 'oven', 600, 550, 600, 850, null, 45000, 'biz_default'),
  ('app_cat_otg_450', 'OTG (450mm)', 'otg', 450, 400, 450, 850, null, 12000, 'biz_default'),
  ('app_cat_toaster_300', 'Toaster (300mm)', 'toaster', 300, 300, 300, 850, null, 3500, 'biz_default'),
  -- Sits at counter height inside a sink-unit cabinet's footprint.
  ('app_cat_sink_single', 'Single Bowl Sink (600mm)', 'sink', 600, 450, 200, 850,
   '/models/kitchen-sink.glb', 8500, 'biz_default')
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
-- public: true is deliberate and UNCHANGED by the auth work elsewhere
-- in this file — a panorama/quote-PDF link needs to open for a
-- customer with no account at all (that's the whole point of the
-- WhatsApp quote-export feature). Only who can UPLOAD changed: was
-- fully open to any anon request, now requires being signed in.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('panoramas', 'panoramas', true)
on conflict (id) do nothing;

-- WRITES ONLY INTO YOUR OWN BUSINESS'S FOLDER, here and for
-- material-swatches and quote-pdfs below. These were "any signed-in
-- account" until §106 (harmless while only the team could sign in, but
-- with sign-up open a stranger could have OVERWRITTEN a customer's quote
-- PDF at its predictable path), then "any member of some business",
-- then (§107) the business's own folder: `<business_id>/...`, the same
-- rule business-logos already had. Files saved before §107 sit outside
-- any business folder: still readable (public read), no longer
-- writable; the app writes new copies under the business folder.
drop policy if exists "Public read access to panoramas" on storage.objects;
create policy "Public read access to panoramas"
on storage.objects for select
using (bucket_id = 'panoramas');

drop policy if exists "Public upload access to panoramas" on storage.objects;
drop policy if exists "Authenticated upload access to panoramas" on storage.objects;
drop policy if exists "Members upload panoramas" on storage.objects;
create policy "Members upload panoramas"
on storage.objects for insert
with check (bucket_id = 'panoramas' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Public overwrite access to panoramas" on storage.objects;
drop policy if exists "Authenticated overwrite access to panoramas" on storage.objects;
drop policy if exists "Members overwrite panoramas" on storage.objects;
create policy "Members overwrite panoramas"
on storage.objects for update
using (bucket_id = 'panoramas' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Members delete panoramas" on storage.objects;
create policy "Members delete panoramas"
on storage.objects for delete
using (bucket_id = 'panoramas' and (storage.foldername(name))[1] = public.current_business_id());


-- ============================================================
-- Material swatch storage — photographed finish samples uploaded by the
-- business (src/lib/finishes.ts uploadSwatch). Separate bucket from
-- `panoramas`: a panorama belongs to one camera node in one layout,
-- while a swatch is business-wide inventory reused across every
-- project. Read stays public (same reasoning as panoramas above);
-- upload now requires being signed in.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('material-swatches', 'material-swatches', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to material swatches" on storage.objects;
create policy "Public read access to material swatches"
on storage.objects for select
using (bucket_id = 'material-swatches');

drop policy if exists "Public upload access to material swatches" on storage.objects;
drop policy if exists "Authenticated upload access to material swatches" on storage.objects;
drop policy if exists "Members upload material swatches" on storage.objects;
create policy "Members upload material swatches"
on storage.objects for insert
with check (bucket_id = 'material-swatches' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Public overwrite access to material swatches" on storage.objects;
drop policy if exists "Authenticated overwrite access to material swatches" on storage.objects;
drop policy if exists "Members overwrite material swatches" on storage.objects;
create policy "Members overwrite material swatches"
on storage.objects for update
using (bucket_id = 'material-swatches' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Members delete material swatches" on storage.objects;
create policy "Members delete material swatches"
on storage.objects for delete
using (bucket_id = 'material-swatches' and (storage.foldername(name))[1] = public.current_business_id());

-- ============================================================
-- Business logos (§94) — drawn in the quote PDF header. Public read, like
-- the quote PDFs the logo ends up in. Writes are limited to the
-- business's OWN folder (`<business_id>/...`), so one business can't
-- replace another's logo. (The material-swatches policies above only
-- check "signed in"; tightening those is a separate job.)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to business logos" on storage.objects;
create policy "Public read access to business logos"
on storage.objects for select
using (bucket_id = 'business-logos');

drop policy if exists "Members upload their own business logo" on storage.objects;
create policy "Members upload their own business logo"
on storage.objects for insert
with check (bucket_id = 'business-logos' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Members replace their own business logo" on storage.objects;
create policy "Members replace their own business logo"
on storage.objects for update
using (bucket_id = 'business-logos' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Members delete their own business logo" on storage.objects;
create policy "Members delete their own business logo"
on storage.objects for delete
using (bucket_id = 'business-logos' and (storage.foldername(name))[1] = public.current_business_id());

-- ============================================================
-- Quote PDF storage — generated client-side (src/lib/quotePdf.ts) from
-- a FROZEN quote's own immutable summary/pricingContext, then uploaded
-- here (src/lib/quotePdfStorage.ts) so a WhatsApp message can carry a
-- real link instead of asking the designer to attach a file by hand.
-- Path is `${projectId}/v${version}.pdf` — deterministic and re-
-- uploaded with upsert on every share click rather than generated once
-- and cached, because the inputs are frozen (never edited after
-- freezing — see quotes.note above and types/quote.ts), so regenerating
-- always reproduces the same document; there is nothing to invalidate.
-- Read stays public — a customer opens this link from WhatsApp with no
-- account at all, which is the entire point of that feature. Upload
-- now requires being signed in.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('quote-pdfs', 'quote-pdfs', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to quote pdfs" on storage.objects;
create policy "Public read access to quote pdfs"
on storage.objects for select
using (bucket_id = 'quote-pdfs');

drop policy if exists "Public upload access to quote pdfs" on storage.objects;
drop policy if exists "Authenticated upload access to quote pdfs" on storage.objects;
drop policy if exists "Members upload quote pdfs" on storage.objects;
create policy "Members upload quote pdfs"
on storage.objects for insert
with check (bucket_id = 'quote-pdfs' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Public overwrite access to quote pdfs" on storage.objects;
drop policy if exists "Authenticated overwrite access to quote pdfs" on storage.objects;
drop policy if exists "Members overwrite quote pdfs" on storage.objects;
create policy "Members overwrite quote pdfs"
on storage.objects for update
using (bucket_id = 'quote-pdfs' and (storage.foldername(name))[1] = public.current_business_id());

drop policy if exists "Members delete quote pdfs" on storage.objects;
create policy "Members delete quote pdfs"
on storage.objects for delete
using (bucket_id = 'quote-pdfs' and (storage.foldername(name))[1] = public.current_business_id());

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

alter table public.handles add column if not exists business_id text references public.businesses(id);

-- Starter set. `on conflict do nothing` so re-running the schema never
-- overwrites a business's own edits to these rows — someone who has
-- repriced the steel bar handle to their actual buying price keeps it.
--
-- handle_bar_steel_128 is DEFAULT_HANDLE_ID in src/types/front.ts:
-- resolveHandle falls back to it when a cabinet's own handle has been
-- deleted, so HandleManager blocks deleting this one row.
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.handles
  (id, label, kind, length_mm, color_hex, metalness, roughness, pricing_mode, price, business_id)
values
  ('handle_bar_steel_128', 'Bar handle 128mm — brushed steel', 'bar', 128, '#b8bcc0', 0.9, 0.35, 'per-unit', 180, 'biz_default'),
  ('handle_bar_black_192', 'Bar handle 192mm — matte black', 'bar', 192, '#2a2a2c', 0.6, 0.55, 'per-unit', 240, 'biz_default'),
  ('handle_knob_brass', 'Knob 32mm — antique brass', 'knob', 32, '#9a7b3f', 0.85, 0.4, 'per-unit', 150, 'biz_default'),
  ('handle_gola_profile', 'Gola profile — anodised aluminium', 'gola', 0, '#8f9296', 0.8, 0.45, 'per-metre', 620, 'biz_default'),
  ('handle_edge_profile', 'Edge profile — champagne', 'edge-profile', 0, '#c9b79a', 0.75, 0.4, 'per-metre', 540, 'biz_default'),
  -- Push-to-open needs a mechanism per front, which is a real cost but
  -- is a mechanism rather than a handle and isn't modelled yet. Left at
  -- 0 so the number is honestly absent instead of quietly wrong.
  ('handle_none', 'Handleless (push-to-open)', 'handleless', 0, '#000000', 0, 1, 'per-unit', 0, 'biz_default')
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

-- FixtureCatalogItem (src/types/fixture.ts) and lib/fixtureCatalog.ts's
-- itemToRow have carried these since the pendant GLB was wired in, but
-- the columns themselves were never actually added here — a real gap,
-- not something added on purpose and now removed. Every single-row
-- saveFixtureCatalogItem call would have hit the same "column not
-- found" error the moment anyone set a model on a fixture; the bulk
-- import path just happened to be what finally exercised it. Nullable,
-- same convention as the matching columns on appliance_catalog_items,
-- so no backfill is needed for existing rows.
alter table public.light_fixture_catalog add column if not exists model_url text;
alter table public.light_fixture_catalog add column if not exists model_rotation_x_deg numeric;
alter table public.light_fixture_catalog add column if not exists model_rotation_y_deg numeric;
alter table public.light_fixture_catalog add column if not exists model_rotation_z_deg numeric;

alter table public.light_fixture_catalog add column if not exists business_id text references public.businesses(id);

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
-- Same shape as price_electrical, same market reason: the kitchen
-- business usually does NOT supply the countertop slab in Delhi NCR —
-- the homeowner arranges stone separately. The countertop still prints
-- on the quote as a specification at zero either way.
alter table public.layouts add column if not exists price_countertop boolean default false;
-- Cost-plus margin (%) for THIS project's own quote — per-project
-- rather than a business-wide rate card field (docs/DECISIONS.md
-- §15): a big order and a rush one-off don't have to carry the same
-- margin. Nullable, not `not null default 25` — `lib/bom.ts`'s own
-- DEFAULT_MARGIN_PERCENT constant is the fallback for a layout that
-- hasn't set one, so a real NULL genuinely means "not set yet" rather
-- than the column silently disagreeing with the code's own default if
-- one of the two is ever changed without the other.
alter table public.layouts add column if not exists margin_percent numeric;
-- Per-project override of rate_cards.sheet_waste_factor — a job of
-- all-600mm units nests onto sheets far better than one of odd
-- widths. NULL means "use the business default", same null-means-
-- not-set reasoning as margin_percent directly above.
alter table public.layouts add column if not exists sheet_waste_factor numeric;
-- Hand-entered lump sums for this project, { labor: [{id,label,amount}],
-- other: [...] } — added on top of rate-card pricing and NOT marked up
-- by margin_percent (the amount typed is the selling price). JSONB, same
-- reasoning as fixtures: a small list never queried in SQL. NULL = none.
-- See docs/DECISIONS.md §36.
alter table public.layouts add column if not exists project_charges jsonb;
-- SUPERSEDED the same day by charge_rates below (§39) — kept, only read,
-- for a project saved in between. Nothing writes new data to it.
--
-- This project's own copy of the rate card's others_rates list
-- ([{id, label, rate, basis, showOnQuote, applyMargin}]), overriding it
-- wholesale. NULL = follow the business rate card, so rate changes keep
-- flowing into every project that hasn't customised. See
-- docs/DECISIONS.md §39.
alter table public.layouts add column if not exists charge_rates jsonb;
-- Board parts for this project not tied to a cabinet — fillers, plinth,
-- end panels (§48). Same shape as cabinet_catalog_items.extra_parts.
-- Listed on the cutting list and priced inside Material. NULL = none.
alter table public.layouts add column if not exists loose_parts jsonb;
-- This project's override of the business's depth convention (§61):
-- true = stated depth includes the shutter, false = carcass only. NULL =
-- follow construction_settings. Drives the cutting list, the price, and
-- the plan / 3D / collision geometry alike.
alter table public.layouts add column if not exists depth_includes_front boolean;
-- This kitchen's style defaults (§117): finish / colour / handle / board
-- for base, wall and tall cabinets. NULL = use the business's
-- (construction_settings.style_defaults). Its own column, not inside a
-- priced field, so changing a default can't mark a quote stale by itself.
alter table public.layouts add column if not exists style_defaults jsonb;
-- The countertop slab's tint (§119), hex. NULL = the material's own colour.
alter table public.layouts add column if not exists countertop_color_override text;
-- Floor and ceiling tints (§120); a wall's lives in the walls JSONB.
alter table public.layouts add column if not exists floor_color_override text;
alter table public.layouts add column if not exists ceiling_color_override text;
-- The floor laid as tiles (§122): {tileWidthMm, tileHeightMm, pattern,
-- groutMm, groutColor}; a wall's lives in the walls JSONB. NULL = as the
-- finish is.
alter table public.layouts add column if not exists floor_tiling jsonb;
-- Whether floor/wall/ceiling finishes are charged on the quote (§123).
-- NULL = charged, as every kitchen was before this column existed.
alter table public.layouts add column if not exists price_surfaces boolean;
-- A discount off the whole quote (§130): {"kind":"percent"|"amount","value":n}.
-- NULL = none.
alter table public.layouts add column if not exists discount jsonb;

-- Starter set, at plausible Delhi NCR retail. `on conflict do nothing`
-- so re-running never overwrites a business's own rates — same as the
-- handles seed.
--
-- Prices are PLACEHOLDERS in the same sense as HARDWARE_RATES in
-- src/lib/fronts.ts: right order of magnitude, not a price list.
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.light_fixture_catalog
  (id, label, kind, color_temp_k, lumens, pricing_mode, price, business_id)
values
  ('fix_strip_warm',    'LED strip 3000K warm white',      'strip',   3000,  900, 'per-metre', 340, 'biz_default'),
  ('fix_strip_neutral', 'LED strip 4000K neutral white',   'strip',   4000, 1000, 'per-metre', 340, 'biz_default'),
  ('fix_strip_cool',    'LED strip 6500K cool white',      'strip',   6500, 1100, 'per-metre', 310, 'biz_default'),
  ('fix_profile_warm',  'Aluminium profile + 3000K strip', 'strip',   3000,  950, 'per-metre', 620, 'biz_default'),
  ('fix_spot_warm',     'Ceiling spot 8W 3000K',           'spot',    3000,  700, 'per-unit',  480, 'biz_default'),
  ('fix_spot_cool',     'Ceiling spot 8W 6500K',           'spot',    6500,  800, 'per-unit',  480, 'biz_default'),
  ('fix_cove_warm',     'Cove strip 2700K',                'cove',    2700,  700, 'per-metre', 380, 'biz_default'),
  ('fix_pendant',       'Pendant light (shade excluded)',  'pendant', 3000,  600, 'per-unit', 1850, 'biz_default'),
  ('fix_plinth',        'Plinth / toe-kick strip 4000K',   'plinth',  4000,  500, 'per-metre', 300, 'biz_default'),
  -- No visual in a still render: you only see it with the drawer open,
  -- and drawers are always modelled shut. A real BOM item all the same,
  -- so it's here rather than omitted.
  ('fix_drawer_sensor', 'In-drawer sensor light',          'drawer',  4000,  200, 'per-unit',  760, 'biz_default')
on conflict (id) do nothing;

-- A second, distinct pendant option — 'fix_pendant' above is
-- deliberately priced with the shade excluded (customer supplies
-- their own); this one comes with a real modelled industrial shade,
-- via the .glb already sitting at
-- public/models/lighting/pendant-industrial.glb (CC0 Poly Haven
-- hanging_industrial_lamp — see public/models/CREDITS_SOURCED.md).
-- Own insert statement, own `on conflict (id) do nothing`, rather than
-- widening the values list above — same reasoning as every other
-- additive block in this file: never touch what a business may have
-- already edited.
--
-- Was scripts/seed_pendant_fixture.sql, a standalone file never folded
-- in here — that script also used `on conflict do update`, which
-- would have overwritten a business's own edits to this row on every
-- re-run, unlike every other seed in this file. Folded in with the
-- correct `do nothing` instead, and dropping the UUID-shaped id in
-- favour of this file's human-readable convention.
--
-- UNVERIFIED ORIENTATION: model_rotation_x/y/z_deg are left at 0/0/0,
-- a starting guess carried over from that script, NOT a confirmed-
-- correct orientation — there is still no way to render this GLB and
-- check which way it faces from this environment. If the lamp renders
-- sideways or upside-down, adjust these three columns (see the
-- ORIENTATION note in src/components/canvas3d/ApplianceModel.tsx for
-- what each axis corrects).
insert into public.light_fixture_catalog
  (id, label, kind, color_temp_k, lumens, pricing_mode, price, model_url,
   model_rotation_x_deg, model_rotation_y_deg, model_rotation_z_deg, business_id)
values
  ('fix_pendant_industrial', 'Industrial Pendant', 'pendant', 3000, 800, 'per-unit', 2200,
   '/models/lighting/pendant-industrial.glb', 0, 0, 0, 'biz_default')
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

alter table public.rate_cards add column if not exists business_id text references public.businesses(id);

-- Same one-JSONB-column reasoning as hardware_rates above, added
-- alongside real material-cost estimates (docs/DECISIONS.md §13) —
-- `materialCost` in lib/bom.ts stops being a stand-in for the
-- catalogue's own unitPrice and becomes area (the same rough estimate
-- already used for labour) times the cabinet's own material's rate
-- here. `create table if not exists` above no-ops on a database that
-- already has this table, so this ALTER is what actually adds the
-- column to one.
alter table public.rate_cards add column if not exists material_rates jsonb;

-- Same one-JSONB-column reasoning as material_rates above, added
-- alongside glass-door open-shelf fronts — priced by TINT (clear/
-- black/brown/yellow), a set of keys just like MaterialType is, and
-- deliberately a SEPARATE column rather than another key inside
-- material_rates: glass is bought and cut as glass, not the cabinet's
-- own board substrate, so it's a different rate entirely, not another
-- substrate option.
alter table public.rate_cards add column if not exists glass_rates jsonb;

-- Two plain scalar columns, not JSONB — each is one number, not a
-- set of keys that grows over time the way hardware/material rates
-- do (docs/DECISIONS.md §14):
--   fabrication_rate_per_unit  workshop labour to build one cabinet
--     box (cut, edge-band, assemble) — flat per cabinet, unlike
--     labor_rate_per_sqft above, which is SITE installation billed by
--     area, the trade's own convention for that separate job.
--   others_rate_per_unit       a deliberate catch-all, ₹0 by default —
--     unlike every other rate here, no real number exists for it.
-- `numeric not null default X` backfills every existing row with X in
-- the same ALTER (unlike the jsonb columns above, which need a
-- separate UPDATE to backfill — a plain scalar default does it as
-- part of adding the column).
alter table public.rate_cards add column if not exists fabrication_rate_per_unit numeric not null default 2500;
alter table public.rate_cards add column if not exists others_rate_per_unit numeric not null default 0;
-- SUPERSEDED by others_rates below (docs/DECISIONS.md §35) — kept, not
-- dropped: a drop is not idempotent-safe against a database someone
-- hasn't upgraded the app on yet, and lib/rates.ts still reads it once
-- to migrate an older card into others_rates. Nothing writes it now.
--
-- others_rates: the "others" catch-all itemised as one list of named
-- rates, [{id, label, rate, basis}], basis one of 'sqft' (scales with
-- cabinet size — edge banding), 'cabinet' (flat per unit — packing) or
-- 'lumpsum' (once per project — delivery). For one session it was
-- stored as { perSqFt: [...], perUnit: [...] } instead; lib/rates.ts
-- still reads that shape (docs/DECISIONS.md §37). JSONB for the same reason
-- as hardware_rates: a growing set of keys never queried in SQL.
-- Nullable with no default so NULL means "saved before this existed",
-- which is exactly the case the legacy migration keys off.
alter table public.rate_cards add column if not exists others_rates jsonb;
-- Business-default multiplier on substrate cost for whole-sheet
-- purchasing (1.1 = 10% offcut waste). Nullable; lib/rates.ts treats
-- NULL as 1, no waste, so adding the column moves no quote total. A
-- project can override it — see layouts.sheet_waste_factor.
alter table public.rate_cards add column if not exists sheet_waste_factor numeric;
-- Board lines (docs/DECISIONS.md §42): [{id, material, thicknessMm,
-- ratePerSqM}] — the same material at different thicknesses is a
-- different product at a different price, so a list rather than one
-- rate per material. SUPERSEDES material_rates above, which is kept and
-- read once to migrate an older card into 18mm lines; nothing writes it
-- now. default_back_board_id names the line backs are cut from unless a
-- cabinet says otherwise. Both nullable: NULL = "saved before §42",
-- which is exactly what the migration keys off.
alter table public.rate_cards add column if not exists board_rates jsonb;
-- Which sheet waste the quote uses (§53): 'approx' (one experience-based
-- factor — sheet_waste_factor above, or a project's override) or
-- 'calculated' (per board line, measured live from each project's sheet
-- layout). NULL = 'approx', so adding the column changes no quote.
alter table public.rate_cards add column if not exists waste_mode text;
-- ₹ per running metre of edge banding, charged on the cutting list's exact
-- metres (§58). NULL/0 = not charged — so adding the column moves no
-- quote, and a business already charging edge banding per sq ft in its
-- "others" list isn't charged twice until it switches.
alter table public.rate_cards add column if not exists edge_banding_rate_per_m numeric;
alter table public.rate_cards add column if not exists default_back_board_id text;
-- CORRECTED: this block briefly also added a `margin_percent` column
-- here — a business-wide margin. Moved to `layouts.margin_percent`
-- instead (below, near that table's own price_electrical/
-- price_countertop) before this was ever run against a live database
-- (§14 → §15, same session): margin is a decision about ONE project,
-- not a rate that prices a physical thing the same way for every job,
-- so it lives per-layout, not on the rate card. See
-- docs/DECISIONS.md §15.

-- The seed row below keeps its historical id ('default') for the one
-- business this migrated from, purely so the backfill has a row to
-- attach business_id to without moving any existing quote total by a
-- single rupee. `lib/rates.ts` no longer looks this id up directly —
-- once RLS + business_id are live (see the end of this file), a
-- business's rate card is found by business_id, and a NEW business's
-- first rate card gets a real crypto.randomUUID() id, same convention
-- as every other table. Its values match PLACEHOLDER_RATES in
-- src/types/rates.ts exactly.
--
-- `on conflict do nothing` so re-running this file never overwrites a
-- business's own rates, same as the handles and fixture seeds.
--
-- These are PLACEHOLDERS: right order of magnitude for Delhi NCR
-- retail, not a price list. They need checking against real purchase
-- invoices before any quote built on them goes to a customer.
--
-- hinge/channel updated 2026-09-25 to real local-market estimates
-- (still placeholders, just better-informed ones): a soft-close hinge
-- SET (a pair) runs about ₹450, and this table prices hinges per
-- PIECE (see HardwareSpec's own comment in types/cabinet.ts — a door
-- gets 2-4 individual hinges, not "pairs" of them the way a drawer
-- gets pairs of channels), so the per-piece rate here is ₹450 / 2 =
-- ₹225, not ₹450 — using ₹450 directly would silently double every
-- hinge line on every quote. "Tandem Box Drawers: ₹2,500/set" maps
-- straight onto the EXISTING `channel` rate — a tandem-box runner
-- system is what `channel` already prices (a pair of drawer runners),
-- just a specific premium brand/type of it, not a new hardware
-- category.
--
-- CORRECTED (was wrong above, in this same comment, until
-- docs/DECISIONS.md §13): this used to say the two material costs
-- given alongside these (Commercial Plywood/HDMR, BWP) were
-- deliberately left out because nothing consumed a per-sq-m substrate
-- rate. That was true at the time, but wrong to leave unrevisited —
-- `material_rates` below and `carcassAreaSqM` in lib/bom.ts now do
-- exactly that, using the SAME rough area estimate labour already
-- used, not the accurate panel-by-panel one the still-blocked panel
-- model (Phase 1 item 2) would give. MDF and Particle Board did not
-- come from the business — they're this session's own placeholder
-- guesses, scaled down from the two real figures in the usual retail
-- ordering, and carry less confidence than the other rates here.
-- business_id explicit here too, same reasoning as the projects seed
-- (see the note above that insert).
insert into public.rate_cards
  (id, label, labor_rate_per_sqft, hardware_rates, material_rates, glass_rates, business_id)
values
  ('default', 'Default rates (placeholder)', 150,
   '{"hinge": 225, "channel": 2500, "basket": 1400, "shelf": 80, "cornerMagic": 12000, "cornerCarousel": 6000}'::jsonb,
   '{"HDMR": 1400, "Plywood": 1400, "BWP": 2200, "MDF": 1100, "Particle Board": 850}'::jsonb,
   '{"clear": 180, "black": 230, "brown": 230, "yellow": 240}'::jsonb,
   'biz_default')
on conflict (id) do nothing;

-- One-time forward migration for a database seeded before this
-- change: a business still sitting on the OLD hinge/channel
-- placeholders (120/450) gets advanced to the new estimates above
-- automatically. A business that already edited either away from the
-- placeholder is left alone — same "only touch what's still default"
-- rule the corner-unit module_type cleanup earlier in this file uses.
-- Safe to re-run: a database already on the new values, or with
-- either value edited, matches neither `where` clause a second time.
update public.rate_cards
   set hardware_rates = jsonb_set(jsonb_set(hardware_rates, '{hinge}', '225'), '{channel}', '2500')
 where hardware_rates->>'hinge' = '120'
   and hardware_rates->>'channel' = '450';

-- Shelf double-charge fix (docs/DECISIONS.md §48): the 'shelf' rate used
-- to price the shelf BOARD ("cut and edge-banded", placeholder 350); since
-- §42 the board is priced on real area in Material, so the line now means
-- supports & fitting only, placeholder 80. Same "only touch what's still
-- the placeholder" rule as the hinge/channel update above: a business
-- that set its own shelf rate is left alone (and should review it).
update public.rate_cards
   set hardware_rates = jsonb_set(hardware_rates, '{shelf}', '80')
 where hardware_rates->>'shelf' = '350';

-- Separate backfill for the brand-new material_rates column: every
-- row that predates it is NULL, not "already has some other value" —
-- there is no placeholder to detect and preserve here the way the
-- hinge/channel migration above has to, so this is a plain
-- fill-if-empty rather than a fill-if-still-default. A business that
-- saves ANY material rate (even 0 for one substrate) gets a real
-- jsonb object and drops out of this `where` clause on the next run.
update public.rate_cards
   set material_rates = '{"HDMR": 1400, "Plywood": 1400, "BWP": 2200, "MDF": 1100, "Particle Board": 850}'::jsonb
 where material_rates is null;

-- Same fill-if-empty backfill as material_rates above, for the
-- brand-new glass_rates column.
update public.rate_cards
   set glass_rates = '{"clear": 180, "black": 230, "brown": 230, "yellow": 240}'::jsonb
 where glass_rates is null;

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
  created_at timestamptz not null default now(),
  -- When this quote was actually shared via WhatsApp — NOT when it was
  -- frozen (frozen_at, above). Freezing and sending used to be
  -- conflated: the "Freeze & send" button only ever froze the row,
  -- and the two export buttons that appeared afterward (Download PDF,
  -- Share on WhatsApp) never recorded anything back. Null means
  -- "frozen but never actually sent" — a real, distinct state, since
  -- a designer can freeze a quote to lock in the numbers without
  -- sharing it yet. Deliberately set only by the WhatsApp share path,
  -- not Download — downloading a PDF is the designer grabbing a copy
  -- for themselves, not evidence the customer received anything.
  -- Deliberately NOT proof of delivery either (a wa.me link only opens
  -- WhatsApp with the message pre-filled; there is no way for this
  -- app to know whether the person actually pressed send inside
  -- WhatsApp) — it's "the share action was taken," the best signal
  -- available from a browser.
  sent_at timestamptz
);

-- One row per version per project, so a double-click on "Freeze & send"
-- cannot create two v2s.
create unique index if not exists quotes_project_version_idx
  on public.quotes (project_id, version);

create index if not exists quotes_project_idx
  on public.quotes (project_id, version desc);

alter table public.quotes add column if not exists business_id text references public.businesses(id);
-- Added after quotes already shipped — see the column's own comment
-- in the create table block above for why it exists and what it does
-- and doesn't mean. `if not exists` per this file's own idempotency
-- rule: `create table if not exists` is a no-op on an existing table,
-- so a column added to that block alone never reaches a database that
-- already has this table without this explicit alter too.
alter table public.quotes add column if not exists sent_at timestamptz;
-- The cutting list frozen with this version (§60): {parts, warnings}, the
-- parts without their 3D positions. Written once at freeze time like
-- `summary`, never updated — the workshop cuts the agreed kitchen even if
-- the design changes later. NULL on quotes frozen before §60.
alter table public.quotes add column if not exists cut_list jsonb;

-- ============================================================
-- CONSTRUCTION SETTINGS (docs/DECISIONS.md §41)
-- ============================================================
--
-- How the business's workshop builds a cabinet — bottom between or
-- under the sides, how the back is fixed, board thicknesses — which the
-- cutting list (src/lib/cutList.ts) reads — and, since §42, pricing
-- too, because board is priced on the cutting list's real part sizes.
-- One row per business, like rate_cards. Its own table rather than a
-- column on rate_cards because it describes how the workshop builds,
-- not a price. (CORRECTED: this said in §41 that construction never
-- changes a price; it moves it by a few millimetres' worth since §42.)
-- Board thicknesses are NOT stored here any more — each panel takes its
-- board line's thickness from rate_cards.board_rates. `settings` is one jsonb blob for the same reason
-- hardware_rates is: a growing set of keys never queried in SQL.
-- No seed row: a business without one gets the app's defaults
-- (DEFAULT_CONSTRUCTION in src/types/construction.ts), labelled as
-- assumed until confirmed.
create table if not exists public.construction_settings (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  business_id text references public.businesses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The business's kitchen style defaults (§117), what every new kitchen
-- starts from. Beside `settings`, not in it: `settings` is part of every
-- quote's pricing context, and a style default prices nothing.
alter table public.construction_settings add column if not exists style_defaults jsonb;

-- ============================================================
-- BUSINESS ISOLATION (RLS)
-- ============================================================
--
-- Runs last, after every table above has both its business_id column
-- (added right after each `create table`) AND its seed data (inserted
-- earlier in this file) — the `update ... where business_id is null`
-- line below is what backfills BOTH: rows that existed before this
-- migration, and rows this same run of the file just seeded fresh.
-- Order matters for exactly that reason; don't move this block earlier.
--
-- Same repeated block per table: backfill, then NOT NULL, then RLS
-- enabled, then four policies (select/insert/update/delete), each
-- allowing a request through only when it's the caller's own business
-- (public.current_business_id()).
--
-- NO SUPER-ADMIN BYPASS (§107, 7 Oct 2026). These policies (and the
-- businesses read policy) used to also let a super admin through. Nothing
-- in the app used it, and it was a trap: a super admin's app would load
-- EVERY business's customers and catalogue mixed together, and the
-- single-row reads (rate card, Workshop settings) could pick up another
-- business's row. The software owner reaches all data through Supabase's
-- SQL editor instead, which these policies don't apply to (it runs as the
-- tables' owner). super_admins and is_super_admin() are kept for a future
-- support view. Idempotent throughout: every `drop policy if exists`
-- before its `create policy` makes re-running this file safe, same
-- convention as everywhere else in this file.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'layouts', 'surface_finishes', 'cabinet_catalog_items',
    'obstacle_presets', 'appliance_catalog_items', 'handles',
    'light_fixture_catalog', 'rate_cards', 'quotes', 'construction_settings'
  ]
  loop
    execute format('update public.%I set business_id = %L where business_id is null', t, 'biz_default');
    execute format('alter table public.%I alter column business_id set not null', t);
    execute format('alter table public.%I enable row level security', t);

    -- Policy names are IDENTIFIERS (like a constraint name), not string
    -- literals — %I (quote_ident, double-quotes) is correct here;
    -- %L (quote_literal, single-quotes) would produce invalid SQL that
    -- fails on the very first table.
    execute format('drop policy if exists %I on public.%I', 'Business can read own ' || t, t);
    execute format(
      'create policy %I on public.%I for select using (business_id = public.current_business_id())',
      'Business can read own ' || t, t
    );

    execute format('drop policy if exists %I on public.%I', 'Business can insert own ' || t, t);
    execute format(
      'create policy %I on public.%I for insert with check (business_id = public.current_business_id())',
      'Business can insert own ' || t, t
    );

    execute format('drop policy if exists %I on public.%I', 'Business can update own ' || t, t);
    execute format(
      'create policy %I on public.%I for update using (business_id = public.current_business_id()) with check (business_id = public.current_business_id())',
      'Business can update own ' || t, t
    );

    execute format('drop policy if exists %I on public.%I', 'Business can delete own ' || t, t);
    execute format(
      'create policy %I on public.%I for delete using (business_id = public.current_business_id())',
      'Business can delete own ' || t, t
    );
  end loop;
end $$;

-- ============================================================
-- STARTER CATALOGUE AND EACH BUSINESS'S OWN DEFAULT (§107)
-- ============================================================
--
-- THE MASTER STARTER lives in its own business, 'biz_starter', which has
-- no members: nobody sees it in the app. The software owner fills it
-- from a curated business (usually their own) with
--     select public.refresh_starter_catalog('biz_default');
-- and re-runs that whenever the starter should change.
--
-- A NEW BUSINESS gets a COPY of it when approved (approve_new_business
-- below), never a live link: per principle 6 ("shared things are a copy
-- the business chooses"), refreshing the master must not change any
-- business's prices behind its back. Copied ids are
-- '<business id>:<original id>' (ids are global primary keys, so a copy
-- can't reuse the original's), and a cabinet row's finish_id/handle_id
-- are remapped to the copied finish and handle.
--
-- EACH BUSINESS'S DEFAULT is a snapshot of its own catalogue, kept as
-- JSON rows in catalog_defaults. "Save as my default" replaces it with the
-- catalogue as it is now; "Go back to my default" upserts it back:
-- edited items return to the saved values, deleted ones come back, and
-- items added since are KEPT (deleting them could break designs that use
-- them). Approval saves the starter copy as the first default, so a new
-- business can always go back to the starter. A runtime upsert like this
-- is the user's own action; the "never do update" rule is about THIS
-- FILE's seed re-runs, which still never overwrite anything.
--
-- The rate card and Workshop settings aren't part of the catalogue; a new
-- business starts on the in-app defaults for both.

insert into public.businesses (id, name) values ('biz_starter', 'Starter catalogue (master, no members)')
on conflict (id) do nothing;

alter table public.businesses add column if not exists catalog_default_saved_at timestamptz;

-- The catalogue tables, in foreign-key order (finishes before the cabinet
-- rows that point at them).
create or replace function public.catalog_tables()
returns text[]
language sql
immutable
as $$
  select array['surface_finishes', 'handles', 'obstacle_presets', 'appliance_catalog_items', 'light_fixture_catalog', 'cabinet_catalog_items']
$$;

create table if not exists public.catalog_defaults (
  business_id text not null references public.businesses(id),
  table_name text not null,
  item_id text not null,
  row jsonb not null,
  primary key (business_id, table_name, item_id)
);
alter table public.catalog_defaults enable row level security;
drop policy if exists "Members read their own default" on public.catalog_defaults;
create policy "Members read their own default" on public.catalog_defaults
  for select using (business_id = public.current_business_id());
drop policy if exists "Members save their own default" on public.catalog_defaults;
create policy "Members save their own default" on public.catalog_defaults
  for insert with check (business_id = public.current_business_id());
drop policy if exists "Members replace their own default" on public.catalog_defaults;
create policy "Members replace their own default" on public.catalog_defaults
  for delete using (business_id = public.current_business_id());

-- A copied row's id: drop `p_strip` from the front if it's there, then add
-- `p_prefix`. 'starter:finish_x' → strip 'starter:', prefix 'biz_ab:' →
-- 'biz_ab:finish_x'.
create or replace function public.catalog_copy_id(p_id text, p_strip text, p_prefix text)
returns text
language sql
immutable
as $$
  select p_prefix || case when p_strip <> '' and left(p_id, length(p_strip)) = p_strip then substr(p_id, length(p_strip) + 1) else p_id end
$$;

-- Copies one business's whole catalogue into another (rows that already
-- exist are left alone). Runs as the caller, so RLS still applies; the
-- owner-only functions below call it from the SQL editor.
create or replace function public.copy_catalog(p_from text, p_to text, p_strip text, p_prefix text)
returns integer
language plpgsql
as $$
declare
  t text;
  copied integer := 0;
  n integer;
  remap text;
begin
  foreach t in array public.catalog_tables() loop
    remap := case when t = 'cabinet_catalog_items' then
      $r$ || jsonb_build_object(
        'finish_id', coalesce((select public.catalog_copy_id(f.id, $4, $3) from public.surface_finishes f where f.id = s.finish_id and f.business_id = $1), s.finish_id),
        'handle_id', coalesce((select public.catalog_copy_id(h.id, $4, $3) from public.handles h where h.id = s.handle_id and h.business_id = $1), s.handle_id)
      )$r$
    else '' end;
    execute format(
      $q$insert into public.%1$I
         select (jsonb_populate_record(null::public.%1$I,
           to_jsonb(s) || jsonb_build_object('id', public.catalog_copy_id(s.id, $4, $3), 'business_id', $2) %2$s)).*
         from public.%1$I s
         where s.business_id = $1
         on conflict (id) do nothing$q$,
      t, remap)
    using p_from, p_to, p_prefix, p_strip;
    get diagnostics n = row_count;
    copied := copied + n;
  end loop;
  return copied;
end $$;

-- Replaces a business's saved default with its catalogue as it is now.
-- Runs as the caller. An app login may only name its OWN business: RLS
-- alone would just make another business's save a silent no-op (its rows
-- are invisible), so this refuses outright instead. The owner's SQL-editor
-- session has no app login (auth.uid() is null) and may name any.
create or replace function public.save_catalog_default(p_business text)
returns integer
language plpgsql
as $$
declare
  t text;
  saved integer := 0;
  n integer;
begin
  if auth.uid() is not null and p_business is distinct from public.current_business_id() then
    raise exception 'You can only save your own business''s default.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.catalog_defaults where business_id = p_business;
  foreach t in array public.catalog_tables() loop
    execute format(
      'insert into public.catalog_defaults (business_id, table_name, item_id, row)
       select $1, %L, s.id, to_jsonb(s) from public.%I s where s.business_id = $1',
      t, t)
    using p_business;
    get diagnostics n = row_count;
    saved := saved + n;
  end loop;
  update public.businesses set catalog_default_saved_at = now() where id = p_business;
  return saved;
end $$;

-- "Save as my default" (the Catalogue page). Returns how many items were saved.
create or replace function public.save_my_catalog_default()
returns integer
language plpgsql
as $$
declare
  b text := public.current_business_id();
begin
  if b is null then raise exception 'This account is not in a business yet.'; end if;
  return public.save_catalog_default(b);
end $$;

-- "Go back to my default" (the Catalogue page). Returns how many items
-- were restored. Each saved row is laid over the CURRENT row where there
-- is one (jsonb_populate_record with that row as the base), so a column
-- added to the table after the default was saved keeps its current value
-- instead of being blanked.
create or replace function public.restore_my_catalog_default()
returns integer
language plpgsql
as $$
declare
  b text := public.current_business_id();
  t text;
  cols text;
  restored integer := 0;
  n integer;
begin
  if b is null then raise exception 'This account is not in a business yet.'; end if;
  if not exists (select 1 from public.catalog_defaults where business_id = b) then
    raise exception 'No default saved yet. Save your catalogue as your default first.';
  end if;
  foreach t in array public.catalog_tables() loop
    select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
      into cols
      from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name not in ('id', 'business_id', 'created_at');
    execute format(
      $q$insert into public.%1$I
         select (jsonb_populate_record(cur, d.row || jsonb_build_object('business_id', $1))).*
         from public.catalog_defaults d
         left join public.%1$I cur on cur.id = d.item_id and cur.business_id = $1
         where d.business_id = $1 and d.table_name = %2$L
         on conflict (id) do update set %3$s$q$,
      t, t, cols)
    using b;
    get diagnostics n = row_count;
    restored := restored + n;
  end loop;
  return restored;
end $$;

-- OWNER ONLY (SQL editor). Rebuilds the master starter from a business's
-- catalogue. Returns how many items the starter now has.
create or replace function public.refresh_starter_catalog(p_source text default 'biz_default')
returns integer
language plpgsql
as $$
declare
  t text;
  i integer;
  tables text[] := public.catalog_tables();
begin
  if p_source = 'biz_starter' then raise exception 'Choose a real business to copy from.'; end if;
  -- Reverse order: cabinet rows before the finishes they point at.
  for i in reverse array_length(tables, 1)..1 loop
    execute format('delete from public.%I where business_id = %L', tables[i], 'biz_starter');
  end loop;
  return public.copy_catalog(p_source, 'biz_starter', '', 'starter:');
end $$;

-- OWNER ONLY (SQL editor). Approves a waiting sign-up as a NEW, separate
-- business: creates it (named from the sign-up form unless p_name is
-- given), makes the person its owner, copies the starter catalogue in and
-- saves that as the business's first default. Returns the new business id.
-- For adding someone to an EXISTING business instead, see docs/DEPLOY.md.
create or replace function public.approve_new_business(p_user uuid, p_name text default null)
returns text
language plpgsql
as $$
declare
  b text;
  v_name text;
begin
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No user with id %.', p_user;
  end if;
  if exists (select 1 from public.business_users where user_id = p_user) then
    raise exception 'That user already belongs to a business.';
  end if;
  if not exists (select 1 from public.surface_finishes where business_id = 'biz_starter') then
    raise exception 'The starter catalogue is empty. Run: select public.refresh_starter_catalog(''biz_default'');';
  end if;
  select coalesce(nullif(trim(p_name), ''), nullif(trim(raw_user_meta_data->>'business_name'), ''), email)
    into v_name from auth.users where id = p_user;
  b := 'biz_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.businesses (id, name) values (b, v_name);
  insert into public.business_users (business_id, user_id, role) values (b, p_user, 'owner');
  perform public.copy_catalog('biz_starter', b, 'starter:', b || ':');
  perform public.save_catalog_default(b);
  return b;
end $$;

-- Who may call what. Supabase lets every role execute new functions by
-- default, so the owner-only ones are revoked from the app's roles; the
-- SQL editor (the tables' owner) can still run them. The two "my" functions
-- are the app's; save_catalog_default runs under them, as the caller, with
-- RLS as its guard.
revoke execute on function public.copy_catalog(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.refresh_starter_catalog(text) from public, anon, authenticated;
revoke execute on function public.approve_new_business(uuid, text) from public, anon, authenticated;
revoke execute on function public.save_catalog_default(text) from public, anon;
revoke execute on function public.save_my_catalog_default() from public, anon;
revoke execute on function public.restore_my_catalog_default() from public, anon;
grant execute on function public.save_catalog_default(text) to authenticated;
grant execute on function public.save_my_catalog_default() to authenticated;
grant execute on function public.restore_my_catalog_default() to authenticated;

-- ============================================================
-- AI USAGE LIMITS AND GENERATED IMAGES (§132)
-- ============================================================
-- Two paid AI features, the Help assistant (RunPod) and "Make image"
-- (Gemini), each called through the Worker with the user's own sign-in.
-- Limits per business: images and tokens, per day / week / month
-- (India time; weeks start Monday). A business's own number wins; a
-- blank one falls back to the default; a blank default means no limit.
--
-- The tables have RLS on and NO write policies: nothing in the browser
-- can change a limit or erase usage. Everything goes through the
-- functions below:
--   usage_check / usage_record: called by the Worker with the user's
--     token, for the caller's own business only. Calling usage_record
--     directly can only ADD usage to your own business.
--   admin_*: the super admin's Usage page. These are the one place the
--     app sees across businesses (§107 keeps the app per-business), so
--     they return only business names and usage numbers, never customer
--     data, and refuse anyone who isn't in super_admins.

create table if not exists public.usage_limit_defaults (
  id int primary key default 1 check (id = 1),
  images_per_day int,
  images_per_week int,
  images_per_month int,
  tokens_per_day bigint,
  tokens_per_week bigint,
  tokens_per_month bigint,
  updated_at timestamptz not null default now()
);
-- Starting defaults: placeholders, set on the Usage page. A Help
-- question costs ~7,500 tokens (the guide is sent each time), an image
-- a few thousand.
insert into public.usage_limit_defaults (id, images_per_day, images_per_week, images_per_month, tokens_per_day, tokens_per_week, tokens_per_month)
values (1, 20, 100, 300, 500000, 2500000, 8000000)
on conflict (id) do nothing;
alter table public.usage_limit_defaults enable row level security;

create table if not exists public.business_usage_limits (
  business_id text primary key references public.businesses(id) on delete cascade,
  images_per_day int,
  images_per_week int,
  images_per_month int,
  tokens_per_day bigint,
  tokens_per_week bigint,
  tokens_per_month bigint,
  updated_at timestamptz not null default now()
);
alter table public.business_usage_limits enable row level security;

create table if not exists public.ai_usage_events (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.businesses(id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('image', 'help')),
  images int not null default 0,
  tokens bigint not null default 0,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_business_time on public.ai_usage_events (business_id, created_at);
alter table public.ai_usage_events enable row level security;
drop policy if exists "Business can read own ai_usage_events" on public.ai_usage_events;
create policy "Business can read own ai_usage_events" on public.ai_usage_events
  for select using (business_id = public.current_business_id());

-- Effective limits and usage for one business. Internal: not callable
-- from the app (revoked below), or any member could read any business.
create or replace function public.usage_status_for(p_business text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select
      (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as day_start,
      (date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as week_start,
      (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as month_start
  ),
  d as (select * from public.usage_limit_defaults where id = 1),
  o as (select * from public.business_usage_limits where business_id = p_business),
  u as (
    select
      coalesce(sum(e.images) filter (where e.created_at >= t.day_start), 0) as images_day,
      coalesce(sum(e.images) filter (where e.created_at >= t.week_start), 0) as images_week,
      coalesce(sum(e.images) filter (where e.created_at >= t.month_start), 0) as images_month,
      coalesce(sum(e.tokens) filter (where e.created_at >= t.day_start), 0) as tokens_day,
      coalesce(sum(e.tokens) filter (where e.created_at >= t.week_start), 0) as tokens_week,
      coalesce(sum(e.tokens) filter (where e.created_at >= t.month_start), 0) as tokens_month
    from t
    left join public.ai_usage_events e
      on e.business_id = p_business and e.created_at >= least(t.week_start, t.month_start)
    group by t.day_start, t.week_start, t.month_start
  )
  select jsonb_build_object(
    'limits', jsonb_build_object(
      'images_per_day', coalesce((select images_per_day from o), (select images_per_day from d)),
      'images_per_week', coalesce((select images_per_week from o), (select images_per_week from d)),
      'images_per_month', coalesce((select images_per_month from o), (select images_per_month from d)),
      'tokens_per_day', coalesce((select tokens_per_day from o), (select tokens_per_day from d)),
      'tokens_per_week', coalesce((select tokens_per_week from o), (select tokens_per_week from d)),
      'tokens_per_month', coalesce((select tokens_per_month from o), (select tokens_per_month from d))
    ),
    'used', (select to_jsonb(u) from u)
  );
$$;

-- May the caller's business use this feature now? {allowed, reason}.
create or replace function public.usage_check(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b text := public.current_business_id();
  s jsonb;
  w text;
  label text;
begin
  if b is null then
    return jsonb_build_object('allowed', false, 'reason', 'Your account isn’t linked to a business yet.');
  end if;
  s := public.usage_status_for(b);
  foreach w in array array['day', 'week', 'month'] loop
    label := case w when 'day' then 'today' when 'week' then 'this week' else 'this month' end;
    if p_kind = 'image'
       and (s->'limits'->>('images_per_' || w)) is not null
       and (s->'used'->>('images_' || w))::bigint >= (s->'limits'->>('images_per_' || w))::bigint then
      return jsonb_build_object('allowed', false, 'reason',
        format('Your business has made all %s images allowed %s. Ask the software owner to raise the limit.', s->'limits'->>('images_per_' || w), label));
    end if;
    if (s->'limits'->>('tokens_per_' || w)) is not null
       and (s->'used'->>('tokens_' || w))::bigint >= (s->'limits'->>('tokens_per_' || w))::bigint then
      return jsonb_build_object('allowed', false, 'reason',
        format('Your business has used its AI allowance for %s. Ask the software owner to raise the limit.', label));
    end if;
  end loop;
  return jsonb_build_object('allowed', true);
end $$;

create or replace function public.usage_record(p_kind text, p_images int, p_tokens bigint, p_model text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := public.current_business_id();
begin
  if b is null then raise exception 'No business for this account'; end if;
  if p_kind not in ('image', 'help') then raise exception 'Unknown kind %', p_kind; end if;
  if p_images < 0 or p_images > 20 or p_tokens < 0 or p_tokens > 5000000 then
    raise exception 'Usage out of range';
  end if;
  insert into public.ai_usage_events (business_id, user_id, kind, images, tokens, model)
  values (b, auth.uid(), p_kind, p_images, p_tokens, left(p_model, 120));
end $$;

-- The Usage page: defaults, and every business with its own numbers
-- (blank = default), effective limits and usage.
create or replace function public.admin_usage_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'defaults', (select to_jsonb(d) - 'id' from public.usage_limit_defaults d where d.id = 1),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'own', (select to_jsonb(o) - 'business_id' from public.business_usage_limits o where o.business_id = b.id),
        'status', public.usage_status_for(b.id)
      ) order by b.name)
      from public.businesses b
    ), '[]'::jsonb)
  );
end $$;

-- p_limits: {images_per_day, …, tokens_per_month}; null = no limit
-- (defaults) or "use the default" (a business).
create or replace function public.admin_set_default_usage_limits(p_limits jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  update public.usage_limit_defaults set
    images_per_day = (p_limits->>'images_per_day')::int,
    images_per_week = (p_limits->>'images_per_week')::int,
    images_per_month = (p_limits->>'images_per_month')::int,
    tokens_per_day = (p_limits->>'tokens_per_day')::bigint,
    tokens_per_week = (p_limits->>'tokens_per_week')::bigint,
    tokens_per_month = (p_limits->>'tokens_per_month')::bigint,
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.admin_set_business_usage_limits(p_business text, p_limits jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  insert into public.business_usage_limits as l (business_id, images_per_day, images_per_week, images_per_month, tokens_per_day, tokens_per_week, tokens_per_month, updated_at)
  values (
    p_business,
    (p_limits->>'images_per_day')::int, (p_limits->>'images_per_week')::int, (p_limits->>'images_per_month')::int,
    (p_limits->>'tokens_per_day')::bigint, (p_limits->>'tokens_per_week')::bigint, (p_limits->>'tokens_per_month')::bigint,
    now()
  )
  on conflict (business_id) do update set
    images_per_day = excluded.images_per_day, images_per_week = excluded.images_per_week, images_per_month = excluded.images_per_month,
    tokens_per_day = excluded.tokens_per_day, tokens_per_week = excluded.tokens_per_week, tokens_per_month = excluded.tokens_per_month,
    updated_at = now();
end $$;

-- Your own business's limits and usage, for everyone's Usage page
-- (§134). Only ever the caller's business.
create or replace function public.my_usage_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b text := public.current_business_id();
begin
  if b is null then raise exception 'No business for this account'; end if;
  return public.usage_status_for(b) || jsonb_build_object('business_id', b, 'now', now());
end $$;

-- One business's AI images, newest first, for the super admin's Usage
-- page (§136): with the customer and design names, so they can be
-- reviewed without opening each design. Same narrow exception as the
-- other admin_* functions; refuses anyone else.
create or replace function public.admin_business_renders(p_business text, p_limit int default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select r.id, r.created_at, r.camera_label, r.styling, r.model, r.image_url,
             p.client_name, l.name as design_name
      from public.design_renders r
      left join public.projects p on p.id = r.project_id
      left join public.layouts l on l.id = r.layout_id
      where r.business_id = p_business
      order by r.created_at desc
      limit least(greatest(p_limit, 1), 500)
    ) x
  ), '[]'::jsonb);
end $$;

revoke execute on function public.usage_status_for(text) from public, anon, authenticated;
revoke execute on function public.admin_business_renders(text, int) from public, anon;
grant execute on function public.admin_business_renders(text, int) to authenticated;
revoke execute on function public.my_usage_status() from public, anon;
grant execute on function public.my_usage_status() to authenticated;
revoke execute on function public.usage_check(text) from public, anon;
revoke execute on function public.usage_record(text, int, bigint, text) from public, anon;
revoke execute on function public.admin_usage_overview() from public, anon;
revoke execute on function public.admin_set_default_usage_limits(jsonb) from public, anon;
revoke execute on function public.admin_set_business_usage_limits(text, jsonb) from public, anon;
grant execute on function public.usage_check(text) to authenticated;
grant execute on function public.usage_record(text, int, bigint, text) to authenticated;
grant execute on function public.admin_usage_overview() to authenticated;
grant execute on function public.admin_set_default_usage_limits(jsonb) to authenticated;
grant execute on function public.admin_set_business_usage_limits(text, jsonb) to authenticated;
grant execute on function public.is_super_admin() to authenticated;

-- Images made with "Make image", kept for review: one row per image, the
-- file in the public `renders` bucket under the business's own folder.
create table if not exists public.design_renders (
  id text primary key,
  business_id text not null references public.businesses(id) on delete cascade,
  project_id text,
  layout_id text not null,
  camera_label text,
  styling text,
  model text,
  image_path text not null,
  image_url text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists design_renders_layout on public.design_renders (layout_id, created_at desc);
alter table public.design_renders enable row level security;
drop policy if exists "Business can read own design_renders" on public.design_renders;
create policy "Business can read own design_renders" on public.design_renders
  for select using (business_id = public.current_business_id());
drop policy if exists "Business can insert own design_renders" on public.design_renders;
create policy "Business can insert own design_renders" on public.design_renders
  for insert with check (business_id = public.current_business_id());
drop policy if exists "Business can delete own design_renders" on public.design_renders;
create policy "Business can delete own design_renders" on public.design_renders
  for delete using (business_id = public.current_business_id());

insert into storage.buckets (id, name, public)
values ('renders', 'renders', true)
on conflict (id) do nothing;
drop policy if exists "Public read access to renders" on storage.objects;
create policy "Public read access to renders"
on storage.objects for select
using (bucket_id = 'renders');
drop policy if exists "Members upload renders" on storage.objects;
create policy "Members upload renders"
on storage.objects for insert
with check (bucket_id = 'renders' and (storage.foldername(name))[1] = public.current_business_id());
drop policy if exists "Members delete renders" on storage.objects;
create policy "Members delete renders"
on storage.objects for delete
using (bucket_id = 'renders' and (storage.foldername(name))[1] = public.current_business_id());

-- ============================================================
-- IMAGE PROMPTS (§137)
-- ============================================================
-- The software owner's prompt lab: up to five named prompts for Make
-- image (opening and closing instructions, whether to send the design
-- brief, up to three reference photos), one of which can be marked as
-- the production prompt every business uses. None marked = the app's
-- built-in prompt.
--
-- A PLATFORM table, like super_admins: no business_id, because the
-- prompt belongs to the software, not to a business. Anyone signed in
-- may read the production prompt (their Make image sends it); only a
-- super admin may read the others or write.

create table if not exists public.render_prompts (
  id text primary key,
  name text not null check (length(trim(name)) between 1 and 60),
  intro text not null default '',
  closing text not null default '',
  include_brief boolean not null default true,
  -- [{"url": "...", "path": "prompts/<id>/<file>", "label": "..."}], at most 3.
  reference_images jsonb not null default '[]'::jsonb check (jsonb_typeof(reference_images) = 'array' and jsonb_array_length(reference_images) <= 3),
  is_production boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists render_prompts_one_production on public.render_prompts (is_production) where is_production;
alter table public.render_prompts enable row level security;

drop policy if exists "Read the production prompt, or all as super admin" on public.render_prompts;
create policy "Read the production prompt, or all as super admin" on public.render_prompts
  for select using (is_production or public.is_super_admin());
drop policy if exists "Super admin inserts prompts" on public.render_prompts;
create policy "Super admin inserts prompts" on public.render_prompts
  for insert with check (public.is_super_admin());
drop policy if exists "Super admin updates prompts" on public.render_prompts;
create policy "Super admin updates prompts" on public.render_prompts
  for update using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "Super admin deletes prompts" on public.render_prompts;
create policy "Super admin deletes prompts" on public.render_prompts
  for delete using (public.is_super_admin());

-- At most five.
create or replace function public.render_prompts_max_five()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.render_prompts) >= 5 then
    raise exception 'At most 5 prompts: delete one first.';
  end if;
  return new;
end $$;
drop trigger if exists render_prompts_max_five on public.render_prompts;
create trigger render_prompts_max_five before insert on public.render_prompts
  for each row execute function public.render_prompts_max_five();

-- Mark one prompt as production, or none (null) for the built-in prompt.
-- One statement, so the one-production index never sees two.
create or replace function public.admin_set_production_prompt(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  update public.render_prompts set is_production = false, updated_at = now() where is_production and id is distinct from p_id;
  if p_id is not null then
    update public.render_prompts set is_production = true, updated_at = now() where id = p_id;
  end if;
end $$;
revoke execute on function public.admin_set_production_prompt(text) from public, anon;
grant execute on function public.admin_set_production_prompt(text) to authenticated;

-- Which prompt made each image, for comparing (kept as a name too, so it
-- still reads after the prompt is renamed or deleted).
alter table public.design_renders add column if not exists prompt_id text;
alter table public.design_renders add column if not exists prompt_name text;

-- Reference photos: public read (they're sent with every image), written
-- only by the super admin.
insert into storage.buckets (id, name, public)
values ('prompt-refs', 'prompt-refs', true)
on conflict (id) do nothing;
drop policy if exists "Public read access to prompt-refs" on storage.objects;
create policy "Public read access to prompt-refs"
on storage.objects for select
using (bucket_id = 'prompt-refs');
drop policy if exists "Super admin uploads prompt-refs" on storage.objects;
create policy "Super admin uploads prompt-refs"
on storage.objects for insert
with check (bucket_id = 'prompt-refs' and public.is_super_admin());
drop policy if exists "Super admin deletes prompt-refs" on storage.objects;
create policy "Super admin deletes prompt-refs"
on storage.objects for delete
using (bucket_id = 'prompt-refs' and public.is_super_admin());
