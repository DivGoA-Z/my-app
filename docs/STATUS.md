# Status

**The bridge between the repo and planning conversations.** Paste this
file into the Claude Project (which can't see the repo). It's a
snapshot, not a history. The reasoning is in `docs/DECISIONS-INDEX.md`
(one line per decision, with `§` pointers into `docs/DECISIONS.md`), and
the history is in `git log`.

**Last updated:** 3 Oct 2026. Branch `charges-and-cutting-list`, not yet
merged to `main`.

---

## Built

**Design**
- 2D plan: room, pillars and shafts, cabinets, appliances, doors and
  windows, light fixtures.
- Overlap picker; collision, door-swing (true arcs) and kitchen
  ergonomics checks in one alerts panel.
- Undo/redo, autosave, keyboard shortcuts, copy/paste.
- 3D walkthrough with camera nodes, 360° panoramas, three lighting
  modes, HDRI + Lightformer environment.
- Wall elevation; present mode (customer view with a price reveal).
- Parametric fronts: mixed rows, tambour, glass in four tints, three
  corner types, pantry; hardware derived from fronts.
- Depth convention ("includes shutter" or "carcass only"): business
  setting with a per-project override, followed by the plan, 3D and
  collisions. Shutter thickness comes from each cabinet's fronts board.

**Pricing and quotes**
- Board priced on the real area of every cut part, per board line
  (material × thickness × ₹/m²).
- Sheet waste: one approximate factor, or calculated per board from that
  project's sheet layout (rate-card switch).
- Edge banding ₹/m on exact metres.
- One "Labour and other charges" list (per sq ft on total cut-part area,
  per cabinet, or lump sum; show-on-quote and add-margin ticks per row),
  overridable per project.
- Margin per project, distributed into every displayed line.
- Quotes freeze as versions with a content-fingerprint staleness check.
- PDF export plus a hosted WhatsApp link; `sent_at` records the first
  share.
- "All frozen versions" dropdown on the quote: each version's PDF and
  cutting list.

**Production** (optional per Principle 12; everything has defaults)
- Workshop settings (corner rules, back fit, drawer-box deductions,
  fronts from the carcass board or pre-laminated, kerf and trim),
  locked once confirmed.
- Cabinet Designer: per-panel built/board choices, extra shelves and
  parts, 3D panel preview.
- Cutting list: drawer boxes, corner carousel parts, loose parts,
  customer-facing edge banding, grain only where it applies.
- Guillotine nesting on each board's sheet sizes.
- Glass order sheet.
- Excel export, printable cutting-list PDF and part labels.
- The cutting list is frozen with each quote.

**Platform**
- Supabase with per-business RLS on every table; real sign-in.
- Excel import/export for all five catalogues (merges onto stored rows).
- Inventory managers; customer pipeline dashboard; first-run checklist.
- shadcn/ui throughout.

## Tests

`npm test` (Vitest): **122 tests**. 102 cover pricing, the cutting list,
nesting, panels, the importer, physical depth and the pipeline rules. 20
screen tests (React Testing Library) cover the rate card, boards, Cabinet
Designer, charges, the Cutting List, the quote's version list, Home and
Customers. 3D and 2D drawing is
still checked by eye.

## Your to-dos before using this branch

1. **Re-run `supabase/schema.sql`.** Several new columns; saves fail
   without them. Re-run again after 3 Oct for the Installed/Lost stages
   (§69).
2. **Lower the labour rate.** The ₹150/sq ft placeholder was set against
   the old small area estimate. Labour now bills on total cut-part area
   (a base unit went from 7.0 to 22.7 sq ft).
3. **Set an edge-banding ₹/m** on the rate card and **remove the
   per-sq-ft edge-banding row** from Labour & other charges, or edge
   banding is charged twice. The rate card warns.
4. **Check the placeholders**: HDMR 6mm back board ₹450/m², shelf
   supports & fitting ₹80, and board rates generally. Open quotes' board
   cost rose about 2.5–3× with real-area pricing.
5. **Freeze a new quote version** to get a saved cutting list. Older
   versions don't have one.
6. **Try "carcass only" depth** (Room Settings) and drag a cabinet; look
   at it in 3D.
7. **Compare one real job** with your carpenter (parts and sheet count),
   then confirm and lock Workshop settings.

## Unverified (built, not seen in a browser)

- Most of §41–§67:
  - cutting-list screens and exports
  - Workshop settings lock
  - Cabinet Designer and its 3D preview
  - board and waste editors
  - project charges override
  - frozen cutting lists
  - all-versions dropdown
  - carcass-only dragging and 3D
  - board-thickness shutters
  - the diagonal carousel door in the preview

  (The printed PDFs and sheet drawings were checked as rendered images.)
- From earlier: the pendant `.glb` model (`fix_pendant_industrial`) and
  its orientation; the new appliance types' colours.
- No comparison yet against a carpenter's real cutting list or sheet
  count.

## Not built

Everything parked for after the first customers (self-serve sign-up,
real rates, shared catalogue, carpenter validation, appliance cutouts,
rectilinear rooms, CNC, Draco and others) is listed in
`docs/AFTER_FIRST_CUSTOMERS.md`, including what must be true **before**
customer #1 is onboarded by hand (starter catalogue copy, runbook,
two-business isolation check).

Near term: browser (Playwright) tests, after your end-to-end walkthrough.

## Blocked

Nothing. Production waits only on the carpenter *confirming* the
assumed settings, which is a check, not a blocker.

## Next

0. **UI/UX overhaul in progress** (`docs/UX_PLAN.md`). Built: theme, app
   shell, Home, Customers, Settings (§68–§70). Next: the design editor,
   then inspectors and quote, cutting list, catalogue. The walkthrough
   follows, on the new UI.

1. **Your end-to-end walkthrough** (`docs/WALKTHROUGH.md`): a new kitchen from scratch, checking
   functionality and basic calculations (not rates). Anything found goes
   in `docs/ISSUES.md`.
2. Merge `charges-and-cutting-list` into `main`.
3. Browser tests that script the walkthrough's flows.
4. The "before the first customer" list in `docs/AFTER_FIRST_CUSTOMERS.md`.

Open issues: none (`docs/ISSUES.md`). Fixed issues are logged in
`docs/ISSUES-FIXED.md`.
