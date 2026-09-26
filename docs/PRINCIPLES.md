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

### 2. Panels are the unit of truth

**This is the biggest change implied by "cutting list".**

Today, material and labour are priced from an *area estimate* —
front-face area plus half the side area (`estimateAreaSqFt` in
`src/lib/bom.ts`). That is a sales approximation and it is fine for a
sales tool. It cannot produce a cutting list, because a workshop needs
actual panels: two sides, top, bottom, back, shelves, each with real
dimensions, a thickness, edge banding on named edges, and a grain
direction.

So the model inverts. A cabinet is decomposed into **panels**, and
*both* the cutting list and the price derive from that decomposition.
The cutting list stops being a feature bolted on later and becomes the
more honest foundation for pricing — because once you know every panel,
material cost is a fact rather than an estimate.

Consequence: this replaces the area-based costing rather than sitting
beside it. Doing it later means re-deriving every quote the app has ever
produced.

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

- The panel model (principle 2) replaces area-based costing.
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
2. **The panel model.** Every feature built on area-estimate costing is
   a feature that has to be re-derived later.
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
convention rather than a one-off.

### Keyboard

Undo/redo, delete, escape to deselect, arrow keys to nudge. Designers
work fast; a mouse-only tool feels like a toy.

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
3. **Undo/redo**, while the set of edit actions is still small.
4. **Autosave**, so nothing is ever lost.

### Phase 2 — Make it sellable

5. **Quote export** — PDF and WhatsApp link. Still the last unbuilt
   piece of the original brief, and the reason a quote currently cannot
   leave the app.
6. **Real rates**, replacing every placeholder. Commercial blocker, not
   technical. **Partially improved** — hinge/channel hardware rates,
   material rates by substrate (HDMR/Plywood/BWP; MDF/Particle Board
   are this app's own guesses, not the business's), two new finishes
   (basic laminate/acrylic, quartz), and per-cabinet fabrication/others
   rates now use real or explicitly-flagged-as-guessed Delhi NCR market
   estimates instead of invented placeholders (see `docs/DECISIONS.md`
   §12-14). Still placeholders in the sense that matters — a business's
   own negotiated invoice prices, not a market estimate — so the amber
   banner stays and this item isn't done. Cost basis vs. selling basis
   is now a real, separate concept (`marginPercent`, a Cost/Selling
   toggle in the quote sidebar) rather than margin being implicit
   inside a guessed catalogue price.
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
   change, but it does not block selling, so it sits here.
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
11. **Appliance dimensions first, appearance second.** Appliances are
    usually customer-supplied in India, so the dimension drives cabinet
    cutouts and clearances. Photoreal models are the last 10% of appeal
    at most of the cost.
12. **Kitchen-specific checks** — aisle width, work triangle,
    sink-to-hob distance, hob not under a window, counter run beside the
    hob, chimney centred on the hob. This is what makes the software
    look like it knows the trade.
13. **Present mode** — the customer-facing view.
14. **The visual assets work** in `VISUAL_ASSETS_PROMPT.md` — HDRI
    first, then finish scale, then metals on hardware.

### Phase 4 — Production

15. **Board nesting** — fitting panels onto 8×4 sheets. Genuinely hard
    (2D bin packing); use a known heuristic, don't invent one.
16. **Cutting list output** for the workshop.
17. **Hardware boring positions**, if CNC ever matters.

### Running alongside all of it

**Use the software on your own real jobs.** It is the only way to learn
your carpenter's conventions, which checks designers actually want, what
the library must contain, and whether the quote format closes sales.
Building a product for a workflow you have not run end-to-end is how you
build the wrong thing extremely well.
