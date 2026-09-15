# Decisions and bug history

Read on demand. `CLAUDE.md` has the rules; this has the reasons, and
the record of what was tried and broke.

**Provenance note.** This was written by reading the codebase, and most
entries can be traced to a comment in the file named. Where reasoning
was not recoverable from the code it says **reason not recorded** rather
than guessing. Some entries carry a specific number (a ripple
percentage, a light-budget figure) that came from modelling the maths
in Python rather than from a render — those are marked *calculated, not
observed*.

---

## 1. Data model

### JSONB arrays instead of child tables

Cabinets, appliances, obstacles, walls, cameras and fixtures are JSONB
arrays on the `layouts` row. The header of `supabase/schema.sql` gives
the reason: they are always read and written as a whole array together
with the layout, so normalising them would add round-trips for no
benefit at MVP stage. Revisit if individual cabinets ever need
server-side querying.

**Consequence that matters:** `layouts.updated_at` bumps whenever
*anything* in the layout changes, including a camera nudge. See §2 on
quote staleness, where this is decisive.

### `text` ids, generated client-side

Stated at the top of `schema.sql`: the app already makes its own ids
(`crypto.randomUUID()`, or `proj_001` in sample data), so Postgres does
not need to generate or validate them.

**Bug:** the `quotes` table was first written with
`id uuid primary key default gen_random_uuid()` and a `uuid`
`project_id`. Postgres refused the foreign key outright —
`incompatible types: uuid and text`. The convention was documented on
line 17 of the very file being appended to. Fixed to `text` with
client-side generation.

### `projects` table, "customer" in the UI

`CustomerProject` maps onto `projects`. The mismatch dates from a
Supabase migration. Renaming would require a real migration for no
functional gain, so the schema keeps `projects` and the UI keeps
"customer".

### Idempotent `schema.sql` as the migration mechanism

Every statement is `if not exists` / `on conflict do nothing`. Two
purposes: re-running the file is always safe, and — specifically — a
business that has repriced a seeded handle or rate keeps its edit. There
are no numbered migrations.

---

## 2. Pricing

### `calculateBOM` takes one required `PricingContext`

**Rejected:** six positional parameters, five with `= []` defaults.
That was the original signature and it produced the same bug twice: a
caller that omitted `handles` got a quote with ₹0 of hardware, silently,
with no type error, because an empty catalogue is a *valid* empty
catalogue. The displayed quote and the saved project total could
disagree about the same layout.

**Chosen:** one object parameter, required, no default. A missed field
is a compile error at the call site instead of a wrong number in front
of a customer. `layout` is the only optional field, because its absence
is a real state (pricing a bare cabinet list has no room) rather than
an oversight.

Both call sites — `src/hooks/useBOM.ts` and `saveProject` in
`src/store/layoutStore.ts` — must pass the same context.

### Rates: one editable row, no version history

Most prices already lived on the thing priced: `surface_finishes
.price_per_sqm`, `handles.price`, `light_fixture_catalog.price`, and
`unit_price` on cabinet and appliance catalogue rows. Only two were
hardcoded — labour per sq ft in `bom.ts`, and the four hardware rates in
`fronts.ts`. Both carried comments promising a settings table; that is
`rate_cards`.

**Rejected:** versioned rate cards. Because a quote freezes its own
snapshot, an old quote already carries the numbers it was priced with
and does not need an old rate card to stay correct. Versioning would be
a second history of the same facts — the one nobody maintains.

`hardware_rates` is one JSONB column rather than four columns: the set
of hardware types is defined in TypeScript and has already grown once
(`shelf` arrived with parametric fronts), and it is never queried or
aggregated in SQL.

`CardPricedHardware` is derived as `Exclude<HardwareSpec['type'],
'handle'>` rather than written out, so adding a hardware type is a
compile error until a rate exists for it. `handle` is excluded because a
handle's price is a per-product catalogue value — two bar handles are
genuinely different products — while a hinge is a hinge.

### Quotes freeze on send

Everything else in the app is live, which is right while designing and
wrong once a number has been given to someone. If labour moves ₹150 →
₹180, a quote approved last month must still read ₹150.

So a `quotes` row stores the computed `BOMSummary` **and** the
catalogues it was computed from. The denormalisation is the point: the
catalogue is mutable and the snapshot must not be. A frozen quote stays
readable even if every finish it referenced has since been deleted.

A revision is a **new row at `version + 1`**, never an edit, so what was
actually sent survives. `quotes_project_version_idx` is unique on
`(project_id, version)`, which is what makes a double-clicked
"Freeze & send" fail loudly instead of creating two v2s — the version
number is read just before the insert, and that race is deliberately
left to the database rather than handled with a transaction.

There is no delete. Deleting the record of what you quoted someone is
not a feature.

### Staleness is a content fingerprint, not a timestamp

**Rejected:** comparing `layouts.updated_at`. It fails in both
directions.

- *Too sensitive.* Cabinets and appliances are JSONB on the layouts row
  (§1), so that timestamp bumps on every save — renaming the layout,
  nudging a camera, dragging the exposure slider. None of those change
  a price, and all would mark the quote stale, which trains people to
  ignore the warning.
- *Not sensitive enough, and this is the dangerous half.* The rate card,
  finishes, handles and the fixture catalogue are their **own** tables.
  Repricing a handle moves every open quote's total and touches
  `layouts.updated_at` not at all. The quote would read "current" while
  the numbers under it had moved.

**Correction on the record:** an earlier version of this reasoning —
written into `types/quote.ts`, `schema.sql` and a handoff prompt —
claimed cabinets were a separate table and that a cabinet move would
therefore miss the timestamp. That was **wrong about the mechanism**
while landing on the right design. Corrected rather than quietly
deleted, because the wrong reason was about to be copied into a
permanent document.

The fingerprint (`computeQuoteFingerprint`, `src/types/quote.ts`) hashes
*everything* in the priced inputs rather than an explicit list of priced
fields. That is a deliberate choice of failure direction: hashing
everything can report stale when something cosmetic changed; an explicit
field list can report current when something priced changed and was left
off the list. A needless revision is a wasted click; a missed one is a
wrong price. `updatedAt`/`createdAt` are excluded because they move on
every save without meaning anything.

FNV-1a 32-bit, not a crypto hash: this detects accidental change, not
forgery, and `SubtleCrypto` is async — making staleness async would put
a promise in a render path for nothing. A collision costs one missed
hint, not a wrong price, since the frozen summary is what renders either
way.

`fingerprintPricedInputs` in `src/lib/quotes.ts` is the single place the
hash input is assembled, called by both the freeze path and
`useQuoteStatus`. Two call sites building that object independently
would make every quote read stale the instant it was created.

### Surface cost categories

EXPOSED / CONCEALED / OCCUPIED / VOID, precedence void → occupied →
concealed → exposed (`src/lib/surfaceAreas.ts`).

- CONCEALED is a separate *rate*, not a discount: the cheap tile goes
  where nobody sees it.
- OCCUPIED is reported but never charged — a pillar means there is no
  surface there to finish.
- VOID is doors and windows, reported separately from occupied because
  the two answer different client questions ("there's a pillar in the
  way" vs "we don't tile the doorway"). A 900×2100 door is 1.89 m² that
  was previously being charged for.

An opening still prints on the quote at ₹0 when the builder supplies it.
Deliberate: an opening that silently vanished from the paperwork is how
a site argument starts about whether a door was included.

Light fixtures likewise always print, even when
`layout.priceElectrical` is off — the whole design of the global
toggle. The business may not do the electrical work, but the fixtures
are part of the design, and a lighting plan missing from the paperwork
is how a client ends up without the under-cabinet light they believe
they agreed to. `fixtureSpecifiedTotal` shows what it *would* come to.

---

## 3. Cabinets

### Three orthogonal axes

- **Substrate** (`MaterialType`: HDMR / Plywood / MDF / Particle Board)
  — price and durability only. A finished cabinet never shows it.
- **Finish** (`SurfaceFinish`) — appearance, and priced per m² of
  shutter area.
- **Front layout** (`FrontLayout`) — structure.

Keeping them separate is what lets a laminate and an acrylic differ in
price *and* gloss without either touching the carcass.

### Hardware is derived, not stored

`effectiveHardware` (`src/lib/fronts.ts`) derives hinges, channel pairs,
baskets, shelves and handles from the front layout. An explicit
`item.hardware` array still wins, so a one-off fitting can be entered by
hand.

**Bug:** the quote read `item.hardware` directly, and nothing ever wrote
that field — so hardware cost ₹0 on every cabinet in every quote.

Panels and hardware come out of **one subdivision pass**
(`computeFrontBreakdown`) so the renderer and the quote cannot disagree;
a cabinet showing three drawers and billed for two was the failure mode
being designed out. That is why the 3D renderer reads a rate card at
all — noted in `Room3DCanvas.tsx`, with the observation that if the
coupling ever gets in the way the fix is to split geometry from costing,
not to pass a placeholder rate card.

`false-front` exists because a sink cabinet's front panel costs a
shutter's worth of material and finish but has no hinges and no handle —
it cannot be modelled as a door.

### Cabinets must never get a `modelUrl`

**The rule:** `modelUrl` belongs on things whose shape is fixed and
bought; parametric geometry belongs on things whose shape is derived
from the dimensions the quote is priced against.

- **Appliances** — mesh. A microwave is a manufactured object at a
  catalogue size.
- **Fixtures** — mesh, for the same reason. (Not yet implemented; see
  §5.)
- **Cabinets** — never. `ApplianceModel` scales **per-axis** to stored
  dimensions, so a 600 mm cabinet GLB stretched to 900 mm would smear
  the shutter, stretch the reveals and grow the handle with the door —
  the exact failure parametric fronts were built to avoid.
- **Handles** — split by kind. `bar`, `edge-profile` and `gola` are
  length-parametric (128 mm and 320 mm are the same shape at different
  lengths; stretching a mesh would deform end caps and mounting
  bosses). **`knob` is the sole exception** — a fixed object with one
  meaningful dimension whose shape is the thing being sold.

Do not add the field speculatively. There is no cabinet, handle or knob
GLB in `public/models/`.

### Handles are their own table, not a `SurfaceFinish`

The note on `HandleSpec` (`src/types/front.ts`) argues it: handles are
solid metal, priced per unit or per running metre, and share none of a
laminate's pattern/tiling machinery. Reusing `SurfaceFinish` would mean
carrying texture fields that never apply.

`pricingMode` is `per-unit` or `per-metre` — bar handles and knobs are
bought per piece; gola and edge profiles are cut from stock and billed
by length. Charging a per-metre profile as "one handle" is how a quote
ends up thousands short on a large kitchen. The same distinction
appears a third time on fixtures.

Deleting a handle placed cabinets still reference is allowed, not
blocked: `resolveHandle` falls them back to the default so they keep
drawing and keep pricing. Blocking it would mean a business could never
retire a discontinued handle without editing every old layout.

---

## 4. Openings (doors and windows)

### Coordinate-grid rectangle decomposition

`wallSegments` (`src/lib/openings.ts`) builds a coordinate grid from
every opening's edges, discards covered cells and merges horizontally.

**Rejected:** a 1-D band sweep, which was the first implementation and
was wrong for overlapping openings. The invariant now holds exactly:
*segments area + void area == wall area*.

Overlapping openings are a **hard error**, checked in 2D
(`overlappingOpeningPairs`), covering door/window/pass-through in any
combination.

### Door swing clearance includes obstacles

`detectClearanceIssues` (`src/lib/clearance.ts`) checks the swing zone
against cabinets **and** obstacles, using each obstacle's own
floor-to-ceiling span, with `isStructural` distinguishing an unmovable
conflict from a movable one. Obstacles were missing at first, so a door
swinging into a pillar wasn't flagged.

### Backdrop plane geometry

`BACKDROP_DISTANCE_M = 0.6`, `BACKDROP_OVERSIZE = 2.6`. Both matter and
each failure looks like a different bug: a plane *at* the wall loses all
parallax and slides with your head like a sticker; a plane sized exactly
to the opening shows its edges the moment you look through at an angle,
which reads as the image peeling.

---

## 5. Lighting

The longest bug history in the project. Read this before touching
`src/lib/lighting3d.ts` or the light code in `Room3DCanvas.tsx`.

### Removed fakes

- **Automatic under-cabinet lights** (`getLedStripPlacements`) put a
  warm point light under *every* elevated cabinet. It looked like a
  feature and behaved like a bug: derived from cabinet elevation rather
  than from any decision, it could not be moved, switched off,
  recoloured or priced, and appeared on cabinets nobody had specified
  lighting for. Every render approved before its removal was lit partly
  by hardware that did not exist and would never be installed.
- **The fake sun.** A shadow-casting directional light standing in for
  daylight nobody had placed. It is now a *viewing* light that casts no
  shadows — kept because a physically dark room is useless to review,
  but honest about representing nothing. Shadows now come only from
  window daylight. Consequence: an empty room with no openings and no
  fixtures looks identical in all three lighting modes.

### `decay = 0` — the big one

Fixtures used `decay={0}`, which removes distance attenuation entirely.
Every surface within reach was lit identically: no pools, no gradients,
and a pendant flooded the room uniformly. This was **the** reason
placing a light never appeared to light anything, and it was reported
twice with screenshots before being found.

Fixtures now use `FIXTURE_LIGHT_DECAY = 2` (physical inverse-square).
`FIXTURE_LUMEN_SCALE` was recalibrated as a direct consequence.

**Window daylight deliberately still uses `decay = 0`** — on physical
grounds, since sunlight through an opening does not attenuate
measurably across a 3 m room.

### `SpotLight.target` must be in the scene graph

Setting a declarative `target-position` prop silently aims the light at
the world origin. three.js only updates a target that is *mounted*. Fix:
a real target object mounted with `<primitive object={target}>`. This
bit window daylight first, and the note on `DaylightThroughOpening` is
where it's recorded.

Related: aiming a window's cone at the wall plane converges it on the
wall and almost nothing reaches the floor, which reads as the opening
glowing rather than light entering. `DAYLIGHT_THROW_MM = 3500` aims well
into the room.

### `toneMapped={false}` on the fixture body

Exempted the body from the scene's exposure curve, so it displayed at
full brightness however dark or bright the room was. This is the
mechanical reason a fixture could look blazing while contributing
nothing. Now `toneMapped`, so it passes through the same exposure as
the light it casts.

`meshStandardMaterial` with emissive rather than `meshBasicMaterial`:
basic would ignore the room's light entirely and the fitting would look
like a flat cut-out when switched off.

### The `<Environment>` panels are not occluded by geometry

`Room3DCanvas` uses four hand-built `<Lightformer>` rectangles rather
than an HDRI. (`preset="apartment"` was rejected: it fetched a stock HDR
from drei's CDN at runtime, and any glossy surface *reflected* it — a
photo of someone's hallway, wooden door and all, mirrored in the kitchen
floor.)

**The bug:** those panels are an image-based light. They sit at x = ±4.5,
y = +4 and y = −2.5 — outside the walls, above the ceiling, below the
floor of a typical kitchen — and an environment map is **not occluded by
geometry**. Nothing shadows it; it lights straight through walls.

They were also hardcoded and ungated, so:

- they stayed at full strength while ambient and the viewing light
  receded for placed fixtures, making the environment the dominant
  source by default;
- their deliberate asymmetry (a cool `#dce9f5` panel at 1.1 on one side,
  a warm `#f6e8d8` at 0.55 on the other) painted a brightness and
  colour gradient across the ceiling corresponding to nothing anyone
  had placed;
- two of the four are **tinted**, so `true-colour` — the mode whose
  entire stated purpose is that nothing tints the finishes — was
  tinting the finishes.

Fixed by adding `envIntensityScale` and `envTinted` to
`LightingEnvironment`. Panel total drops 3.33 → 0.83 in `designed` once
a light is placed, and the side asymmetry +0.55 → +0.14. *Calculated,
not observed.*

**A correction worth recording:** the first pass left `fixtures-off` at
full environment strength, reasoning that with fixtures off the
environment is all there is. That reasoning was about *illumination* and
missed the actual complaint, which was about *reflection* — a highlight
visible in the one mode where nothing is meant to be on. It would have
fixed two modes and left the reported one untouched. Now 0.6.

The asymmetry is intentional and was kept: a perfectly uniform
environment makes polished surfaces look flat, and contrast is what
makes gloss read as gloss.

### Linear-run banding is geometric, not a sample-count problem

A wall-mounted strip set to `diffuse` showed three discrete blobs rather
than one continuous line.

The tempting fix is more samples. It does not work, and the reason is
worth internalising: a point light 60 mm from a wall
(`WALL_STANDOFF_MM`) lights a pool about 60 mm across, because `1/r²` is
dominated by that 60 mm. Samples 430 mm apart cannot merge. Modelling
it: 3 samples → 6 at the same standoff moved banding from **99.7% to
96.0%** — no improvement. Closing 60 mm pools across 2.4 m would take
about forty lights.

**Fix:** the light *origins* stand 350 mm off the host surface while the
body stays put. That widens each pool to roughly the standoff, and at 6
samples banding drops to **13.6%**. 500 mm buys only another 2%.
*Calculated, not observed.*

This required the mount's surface normal, which the placement was
discarding: `throwVector` deliberately drops `hostNormal` for `diffuse`
because a diffuse source has no throw — but the *surface* still has a
normal. `FixturePlacement` now carries `hostNormalX/Y` separately from
the throw.

Same trick, same reason, as `FIXTURE_ORIGIN_STANDOFF_M`, which exists
because an aimed light at its own body has nowhere to throw. Both are
point-light approximations of an area source.

**The correct primitive is `RectAreaLight`** — it *is* a rectangular
emitter and needs no sampling. Not adopted because it requires
`RectAreaLightUniformsLib.init()` at startup and renders **black**
without it. On three ^0.170.0 the import is
`three/addons/lights/RectAreaLightUniformsLib.js`. Worth doing; do it
with a render in front of you.

**Known gap:** the standoff fix covers wall and cabinet-front mounts. A
diffuse strip on a cabinet's `under` or `top` face gets a horizontal
offset that doesn't help, since its nearest surface is above or below.
Those faces are normally `wash` or `down` (the aimed path), so it is
rare — but it is not fixed.

### Brightness is two dials, not one

Body glow and light output had been conflated, and `FIXTURE_LUMEN_SCALE`
churned three times as a result — a symptom of one constant absorbing
feedback that belonged to another. They were split deliberately:
emissive 2.6 → 1.0, output 1/400 → 1/240. At 2.6 the body clipped to
flat white under ACES, which also worsened the banding, since a blown
highlight has no shape for the eye to join up.

### Other lighting notes

- **Colour temperature is not cosmetic.** A cool grey laminate under
  6500 K looks beige under 3000 K. A client who approves a colour in the
  render and gets a warmer kitchen on site has seen the wrong colour,
  and that is a dispute rather than a preference. `kelvinToColor` is
  piecewise-linear over six anchors — visually indistinguishable from
  the Planckian locus at interior ranges, with no colour-science tables.
- **Colour temperature is fixed per catalogue row**, not per placement:
  you stock 3000 K and 6500 K as separate products at separate rates.
- **Exposure** (`DEFAULT_EXPOSURE = 1.1`) is neither a rate nor a
  calibration constant — it changes no design data and never reaches a
  quote. It records how bright the designer wanted the picture, which
  matters once a layout opens on someone else's screen.
- **Fixture mounts are host-relative** (ceiling / wall / cabinet-face /
  free) so a strip follows its cabinet. Cabinet-mounted fixtures cascade
  on cabinet delete. A fixture whose host was deleted resolves to the
  room centre and sets `hostMissing` rather than vanishing — it is still
  a priced line item.
- **`FixtureLayer` is deliberately not draggable**, unlike every other
  plan layer. Most fixtures have no independent position: an
  under-cabinet strip is wherever its cabinet is. Dragging would either
  silently detach it or quietly do nothing. Ceiling and free mounts,
  which do have real x/y, *are* draggable.
- **`top` face clearance.** A fixture on a base cabinet's top face was
  invisible because it sat inside the 40 mm countertop slab;
  `COUNTERTOP_CLEARANCE_MM` lifts it clear.
- **Wall fixtures needed `WALL_STANDOFF_MM = 60`** or they render inside
  the 50 mm wall and are invisible.
- **Drawer lights render nothing**, by design: you only see one with the
  drawer open, and drawers are always modelled shut. Still a real BOM
  line.

---

## 6. Interaction

### One `selection`, not five ids

The store had five mutually-exclusive ids (cabinet / obstacle /
appliance / opening / fixture), each of which had to clear the other
four on every select — twenty lines saying one thing. Replaced by a
single `SelectionRef` (`src/types/selection.ts`), read through
`src/hooks/useSelection.ts` so each component still asks for its own
type's id.

The forcing reason: the overlap picker cannot express "an item of some
type at this point" against five separate fields without a switch at
every call site.

### Overlap picker

`hitTestAt` (`src/lib/hitTest.ts`) returns all candidates at a point,
sorted by height descending, using plan geometry only. `PickChooser`
opens **only on genuine overlap** — a single hit selects directly.
Whichever Konva layer catches the click, the hit test decides what is
selected, so the layers cannot disagree.

**Bug worth remembering for its shape:** three files were missing the
`usePickAt` import. The guard scanning for it was
`if 'usePickAt' not in file`, and the comment being inserted said *"see
usePickAt"* — so it matched its own text. This class of self-matching
guard has since recurred (a `HardwareRates` import silently not
landing). Never let a scanner match prose.

---

## 7. Assets

`public/textures/` — 15 ambientCG CC0 PBR sets (color + normal +
roughness, 1K JPG). `public/models/` — 10 GLBs: 3 real Poly Haven scans
(induction cooktop 2.4 MB, microwave 2.1 MB, industrial pendant 3.1 MB),
3 Kenney furniture-kit models, and 4 generated box-stack placeholders.
Credits and provenance in `CREDITS*.md`; `TEXTURE_CAPTURE_GUIDE.md`
covers photographing real swatches.

**Deliberately not wired:**

- `pendant-industrial.glb` — `FixtureCatalogItem` has no `modelUrl`
  field yet. Stated outright in `CREDITS_SOURCED.md`.
- `hob-gas-4burner.glb`, `oven-built-in.glb`,
  `sink-undermount-single.glb`, `sink-topmount-double.glb` — generated
  box stacks. A box stack pretending to be an oven reads *worse* than
  the plain parametric box, because it promises detail it doesn't have.
- `kitchen-sink.glb` — no wiring point, since `PlacedCabinetItem` has no
  `modelUrl` (§3, and it should not get one).

**Two open traps:**

- **`stone-concrete` is 1024×512**, a 2:1 image. Given square
  `swatchWidthMm`/`swatchHeightMm` it renders horizontally squashed.
  Every other set is square.
- **A 1024² JPG decodes to ~4 MB of VRAM** regardless of its ~500 KB on
  disk. 15 sets × 3 maps is on the order of 180 MB if all load at once —
  enough to drop frames or lose the WebGL context on a mid-range
  Android tab. Textures must load lazily per finish actually used.
  *Whether they currently do is unverified.*

**Physical scale is the biggest unfixed realism item.**
`SurfaceFinish.swatchWidthMm`/`swatchHeightMm` declares what real area
one copy of the albedo covers; wrong values render walnut grain four
times life size. ambientCG publishes a physical dimension per asset and
the asset ids are in `CREDITS_FINISHES.md`. **Whether the seeded values
are correct is unverified.** For the two tile sets the mm value
describes the whole repeat, not one tile — a 2×2 grid of 600 mm tiles is
a 1200 mm swatch, and getting that backwards is the classic version of
this bug.

Also: where a real `normalMapUrl` is present, the luminance-derived
relief in `textures3d.ts` should not *also* apply. Whether both
currently stack is **unverified** — check `materials3d.ts`.

`tilingMode` is `'repeat'` or `'mirror'`. Mirror exists for
photographed swatches that don't tile seamlessly; ambientCG scans do, so
mirror costs visible symmetry for no benefit on them.

`textures3d.ts` carries two notes worth keeping: albedo must be tagged
`SRGBColorSpace` while normal and roughness stay **linear** (tagging a
data map as sRGB bends its values through a gamma curve and shows up as
weirdly flat lighting rather than an obvious error); and when a source
supplies colour but no data maps, the normal/roughness slots are
**null** rather than substituting the albedo — a colour image is not a
valid normal vector field.

---

## 8. Things I could not establish from the code

Fill these in from memory before relying on this document.

1. **Whether textures load lazily** per finish in use, or eagerly. §7's
   VRAM warning depends on it.
2. **Whether the seeded `swatchWidthMm`/`swatchHeightMm` values are
   correct** for each of the 12 finish sets, and whether
   `stone-concrete` was given 2:1 dimensions.
3. **Whether derived relief and real normal maps currently stack** in
   `materials3d.ts`.
4. **The reclaimed-wood ceiling's `roughness`.** A sharp specular dot
   was observed on it; a matte wood ceiling should not mirror anything,
   which points at roughness being too low. Not confirmed.
5. **Whether the ceiling highlight seen in `fixtures-off` is
   environmental or a fixture's emissive body.** Discriminating test:
   switch to Fixtures Off and orbit — if it survives it's the
   environment.
6. **Whether `scripts/` in the live repo matches this description.**
   `fetch_models.py`, `build_placeholder_models.mjs` and
   `seed_finishes_and_appliances.mjs` are referenced by the credits
   files but were not all present in the copy this was written from.
7. **`quote_total` on `projects`** duplicates a frozen quote's
   `grand_total`. Which is authoritative for the dashboard, and whether
   the column should now be derived from the latest frozen quote, is
   undecided.
8. ~~Supabase Storage bucket configuration.~~ **Resolved:**
   `schema.sql` does create both buckets (`panoramas` and
   `material-swatches`) as public, with read and insert policies. No
   manual dashboard step is needed. See `docs/SUPABASE_SETUP.md`.
9. **Whether `npx tsc --noEmit` currently passes.** Everything in this
   project has been checked by static scan and Python modelling, never
   by a compiler or a browser.
