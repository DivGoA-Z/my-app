-- scripts/add_fixture_model_columns.sql
--
-- Manual, one-time migration. This repo has no schema-migration
-- tracking (no supabase/schema.sql, no migrations table) — the actual
-- Postgres tables live in a configured Supabase project and are edited
-- by hand. Run this once against that project, either by pasting it
-- into the Supabase SQL editor or via:
--
--   psql "$DATABASE_URL" -f scripts/add_fixture_model_columns.sql
--
-- Adds the same "optional GLB body" columns that already exist on
-- appliance_catalog_items (model_url, model_rotation_x_deg/y_deg/
-- z_deg) to light_fixture_catalog, so a catalogue row can point at a
-- real model instead of always rendering the primitive bar/disc body.
-- All four columns are nullable and `if not exists`, so this is safe
-- to re-run and safe to run against a table that already has some or
-- all of them.

alter table light_fixture_catalog
  add column if not exists model_url text,
  add column if not exists model_rotation_x_deg integer,
  add column if not exists model_rotation_y_deg integer,
  add column if not exists model_rotation_z_deg integer;
