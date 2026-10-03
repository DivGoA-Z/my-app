# Status

**The bridge between the repo and planning conversations.**

Claude Code updates this at the end of each working session. When
starting a planning conversation in the Claude Project — which cannot
see this repo — paste this file in. It is the only thing that needs to
travel.

Keep it short. It is a snapshot, not a history; `docs/DECISIONS.md` is
where reasoning is recorded and `git log` is where the history is.

---

**Last updated:** 29 Sep 2026

## Where things stand

**New, confirmed working end-to-end**: "Freeze & send" never actually
sent anything — freezing writes the quote immediately, and the two
export buttons that appeared afterward (Download PDF, Share on
WhatsApp) never recorded anything back, so the button's own label was
false. Fixed with a new `sent_at` timestamp on `quotes` (needs a
`schema.sql` re-run), set only by Share on WhatsApp (Download
deliberately doesn't count — that's the designer grabbing a copy, not
evidence of delivery; true delivery confirmation isn't possible at
all, since a `wa.me` link has no callback once the tab opens). The
button is renamed "Freeze quote" now that it doesn't claim to send;
the sidebar shows "Sent on WhatsApp {date}" or an amber "Not yet
sent"; the dashboard's quote-history dropdown only lists quotes that
were actually shared, not just frozen. Confirmed live — including a
real ~13% current-vs-frozen total gap that turned out to be a genuine
priced-input change (most likely margin %), not a bug, resolved by
freezing v3. See `docs/DECISIONS.md` §34.

**New, code complete, NOT yet seen in a browser — the panel-model
block reframed (items 1–3 of last session's plan)**:

1. **Principle 2 changed** in `docs/PRINCIPLES.md`: pricing is
   area-based *permanently*; the panel model is a production
   (cutting-list) concern only and no longer blocks pricing. The old
   text is kept, marked superseded.
2. **One "Labour and other charges" list** on the rate card replaces
   the separate labour, fabrication and "other" fields. Pre-filled
   with site installation (₹/sq ft) and fabrication (₹/cabinet); each
   row picks per sq ft / per cabinet (default) / lump sum (once per
   project), and a **Show on quote** tick — ticked rows print as their
   own line, unticked ones combine into "Other". Existing values
   migrate on load, so no total moves. (`docs/DECISIONS.md` §35, §37,
   §38.)
3. **Sheet waste factor**: business default on the rate card, blank-
   means-default override per project in the quote sidebar. Multiplies
   material (substrate) cost only. Seeded at 1 (no waste) so no open
   quote moves — set your real figure (e.g. 1.10).

4. **Project-level override** of the whole charges list in the quote
   sidebar: follows the business rates until "Customise for this
   project", then every rate-card option plus an **Add margin** tick
   (untick for a fixed price — ₹20k stays ₹20k; the rate card has the
   same tick, §40). "Reset to business
   rates" undoes it. Replaced the earlier separate "Project charges"
   box, whose saved data still prices correctly. `docs/DECISIONS.md`
   §36, §39.
5. **Rate card Save button fixed** — it was at the bottom of a long
   form and never seen, so rate edits were never saved. Now a Save
   button at the top of the rate card, plus a sticky amber bar at the
   bottom while there are unsaved changes.

**Before using it: re-run `supabase/schema.sql`.** A new
`construction_settings` table, `rate_cards.board_rates`,
`rate_cards.default_back_board_id`, `cabinet_catalog_items.panels`, and
five more new nullable columns (`rate_cards.others_rates`, `rate_cards.sheet_waste_factor`,
`layouts.sheet_waste_factor`, `layouts.project_charges`,
`layouts.charge_rates`); until they exist, **autosave and rate
saves fail** (reads are fine). Expect existing frozen quotes to read
"design has changed" once — the rate card gained fields, no total
moved. See `docs/DECISIONS.md` §35.

**New, NOT yet seen in a browser — cutting list, phase 1**
(`docs/DECISIONS.md` §41): a **Cutting List** screen (button beside
Present) listing every carcass, back and front part per cabinet —
size, thickness, quantity, edge banding, grain — "for cutting" or "by
cabinet", with Excel export. Built on new **Construction settings**
(Manage Inventory, under the rate card): every carpenter decision is
selectable with all its alternatives, pre-filled with the common
convention, and marked **assumed** until you tick "my carpenter has
confirmed". Not yet listed: drawer boxes, tambour, glass (noted), the
corner carousel's diagonal shape (flagged). Dimensions checked by
running the real code on sample cabinets against hand arithmetic —
not yet against a carpenter's own list.

**New, NOT yet seen in a browser — board lines and real-area pricing**
(`docs/DECISIONS.md` §42, steps 1–4 of the 2 Oct plan):
- Rate card **Boards**: one line per material × thickness × ₹/m²
  (HDMR 18mm, HDMR 6mm…) plus a default back board. Old rates carried
  over as 18mm lines; **HDMR 6mm ₹450 is a guess — check it.**
- Every cabinet has a per-panel spec (each side, top/rails, bottom,
  back, shelves, fronts: included? which board?), catalogue default,
  cabinet override, all included by default. Edited in the Cabinet
  Designer (below).
- **Board is now priced on real area** from the cutting list's parts.
  A typical base unit's material goes ~₹907 → ~₹2,567. **Every open
  quote's material line rises ~2.5–3×** — recheck board rates and the
  fabrication charge against invoices. Principle 2 reworded to match
  (rule unchanged: price by real area).
- **Check-in point (as agreed): look at a real project's new prices
  before step 5 starts.**
- Follow-ups from your review (§43): construction settings moved to a
  separate **Workshop settings** page (they move price by ₹0–30, not
  meaningfully); "full top vs rails" moved to the cabinet's own top
  panel (it moves price ~₹300); a board line in use **can't be deleted**
  — the rate card names the projects/catalogue rows using it; cabinet
  Material dropdowns offer **only priced boards**, plus "+ Add a new
  board…" which saves the line to the rate card.
- (§44) Cabinets now pick an exact **board line** ("HDMR 18mm —
  ₹1,400/m²") instead of just a material, with the back board shown
  under it. Workshop settings are formally optional — **Principle 12**:
  designing and quoting never need them.

**New, NOT yet seen in a browser — the Cabinet Designer** (§45): open
it with **"Panels & boards…"** on a catalogue row (product defaults) or
in the cabinet inspector (that cabinet only). Tick which panels are
built, pick a board per panel, full top or rails; parts and board cost
update live from the same code the quote uses. From a placed cabinet,
apply its board to every cabinet in the kitchen, or its panels to every
cabinet of the same type — one undo step each.

**New, NOT yet seen in a browser — 3D preview in the Designer** (§46):
the cabinet drawn as its actual panels at real cut sizes, coloured by
board; untick a panel and it disappears. Show/hide fronts, pull panels
apart; hover a row to light its panel, click a panel to find its row.
**Also fixed (§46):** the catalogue reloaded on every browser-tab switch
(keyed on the session object, which Supabase replaces on tab focus) —
now loads once per signed-in user; returning from the Designer keeps
your scroll position.

**New (§47), not seen in a browser:** Workshop settings gained **"Cabinet
depth means…"** (includes the shutter — default — or carcass only), the
top's corner rule now covers rails too, and once you tick "my carpenter
has confirmed" and save, the page **locks** (deliberate "Change
settings" to unlock). Edge banding now counts only customer-facing
edges — newly, the bottom edge of wall-cabinet sides.
**Known gap:** with "carcass only", the 2D plan / 3D view / collision
still draw the cabinet 18mm shallower than it really is — only the
cutting list and price follow the setting.

**New (§48), not seen in a browser — adding to the cutting list:** the
list is still never edited directly (it sets the price), but now:
**extra shelves** in any cabinet (Designer → Shelves row), **extra parts**
on a cabinet (Designer → Extra parts), **loose parts** for the project —
fillers, plinth, end panels (Cutting List page) — all listed AND priced
at their board's rate; every C-number on the cutting list opens that
cabinet in the Designer. **Fixed a shelf double charge** from §42: the
₹350 "shelf" hardware line now means supports & fitting only, ₹80
placeholder.

**New (§49), not seen in a browser — sheet nesting:** Cutting List →
**Sheets & waste** lays every board's parts on 8×4 sheets (guillotine
cuts a panel saw can follow), draws each sheet, and measures ONE waste
factor — total sheets bought ÷ parts area, every sheet counted (a
typical kitchen: ×1.45; §51). One click puts it on this project's
quote. Excel export gains a Sheet layout tab. **Sheet waste on quotes**
is now a switch on the rate card (§53): **Approx** (default) — one
experience-based factor everywhere; **Calculated** — each board line's
waste measured from that project's sheet layout, used automatically
(on the test kitchen it priced board exactly at what the sheets cost).
**Sheet sizes are set
per board on the rate card** (any number per board, default 8×4; the
nesting picks among them — §52); saw cut and edge trim are Workshop
settings with defaults. Each sheet drawing has
dimension lines with arrows — the sheet's size outside, every piece's
length and width inside (§50). **The real test: compare its sheet count
with your carpenter's on a real job.**

**Checkpoint, later the same day**: you went through last session's
unverified items live in the browser. Present mode, glass fronts,
gola/edge-profile handles, keyboard shortcuts, and the kitchen
ergonomics checks (including the corner-ambiguity fix) all confirmed
working. That pass surfaced real follow-on work, all shipped and
build-clean: a fridge work-triangle check (`checkFridgeDistances`),
Cmd+C/Cmd+V cabinet/obstacle/appliance duplication, a real gap fix (a
cabinet's door could open straight into a wall with no warning — now
caught), and a full rewrite of the warning UI: one `DesignAlertsPanel`
replacing three separate aggregate-count banners, showing a real
explanation per alert and filtering to whatever's currently selected.
See `docs/DECISIONS.md` §32.

**Done, after the checkpoint above and real back-and-forth testing**:
the cabinet door-swing conflict check now uses the TRUE quarter-circle
arc everywhere (detection AND the on-screen arc, one shared geometry
function — including a `'mixed'`-front door row, which used to always
fall back to a plain rectangle). Two real bugs turned up and got
fixed along the way, both caught by insisting on precision rather than
accepting a screenshot-level guess: a backwards overlap-tolerance
epsilon that flagged every ordinary edge-to-edge adjacent cabinet pair
as conflicting (caught by a script before you ever saw it), and — the
one that mattered most — a third report that turned out NOT to be a
bug at all, confirmed by you actually nudging a cabinet and watching
the alert correctly clear. See `docs/DECISIONS.md` §33 for the full
sequence; worth reading before touching this file again, since it's
exactly the kind of area (rotation/arc geometry) with a repeat bug
history in this codebase.

The rest of this session's earlier work, for context:

This session closed out three Phase 3 roadmap items and deferred a
fourth, your call on each:

**Present mode (item 13) is done** — a new `'present'` screen
(`PresentMode.tsx`), reached via a new "Present" button next to "3D
Preview". Not a stripped copy of the editing screen: a 3D walkthrough
sub-view (reuses `Room3DCanvas` unchanged) and a new floor-plan
sub-view (no grid/dimensions/warnings/toolbars/inspectors, pointer
events disabled so a stray click can't drag a cabinet mid-
presentation), plus a designer-tapped price reveal that now also shows
a category breakdown matching `QuoteSidebar`'s Selling view exactly
(Material, Finish, Floor/walls/ceiling, Countertop/slab, Hardware,
Labour, Fabrication, Other, Glass doors, Appliances, Grand Total — all
rows QuoteSidebar has, not just the ones visible on your current
project, so it stays correct if you ever enable countertop pricing).
See `docs/DECISIONS.md` §28, §30.

**Appliance-dimensions-first (item 11) is in progress, scope agreed
with you** — `ApplianceType` widened from 6 to 10 values: added
`fridge`, `microwave`, `dishwasher`, `water-purifier`, each with a
starter-catalogue row at realistic Delhi NCR dimensions. This was the
smaller of two possible scopes — the larger one, cabinet cutouts
actually sized to a placed appliance, is still open. `fridge`
specifically unblocks a real sink/hob/fridge work triangle in
`kitchenChecks.ts`'s existing sink-to-hob check, deliberately not
built this pass. Also corrected a stale code comment claiming sink
cutouts are never modelled — untrue since `sinkCutoutWidthMm`/
`sinkCutoutDepthMm` and `CountertopMesh`'s real cutout rendering were
built in an earlier session. See `docs/DECISIONS.md` §27.

**The visual assets work (item 14) is done**, and needed far less than
`VISUAL_ASSETS_PROMPT.md` assumed — finish scale/relief, window
backdrops, and lazy texture loading were already fully built in an
earlier session that never got folded back into that brief. Real
remaining work closed this pass: the already-fetched HDRI is now wired
into `<Environment>` alongside the existing Lightformer rig (not
replacing it); the sink/chimney box-fallback geometry now uses real
brushed-steel maps; and the pendant fixture's `.glb` is now actually
rendered (`FixtureModel.tsx` existed, `FixtureInScene` just never
called it). Two now-redundant scratch SQL scripts folded into
`schema.sql` and deleted — one had a real bug caught in the process,
`on conflict do update` instead of `do nothing`, which would have
overwritten a business's own edited catalogue row on every re-run.
Handle texture maps deliberately skipped — no browser available to
make the brief's own "does flat color already look convincing" call.
See `docs/DECISIONS.md` §29.

**Rectilinear room geometry (item 9) was scoped, then deferred, your
call.** Three research passes mapped every rectangle-specific site —
~15-20 files, several with genuinely tricky geometry (the drag-clamp
across a concave corner especially). A multi-session foundation
rewrite for a feature whose customer value isn't validated yet; full
scope kept in a plan file rather than re-derived later. See
`docs/DECISIONS.md` §27.

**Follow-up confirmed in a browser this session**: the HDRI and the
sink/chimney metal textures are both visibly taking effect. The
pendant model was NOT confirmed rendering — still showing the old
primitive stem+disc in the screenshot checked, most likely because the
placed fixture is still the original `fix_pendant` catalogue row (no
model) rather than the new `fix_pendant_industrial` row, and/or
`schema.sql` hadn't been re-run against the live project yet. Worth
checking once `schema.sql` is re-run and the new fixture is placed.

**A documentation-integrity detour, self-corrected before it left the
repo, no code involved.** `docs/Issues.md` said "(none currently
open)"; a first pass this session concluded that was wrong, moved 20
items from a mislabeled file (`docs/Issues_fixed.md` — its name said
"fixed," its content read like an undated open list) into `Issues.md`
as the real open list. That was itself wrong: cross-checking each of
the 20 against `docs/ISSUES-FIXED.md` individually found every one
already had a matching dated fix or "investigated, not a bug" entry
from 21-23 Sep. `Issues_fixed.md` was the ORIGINAL raw complaint list
from before that triage process, never cleared out even though
nothing on it was still open. Reverted: `Issues.md` is back to "(none
currently open)", with a note on both rounds; the stale file stays
deleted, since every item on it is already logged with a real
resolution in `ISSUES-FIXED.md`. Full account in `docs/DECISIONS.md`
§31, corrected in place rather than silently rewritten.

## Built and working

2D plan (room, obstacles, cabinets, appliances, doors and windows, light
fixtures, overlap picker, unified selection, clearance and collision
detection) · parametric cabinet fronts with derived hardware · 3D
walkthrough with camera nodes and 360° panorama capture, HDRI +
Lightformer environment lighting, real metal textures on sink/chimney
fallback geometry · three lighting modes with exposure control ·
itemised quote with a global electrical toggle · rate card · quote
freezing and revisions · quote export (PDF + hosted WhatsApp link) ·
undo/redo (Cmd+Z/Cmd+Shift+Z) and autosave · real auth + per-business
RLS on all ten tables (with a super-admin bypass for the software
owner) · Excel import/export for all five catalogues (download, edit,
upload, validate, fix inline, commit) · customer pipeline dashboard ·
Supabase persistence · inventory managers for finishes, handles,
fixtures, cabinets and appliances · shadcn/ui component library
throughout · material cost priced by area and substrate · glass fronts
(single-door, double-door, drawers, open-shelf), four tints, rendered
as real tinted glass in 3D · keyboard shortcuts (Delete/Backspace,
Escape, arrow-key nudge) on the 2D canvas · a pantry pull-out cabinet
and a wider tandem drawer bank · kitchen-ergonomics advisory checks
(aisle width, sink-hob distance, hob-under-window, landing counter
beside the hob, chimney centring) · **present mode** — a customer-
facing 3D/floor-plan view with a designer-controlled price reveal and
breakdown · **fridge/microwave/dishwasher/water-purifier** appliance
types with starter-catalogue rows · pendant fixture `.glb` rendering
and a second real-shade pendant catalogue option.

## Not built

- **Self-serve sign-up for a second business.** One business exists
  today, created via a manual step (`docs/SUPABASE_SETUP.md`).
- **Shared/global catalogue toggle.** Requested, deferred — see
  `docs/PRINCIPLES.md`'s "Open decisions" for the shape.
- **The real panel model.** Material cost is an area estimate, not
  exact per-panel dimensions, so no cutting list is possible yet.
- **Rectilinear room shapes.** Rectangle plus pillars only — scoped in
  full this session, then explicitly deferred (see above).
- **Cabinet cutouts sized to a placed appliance's real dimensions** —
  the larger half of item 11; only the appliance-type/dimension data
  itself was added this pass.
- **Sink/hob/fridge work triangle check** — `fridge` now exists as an
  `ApplianceType` specifically to unblock this, but `kitchenChecks.ts`
  still only checks the sink-hob leg.
- Board nesting, cutting list, hardware boring (Phase 4) — see
  Blocked, below.

**New (§58): edge banding by the metre** — rate card "Edge banding (₹ per
running metre)", charged on the cutting list's exact metres. ₹0 by
default so nothing double-charges; when you set it, remove the per-sq-ft
edge-banding row from Labour & other charges (the rate card warns).

**New (§57): fronts are cut from the carcass board** by default (Workshop
setting; alternative: pre-laminated sheets). They share its sheets and
can turn, saving a sheet on the test kitchen (12 vs 13).

**New (§56): drawer boxes** are on the cutting list and priced — tandem
(bottom + back per drawer) or wooden (sides, inner front & back, grooved
bottom), sized by Workshop settings; untick "Drawer boxes" in the
Designer when bought ready-made. A 3-drawer 600 unit gains ~₹1,462 of
board that was previously never charged.

## Tests

**`npm test`** (Vitest) — 70 tests on pricing, the cutting list, nesting,
panels and the catalogue importer, ~0.3s (§55). Run before trusting a
change to any of those. UI still has no automated tests.

## Known unverified

- The Cutting List screen, its Excel export and the Construction
  settings editor (§41) — build clean and the sizing maths run under
  Node against hand arithmetic, but not seen in a browser and not yet
  compared with a carpenter's real cutting list.

- Itemised "others" lists and the sheet waste factor on the rate card,
  and the per-project waste override in the quote sidebar
  (`docs/DECISIONS.md` §35) — you've seen the lists render; saving
  rates and seeing the quote move is not yet confirmed. Needs
  `schema.sql` re-run first.
- The project-level charges override and its Add margin tick in the
  sidebar/Present mode/PDF (§39), and the rate card's top Save button
  — build clean, not seen in a browser.

- Present mode (`docs/DECISIONS.md` §28, §30) — both sub-views and the
  price-reveal breakdown are `tsc`/`eslint`/`npm run build` clean, dev
  server confirmed to serve without a startup error, but not clicked
  through in a browser. Worth checking specifically: the floor-plan
  sub-view's `pointer-events-none` actually blocks drag, and the price
  breakdown's conditional rows behave correctly on your project.
- The new appliance types (`fridge`, `microwave`, `dishwasher`,
  `water-purifier`) — round-tripped through the real Excel parser with
  zero validation errors, but their new 2D/3D colours haven't been
  seen placed and rendered.
- The pendant fixture model (`fix_pendant_industrial`) — the model and
  its rotation (0/0/0, a documented guess) haven't been confirmed
  rendering correctly; see the follow-up note above.
- Kitchen ergonomics checks, the Select/Checkbox migration, glass
  fronts, and the manual gola/edge-profile orientation override — all
  carried over from the previous session, still not seen in a browser.
  See `docs/DECISIONS.md` §18-21, §24, §26.
- Nine open items in `docs/DECISIONS.md` §8, mostly about textures and
  finish scaling.

## In progress

`docs/Issues.md` is genuinely empty right now — see the correction
above. Appliance-dimensions-first (item 11) is partially done — the
type/data half is in, the cutout-sizing half and the fridge
work-triangle check are both open follow-ups, not started.

## Blocked

- **Nothing in Phase 4 is blocked any more.** The carpenter's
  construction convention is now a set of settings (every alternative
  selectable, defaults labelled "assumed" until confirmed), so the
  cutting list and nesting build on those. The carpenter still needs to
  CONFIRM the settings before anything is actually cut — a check, not a
  blocker. Pricing was already unblocked (Principle 2, area costing is
  permanent).

## Next

**First**: re-run `schema.sql`, then look at the rate card's new
"Other costs" lists, the waste factor, and the sidebar override in the
browser. Then build the standalone waste calculator (plan item 4).

Earlier backlog, unchanged: Phase 3 items 9, 11, 13, 14 are now scoped and either done (13, 14) or
partially done and explicitly deferred/scoped (9, 11). Nothing from
this session has been seen in a browser except the HDRI/metal-texture
follow-up — that remains the single biggest open item: present mode's
two sub-views and price breakdown, the four new appliance types placed
and rendered, and the pendant model's actual orientation once
`schema.sql` is re-run against the live project. `docs/Issues.md` is
genuinely empty (see the correction above) — nothing there to triage.
After that: the fridge work-triangle check,
appliance-driven cabinet cutouts, and — once the panel-model question
is answered — all of Phase 4. Full roadmap in `docs/PRINCIPLES.md`,
Part 2/3.
