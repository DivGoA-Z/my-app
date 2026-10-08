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

**§79** Waste factor = board cost only (area × rate × factor); live example on the rate card. Workshop page = SectionCards + option cards whose examples are cut by `cabinetCutParts`.

**§80** Duplicates merge: same normalised name + same kind; move references (designs fresh, open design in memory, catalogue rows) THEN delete; frozen quotes untouched; groups with differing copies flagged. Rate card/Workshop full width.

**§81** Design editor stage 1: `DesignEditor` frame (top bar with Plan/3D/Elevation views, rail with one tool panel, measured plan size shared by all layers, inspector-or-quote right panel, bottom bar with checks/undo/total/Finalise). Old toolbars/inspectors reused until stages 2-3.

**§82** Editor top bar z-40 (Room pop-up was under the quote). Elevation embedded and sized. 3D wall view = `Room3DCanvas wallView` (camera across the room, wall behind hidden).

**§83** Cutting list page redesigned (sticky header with Excel/Labels/Print, view switch, stats strip, board SectionCards, chip cabinet refs). Editor shows a Cutting list icon below lg.

**§84** 3D wall view = only that wall + items against it; neighbour-wall corner pieces as grey ghost blocks (`lib/wallView.ts`). Quote panel toggle in the editor. Cutting-list buttons labelled as downloads.

**§85** Editor stage 2: Cabinets as picture tiles (`CabinetThumb`, front drawing filled with the finish), Appliances tiles, Pillars preset tiles + custom form, other panels restyled.

**§86** Editor stage 3: cabinet inspector (quick actions, big finish swatches, front picture tiles, alerts folded); quote panel pricing fold (closed = Selling), margin note only in Cost view, stacked cabinet rows.

**§87** Editor stage 4: phone top bar (Room icon + More menu), tools as bottom strip, panels as bottom sheet; Add part button.

**§88** Room button toggles; plan display ticks moved to their own Show button (checks button = problems only); cutting-list download caption replaced by a download arrow on each button.

**§89** Present mode restyled, price as right-hand panel; plan origin centred in computeRoomScale (tested); plan display button renamed "Guides".

**§90** 3D controls restyled ("Look from"; 360° tools + calibration in one fold); 3D overlay and 360° viewer restyled; fix: editor main lacked min-h-0, squashing the phone tool strip in 3D.

**§91** Drag to place from Cabinets/Appliances/Pillars tiles: preview outline with front edge; auto-turn to face the room within depth (≥600mm) of a wall; cabinets snap in physical size then convert to stored (§61); touch = hold or sideways move. lib/placement.ts tested.

**§92** Elevation drawing: running dimension chains outside the drawing (base/wall runs, heights, overall, gaps amber; lib/elevationDims.ts, tested; cabinets keep widths under a straddling hob). 3D wall view: neutral backdrop, 20° lens, corner ghosts clipped to the corner, no ceiling pendants, shadow key light, phone fills height. 3D floating inspector only in Present mode.

**§93** 3D wall view backdrop picked to contrast: area-weighted perceptual lightness of units + uncovered wall (lib/backdrop.ts, tested); ≥0.78 → dark backdrop, else light.

**§94** Quote PDF business profile from the businesses row (was .env): phone/logo/GSTIN+show_gstin columns, Settings → Business with logo upload (own-folder storage policy) and header preview; GSTIN check-char validation; PDF embeds Plus Jakarta Sans subset for ₹ (falls back to Helvetica/Rs.); branding is current, not frozen.

**§95** Sidebar business mark shows the uploaded logo on a white tile; initial as fallback (also on image error).

**§96** Customer notes: optional box on New customer, Notes/Add notes in the card menu (dialog), first line shown on the card; updateCustomerNotes checks zero-row RLS refusals.

**§97** Image brief (3D view button): PNG of the current view + `kitchen-render-brief/v1` JSON (`lib/renderBrief.ts`) with mm boxes, per-wall left-to-right order, finishes, fronts, appliance relations, openings, lights, camera, counts, `notInThisRoom`, and generated instructions/prompt/negative prompt. Physical cabinets; no customer data or prices; snapshot rendered on demand (no preserveDrawingBuffer), editor markers hidden.

**§98** Image brief's reference is now ONE four-wall elevation sheet (`lib/elevationSheet.ts`, SVG→PNG via `lib/svgToPng.ts`) drawn from the brief: real fronts and handles, counter, appliances as shapes, openings, hatched pillars, neighbour corner sides; labels outside, no colour. Never draw what the data doesn't say (fridge split, bowl depth). 3D still is opt-in. `referenceImages[]` replaces `referenceImage`.

**§99** Top view: elevation tab's wall picker gains **Top view** (Drawing = `PlanTopView`, the exported plan SVG; 3D = `Room3DCanvas topView`, orthographic, north up, `up` −Z). Sheet is 3×2 (plan + key, four walls). Stored `'in-left'` = hinge at the wall's START = your RIGHT on south/west: brief records `door.hingeSide` as faced (`hingeSideFacingWall`). No duplicate SVG attributes (browser won't load it).

**§100** Condensed prompt: `imagePromptCondensed` (≤200 words, fixed order, materials grouped by run, no refs/mm/brands; whole optional sentences dropped over the cap) alongside the full `imagePrompt`. Negative prompt = generic terms + `notInThisRoom`, deduped, comma-free phrases, never `'island'` generically. The JSON is export-only; nothing in the app reads it.

**§101** Leonardo: Phoenix has NO edge/depth guidance (SDXL-only, preprocessor 19/20), so structure lock = Vision XL + PhotoReal v2 + Alchemy + Edge to Image `strengthType: High`, 1024×576 (Alchemy ≤1024). No "INTERIOR" preset; no "octane render". Guide image = `renderStructure` line render of a STANDING camera (textured still dropped). `-leonardo.json` has ready bodies; nothing calls the API (key must be server-side).

**§102** A camera is a saved VIEW: optional `pitchDeg` (+ up) and `fovDeg` on `CameraNode` (JSONB, no migration). Height/Tilt typed in the Cameras panel (commit on Enter/blur, clamped — never per keystroke). 3D "Save this view" stores heading/tilt/lens via `lookAnglesFromDirection` (same 'YXZ' order as drag-look; round-trip tested). Leonardo pack = guide + JSON only (depth map was uploaded by mistake).

**§103** Cameras panel move pad: hold Forward/Back/Left/Right/Up/Down to glide the picked camera (camera-relative, 300/200 mm/s, clamped in the room); rAF loop on pointer down/up with capture; one undo step per press via the store's signature debounce. Walkthrough effect split: moving re-targets position without resetting an unsaved look-around.

**§104** First Leonardo run (Lightning XL, Edge High): exact geometry but drawn "stitched" edges and lost colour. Request now Edge `Mid`; `LINE_ARTEFACT_TERMS` lead the negative; `promptShort` (≤400 chars, colours first) + `negativePromptShort` (≤300) for the free plan; full `prompt` capped at 1,500 chars (Leonardo's box limit, paid plans too). Prose fixes: a/an by sound ("an RO"), acronyms kept, sizes stripped from labels, no repeated finish words. Next lever, untried: a shaded clay guide.

**§105** Tried Leonardo (Lightning/Flux), Gemini, Qwen on one design: only Gemini (JSON + guide image) kept layout and look. One "Image brief" button, no model named: at a camera → `-guide.png` line drawing + JSON; free orbit → plan/walls sheet + JSON. Leonardo code removed (kept on branch `leonardo-pack`); short prompt/negative now model-neutral in the brief.

**§106** Sign-up with APPROVAL: "Create an account" makes a login only; no business → "Waiting for access" screen; you link them in SQL (`docs/DEPLOY.md`). No browser path to create/join a business (no insert policies). Fixed a hole first: storage uploads/overwrites in 3 buckets needed only a login — now need `current_business_id()`. Re-run `schema.sql` before enabling sign-ups in Supabase.

**§107** Separate businesses: `approve_new_business(user)` (SQL editor) creates a business and COPIES the master starter (`biz_starter`, filled by `refresh_starter_catalog`) in; ids `<biz>:<orig>`, cabinet finish/handle remapped. Each business saves its own default and goes back to it (edits reset, deleted return, added kept). No super-admin bypass in the app's RLS. Storage writes only in `<business_id>/`. `supabase/isolation_check.sql` proves it (rolls back); verified locally, must be run in real Supabase.

**§108** 3D "hang" measured (real design, prod build, writes blocked): first 3D open froze ~4 s compiling shaders (`onFirstUse`), idle 3D burned 26% CPU (60fps loop), reopening rebuilt everything. Fixes: `frameloop="demand"` + `invalidate()` (camera ease, exposure, late textures; hotspot pulse 3 s), `compileAsync` warm-up behind "Preparing 3D…", editor 3D tab kept alive (`active` → frameloop never). Idle 26%→3%, reopen 0.67 s→0. CLAUDE.md was wrong: the React Compiler is NOT enabled, only its lint rules.

**§109** The 360° viewer opened facing the opposite way: the capture centres the image on south (+Z) and the viewer opens on the centre. `panoramaStartView(heading, tilt)` gives it the start yaw (heading + 180° with the default mirror); all three viewers pass the camera's heading and tilt. No re-capture needed. Black top of 360° photos = a transmissive glass material breaking the cube render; capture now turns transmission off for the shot and hides camera markers; ceiling always drawn. Model addresses must end in .glb/.gltf (`lib/modelUrl.ts`).

**§110** Move pad on the 3D view: at a camera it moves the camera; in free orbit it glides the view (forward level, camera + orbit target together; `orbitMove`/`applyOrbitStep`, OrbitControls `makeDefault`, `invalidate()` per step). Sink countertop cut already exists — needs the sink row's cutout size.

**§111** New appliance models were 15–25 MB (≈290k triangles, 3–4k PNGs); `gltf-transform optimize` (meshopt + WebP 1024 + gentle simplify 0.3/0.0003) → 0.84–0.86 MB (faucet sink 4.2 MB, won't simplify). Harder simplify dented the shading. No Draco (CDN decoder). Recipe in `public/models/README.md`. Three duplicate .glb copies in `supabase/` untracked + ignored.

**§112** Gemini Flash Lite painted the refs (C3, O1…) onto the image. Instructions now open with "NEVER DRAW ANY TEXT… codes are for your reasoning only"; full prompt and negatives forbid letters/numbers/labels/codes; short negative leads with "text or labels". Heavier model for customer images.

**§113** Image brief at a camera adds `-colour.png`: the 3D view, same camera and size as the line drawing (aligned pixel-for-pixel), as a placement reference for which finish goes where; the brief says not to copy its CG look. To A/B against line + JSON only.

**§114** Camera route brief has NO codes (`refs: false`: descriptions and counts in all text; `withoutRefs` drops `ref` fields) — a light model painted them. Instructions open with a per-design "ADD NOTHING" list (bare counters, walls/backsplash, only the placed lights, no sockets, no window scenery), mirrored in the negatives. Shortlist: ChatGPT (most photographic, invents styling) vs heavier Gemini.
