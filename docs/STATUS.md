# Status

**The bridge between the repo and planning conversations.**

Claude Code updates this at the end of each working session. When
starting a planning conversation in the Claude Project — which cannot
see this repo — paste this file in. It is the only thing that needs to
travel.

Keep it short. It is a snapshot, not a history; `docs/DECISIONS.md` is
where reasoning is recorded and `git log` is where the history is.

---

**Last updated:** 26 Sep 2026

## Where things stand

Moved to a new machine and a fresh Supabase project. The app runs
locally, the database is built from `supabase/schema.sql`, and the repo
is under git with a private GitHub remote.

Old designs did not come across — the new Supabase project starts
empty, which was expected.

Re-running `schema.sql` a second time (to pick up a fixture-catalog
column fix) surfaced a real idempotency bug — every seed insert wrote
rows without `business_id`, which only worked by accident the first
time the file ever ran. Fixed; see `docs/DECISIONS.md` §9.

Roadmap item 8 (component library): shadcn/ui is in, every plain
`<button>` in the app is now a shadcn `Button`, toasts and an in-app
confirm dialog cover every save/freeze/import/delete action, and a
first four-states pass landed on `CustomerDashboard`/`InventoryManager`
— all confirmed working in the browser, including a real overflow bug
the migration introduced (`whitespace-nowrap` baked into `Button`,
breaking a few narrow-panel labels that used to wrap) and fixed.
See `docs/DECISIONS.md` §11.

Roadmap item 6 (real rates): hinge/channel hardware rates and material
rates by substrate now use real Delhi NCR market estimates, and
material cost now varies by a cabinet's own area and substrate instead
of being folded silently into its flat catalogue price — the
costing-only slice of the blocked panel model, not the panel model
itself (`docs/DECISIONS.md` §13). That surfaced a real problem
(material+finish+hardware alone came to under half of every cabinet's
old price), fixed by adding two new per-cabinet rate card fields
(fabrication, others) and a real cost-basis-vs-selling-basis split
(§14) — then corrected further (§15) once uploading that fix hit a
real validation bug: `unitPrice` is now a pure DISPLAY reference,
never read by the pricing formula at all (no more double-counting
risk, however it's set); margin is distributed across every line
instead of shown as one separate line, matching how real customer-
facing quotes read; and margin moved off the rate card entirely, onto
each PROJECT's own layout, edited in `QuoteSidebar` next to the
Cost/Selling toggle rather than in Manage Inventory.
`final-catalogues/cabinets-reference-price.xlsx` is the file to
upload — `unit_price` set to each cabinet's real computed cost
(material+finish+hardware+labour+fabrication), for browsing reference
only, with zero effect on what a quote actually charges. The
Cost/Selling toggle and margin input in `QuoteSidebar` were also moved
to the top of the panel, next to the heading, instead of below the
whole itemised table (`docs/DECISIONS.md` §16).

Roadmap item 8 (four states), continued: promoted every screen-level
hand-rolled error/warning box in the toolbars, inspectors and quote
sidebar to the shared `Alert` component — `OpeningToolbar`,
`LightingToolbar`, `CameraToolbar`, `FixtureInspector`,
`OpeningInspector`, `FrontPicker`, `QuoteFreezePanel`. Deliberately
left alone: informational (non-error/warning) banners, inline hint
spans, the 5 import/export panels' per-row review-grid errors, and the
two canvas overlay banners (`CollisionWarningBanner`,
`CabinetClearanceWarningBanner`) — see `docs/DECISIONS.md` §16 for the
full list and why.

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
managers for finishes, handles, fixtures, cabinets and appliances ·
shadcn/ui component library (every button, toasts, an in-app confirm
dialog, a first four-states pass) · material cost priced by area and
substrate, alongside labour, not just a flat catalogue number.

## Not built

- **Self-serve sign-up for a second business.** One business exists
  today, created via a manual step (`docs/SUPABASE_SETUP.md`).
- **Shared/global catalogue toggle.** Requested, deferred — see
  `docs/PRINCIPLES.md`'s "Open decisions" for the shape.
- **The real panel model.** Material cost is now an area estimate
  (not just labour), but still an ESTIMATE — no exact per-panel
  dimensions, so no cutting list is possible yet.
- **Rectilinear room shapes.** Rectangle plus pillars only.
- Present mode, board nesting.

## Known unverified

- The QuoteSidebar reorder and the new `Alert`-based error/warning
  boxes (`docs/DECISIONS.md` §16) are `tsc`/`eslint`-clean but not yet
  seen rendered in a browser.
- Nine open items in `docs/DECISIONS.md` §8, mostly about textures and
  finish scaling.
- The Excel import/export's browser download flow (as opposed to
  upload/parse/validate/commit, which you've now driven for real
  through the UI for all 5 catalogues, including the delete-column
  path) has only been clicked through for cabinets. Obstacles/
  appliances/handles/fixtures were uploaded from files this session
  generated directly, not from a file freshly downloaded from the app
  in the browser first.
- Material cost by area, fabrication/others rates, per-project margin
  (distributed across every line, not a separate line), and
  `unitPrice` no longer feeding pricing at all (`docs/DECISIONS.md`
  §13-15) are all verified numerically (standalone scripts confirmed
  each formula by hand) and `tsc`/`eslint`/`vite build`-clean, but
  `RateCardManager`'s new fields and `QuoteSidebar`'s margin input +
  Cost/Selling toggle have not been seen rendered in a browser, and
  `schema.sql`'s new columns (`material_rates`,
  `fabrication_rate_per_unit`, `others_rate_per_unit` on `rate_cards`;
  `margin_percent` on `layouts`) have not been run against a live
  database.

## In progress

`docs/ISSUES.md` is currently empty — real-use bug reports get logged
there as they come up. Just shipped: undo/redo, autosave, quote export
(PDF + hosted WhatsApp link), business isolation (auth + RLS), Excel
import/export with an explicit delete column for all five catalogues,
a schema.sql idempotency fix (re-running it after RLS went live was
breaking every seed insert — see `docs/DECISIONS.md` §9), the shadcn/ui
component library sweep, and real cost-basis pricing — material by
area/substrate, per-cabinet fabrication/others rates, `unitPrice`
demoted to a pure display reference, and margin as a distributed,
per-project figure edited next to the quote itself
(`docs/DECISIONS.md` §13-15, not yet run against a live database).

## Blocked

- **The panel model** waits on the carpenter's construction convention:
  is the bottom panel captured between the sides, or sitting on them?
  Is the back grooved in or nailed on?
- **Board nesting** waits on real supplier sheet sizes and thicknesses.

## Next

Foundations, inventory import/export, business isolation, and the
button-migration slice of the component library are all confirmed
working end to end. Open next steps: re-run `schema.sql` against a
live database (picks up `material_rates`/`fabrication_rate_per_unit`/
`others_rate_per_unit` on `rate_cards` and `margin_percent` on
`layouts`), upload `final-catalogues/cabinets-reference-price.xlsx`,
click through the new Rate Card fields and the QuoteSidebar margin
input/Cost-Selling toggle in a real browser, then the four states on
the remaining screens and consistency rules beyond button colour.
Full roadmap in `docs/PRINCIPLES.md`, Part 2.
