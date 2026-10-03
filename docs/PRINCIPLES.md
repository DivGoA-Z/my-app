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

## What the three answers changed (condensed 3 Oct 2026)

*This section and the two after it were planning notes from 17 Sep.
Most of what they asked for is now built or decided, so they're cut to
outcomes with pointers. The full original text is in git history
(before commit "Compress docs").*

- **Multi-tenant** → `business_id` + RLS on every table, real sign-in,
  super-admin bypass (`docs/DECISIONS.md` §9). Still open: self-serve
  sign-up, onboarding a second business, billing.
- **Sales and production** → a millimetre cutting list built on
  construction *settings* (§41), with board lines and real-area pricing
  (§42), nesting (§49–§53), edge banding by the metre (§58), drawer
  boxes (§56), and printable sheets and labels (§64). Hardware boring
  for CNC is not started.
- **Laptop-first** → unchanged; still what keeps the 3D walkthrough
  affordable.

## What was cheap now and expensive later

1. Tenant column → **done** (§9).
2. Panel model before area costing → **withdrawn 29 Sep**. Area pricing
   is permanent (Principle 2), so nothing needs re-deriving.
3. Rectilinear room geometry → **deferred 28 Sep** until there's market
   evidence (§27). It still gets more expensive with every wall-relative
   feature added.
4. Undo/redo → **done** (§6).

## Sequencing, and the open decisions

The 17 Sep warning still holds: **run real jobs through the app while
building.** The things only real use can teach are now mostly
answerable:

1. ~~Construction convention~~ → **decided as settings** with every
   alternative selectable, labelled "assumed" until the carpenter
   confirms (§41, §47). Comparing one real job with the carpenter is
   the remaining check.
2. ~~Board sizes and stock~~ → **decided**: sheet sizes per board line on
   the rate card (§52).
3. ~~Edge banding rules~~ → **decided**: customer-facing edges only (§47),
   one ₹/m rate (§58, §65).
4. Isolated vs shared catalogue → **answered, not built**: isolated by
   default, with an opt-in shared catalogue (`is_global` +
   `business_settings.show_global_catalog`). Waits for a second
   business (§9).
5. **SaaS pricing model**: per seat, per business, or per quote? Open.
6. **The first paying customer that isn't you.** Open. The answer
   usually reorders the roadmap.

## What I cannot validate

Stated plainly, because this file will be read as authoritative.

I have no access to the Indian modular kitchen market, your competitors'
pricing, or what interior firms will actually pay for. Principle 9 (local
specificity as the moat) is a reasonable strategic bet, not a researched
finding. The market claims in this document are inference from what
you've told me about Delhi NCR kitchens — treat them as hypotheses to
test on real customers, not as established facts.

---

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

---

## What "professional" turned out to mean (done)

All built (`docs/DECISIONS.md` §11, §16–§18, §21–§22):
- shadcn/ui throughout
- the four states (full, empty, loading, error)
- a toast on every action
- in-app confirmation naming the thing being destroyed
- keyboard shortcuts (delete, escape, arrow-nudge, copy/paste)
- a first-run checklist

What stays is the convention, so it doesn't drift:

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

Still open: raw number and text inputs are native everywhere. That's a
separate design call nobody has made.

## Inventory import and export (built, §10)

Excel round trip for all five catalogues: download current data → edit
→ upload → validate → fix inline in the browser → commit atomically.
The rules that matter, and still apply to any new importer:
- `.xlsx`, not CSV.
- Units in the headers (`width_mm`). The template carries its own
  instructions sheet.
- The row's own `id` column is the match key; blank means new.
- **A missing row never deletes**; deletion is a typed `delete` column.
- Validate everything before writing anything.
- **An update merges onto the stored row** (§54). A partial source must
  never wipe the fields it doesn't carry.

---

## Roadmap

**This section changes often. The principles above do not.** Rewritten
3 Oct 2026. The 21 Sep phase list is done except where noted below. See
`docs/STATUS.md` for the current snapshot.

**Done**:
- Foundations: tenancy and RLS, undo, autosave.
- Sellable: quote export (PDF + WhatsApp link), Excel import, component
  library, four states.
- Good: present mode, glass fronts, pantry/tandem/corner types, kitchen
  checks including the fridge work triangle (§32), visual assets.
- Production: cutting list, nesting, measured waste, frozen cutting
  lists, glass order, printable sheets and labels (§41–§64).
- Tests: 111, including screen tests (§55, §66).

**Next, in order** (revised 3 Oct 2026; there is no carpenter
available yet, so real-job validation moves to after the first
customers):
1. **End-to-end walkthrough.** Build a new kitchen from scratch to
   understand the whole app and check functionality and basic
   calculations (not rates).
2. **Browser tests** that script those flows.
3. **Before the first customer** (`docs/AFTER_FIRST_CUSTOMERS.md`):
   starter catalogue for a new business, hand-onboarding runbook,
   two-business isolation check.
4. Onboard the first few customers **by hand**.

**Parked until a few customers are onboarded**, with the principles for
that phase: `docs/AFTER_FIRST_CUSTOMERS.md`. This covers self-serve
sign-up, real rates, the shared catalogue, carpenter validation and every
deferred item that used to be listed here.

### Running alongside all of it

**Use the software on your own real jobs.** It is the only way to learn
your carpenter's conventions, which checks designers actually want, what
the library must contain, and whether the quote format closes sales.
Building a product for a workflow you have not run end-to-end is how you
build the wrong thing extremely well.
