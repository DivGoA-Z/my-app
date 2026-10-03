# Decisions — index

**Read this, not the archive.** One or two lines per section of
`docs/DECISIONS.md`: the rule it set, and the trap or failed approach to
avoid. `DECISIONS.md` is the full, untouched archive with the reasoning
and bug stories. Open the matching `§` there when you work in that area.

**New decisions go in both places:** a full section in `DECISIONS.md`
(what, what was rejected, why, what broke), and one line here.

---

## Foundations (§1–§11)

**§1 Data model.**
- Layout contents are JSONB arrays on `layouts` (read and written whole).
- Ids are client-made `text` (a `uuid` FK broke the `quotes` table once).
- The table is `projects`, the UI word is "customer".
- `schema.sql` is idempotent and is the only migration mechanism.

**§2 Pricing.**
- `calculateBOM` takes one required `PricingContext`. Defaults priced hardware at ₹0, twice.
- Rate card: one row, no versioning. Frozen quotes carry their own snapshot.
- Quotes freeze; a revision is `version+1`. The unique `(project_id, version)` index catches double-clicks.
- There is no delete for quotes.
- Staleness is a content fingerprint (FNV-1a over all priced inputs), NOT `updated_at`, which fails in both directions.
- `fingerprintPricedInputs` is the single place the hash input is assembled.
- Surfaces: void → occupied → concealed → exposed.
- Openings and fixtures always print, even at ₹0 or when electrical is off.
- Countertop: one finish per layout, charge behind `priceCountertop`. A material choice is never shown without its price (Principle 10).

**§3 Cabinets.**
- Substrate, finish and front layout are separate axes.
- Snap: 2D push-out with a Z-check and a 0.5mm overlap epsilon. A per-axis push-out was tried and is wrong.
- Hardware is derived from fronts in one pass (`computeFrontBreakdown`). It was once read from a never-written field: ₹0 everywhere.
- `'mixed'` fronts are recursive, one level only.
- Three corner types. Only the carousel has the diagonal (cut 0.4).
- Tambour is a `FrontKind` with per-slot appliance checks.
- Cabinets never get a `modelUrl`; only knobs among handles may be meshes.
- Open bands get 5-panel shells with a `PLASTER_COLOR` liner.
- Sink cutout is a catalogue property, drawn as 4 boxes.
- The sink z-fight fix was tried 3 ways and reverted. Root cause: the catalogue row had height 0. Don't retry speculatively.
- Handles are their own table, per-unit or per-metre.

**§4 Openings.**
- `wallSegments` uses a coordinate grid. A 1-D sweep was wrong for overlaps.
- Overlapping openings are a hard error.
- Door swing checks obstacles too.
- Backdrop plane sits 0.6 m back at 2.6× size.

**§5 Lighting.** The longest bug history; read before touching `lighting3d.ts`.
- Removed fakes: automatic under-cabinet lights, and the shadow-casting sun.
- Fixture `decay=2`. `decay=0` was why lights lit nothing. Window daylight stays at 0.
- A `SpotLight.target` must be mounted in the scene.
- Fixture body is `toneMapped`.
- Environment Lightformers aren't occluded, so they're scaled/untinted per mode (`fixtures-off` 0.6).
- Strip banding is geometric: a 350mm origin standoff fixes it, more samples don't. `RectAreaLight` needs `RectAreaLightUniformsLib.init()` or renders black.
- Glow and output are two separate dials.

**§6 Interaction.**
- One `SelectionRef`.
- The overlap picker opens only on a real overlap.
- Never let a scanner match its own prose (the `usePickAt` guard).
- Overlap mute is per item. Global toggles only hide more, never un-mute.
- Floor and wall gap bands are separate.
- Dimension toggles are session-only.
- L-corner clearance: wall cabinets are excluded; the carousel zone is anchored at the diagonal's midpoint; zones are arcs, not boxes.
- Undo/autosave are debounced per edit signature.
- Quote export renders the FROZEN quote to PDF, uploads it to `quote-pdfs` (deterministic path, upsert), and opens a `wa.me` link.

**§7 Assets.**
- Unwired on purpose: the box-stack GLBs and `kitchen-sink.glb`.
- Albedo is sRGB, data maps are linear.
- No albedo substitute for missing maps.
- Swatch mm is the physical repeat (for tiles, the whole repeat).

**§8 Open questions from the code read.** All resolved or superseded:
- textures load lazily
- `stone-concrete` is 2:1
- derived and real normal maps don't stack
- the reclaimed-wood highlight is in the texture
- bare `tsc --noEmit` is a no-op; use `-p tsconfig.app.json`

**§9 Auth.**
- `business_id` and RLS on every table; `business_users` join table with a role; `super_admins` bypass.
- `business_id` is passed explicitly, never a DB default.
- Seed inserts carry `biz_default`, because re-running hit NOT NULL. `on conflict` doesn't suppress that.
- Composite cross-business FKs are an accepted gap.

**§10 Import/export.**
- The sheet's `id` column is the match key; blank = new.
- One atomic upsert per batch.
- A missing row never deletes; a `delete` column does (upsert and delete are two statements).
- Install SheetJS from its CDN; the npm build is vulnerable.
- `light_fixture_catalog` lacked 4 columns.
- Blank-id starter files create duplicates on re-upload.

**§11 shadcn/ui.**
- The `@/*` alias must also be in the root tsconfig, or the CLI writes to a literal `./@/` folder.
- Toasts on every action.
- `confirmDialog()` instead of `window.confirm`.
- Button has `whitespace-nowrap` built in: add `whitespace-normal h-auto` at long-label call sites; don't change the primitive.
- A mid-session install requires a dev-server restart.

## Pricing evolution (§12–§20)

**§12** Market rates.
- A hinge is priced per PIECE (₹450/pair → 225).
- Tandem box = the `channel` rate.
- Seed updates touch only rows still on the placeholder.

**§13** Material cost by area (an estimate), separate from the cutting list. `unitPrice`'s meaning changed. *Superseded by §42 (real area).*

**§14** Fabrication and others rates; cost basis vs selling basis; the margin idea. *Margin placement superseded by §15.*

**§15**
- `unitPrice` is decorative: never read by `calculateBOM`.
- Margin is distributed into every displayed line, so the lines sum to the total.
- Margin is per PROJECT (`layouts.margin_percent`), not on the rate card.

**§16**
- Quote toggle and margin sit at the top of the sidebar.
- Errors and warnings use `Alert`; amber is a className on `default`, not a new variant.

**§17** First-run checklist.
- "Done" is computed from real state, never a flag.
- Dismissal is per business, in localStorage.

**§18**
- Inspectors and toolbars use shadcn Select and Checkbox.
- Radix `Select.Item` can't take `""`; use a `'__none__'` sentinel.

**§19** Glass doors, priced per sq ft by tint (`glassRates`).

**§20**
- Glass is allowed on single/double door, drawers and open shelf.
- Fixed: glass area was double-charged as board and finish.
- A clear-glass door shows a sealed carcass behind it. That's a known open design question.

## UI, library and checks (§21–§34)

**§21** Inventory and import grids moved to shadcn controls. A control's type is never changed during a mechanical conversion.

**§22**
- Consistency scale written down (`PRINCIPLES.md`).
- Keyboard: Delete, Escape, arrow nudge; gated to the canvas view; `nudgeFootprint`.

**§23** Pantry is a real `ModuleType`. `frontLayout` doesn't survive Excel, so a type was needed. Every `ModuleType` enumeration site must be updated; some aren't compiler-enforced.

**§24** Kitchen checks are advisory.
- Use `nearestWall` (by centre), not `isAgainstWall` (by edge). The edge test caused phantom aisles at corners.
- Landing-counter gap tolerance is 150mm, not 60.

**§25** Gola/edge profile on a trolley goes vertical (it's a FrontKind property).

**§26** Manual gola orientation override, for doors only.

**§27**
- Rectilinear rooms deferred (15–20 files).
- Added fridge, microwave, dishwasher and water-purifier types.
- Stale comments corrected in place.

**§28** Present mode is a new screen. The plan is made read-only with a `pointer-events-none` wrapper. The price reveal is a deliberate act.

**§29** Visual assets.
- Verify current state before doing a stale brief.
- HDRI combined with Lightformers.
- Metal textures on the sink and chimney fallbacks.
- Pendant GLB wired.
- Seed `on conflict do nothing`, never `do update`.

**§30** Present-mode breakdown mirrors the sidebar's rows, including zero-capable ones.

**§31** Issues files: trust neither a filename nor a list's shape; check each item against `ISSUES-FIXED.md`. Got it wrong twice in one investigation.

**§32**
- Fridge work-triangle legs (max distance only).
- Cmd+C / Cmd+V duplicates.
- Cabinet reach vs room walls.
- One `DesignAlertsPanel`, filtered by selection.

**§33** Door swing is a true sector, overlap-tested with SAT.
- The epsilon comparison was backwards; adjacency is now a test case.
- One shared `carouselDoorArc` / `winningReachRow` for both the drawing and the check.

**§34** `sent_at` records the first WhatsApp share only. "Freeze & send" was renamed: it never sent anything.

## Charges (§35–§40)

**§35**
- Area pricing is permanent (Principle 2).
- `sheetWasteFactor` is seeded at 1.
- **Nothing reachable from `PricingContext` may be generated non-deterministically on load.** Random ids made every quote stale.

**§36** Project lump sums at the typed price, no margin. *Superseded by §39.* The invisible Save button was fixed with a sticky bar.

**§37** "Others" is one list with a per-row basis (sq ft / cabinet / lump sum). A rate-card lump sum is a marked-up cost charged once per project.

**§38** Labour is the first two rows of that list (fixed ids). The `showOnQuote` tick only changes presentation. Old labour columns are written as 0 so deletion sticks.

**§39** A project can override the whole list (`layouts.charge_rates`; undefined = follow the business). `applyMargin` per row. Margin = (cost − unmarked) × %.

**§40** "Add margin" tick on the rate card too; both lists are identical.

## Cutting list and boards (§41–§54)

**§41** The carpenter's convention became `construction_settings`, with every alternative selectable and an "assumed" banner until confirmed. Half-mm rounds DOWN (a doubled half-mm made doors 1mm too wide). *"Never priced" is superseded by §42.*

**§42**
- Board lines (material × thickness × ₹/m²).
- Per-panel `PanelSpec`: catalogue default, cabinet override.
- **Board priced on real cut-part area.**
- Construction is a priced input: required in `PricingContext` and fingerprinted.
- Material cost rose roughly 2.5–3×.

**§43**
- Workshop settings page.
- Rails vs full top belongs to the cabinet (`topStyle`).
- A board line in use can't be deleted (`boardUsage.ts`).
- Only priced boards are offered.
- The rate card draft merges a board added elsewhere.
- Never run Prettier.

**§44**
- Cabinets pick a board line (`carcassBoardId`).
- **Adding a board never moves an existing cabinet.** The fallback is the legacy 18mm line, not the thickest.
- Principle 12: workshop settings are optional.

**§45** Cabinet Designer.
- Draft until Save; `normalizePanels` / `samePanels`.
- `updateCabinets` is one undo step.
- The Designer has its own Back slot; reusing `previousView` caused a loop.

**§46**
- Key loading on `session.user.id`, never on `session` identity (it reloaded the catalogue on every tab focus).
- The 3D preview draws the actual parts from `CutPart.boxes`.

**§47**
- Depth convention setting (`depthIncludesFront`).
- Rails follow the top's corner rule.
- Confirmed settings lock.
- Edge banding only on customer-facing edges.

**§48** The cutting list is never edited directly. Changes go upstream: extra shelves (`extraCount`), extra parts, loose parts. The shelf rate became "supports & fitting" ₹80, fixing a §42 double charge.

**§49** Nesting: Jylänki guillotine (panel-saw-cuttable), all rules × orderings. Kerf, trim, grain. An oversize part is reported, never dropped.

**§50** Dimension lines on the sheet drawings. A thin strip gets a compact label. Render to an image and look before shipping.

**§51** One measured waste factor; every sheet counted in full.

**§52** Sheet sizes per board line (`sheetSizes`). Choice rule: fill, then finish on the smallest size that fits.

**§53**
- Waste mode: approx (one factor) or calculated (per board, measured live by `measuredBoardWaste`, cached).
- Calculated mode equals the true sheet cost exactly.

**§54** **A whole-row upsert from a partial source must merge onto the stored row.** The Excel re-import wiped fronts, handles, panels, boards and extra parts; all importers were fixed.

## Tests and production detail (§55–§67)

**§55**
- Vitest, tests beside the code.
- Prices are pinned to the seeded placeholders on purpose.
- Re-adding an old bug proved the tests bite.

**§56** Drawer boxes, tandem or wooden. Runner length is automatic; deductions are Workshop settings. A 3-drawer unit gained +₹1,462 of board.

**§57**
- Fronts are cut from the carcass board by default.
- `stockKey` decides the sheet stack.
- Grain is fixed only for pre-laminated patterned fronts.
- A drawer front replaces door area; drawer boxes add board.

**§58** Edge banding ₹/m on exact metres. Default ₹0, to avoid a double charge with the old per-sq-ft row; the rate card warns if both are set.

**§59** Per-sq-ft charges (labour) bill on TOTAL cut-part area plus glass. Base unit 7.0 → 22.7 sq ft; the ₹150 placeholder needs lowering.

**§60** The cutting list is frozen with each quote (`quotes.cut_list`; boxes dropped; groups rebuilt on thaw). The sheet layout is recomputed, so the parts are what's guaranteed.

**§61** Depth convention everywhere.
- `effectiveConstruction` (project override) is the one resolver.
- `physicalCabinet` grows the FRONT only.
- Drag reads physical and writes stored.
- Editors and pricing keep stored cabinets.

**§62** Corner carousel's real parts:
- returns and two backs
- pentagons priced on their bounding rectangle, with diagonal banding (`extraEdgeBandMm`)
- a 503mm diagonal door (`PartBox.rotY`)

**§63** Glass order sheet (`CutList.glass`), frozen too. The thickness column is left blank.

**§64** Cutting list PDF and part labels (24 per A4). jsPDF Helvetica can't print ₹, arrows or ⟲.

**§65** Shutter thickness comes from the fronts board everywhere (`frontThicknessMm`). Edge-banding tape thickness isn't needed; the carousel simplifications are kept.

**§66** Screen tests (RTL + jsdom, `resetStore`). **A control that only appears in the right state is a control nobody finds.** The frozen-list dropdown is now always shown, and the page loads quotes itself.

**§67** All frozen versions are on the quote, each with its PDF and cutting list. WhatsApp share stays on the latest version only.

**§68** UI overhaul's theme ("Calm workshop") lives in `src/index.css` tokens, incl. new warning/info/success. Rebuilt screens use tokens, never raw greys/hex or text-[11px].

**§69** Pipeline gains Installed and Lost (reason required by the `StatusChange` type). New project columns are written only by `lib/customers.ts`, never `projectToRow`. A changed constraint must be dropped and re-added in `schema.sql`.

**§70** App shell + Home + Customers + Settings built. Pipeline rules in `lib/pipeline.ts`. Card menus are flat (submenus close in jsdom and are fiddly on touch). `businesses` RLS was off; fixed.

**§71** Catalogue = `CatalogueSection` frames, most-used-first order, help behind "How this works"; sidebar sub-list with scroll-spy; cutting list reachable from a customer card.

**§72** Production page (approved + in-production jobs; cutting list, install date, move along). Named Production to avoid clashing with Settings → Workshop. Cabinet Designer needs a scope banner when rebuilt.

**§73** Premium A applied (dark forest sidebar + brass, shadow-card, eyebrow headers, material photos on design cards). Sidebar: Home · Customers · Production · Catalogue · Rate card · Workshop · Settings; phone uses More.

**§74** `npm run screens` = Playwright photos of every shell page at 3 sizes, using a separate read-only test login (`.env.e2e.local`). Sign-in screen redone in Premium A, checked by screenshot.

**§75** First screenshot pass. Phone overflow had 4 causes (unsized grid, fieldset min-width, fixed grid columns, non-wrapping buttons); overflow is now asserted on every screenshot. Customers board columns are fixed 280px and scroll.

**§76** Catalogue = read-only lists + one `EditPanel` (slide-over / full-screen on phone) for every section; shared `CatalogueKit` + `useItemEditor`. Dropdowns need `h-11!`. Duplicate handles/cabinets found in data (not deleted).

**§77** Rate card = 5 SectionCards (general SectionCard from §71), roomy rate rows, charge and board cards (`NamedAmountList comfortable`; sidebar stays compact), one floating save bar.

**§78** Settings → Business renames `businesses.name` (new RLS update policy). A refused RLS update returns 0 rows, not an error, so the code checks the rows.
