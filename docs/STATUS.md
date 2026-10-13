# Status

**The bridge between the repo and planning conversations.** Paste this
file into the Claude Project (which can't see the repo). It's a
snapshot, not a history. The reasoning is in `docs/DECISIONS-INDEX.md`
(one line per decision, with `§` pointers into `docs/DECISIONS.md`), and
the history is in `git log`.

**Last updated:** 8 Oct 2026. Everything is on `main` (the
`charges-and-cutting-list` branch was merged 5 Oct; this line still said
"not yet merged" until 6 Oct).

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
- Image brief (§97–§105), one button in the 3D view: standing at a
  camera, a line drawing of that view; otherwise the plan + four-wall
  sheet; always a JSON describing everything, with full, condensed and
  short prompts. No image model is named (Gemini did best in tests).
- Cameras are saved views (§102, §103): height and tilt in the Cameras
  panel, a hold-to-move pad (forward/back/left/right/up/down), and "Save
  this view" in the 3D walkthrough for heading, tilt and lens.
- Top view (§99) in the Elevation tab: a line plan (Drawing) and a 3D
  view from straight above.
- Parametric fronts: mixed rows, tambour, glass in four tints, three
  corner types, pantry; hardware derived from fronts.
- Kitchen style defaults (§117): finish, colour, handle and board for
  base / wall / tall cabinets, at business (Catalogue page), kitchen
  (Style button) and cabinet level; copied onto cabinets, never priced.
- Fixed corner panel on blind/magic corners and wall cabinets in a corner
  (§116, §118), fitted on placement; no false swing clashes.
- Editor polish from the first hand-built kitchen (§115, §118): double-click
  turns a stacked item's selected base; inspector floats as a slim tab;
  hex colour box typeable; quote panel starts closed; Catalogue's "Back to
  <customer>'s kitchen" floats.
- Countertop slab picker (§119): slab materials with surface and ₹/m²,
  plus a slab tint, in Surfaces.
- Room-surface library (§120): 67 floors, walls, stones, wood floors,
  paints and Indian-stone placeholders, picked from a swatch library with
  prices and a custom shade per surface. Prices are placeholders.
- Sinks drop into the counter with their tap upright (§126); room
  surfaces optional on the quote (§123); cabinet Finish is a compact row
  opening the finish library (§125).
- Floors and walls laid as tiles (§122): size, straight/offset, grout
  width and colour; tile photos rescale, seamless finishes get drawn grout.
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
- Sign-up with approval (§106): new accounts wait until linked to a
  business by hand.
- Separate businesses (§107): approving a sign-up as a new business
  copies in the master starter catalogue; each business can save its
  own default catalogue and go back to it; storage writes are per
  business folder; no super-admin bypass in the app; a two-business
  isolation check (`supabase/isolation_check.sql`).
- Excel import/export for all five catalogues (merges onto stored rows).
- Inventory managers; customer pipeline dashboard; first-run checklist.
- shadcn/ui throughout.

## Tests

`npm test` (Vitest): **326 tests** in 43 files (this said 125, which
was stale). Maths tests cover pricing, the cutting list, nesting,
panels, the importer, physical depth, the pipeline rules, and the image
brief with its plan and elevation drawings. Screen tests (React Testing Library) cover the rate card, boards,
Cabinet Designer, charges, the Cutting List, the quote's version list,
Home, Customers, the app shell and catalogue duplicates. 3D and 2D drawing is
still checked by eye.

## Your to-dos before using this branch

1. **Re-run `supabase/schema.sql`.** Several new columns; saves fail
   without them. Re-run again after 3 Oct for the Installed/Lost stages
   (§69), and after 7 Oct **before switching sign-up on** in Supabase
   (§106: storage writes now need business membership), and after 8 Oct
   for the style-default and surface-tint columns and the surface
   library (§117, §119, §120: until then the library is empty and a style
   default or surface tint can't be saved; everything else works). Then
   `select public.refresh_starter_catalog('biz_default');` so new
   businesses get the library too.
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

- §116: the corner fixed panel in 3D with a unit pushed into a real
  corner (geometry is tested; the look isn't seen).

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
- Saved camera views and the move pad (§102, §103): "Save this view",
  the tilted walkthrough and the glide are not yet seen in a browser
  (maths and the panel are tested).
- Sign-up and separate businesses (§106–§107): verified against a local
  Postgres, not yet in the real Supabase. Needs: re-run `schema.sql`,
  `select public.refresh_starter_catalog('biz_default');`, then run
  `supabase/isolation_check.sql` (should say ALL ISOLATION CHECKS
  PASSED), then turn on sign-ups in Supabase.
- Image generation (§105): models compared by hand on one design;
  nothing is sent to a model from the app (that needs a server-side
  piece holding the API key).
- Image brief and Top view (§97–§105): the guide image was downloaded
  from a real design and used successfully by hand; the Top view was
  checked in a browser only on an empty design (3D top view with units
  not yet seen).

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

0. **UI/UX overhaul in progress** (`docs/UX_PLAN.md`). Built: theme (Premium A),
   app shell, Home, Customers, Production, Catalogue, Rate card, Workshop,
   Settings, sign-in; screenshot checks at 3 sizes (§68–§78). Design editor
   all four stages done (§81–§87): new frame, 3D wall elevation, cutting
   list, tool panels as picture tiles, inspectors with big swatches and
   front pictures, quote panel with pricing folded away, phone layout
   (bottom tool strip, sheet panels, More menu), present mode, 3D
   controls, and drag-to-place with auto-turn (§88–§91). The overhaul is
   functionally complete; the walkthrough follows, on the new UI.
   Unverified: drag on a real touch device.

1. **Your end-to-end walkthrough** (`docs/WALKTHROUGH.md`): a new kitchen from scratch, checking
   functionality and basic calculations (not rates). Anything found goes
   in `docs/ISSUES.md`.
2. ~~Merge `charges-and-cutting-list` into `main`.~~ Done 5 Oct 2026 (fast-forward, §1–§96 now on `main`). Next: host it (Cloudflare Pages, free `.pages.dev` address) and add the co-founder by hand.
3. Browser tests that script the walkthrough's flows.
4. The "before the first customer" list in `docs/AFTER_FIRST_CUSTOMERS.md`.
5. L-shaped / bi-fold wall corner units (not built; blind wall corners are).
6. Tiling extras (§122): backsplash tiles starting at the counter (3D
   only; grout pricing and 2D tiles decided against, §123).

Open issues: none (`docs/ISSUES.md`). Fixed issues are logged in
`docs/ISSUES-FIXED.md`.
