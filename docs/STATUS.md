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

Roadmap item 8's first-run checklist is now built: `FirstRunChecklist`
on the dashboard walks a new business through add rates → import
catalogue → create first customer, each step computed from real state
(not a flag), dismissible per business via `localStorage`. See
`docs/DECISIONS.md` §17.

Roadmap item 8 is now DONE, scope confirmed with you rather than
assumed: every native select/checkbox in the 2D canvas's inspectors
and toolbars migrated to shadcn `Select`/`Checkbox` (a real trap along
the way — Radix rejects an empty-string item value, so several
"unspecified"/"none" options needed sentinel values), and real
`Skeleton` loading states added to the 3 catalog-driven toolbars
(`CabinetToolbar`, `ApplianceToolbar` already had a plain-text loading
branch, promoted; `LightingToolbar` had none at all — a real gap, now
fixed). `InventoryManager`'s tables and the 5 Excel import/export
review grids keep native controls on purpose — dense editing surfaces,
not an oversight. See `docs/DECISIONS.md` §18.

New feature (item 10's cabinet-library-breadth line): glass fronts,
four tints (clear/black/brown/yellow), now on single-door, double-door,
drawers AND open-shelf — all-or-nothing per front ("double door,
brown-tint glass" means both leaves), priced separately by tint
(`RateCard.glassRates`, ₹ per sq ft) and rendered as real
transparent/tinted glass in the 3D view — not just a visual flag, the
same door-swing hardware (hinges, handle, single/double split by
width) a board front of the same kind gets; drawers keep their own
channel hardware. Available on a plain front and on a row inside a
'mixed' front. A real double-charge caught along the way: material and
finish were being charged on top of the glass rate for the SAME area —
fixed by reducing `materialArea`/`finishedAreaSqM` by the glass
panel's own area (`docs/DECISIONS.md` §20 — this had already shipped
in §19 for open-shelf, caught and corrected before either was ever
committed). Verified numerically against the real `calculateBOM`/
`computeFrontBreakdown` for every kind (hinge/channel counts unaffected
by material, material/finish reduced by exactly the glass area,
glassCost correctly priced by tint; a mixed front mixing a glass row
and a board row correctly isolated each). Known simplification, not
fixed: the carcass behind a glass single/double-door/drawers front
stays sealed (unlike open-shelf, which is genuinely open) — see
`docs/DECISIONS.md` §20 for why that's a deliberate open question, not
an oversight.

Item 8's last deferred piece is also done now, asked for explicitly:
every remaining native select/checkbox — `InventoryManager`'s three
catalogue tables (cabinets, obstacle presets, appliances) and all 5
Excel import/export review grids — migrated to shadcn `Select`/
`Checkbox`, same mechanical pattern §18 already established (sentinel
values for "nothing chosen", `String(...)` for numeric selects,
`disabled` passed straight through). One deliberate non-change:
`ObstaclePresetImportExport`'s floor-to-ceiling column stays a yes/no
`Select` rather than being switched to match `InventoryManager`'s own
checkbox for the same field — this was a control-type conversion
pass, not a redesign of which control each field uses. See
`docs/DECISIONS.md` §21.

Roadmap item 8's remaining two pieces, done together: **consistency
rules**, audited rather than assumed — a scan of every toolbar/
inspector/dashboard panel found the app was already overwhelmingly
consistent in practice (one real drift found and fixed: this same
session's own `FirstRunChecklist` heading), so the scale is now
written down in `docs/PRINCIPLES.md` rather than left implicit; and
**keyboard** — a new `useSelectionShortcuts` hook adds Delete/
Backspace (remove whatever's selected), Escape (deselect) and arrow
keys (nudge a cabinet/obstacle/appliance — 10mm plain, the room's own
grid step with Shift), all gated to the 2D canvas view only so a stale
selection from another screen can't silently act on it. New shared
geometry helper `nudgeFootprint` (`lib/footprint.ts`), verified against
a plain cabinet, one already near the room edge, and a rotated one.
See `docs/DECISIONS.md` §22.

Roadmap item 10 (cabinet library breadth): pantry, tandem and wicker
baskets. Pantry needed a real new `ModuleType` (`'pantry-unit'`, its
own multi-tier wire-basket default front) — a catalogue-row-only first
attempt was caught losing its front configuration silently on the
Excel round trip (`frontLayout` is deliberately excluded from that
format) before it ever shipped. Tandem was already fully priced (every
`drawer-unit` row already gets tandem-box-rate channels), so this
added a genuinely new width (1200mm) instead of a same-size duplicate.
Wicker baskets are the pantry unit's own basket hardware, not a
separate priced product. Two new starter-catalogue rows, verified by
round-tripping the regenerated xlsx through the real parser and
front-breakdown functions. See `docs/DECISIONS.md` §23.

Roadmap item 12 (kitchen-specific checks): aisle width, sink-to-hob
distance, hob-not-under-a-window, a landing counter beside the hob,
and chimney-centred-on-hob — a new advisory-only `lib/kitchenChecks.ts`
and a third amber banner (`KitchenChecksBanner`) alongside the
collision/clearance ones, its own show/hide toggle. A real bug caught
by a constructed-scenario verification script before it shipped: reusing
`surfaceAreas.ts`'s edge-based `isAgainstWall` for "which wall is this
against" turned every ordinary single-wall counter run into a phantom
second run at the room's corners; fixed with a separate,
centre-distance-based `nearestWall` test that has no such ambiguity —
confirmed against a one-sided layout, a genuine L-shaped kitchen, and
independent north-south/east-west galleys. No full work triangle
(sink/hob/fridge) — this app has no fridge `ApplianceType`, so only the
sink-hob leg is checked, stated as a known gap rather than faked. See
`docs/DECISIONS.md` §24.

A second real false-positive, caught by you in the browser this time,
not a constructed scenario: "no counter beside the hob" fired even
with base cabinets on both sides — the adjacency tolerance (60mm,
borrowed from a "does this touch the wall" test) was far stricter
than a normal installation gap. Widened to 150mm and confirmed against
your actual layout. See `docs/DECISIONS.md` §24 (corrected in place).

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
dialog, a full four-states pass, every native select/checkbox in the
whole app — inspectors, toolbars, InventoryManager, all 5 Excel review
grids — migrated to shadcn) · material cost priced by area and
substrate, alongside labour, not just a flat catalogue number · glass
fronts (single-door, double-door, drawers, open-shelf), four tints,
priced separately by tint and rendered as real tinted glass in 3D ·
keyboard shortcuts (Delete/Backspace, Escape, arrow-key nudge) for
whatever's selected on the 2D canvas · a pantry pull-out cabinet
(its own ModuleType, wire-basket trolley front) and a wider tandem
drawer bank · kitchen-ergonomics advisory checks (aisle width,
sink-hob distance, hob-under-window, landing counter beside the hob,
chimney centring) as a third canvas banner.

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

- Manual horizontal/vertical override for gola/edge-profile on doors
  (single-door/double-door, per row in a mixed front) —
  `docs/DECISIONS.md` §26. Verified numerically; not yet seen in a
  browser.
- Gola/edge-profile handles on a trolley front now go vertical instead
  of horizontal-top, and both now sit inset within the panel rather
  than straddling its edge (`docs/DECISIONS.md` §25) — confirmed
  fixed and visible in a browser.
- Kitchen ergonomics checks (`docs/DECISIONS.md` §24) — every geometry
  rule is verified against constructed scenarios (including the one
  that caught a real corner-ambiguity bug before it shipped), but a
  constructed scenario isn't a real layout; this is the piece most
  worth clicking through in a browser, more so than most of this
  session's work, since wall-geometry assumptions are exactly what a
  real layout tests harder than any number of hand-built test cases.
- Keyboard shortcuts (`docs/DECISIONS.md` §22) — Delete/Backspace,
  Escape, arrow-key nudge. Easy to get subtly wrong in ways only a
  browser catches (focus stealing, a shortcut firing where it
  shouldn't); `nudgeFootprint`'s own geometry is verified, the keybinding
  wiring isn't.
- The new pantry-unit cabinet (`docs/DECISIONS.md` §23) — verified
  that it round-trips the Excel format and resolves to the right
  front/hardware, not yet seen placed and rendered in the 3D view.
- Glass fronts — single-door, double-door, drawers, open-shelf
  (`docs/DECISIONS.md` §19-20) — a genuinely new visual (transparent/
  tinted 3D material) and a new form (the glass toggle + tint picker
  in Front Picker), not a markup swap. Pricing is verified numerically
  against the real formula; not yet seen rendered in a browser.
- The `Select`/`Checkbox` migration — now covering the inspectors,
  toolbars, `InventoryManager`'s catalogue tables and all 5 Excel
  review grids (`docs/DECISIONS.md` §18, §21) — and the 3 toolbars'
  new `Skeleton` loading states are the one piece of this session most
  worth clicking through before trusting it — a popover-based `Select`
  changes real interaction mechanics (keyboard, focus, click targets)
  versus a native `<select>`, not just markup, and this now touches
  the densest, most-edited screens in the app. Not yet seen in a
  browser.
- The `Alert`-based error/warning boxes (`docs/DECISIONS.md` §16) are
  `tsc`/`eslint`-clean but not yet seen rendered (or triggered) in a
  browser.
- Nine open items in `docs/DECISIONS.md` §8, mostly about textures and
  finish scaling.

## In progress

`docs/ISSUES.md` is currently empty — real-use bug reports get logged
there as they come up. Just shipped and confirmed working end to end:
`schema.sql`'s new columns (`material_rates`, `fabrication_rate_per_unit`,
`others_rate_per_unit` on `rate_cards`; `margin_percent` on `layouts`)
run against the live database; `final-catalogues/cabinets-reference-
price.xlsx` and the equivalent files for obstacles/appliances/handles/
fixtures uploaded and verified for all five catalogues; the
`FirstRunChecklist` seen rendering correctly on the dashboard. Also
shipped this session: undo/redo, autosave, quote export (PDF + hosted
WhatsApp link), business isolation (auth + RLS), Excel import/export
with an explicit delete column for all five catalogues, a schema.sql
idempotency fix (`docs/DECISIONS.md` §9), the shadcn/ui component
library sweep including roadmap item 8's full close-out (four states,
`Alert`-ified errors, the first-run checklist, and the Select/Checkbox
migration — `docs/DECISIONS.md` §16-18), and real cost-basis pricing
(`docs/DECISIONS.md` §13-15).

## Blocked

- **The panel model** waits on the carpenter's construction convention:
  is the bottom panel captured between the sides, or sitting on them?
  Is the back grooved in or nailed on?
- **Board nesting** waits on real supplier sheet sizes and thicknesses.

## Next

Foundations, inventory import/export, business isolation, real
cost-basis pricing, roadmap item 8 (component library, the four
states, consistency rules and keyboard — all fully done), item 10
(cabinet library breadth), and item 12 (kitchen-specific checks, minus
the fridge-dependent full work triangle) are all built. Item 6 (real
rates) remains explicitly deferred by you in favour of the others.
Nothing this session has been seen in a browser yet — that's the
single biggest open item, not any particular remaining feature. Open
next, roughly in order of how much a browser click-through would
de-risk: the kitchen ergonomics checks and keyboard shortcuts (newest,
least exercised), the Select/Checkbox migration and glass fronts
(from earlier this session), then whatever Phase 3 item you want after
that — appliance-dimensions-first, rectilinear rooms, present mode, or
the remaining Phase 4 production items (board nesting, cutting list,
hardware boring). Full roadmap in `docs/PRINCIPLES.md`, Part 2/3.
