# Principles

What this product is, and the rules that settle arguments about it.

Read this before `docs/DECISIONS.md`. That file records what was decided
and why; this one records what we're *trying to be*, which is what makes
future decisions decidable.

**Status: drafted 17 Sep 2026, from three answers that changed the scope
of the project.** Everything below follows from them, so if any of the
three changes, revisit this whole file.

---

## What this is

A kitchen design, quoting and production tool, **sold to interior
businesses in India**, starting with Delhi NCR.

Three scope decisions, made deliberately:

1. **Multi-tenant.** Other firms use it, each with their own catalogue,
   rates, customers and designs. Not a single-business internal tool.
2. **Sales *and* production.** It produces both a customer-facing quote
   with renders, and a millimetre-exact cutting list the workshop cuts
   from.
3. **Laptop-first** — showroom or office. Not a site tablet. This is the
   one merciful constraint, and it's what keeps the 3D walkthrough
   affordable.

The first two are the ambitious ones and they are the reason the rest of
this document exists.

---

## The principles

Ten rules. Each one is here because it settles a question that would
otherwise be re-argued every few weeks.

### 1. The price shown to a customer must never be wrong

The deepest rule in the codebase and the reason for several existing
design decisions: one calculation feeds both the drawing and the quote,
so they cannot disagree; a sent quote freezes; `calculateBOM` takes a
required context so a missing input is a compile error rather than a
silently cheaper quote.

Everything else in the app may be approximate. This may not.

### 2. Price by real area

**Wording corrected 2 Oct 2026** — the rule is unchanged, the text was
wrong in two places (see "Correction, 2 Oct" below). **Changed 29 Sep
2026.** This principle used to be "Panels are the unit
of truth" and said the panel model would *replace* area-based costing.
That is no longer the plan — the original text is kept below, marked
superseded, because the reasoning behind it was sound and the reason it
was dropped is the useful part.

Price is `area × rate`, computed fresh from each cabinet's own
dimensions on every quote, using **the area that is really there —
never less.** **That is the permanent pricing method, not a stopgap.**
It never needs a fixed size table, so there is nothing to re-derive.

Board area is the real area of each panel the cabinet is actually
built from (only the panels it has; each at its own board's thickness
and rate — `docs/DECISIONS.md` §42), measured by the same panel
breakdown the cutting list uses, so the price and the workshop can
never disagree about a panel. Nothing about pricing may ever wait on
anyone's answer again: the construction convention is a set of
settings with defaults (§41), not a blocker.

> **Correction, 2 Oct 2026.** This section previously said price came
> from `estimateAreaSqFt`/`carcassAreaSqM` — front face plus half a
> side — and that the panel model "does not feed the price". Both were
> wrong against the rule itself. That estimate came to roughly a third
> of the board a cabinet really uses (a 600×600×720 base unit: 0.65 m²
> priced against 1.70 m² of 18mm plus 0.41 m² of 6mm back actually
> cut), which breaks "never less". And "panels don't feed the price"
> was only ever there so pricing wouldn't wait on the carpenter; once
> construction became settings, the panel breakdown was simply the
> best measure of real area. The rule — price by real area × rate — is
> what you set on 29 Sep and is unchanged. Site labour and per-sq-ft
> charges still use the estimated area, which is how the trade bills
> labour; that's a separate question, not settled here.

Why the change: whether the bottom panel sits between or under the
sides moves real panel dimensions by one board thickness (~18mm),
which is invisible in a quote. Waiting on the carpenter's convention
for pricing bought no accuracy anyone would see, and it was blocking
real work. (That same fact is why pricing from the panel breakdown is
safe now: construction settings move the price by a few millimetres'
worth, never meaningfully.)

What makes area pricing honest instead of hand-wavy is saying what it
leaves out, and pricing those things explicitly rather than hoping the
estimate absorbs them:

- **Sheet waste** — a business buys whole 8×4 sheets, not square
  metres. That is a waste factor multiplied into material cost
  (business default, per-project override), not a nesting run on
  every quote.
- **Consumables and handling** — edge banding, glue, nails, packing.
  Itemised on the rate card, per sq ft where it genuinely scales with
  size (edge banding) and per cabinet where it doesn't.

Accurate waste *measurement* — real panels nested onto real sheets —
is a separate, standalone tool that informs the waste factor. It may
use an assumed construction convention, labelled as such
(Principle 10), because a waste *percentage* barely moves on a few mm
of construction detail even though an exact cutting list would.

> **Superseded (17 Sep 2026 text, kept for the reasoning):** "Panels
> are the unit of truth. [...] A cabinet is decomposed into panels,
> and *both* the cutting list and the price derive from that
> decomposition. [...] Consequence: this replaces the area-based
> costing rather than sitting beside it. Doing it later means
> re-deriving every quote the app has ever produced."
>
> The last sentence is what turned out to be wrong: frozen quotes
> carry their own snapshot (`src/types/quote.ts`), so no old quote is
> ever re-derived, and a live quote is re-priced from dimensions on
> every render anyway. There was never a backlog to migrate.

### 3. The catalogue belongs to the business

Nothing about a business's products is hardcoded. Module sizes, finishes,
handles, fixtures, appliances, rates — all editable rows, all per-tenant.
We ship seed data as a *starting point*, labelled as ours.

Already mostly obeyed (`surface_finishes`, `handles`,
`light_fixture_catalog`, `cabinet_catalog_items`). The rate card was the
last violation and is now a table too. Keep it that way: **a fixed
dropdown of business data is a bug.**

### 4. A business can never see another business's data

Multi-tenancy makes this the core security model, not a hardening step
for later. Every table gets a business id; Row Level Security is the
mechanism that enforces it; the anon key ships in the browser so RLS is
the *only* thing standing between tenants.

This is the single most expensive thing to retrofit and the cheapest
thing to add now. See "What's cheap now" below.

### 5. The drawing always states its own dimensions

Measurements are visible by default — not on hover, not behind a click.
A designer sitting beside a customer must be able to read the kitchen
off the screen. This is what makes the tool trustworthy in the room.

### 6. Warn, never block

The designer is the authority. The software flags clearance problems,
collisions, overlapping openings, ergonomic violations — and then lets
them proceed. Real kitchens contain compromises the rules dislike.

Already obeyed. The corollary is that warnings must be *good*, because a
warning nobody can act on trains people to ignore all of them.

### 7. Nothing is ever lost

Autosave, undo/redo, revision history. A design tool without undo does
not feel professional, and no amount of features compensates.

Currently **not obeyed** — there is no undo. This is the largest gap
between the app and the word "professional".

### 8. Two audiences, two views

The screen the designer drives is not the view the customer should see.
The customer view has no grid, no warnings, no inspector panels, and
reveals price when the designer chooses. This is worth more to closing a
sale than any improvement to the render itself.

### 9. Local specificity is the moat

Established competitors exist and have more features. We will not win on
feature parity. We win on being *correct about Indian kitchens*: 6×8 ft
rooms, structural pillars, exposed shafts, cylinder trolleys, sq ft
labour billing, ₹ rates, customer-supplied appliances, WhatsApp as the
delivery channel, electrical work by a separate contractor.

So: when a general-purpose feature and a locally-correct one conflict,
local wins. The market realities in `CLAUDE.md` are the product, not
the constraints on it.

### 10. Approximation is allowed, but never hidden

Where the software estimates, it says so on screen. The amber
placeholder-rates banner in `RateCardManager` is the pattern: the number
is shown, and so is the fact that we made it up.

This is what lets principle 1 coexist with a product that ships. An
honest estimate is usable; a silent one is a liability.

---

## What the three answers change

### Multi-tenant

- Every table needs a business/org id. Ten tables today.
- `rate_cards` currently holds **one row with `id = 'default'`**. That is
  now wrong: one rate card per business.
- RLS goes from "later" to "the security model" (principle 4).
- Auth with organisations, invited users, roles.
- Onboarding: a new business starts with an empty catalogue. Either seed
  per business on signup, or offer a copyable starter catalogue.
- Billing, and a support burden — you will be debugging other firms'
  data without being able to see their site.

### Sales *and* production

- ~~The panel model (principle 2) replaces area-based costing.~~ No
  longer — pricing stays area-based permanently; the panel model is
  for the cutting list only (Principle 2, changed 29 Sep 2026).
- **Construction convention must be decided before modelling panels.**
  Is the bottom panel captured between the side panels, or does it sit on
  top of them? Is the back grooved in or nailed on? These change *every
  panel dimension in the app*. Indian workshops differ, and this answer
  has to come from your carpenter, not from me.
- Edge banding is priced per running metre, per edge, and which edges get
  banded depends on what's visible.
- **Board nesting** — fitting panels onto 8×4 sheets with minimum waste —
  is a genuinely hard problem (2D bin packing). Don't invent an
  algorithm; use a known heuristic and accept it won't be optimal. This
  is what makes material cost accurate rather than estimated.
- Optionally later: hinge boring and channel positions, for CNC output.

### Laptop-first

The good news. Keeps the 3D walkthrough, the texture budget and the
lighting work viable. Revisit only if designs start being made on site.

---

## What's cheap now and expensive later

Do these before feature work, because their cost grows with everything
built on top:

1. **The tenant column**, on every table, even with one tenant. Adding a
   column to ten tables today is an afternoon. Retrofitting tenancy into
   a system with live customer data in multiple firms is a project people
   write postmortems about.
2. ~~**The panel model.** Every feature built on area-estimate costing is
   a feature that has to be re-derived later.~~ Withdrawn 29 Sep 2026 —
   area costing is permanent (Principle 2), so nothing built on it
   needs re-deriving. The panel model is still needed for production,
   but it is no longer cheaper now than later.
3. **Rectilinear room geometry.** Arbitrary 90°-angle polygons instead of
   rectangle-plus-pillars. This touches wall building, surface-area
   costing, opening subtraction, collision and the 3D room. It is a
   foundation, not a feature.
4. **Undo/redo.** Cheap to add to a small command surface, painful to
   retrofit once there are fifty kinds of edit.

---

## The honest sequencing problem

Three foundation rewrites before shipping anything to anyone is how
projects die. But building the exciting half first — libraries, shapes,
realistic appliances — produces a beautiful tool that can't be put in
front of a paying customer, because it has no login, invented prices and
no way to send a quote.

The way through: **run your own business's real jobs through the current
app while making the foundation decisions above.**

That is not a delay. It is the only way to learn things you cannot learn
any other way:

- your carpenter's actual construction convention (blocks principle 2)
- which ergonomic checks designers actually want (principle 6)
- what the cabinet library really needs to contain
- whether the quote format closes sales
- what breaks when a design is used to cut real board

Selling software for a workflow you have not yet run end-to-end is how
you build the wrong thing extremely well.

---

## Open decisions

Needed before the corresponding work can start. Most need real-world
input rather than more thinking.

1. **Construction convention** — from your carpenter. Blocks the panel
   model, which blocks everything about production output.
2. **Board sizes and material stock** — what sheets do your suppliers
   actually sell, in what thicknesses? Blocks nesting.
3. **Edge banding rules** — which edges get banded, at what rate.
4. ~~Does a tenant get isolated catalogues, or a shared starter they
   fork?~~ **Answered, not yet built**: both — isolated by default,
   with a per-business toggle to also see a shared/global catalogue.
   Needs an `is_global` column on the catalogue tables and a
   `business_settings.show_global_catalog` flag; deferred until a
   second real business exists to need it (see `docs/DECISIONS.md`,
   the auth/RLS entry).
5. **Pricing model for the SaaS itself** — per seat, per business, per
   quote? Affects nothing technical yet, everything commercially.
6. **Who is the first paying customer that isn't you?** The answer
   usually reorders this entire document.

---

## What I cannot validate

Stated plainly, because this file will be read as authoritative.

I have no access to the Indian modular kitchen market, your competitors'
pricing, or what interior firms will actually pay for. Principle 9 (local
specificity as the moat) is a reasonable strategic bet, not a researched
finding. The market claims in this document are inference from what
you've told me about Delhi NCR kitchens — treat them as hypotheses to
test on real customers, not as established facts.

---

# Part 2 — What we learned, and what to do next

Added 21 Sep 2026, after working through "how do we make this
professional enough to sell".

## Principle 11: meet the business in the tool it already uses

Small Indian interior firms live in **Excel and WhatsApp**. That is not
a limitation to design around — it is where the work happens.

- Inventory arrives as a spreadsheet, because that is how a business
  already holds its price list.
- Quotes leave over WhatsApp, because that is how they already reach
  customers.

So the rule: **before building a sophisticated in-app editor for bulk
data, build the round trip to the tool they already use.** A beautiful
grid nobody fills in is worth less than a spreadsheet template they
complete on a Sunday evening.

This settles a recurring argument. "Should we build a fancy bulk
editor?" — not first. Excel round-trip first; the in-app editor is for
single-item edits and corrections.

## Principle 12: production detail is an add-on, never a gate

*Added 2 Oct 2026, in your words: workshop settings "must never be
indispensable for designing a kitchen, as this can be too complicated
for the small business owner or too time consuming."*

The core flow — draw the room, place cabinets, walk through it, price
it, send the quote — must work completely with **nothing** filled in on
the production side. Workshop settings (how panels are fitted), an
exact cutting list, sheet nesting and measured waste are add-ons for a
business that wants them.

So:

- Every production setting has a sensible default, and the app runs on
  it silently. Nothing in designing or quoting links to, warns about, or
  waits on Workshop settings.
- Anything production detail would *refine* has a by-experience
  shortcut that's good enough on its own. Waste is the example: the
  rate card's sheet waste factor (e.g. 1.10) is typed from experience;
  measuring it from a nested cutting list is optional.
- Where a production setting does touch the price, it must be by a
  rounding error, never meaningfully (measured: ₹0–30 on a ~₹2,500
  cabinet's board). If a choice moves the price meaningfully — whether
  a base unit has a full top or rails, which board a cabinet uses — it
  belongs with the cabinet in the catalogue, where a designer already
  is, not on the production page.

This settles "should this go in Workshop settings?": only if a business
that never opens that page still gets a correct quote without it.

---

## Three things we got straight

**1. Features are not principles.** A principle settles an argument. "A
library of cabinets" is a thing to build; "the catalogue belongs to the
business" decides a dozen future questions without re-thinking. The
original feature list is a roadmap, and it's a good one — it just isn't
the thing that guides decisions between roadmap items.

**2. "Professional" mostly isn't features.** The gap between this app
and something a business would pay for is not the cabinet library. It
is: no login, invented prices, no way to get a quote out, one business
only, and no undo. All boring, all blocking. The exciting half —
libraries, room shapes, realistic appliances — makes it *good*, not
*sellable*.

**3. The stack question was already answered.** Browser-based
React + TypeScript + Three.js with parametric geometry is the correct
architecture for this product, and it is what already exists. There is
no framework change worth making, and forking a generic floor planner
would trade the valuable part (pricing, BOM, quoting, India-specific
rules) for the commodity part (drawing walls).

One consequence worth stating because it is easy to get backwards:
**the cutting-list decision makes parametric geometry mandatory.** You
cannot derive panel dimensions, edge banding or grain direction from an
uploaded 3D mesh. Any "let customers upload .glb models" strategy is
incompatible with production output — quite apart from the fact that a
carpenter in Delhi is not going to produce GLB files.

---

## What "professional look and feel" actually means

Beyond undo/redo, in rough order of impact per hour spent.

### Adopt a component library

Every element in the app is currently hand-written Tailwind. It works,
and it is why nothing quite lines up. A component library gives buttons,
dialogs, inputs, tables, dropdowns and toasts that already agree with
each other on spacing, radius, colour and focus states.

`shadcn/ui` fits this codebase directly — React plus Tailwind v4, no new
paradigm, components copied into the repo so they stay editable. This
single change does more for "feels like real software" than any render
improvement.

### The four states every screen needs

Most amateur-feeling software only builds the first one:

1. **Full** — data is there.
2. **Empty** — no data yet. Say what this screen is for and offer the
   action that fills it. A new business's first login is *all* empty
   states; it is their first impression of the product.
3. **Loading** — skeletons, not a spinner on a blank page.
4. **Error** — what failed, and what to do about it.

### Feedback on every action

- A **toast** on save, freeze, import, delete. Silence after clicking
  is the most common reason users click twice.
- **Confirmation on destructive actions**, naming the thing being
  destroyed.
- **Disabled buttons during in-flight work**, with the label saying so
  ("Saving…"), which the rate card already does.

### Consistency rules

One spacing scale, one type scale, one set of colours with fixed
meanings (amber = needs attention, red = error, green = confirmed). The
placeholder-rates banner already uses amber this way — make it a
convention rather than a one-off. **Done, audited rather than
assumed** — a scan across every toolbar/inspector/dashboard panel
found the app was already overwhelmingly consistent in practice
(14 of 16 top-level panels use the exact same `rounded-lg border
border-gray-200 bg-white p-4` shell; every panel heading uses `text-sm
font-semibold text-gray-700`; every description line uses `text-xs
text-gray-400` or `text-gray-500`), just not written down anywhere —
so it could drift without anyone noticing. Now it's an explicit
convention rather than an implicit one:

- **Panel shell**: `rounded-lg border border-gray-200 bg-white p-4`.
  A small popup/dropdown menu (`PickChooser`, the 360° views list) is
  a different category — `p-2`/`py-1`, denser — not a violation of
  this rule.
- **Panel heading**: `text-sm font-semibold text-gray-700`.
- **Description / hint text**: `text-xs text-gray-400` (a hint,
  something already true and unremarkable) or `text-gray-500` (body
  copy explaining what the panel is for) — the two aren't
  interchangeable, `-400` reads as quieter.
- **Colours keep the meanings above** — amber/red/green — and nothing
  else borrows them for decoration.

One real drift already found and fixed: `FirstRunChecklist`'s heading
used `text-gray-800` instead of the established `-700`.

### Keyboard

Undo/redo, delete, escape to deselect, arrow keys to nudge. Designers
work fast; a mouse-only tool feels like a toy. **Done** —
`useSelectionShortcuts` (global, only while the 2D canvas is the
active view): Delete/Backspace removes whatever's selected (same as
clicking that item's own Delete button — no confirm dialog, undo
covers the "oops" case), Escape deselects, arrow keys nudge a
cabinet/obstacle/appliance (10mm plain, the room's own grid step with
Shift). Deliberately NOT extended to openings (move along a wall by
offset, not x/y) or fixtures (position depends on mount kind) — arrow-
nudging either would need per-kind logic disproportionate to what a
keyboard shortcut is for; Delete/Escape still cover them. See
`docs/DECISIONS.md` §22.

### First-run experience

A new business signs in to nothing. They need: a short setup checklist
(add your rates → import your catalogue → create your first customer),
and the ability to skip it. **Built** — `FirstRunChecklist` on the
dashboard, each step computed from real state rather than a flag, and
dismissible per business. See `docs/DECISIONS.md` §17.

---

## Inventory import and export

The flow, designed. Applies to **every** catalogue — cabinets,
appliances, finishes, handles, fixtures — which is the key engineering
insight: build **one import engine driven by a column spec per
catalogue**, not five importers.

### The round trip

1. **Download.** Not just a blank template — download the business's
   **current** inventory, so editing 200 rows means download, edit,
   re-upload. A blank template is only the first-time case.
2. **Fill in Excel.** `.xlsx`, not CSV: Excel is what they have, and CSV
   mangles ₹ and Indian text encodings. (SheetJS handles this.)
3. **Upload.**
4. **Validate and show errors in a grid in the browser.**
5. **Fix inline, in that grid** — not by editing Excel and re-uploading.
   Re-uploading loses their place and is the difference between a
   feature people use and one they abandon.
6. **Preview the effect**: "12 new, 8 updated, 0 removed."
7. **Commit as one transaction**, into that business's inventory.

### Rules that matter

- **The template carries its own instructions.** A second sheet with
  each column's meaning, its unit, allowed values, and one filled
  example row. The person completing it is not looking at the app while
  they do it.
- **Units in the column headers.** `width_mm`, not `width`. Then
  validate ranges and flag the obvious mistakes — a `60` in a
  millimetre column almost certainly means 600.
- **Match on a business-supplied `code` column.** Present code = update
  that item; absent = insert new.
- **A missing row NEVER deletes anything.** Someone will upload a
  partial sheet. Deletion stays a separate, deliberate action.
- **All-or-nothing commit.** A partial import leaves the business unsure
  what is actually in their catalogue, which is worse than a failed one.
- **Validate everything before writing anything**, and show every error
  at once. Fixing errors one upload at a time is how people give up.

### Why this matters more than it looks

Onboarding a new business is the moment they decide whether to keep
paying. If step one is "type in your 180 cabinet modules by hand", most
will not finish. This flow *is* the onboarding.

---

## Next steps

**This section changes often. The principles above do not.**

Ordered by "cheapest now, most expensive later", not by excitement.

### Phase 1 — Foundations (before feature work)

Each of these gets more expensive with everything built on top.

1. ~~Tenant column on all ten tables, plus auth and RLS.~~ **Done** —
   `business_id` + RLS on all ten (now thirteen, with `businesses`/
   `business_users`/`super_admins`), real sign-in. One business exists;
   self-serve sign-up for a second is still not built (see
   `docs/SUPABASE_SETUP.md`).
2. **The panel model.** Replace area-estimate costing with real panel
   decomposition, so price and cutting list derive from one source.
   *Blocked on:* your carpenter's construction convention. **The
   costing-only slice of this is now done** — material substrate cost
   varies by area and by material (`docs/DECISIONS.md` §13), reusing
   the same rough area estimate labour already used. That is NOT this
   item: it produces a price, not a cutting list, and doesn't need the
   carpenter's convention to do it. The real panel model — exact
   per-panel dimensions — is still fully blocked on that answer.
   **Reframed 29 Sep 2026** (Principle 2 changed): pricing no longer
   waits on this at all — area costing is the permanent method, now
   with an itemised "others" rate and a sheet waste factor
   (`docs/DECISIONS.md` §35). What remains of this item is the
   production cutting list only, still blocked on the carpenter's
   convention. A standalone waste calculator that nests panels from an
   *assumed* convention is not blocked and is the next step.
   **Unblocked 29 Sep 2026** (`docs/DECISIONS.md` §41): the
   carpenter's convention is now a set of business settings with every
   alternative selectable, pre-filled with the common local convention
   and labelled "assumed" until confirmed. The cutting list is built on
   those (Phase 4 item 16) — the carpenter's answer is a settings
   change, not a blocker.
3. ~~Undo/redo, while the set of edit actions is still small.~~ **Done**
   — was already built and documented (`docs/DECISIONS.md`, "Undo/redo
   + autosave" in §6 Interaction) but this list was never updated to
   say so; corrected here rather than silently. Debounced by
   edit-signature (500ms), scoped to the open design only (not
   catalogues/rates/quotes, which persist immediately per-row, or
   panorama capture, an irreversible storage side effect).
4. ~~Autosave, so nothing is ever lost.~~ **Done** — same entry as
   above, same debounce mechanism reused for a 2s-debounced silent
   `saveProject` call.

### Phase 2 — Make it sellable

5. ~~Quote export — PDF and WhatsApp link.~~ **Done** — also already
   built and undocumented-here; corrected for the same reason as 3/4
   above. A hosted PDF (`lib/quotePdf.ts`, frozen-quote data only,
   never the live BOM) uploaded to the `quote-pdfs` bucket
   (`lib/quotePdfStorage.ts`), opened as a `wa.me` deep link
   pre-filled with that URL (`lib/whatsapp.ts`) — the customer gets a
   real tappable document, not a manual attachment. See
   `docs/DECISIONS.md`, "Quote export" in §6.
6. **Real rates**, replacing every placeholder. **Marked not required
   for now — explicit product call, 28 Sep 2026.** Partial work exists
   (hinge/channel hardware rates, material rates by substrate, cost
   basis vs. selling basis as a separate concept — `docs/DECISIONS.md`
   §12-15) but bringing in the business's own negotiated invoice
   prices to replace the market-estimate placeholders is deprioritized
   rather than pursued further right now. The amber placeholder-rates
   banner stays either way (principle 10: approximation is allowed,
   but never hidden) — this item being deprioritized doesn't mean the
   disclosure goes away.
7. ~~Inventory import/export, per the design above. This is
   onboarding.~~ **Done** — Excel round trip (download, edit, upload,
   validate, fix inline, commit) for all five catalogues. Matching is
   on each row's own id rather than a new business-assigned code
   column (see `docs/DECISIONS.md`); no in-sheet Excel dropdowns
   (SheetJS Pro feature), so allowed values live on an Instructions
   sheet and the review grid's own `<select>` fields instead.
8. **Component library and the four states.** The professional finish.
   **In progress** — shadcn/ui adopted (Radix base, 15 primitives incl.
   alert-dialog); toasts and an in-app confirm dialog (not the
   browser's native one) on every save/freeze/import/delete action;
   every hand-rolled `<button>` in the app migrated to shadcn's Button
   (one deliberate exception: `ColorPicker`'s colour-swatch cells); the
   four states (full/empty/loading/error) applied to `CustomerDashboard`
   and `InventoryManager`; every screen-level hand-rolled error/warning
   box in the toolbars, inspectors and quote sidebar promoted to the
   shared `Alert` component (`docs/DECISIONS.md` §16); a first-run
   checklist on the dashboard (add rates → import catalogue → create
   first customer, each computed from real state, dismissible per
   business — `docs/DECISIONS.md` §17); every native select/checkbox in
   the inspectors, toolbars, `InventoryManager`'s catalogue tables and
   all 5 Excel import/export review grids migrated to shadcn
   `Select`/`Checkbox`, plus real `Skeleton` loading states for the 3
   catalog-driven toolbars (`docs/DECISIONS.md` §18, §21). **Done**.
   Not done: raw number/text inputs everywhere were left native (a
   separate design call nobody has made), and consistency rules
   beyond button colour (spacing/type scale) are still open. See
   `docs/DECISIONS.md` §11, §16, §17, §18, §21.

### Phase 3 — Make it good

9. **Rectilinear room geometry** — arbitrary 90° shapes. A foundation
   change, but it does not block selling, so it sits here. **Deferred,
   28 Sep 2026** — scoped in full (touches ~15-20 files: every wall-
   relative geometry function, all 8 2D canvas layers, the 3D room
   shell, persistence) but a multi-session foundation rewrite for a
   feature whose customer value isn't validated yet. Revisit after
   real market feedback, or sooner if the panel model (Phase 1 item 2)
   unblocks first, since that touches walls too. Full scope kept in
   the plan file rather than lost. See `docs/DECISIONS.md` §27.
10. **Cabinet library breadth** — tandem, pantry, tambour, corner
    carousel, wicker baskets. Mostly data entry, which makes it cheap.
    **Glass fronts, done** — single-door, double-door, drawers and
    open-shelf fronts can all have their panel(s) made of glass
    instead of board (clear/black/brown/yellow tint), all-or-nothing
    per front (a "double door, brown-tint glass" cabinet has both
    leaves in that glass), priced separately by tint
    (`RateCard.glassRates`, ₹ per sq ft, with material/finish reduced
    by the same area so it isn't double-charged) and rendered as real
    transparent/tinted glass in the 3D view. Same door-swing hardware
    (hinges, handle) as a board front of the same kind; drawers keep
    their own channel hardware. See `docs/DECISIONS.md` §19-20.
    **Tandem/pantry/wicker baskets, done** — tandem was already fully
    priced (every drawer-unit row already gets tandem-box-rate
    channels), so this added a genuinely new width (1200mm) rather
    than a same-size duplicate; pantry needed a real new ModuleType
    (`pantry-unit`, its own multi-tier wire-basket default front) since
    a catalogue-row-only attempt turned out to silently lose its front
    configuration on the Excel round trip; wicker baskets are the
    pantry unit's own basket hardware, not a separate priced product.
    See `docs/DECISIONS.md` §23.
11. **Appliance dimensions first, appearance second.** Appliances are
    usually customer-supplied in India, so the dimension drives cabinet
    cutouts and clearances. Photoreal models are the last 10% of appeal
    at most of the cost. **In progress** — `ApplianceType` widened from
    6 to 10 values (added `fridge`, `microwave`, `dishwasher`,
    `water-purifier`), with 5 new starter-catalogue rows at realistic
    Delhi NCR dimensions. `fridge` specifically unblocks a real
    sink/hob/fridge work triangle in `checkSinkHobDistance` — not built
    in this pass, a deliberate follow-up rather than an oversight. The
    larger version of this item (cabinet cutouts actually sized to a
    placed appliance, beyond the sink cutout that already exists) is
    still open. See `docs/DECISIONS.md` §27.
12. **Kitchen-specific checks** — aisle width, work triangle,
    sink-to-hob distance, hob not under a window, counter run beside the
    hob, chimney centred on the hob. This is what makes the software
    look like it knows the trade. **Done**, except the full work
    triangle — this app has no fridge `ApplianceType`, so
    `checkSinkHobDistance` checks the one leg of the triangle it can
    actually see rather than fabricating a third corner. All five
    other checks are advisory-only (`lib/kitchenChecks.ts`), a third
    banner alongside the collision/clearance ones. See
    `docs/DECISIONS.md` §24.
13. ~~Present mode — the customer-facing view.~~ **Done** — a new
    `'present'` screen (`PresentMode.tsx`), not a stripped copy of the
    editing one: 3D walkthrough (reuses the existing 3D Preview
    unchanged) plus a new floor-plan sub-view (no grid/dimensions/
    warnings/toolbars/inspectors, pointer-events disabled so a stray
    click can't drag a cabinet mid-presentation), and a designer-
    tapped price reveal showing the same total the PDF/WhatsApp quote
    already sends a customer. See `docs/DECISIONS.md` §28. **Not
    verified in a browser** — no browser automation this session.
14. ~~The visual assets work in `VISUAL_ASSETS_PROMPT.md` — HDRI
    first, then finish scale, then metals on hardware.~~ **Done**, and
    turned out to need far less work than that brief assumed — finish
    scale/relief, window backdrops, and asset weight/lazy-loading were
    already fully done in an earlier session that never got folded
    back into the brief. Real remaining work closed this pass: the
    already-fetched HDRI is now wired in (alongside the existing
    Lightformer rig, not replacing it), the sink/chimney box fallback
    now uses real brushed-steel maps, and the pendant fixture's `.glb`
    is now actually rendered (`FixtureModel.tsx` existed but was never
    called). Handle texture maps deliberately skipped — no browser
    available to make the brief's own "does it look convincing enough
    already" call, so no schema change on a guess. See
    `docs/DECISIONS.md` §29.

### Phase 4 — Production

15. **Board nesting** — fitting panels onto 8×4 sheets. Genuinely hard
    (2D bin packing); use a known heuristic, don't invent one. **Done,
    2 Oct 2026** (`docs/DECISIONS.md` §49) — Jylänki's guillotine
    packing, all rule combinations, measured waste two ways.
16. **Cutting list output** for the workshop. **Phase 1 done, 29 Sep
    2026** (`docs/DECISIONS.md` §41) — carcass, back and front parts
    per cabinet from configurable construction settings, on-screen and
    Excel export. Not yet: drawer boxes, corner-carousel geometry, a
    printable PDF. Item 15 (nesting) is next and no longer blocked.
17. **Hardware boring positions**, if CNC ever matters.

### Running alongside all of it

**Use the software on your own real jobs.** It is the only way to learn
your carpenter's conventions, which checks designers actually want, what
the library must contain, and whether the quote format closes sales.
Building a product for a workflow you have not run end-to-end is how you
build the wrong thing extremely well.
