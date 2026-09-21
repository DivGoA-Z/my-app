# Status

**The bridge between the repo and planning conversations.**

Claude Code updates this at the end of each working session. When
starting a planning conversation in the Claude Project — which cannot
see this repo — paste this file in. It is the only thing that needs to
travel.

Keep it short. It is a snapshot, not a history; `docs/DECISIONS.md` is
where reasoning is recorded and `git log` is where the history is.

---

**Last updated:** 21 Sep 2026

## Where things stand

Moved to a new machine and a fresh Supabase project. The app runs
locally, the database is built from `supabase/schema.sql`, and the repo
is under git with a private GitHub remote.

Old designs did not come across — the new Supabase project starts
empty, which was expected.

## Built and working

2D plan (room, obstacles, cabinets, appliances, doors and windows, light
fixtures, overlap picker, unified selection, clearance and collision
detection) · parametric cabinet fronts with derived hardware · 3D
walkthrough with camera nodes and 360° panorama capture · three lighting
modes with exposure control · itemised quote with a global electrical
toggle · rate card · quote freezing and revisions · customer pipeline
dashboard · Supabase persistence · inventory managers for finishes,
handles, fixtures, cabinets and appliances.

## Not built

- **Quote export** — PDF and WhatsApp link. The reason a quote cannot
  currently leave the app.
- **Auth, tenancy, RLS.** Single business; anyone with the URL can read
  every row.
- **Undo/redo and autosave.**
- **The panel model.** Costing is still an area estimate, so no cutting
  list is possible.
- **Rectilinear room shapes.** Rectangle plus pillars only.
- Component library, present mode, inventory import/export, board
  nesting.

## Known unverified

- **`npx tsc --noEmit` has not been confirmed to pass.** The rate card,
  quote snapshotting and lighting work were checked by static analysis
  and by modelling the maths, never by a compiler.
- Nine open items in `docs/DECISIONS.md` §8, mostly about textures and
  finish scaling.

## In progress

Working through `docs/ISSUES.md` — problems found while using the app
on real work.

## Blocked

- **The panel model** waits on the carpenter's construction convention:
  is the bottom panel captured between the sides, or sitting on them?
  Is the back grooved in or nailed on?
- **Board nesting** waits on real supplier sheet sizes and thicknesses.

## Next

1. Clear `docs/ISSUES.md`.
2. Quote export — PDF and WhatsApp.
3. Tenant column, auth and RLS.

Full roadmap in `docs/PRINCIPLES.md`, Part 2.
