-- scripts/seed_pendant_fixture.sql
--
-- Adds one new light_fixture_catalog row wired to the industrial
-- pendant model that already sits unused at
-- public/models/lighting/pendant-industrial.glb (CC0 Poly Haven
-- hanging_industrial_lamp, fetched by scripts/fetch_models.py).
--
-- Idempotent (on conflict do update), safe to re-run. Run this against
-- the live Supabase project the same way as
-- add_fixture_model_columns.sql (psql or the Supabase SQL editor) —
-- AFTER that migration, since this insert writes the model_url/
-- model_rotation_*_deg columns it adds.
--
-- Deliberately in its own file, separate from
-- scripts/seed_finishes_and_appliances.sql, which is being edited
-- concurrently for an unrelated finish-swatch fix.
--
-- UNVERIFIED ORIENTATION: model_rotation_x/y/z_deg are left at 0/0/0.
-- This environment has no way to render the GLB and visually check
-- which way it's actually facing/up — 0/0/0 is a starting guess, NOT a
-- confirmed-correct orientation. If the lamp renders sideways or
-- upside-down in the browser, adjust these three columns (see the
-- ORIENTATION note in src/components/canvas3d/ApplianceModel.tsx for
-- what each axis corrects) and re-run this file.

insert into light_fixture_catalog (
  id,
  label,
  kind,
  color_temp_k,
  lumens,
  pricing_mode,
  price,
  model_url,
  model_rotation_x_deg,
  model_rotation_y_deg,
  model_rotation_z_deg,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-0000000000e1',
  'Industrial Pendant',
  'pendant',
  3000,
  800,
  'per-unit',
  2200,
  '/models/lighting/pendant-industrial.glb',
  0,
  0,
  0,
  now(),
  now()
)
on conflict (id) do update set
  label = excluded.label,
  kind = excluded.kind,
  color_temp_k = excluded.color_temp_k,
  lumens = excluded.lumens,
  pricing_mode = excluded.pricing_mode,
  price = excluded.price,
  model_url = excluded.model_url,
  model_rotation_x_deg = excluded.model_rotation_x_deg,
  model_rotation_y_deg = excluded.model_rotation_y_deg,
  model_rotation_z_deg = excluded.model_rotation_z_deg,
  updated_at = now();
