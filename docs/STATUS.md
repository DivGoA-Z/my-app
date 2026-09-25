# Status

**The bridge between the repo and planning conversations.**

Claude Code updates this at the end of each working session. When
starting a planning conversation in the Claude Project — which cannot
see this repo — paste this file in. It is the only thing that needs to
travel.

Keep it short. It is a snapshot, not a history; `docs/DECISIONS.md` is
where reasoning is recorded and `git log` is where the history is.

---

**Last updated:** 25 Sep 2026

## Where things stand

Moved to a new machine and a fresh Supabase project. The app runs
locally, the database is built from `supabase/schema.sql`, and the repo
is under git with a private GitHub remote.

Old designs did not come across — the new Supabase project starts
empty, which was expected.

Re-running `schema.sql` a second time (to pick up a fixture-catalog
column fix) surfaced a real idempotency bug — every seed insert wrote
rows without `business_id`, which only worked by accident the first
time the file ever ran. Fixed; see `docs/DECISIONS.md` §9. Also
started on roadmap item 8 (component library): shadcn/ui is now in
the app, and toasts cover every previously-silent save/freeze/import/
delete action — see `docs/DECISIONS.md` §11.

## Built and working

2D plan (room, obstacles, cabinets, appliances, doors and windows, light
fixtures, overlap picker, unified selection, clearance and collision
detection) · parametric cabinet fronts with derived hardware · 3D
walkthrough with camera nodes and 360° panorama capture · three lighting
modes with exposure control · itemised quote with a global electrical
toggle · rate card · quote freezing and revisions · quote export (PDF +
hosted WhatsApp link) · undo/redo (Cmd+Z/Cmd+Shift+Z) and autosave ·
real auth + per-business RLS on all thirteen tables (with a
super-admin bypass for the software owner; cross-tenant isolation
confirmed with a throwaway second business, since cleaned up) · Excel
import/export for
all five catalogues — cabinets, obstacles, appliances, handles,
fixtures (download, edit, upload, validate, fix inline, commit) ·
customer pipeline dashboard · Supabase persistence · inventory
managers for finishes, handles, fixtures, cabinets and appliances.

## Not built

- **Self-serve sign-up for a second business.** One business exists
  today, created via a manual step (`docs/SUPABASE_SETUP.md`).
- **Shared/global catalogue toggle.** Requested, deferred — see
  `docs/PRINCIPLES.md`'s "Open decisions" for the shape.
- **The panel model.** Costing is still an area estimate, so no cutting
  list is possible.
- **Rectilinear room shapes.** Rectangle plus pillars only.
- Present mode, board nesting. Component library is in progress (see
  below), not unstarted.

## Known unverified

- Nine open items in `docs/DECISIONS.md` §8, mostly about textures and
  finish scaling.
- The Excel import/export's browser download flow (as opposed to
  upload/parse/validate/commit, which you've now driven for real
  through the UI for all 5 catalogues, including the delete-column
  path) has only been clicked through for cabinets. Obstacles/
  appliances/handles/fixtures were uploaded from files this session
  generated directly, not from a file freshly downloaded from the app
  in the browser first.
- shadcn/ui, toasts, and the in-app confirm dialog (`docs/DECISIONS.md`
  §11) are now confirmed working in the browser — including surviving
  a real dev-server restart needed after installing shadcn's ~8 new
  npm packages mid-session (see `docs/ISSUES-FIXED.md`).

## In progress

`docs/ISSUES.md` is currently empty — real-use bug reports get logged
there as they come up. Just shipped: undo/redo, autosave, quote export
(PDF + hosted WhatsApp link), business isolation (auth + RLS), Excel
import/export with an explicit delete column for all five catalogues,
and a schema.sql idempotency fix (re-running it after RLS went live
was breaking every seed insert — see `docs/DECISIONS.md` §9), all now
confirmed working against your live Supabase project. Component
library (roadmap item 8) is under way: shadcn/ui is in, toasts cover
every previously-silent save/freeze/import/delete action.

## Blocked

- **The panel model** waits on the carpenter's construction convention:
  is the bottom panel captured between the sides, or sitting on them?
  Is the back grooved in or nailed on?
- **Board nesting** waits on real supplier sheet sizes and thicknesses.

## Next

Foundations, inventory import/export, and business isolation are all
confirmed working end to end. Currently mid-way through roadmap item
8 (component library and the four states) — next: migrate existing
hand-rolled markup to the new shadcn primitives, then the four states
per screen. Full roadmap in `docs/PRINCIPLES.md`, Part 2.
