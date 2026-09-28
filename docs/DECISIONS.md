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

### Countertop: one finish, optional charge

The countertop/slab was visual-only until now — `CountertopMesh`
(`Room3DCanvas.tsx`) hardcoded a built-in procedural "quartz" texture,
and a comment in `cabinetGeometry.ts` said pricing it was explicitly
deferred. Fixed by reusing machinery that already existed rather than
building new: `RoomLayout.countertopFinishId` picks from the same
`SurfaceFinish` catalogue floor/wall/ceiling already use, and
`countertopAreaSqM` (`cabinetGeometry.ts`) × that finish's own
`pricePerSqM` prices it — no new rate table, no new rendering pipeline.

**One finish for the whole layout, not per cabinet.** Same reasoning
as `floorFinishId`/`ceilingFinishId` being singular: a kitchen's slab
is one continuous material in practice.

**Charging for it is a separate global toggle**
(`RoomLayout.priceCountertop`), identical in shape to
`priceElectrical` and for the same market reason: in Delhi NCR the
kitchen business usually does *not* supply the slab — the homeowner
arranges stone separately, often after the cabinets are installed. So
the countertop is always part of the DESIGN (it renders, it affects
the walkthrough) but only *optionally* part of the PRICE.

**Rejected: shipping the finish picker without pricing it.** The
obvious minimal version was "just let them pick a material for the
render." Principle 10 in `PRINCIPLES.md` — approximation is allowed,
never hidden — rules that out: a business choosing "premium granite"
vs "basic laminate" with zero price difference is worse than the
previous all-hardcoded state, because it *looks* like a real choice
and silently isn't. `countertopLineItem` always carries the real rate
and `countertopSpecifiedTotal` (what it would cost) regardless of the
toggle, same as `fixtureSpecifiedTotal` — the toggle decides whether
that number reaches `countertopSubtotal`, never whether the line
exists or what it would charge.

`countertopAreaSqM` lives in `cabinetGeometry.ts`, not duplicated in
`lib/bom.ts` and `RoomSurfacesPanel.tsx` separately — one function the
price and the on-screen area readout both call, so they can't quietly
disagree about how much countertop there is. It includes the same
20mm overhang `CountertopMesh` renders, since the finish is bought on
the slab as it's actually cut, not the carcass footprint underneath.

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

### Magnetic snap: three bugs behind "closing a small gap sends an overlap error"

- `bestSnapForAxis` (`lib/cabinetSnapping.ts`) only snaps to a
  neighbor's edge within `SNAP_THRESHOLD_MM` (40mm); past that it
  falls back to blind grid-rounding with no neighbor-awareness, which
  can land inside the neighbor. Fixed with a real 2D minimum-
  translation push-out (`resolveOverlaps`) after both axes resolve —
  a per-axis version was tried and is wrong, since a shared wall band
  on one axis looks identical to actually overlapping on that axis.
  Also raised the threshold to 100mm (40mm left almost no margin for
  an ordinary drag to land within it).
- That push-out was purely 2D (X/Y), so it also shoved a base cabinet
  away from a wall cabinet mounted directly above it — a normal,
  non-colliding Z-different stack that `detectCollisions` already
  handles correctly. Fixed by giving the push-out the same Z-range
  check `boxesOverlap` uses, excluding neighbors whose height band
  doesn't actually overlap.
- Even at a genuine 0mm gap, the red highlight sometimes stayed on:
  the committed x/y goes through an mm→px→mm round trip
  (`canvasScale`'s `scale` is never a round number), introducing
  ~1e-13mm noise that a strict `<`/`>` has no tolerance for. Fixed
  with a 0.5mm epsilon in `boxesOverlap` — below manufacturing
  tolerance, far above the float noise floor.

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

### Mixed fronts are a recursive composition, not a new geometry system

Until now `FrontLayout.kind` was a single value for the whole face — a
cabinet was entirely drawers, or entirely open shelves, never both.
Real cabinets routinely aren't: a shelf compartment over a drawer
stack, a door over an appliance housing.

**Chosen: `kind: 'mixed'` with `rows: FrontRowLayout[]`, top to
bottom, each row being any OTHER kind with its own count/hinge/
heightRatios plus a `heightRatio` for its share of the total height.**
`computeFrontBreakdown` (`lib/fronts.ts`) splits the face into bands by
`heightRatio` (a new `rowBands` helper — deliberately not `rows()`,
which reveal-reduces the width for a final panel; a band needs its
FULL width since the recursive call underneath does its own reveal),
then calls **itself once per row**, against that band's own height,
and offsets the results back into the full face's frame. Hardware from
every row is merged by type (two drawer rows read as one "Drawer
channels x5" line, and avoids a duplicate-type React key collision in
`FrontPicker`'s hardware list).

**Why recursive rather than a parallel geometry path:** nothing
downstream needed to change. The 3D renderer (`Room3DCanvas.tsx`)
already consumes `FrontBreakdown.panels`/`.shelves` generically — every
panel and shelf carries its own absolute `centerXMm`/`centerYMm`, never
assumes it spans the whole cabinet — and the quote already prices off
`effectiveHardware`'s merged array. A row is just another
`computeFrontBreakdown` call; the existing single-pass-for-panels-and-
hardware invariant (see "Hardware is derived, not stored" above) holds
inside each row exactly as it always did for the whole face.

**A row can't itself be `'mixed'`** (`FrontRowKind = Exclude<FrontKind,
'mixed'>`) — one level of nesting covers every real configuration
asked for, and a recursive tree buys nothing but edge cases (infinite
nesting, a row's row's row).

**Scoped out, deliberately:** cabinet CATALOGUE items
(`InventoryManager.tsx`'s default-front picker) don't offer `'mixed'`
as a default — only a placed cabinet's own `FrontPicker` does. A
catalogue default is a starting suggestion for new cabinets of that
type; building a second rows-editor there for a default nobody asked
for would be scope beyond the actual request. `cabinetDrawerCount`
(`lib/fixtures.ts`, used for the in-drawer sensor light quantity hint)
does recurse into rows though — a mixed cabinet's drawer row still has
real drawers, and the light hint would otherwise silently read 0.

### Three corner solutions, not one generic corner-unit

`'corner-unit'` was an inert catalogue entry (colour + label only).
Replaced with three real `ModuleType`s — `'corner-blind'` (fixed
shelves), `'corner-magic'` (pull-out mechanism), `'corner-carousel'`
(rotating shelf, diagonal door) — rather than one type plus a flag,
matching how `sink-unit`/`cylinder-trolley` are already their own
types, and giving a future "open this cabinet" animation a clean
`switch(moduleType)` seam.

Only the carousel gets the diagonal pentagon shape
(`CORNER_CAROUSEL_CUT_FRACTION = 0.4`, `CabinetLayer.tsx`); blind and
magic stay plain rectangles with an ordinary door — the mechanism is
inside, not the shape. Footprint stays a plain rotatable square for
collision/snapping regardless: the corner is real floor space either
way, and the real hardware is a square carcass with a diagonal DOOR,
not a pentagonal box.

Corner mechanism cost is keyed on `moduleType`, not `FrontKind`
(`cornerMechanismHardware`) — the one exception to "hardware is
derived from the front," since magic and blind corners can share the
same plain door. New placeholder rates: `cornerMagic: 12000`,
`cornerCarousel: 6000`.

Deferred: the interior mechanism geometry and any open/close
animation — nothing shows its interior with the door closed anyway.

Follow-up (2026-09-24): the `cabinet_catalog_items` seed row and the
CHECK constraint migration for existing databases were both left
incomplete when this was first built — see `docs/ISSUES-FIXED.md`,
2026-09-24, for what broke and the fix. `schema.sql` now migrates the
constraint itself; it no longer needs a manual step from this note.

### Carousel's 3D carcass and countertop needed the same diagonal cut, twice over

The 2D plan's diagonal cut wasn't reflected in the 3D carcass or the
countertop above it. Fixed with `cornerCarouselGeometry` (carcass,
extruded `THREE.Shape`) and `cornerCarouselSlabPointsMm` +
`cornerCutSign` (countertop) — same pentagon, same cut fraction,
computed twice on purpose: the carcass works in the cabinet's own
rotated local frame (`CabinetMesh` wraps it in a rotated group), the
countertop builds directly in room-space with no such wrapper, so the
cut corner's identity has to come from `rotationDeg` explicitly there.
Both verified numerically (rotation angle, endpoint alignment) before
trusting them visually — a sign error here misplaces the whole shape
rather than looking subtly off. A bar-shaped handle is placed
directly rather than through `HandleMesh`, which assumes a flat face
perpendicular to Z.

Known simplification: the carcass's `ExtrudeGeometry` uses THREE's
default UV mapping, not the real-world-scaled one ordinary box
carcasses get — a patterned finish could look slightly stretched on
the pentagon faces. Not worth a bespoke fix for a mostly-hidden face
unless it turns out to look wrong in practice.

### Tambour: a `FrontKind`, with shelves and an appliance picker built in

Modelled as `FrontKind: 'tambour'`, not a new `ModuleType` — "what the
front is made of" is already independent of cabinet type (same as
open-shelf/appliance-housing). Priced like `'false-front'` (material +
finish, no hinges/handle — nothing prices a track mechanism yet). 3D
renders as ridged slats (`tambourSlats`), not a flat panel, so it
doesn't read as "a door missing its handle." `FrontPanel`/`CarcassBand`
both gained a `kind: FrontRowKind` field so the 3D renderer can tell a
tambour row apart from any other, including inside a `'mixed'` front.

Shelves divide the compartment into independent slots
(`shelfBoards`/`SHELF_THICKNESS_MM`, both now exported), allowed down
to 0 via `clampTambourShelfCount` — every other count-driven kind
floors at 1, but a tambour can have the appliance rest on the bare
floor. `FrontPicker` shows one appliance dropdown PER SLOT
(`tambourSlotClearance` walks the real boundaries between the floor,
each shelf's centre, and the ceiling), each checked against that
slot's own clear height before anything is placed — an earlier
version checked against the whole compartment instead and let an
appliance render cutting straight through a shelf; verified against
an invariant (every slot's height + the walls + the shelves sums to
the cabinet's own height, for 0–3 shelves) and against that exact
reported case before calling it fixed.

Placement rests the appliance on its slot's own floor, centred on
width/depth, facing the cabinet's own direction. Linked via
`PlacedApplianceItem.mount: {kind:'tambour', cabinetId, slotIndex}`
(mirrors `FixtureMount`'s cabinet case) — cascades away if the cabinet
is deleted, the front changes away from tambour, or the shelf count
shrinks past that slot.

The shutter opens automatically once a slot is occupied
(`occupyingAppliance`, checking real Z-range overlap against that
slot, not just proximity to one plane the way a sink checks a
countertop) — a placeholder. The long-term want is an interactive
open/close animation defaulting to CLOSED, not auto-open; nothing here
should be read as final.

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

### Open carcass: 5 thin panels per open band, not a sealed box

`CLAUDE.md`'s own "Half-built" note said it outright: `open-shelf`/
`appliance-housing` fronts rendered inside a fully sealed carcass box
— ONE `boxGeometry`, the exterior finish on all 6 faces, full depth,
no opening cut anywhere. The shelf boards (for `open-shelf`) were
real geometry sitting inside that sealed volume, completely hidden
behind the carcass's own solid, opaque front face. Not "reads as a
missing door" so much as "indistinguishable from a plain closed
cabinet" — there was no way to tell from outside that anything was
different.

**Fixed by giving OPEN bands a real 5-panel shell (both sides, top,
bottom, back — no front) instead of a sealed box, and CLOSED bands
their existing sealed-box treatment, unchanged.** `carcassBands`
(`lib/fronts.ts`) returns one band for a plain front, or one per row
for a `'mixed'` front, each tagged open or closed. `Room3DCanvas.tsx`'s
`CabinetMesh` renders per band: closed → the same shortened,
front-thickness-inset sealed box as before; open → 5 thin panels
(reusing `FRONT_THICKNESS_MM` as the wall thickness, since it's
already a realistic board thickness) at the band's own height, full
`depthM`, with nothing at all where the front would be.

**Deliberately NOT `rows()`/the front panels' own band split.** That
one leaves `REVEAL_MM` (3mm) gaps between rows, correct for VISIBLE
front panels with a shadow line between them, wrong for a carcass
divider — a real cabinet's internal divider between two compartments
is one continuous board with no gap in it. Reusing the reveal-gapped
split would've put a few millimetres of nothing inside the cabinet's
own body, reading as a thin dark slit in what should be solid
material. `carcassBands` computes its own contiguous split instead,
sharing only the ratio-normalising math (`normaliseRatios`).

**Interior gets a fixed, plain liner colour — `PLASTER_COLOR` — not
the exterior finish, and not a `SurfaceFinish` catalogue row either.**
`CLAUDE.md` flagged this too: an open shelf's interior showing the
same dark-wood-grain-or-whatever exterior finish as the outside was
the other half of the "half-built" look. A real cabinet interior is a
light, cheap laminate, genuinely different from the outside. Made it
a fixed rendering convention (same as `PLASTER_COLOR`'s existing use
for an unfinished wall) rather than a new business-editable catalogue
concept — a real interior-liner-as-a-priced-choice is plausible future
work, but wasn't asked for here, and adding a whole new catalogue axis
for it would have been scope well beyond "make it look open."
Shelf boards inside an open band get this same liner material too
(they used to use the exterior finish), for the same reason.

**Handles mixed fronts for free, structurally.** Because
`carcassBands` operates per-row like `computeFrontBreakdown`'s
`'mixed'` case already does, a mixed cabinet with an open-shelf row
and a drawer row gets an open shell for just that row and a normal
sealed carcass slice for the other — without `CabinetMesh` needing to
know anything about mixed fronts specifically. Up to 5 extra meshes
per open band (worse than 1 sealed box) is the accepted cost; not
worth merging into fewer draw calls unless it actually shows up as a
performance problem on the low end of the device-quality range this
app targets.

### Sink cutout: a catalogue-row property, cut as a box frame not a boolean hole

The `ApplianceType` note on `sink` always said the limitation outright:
"countertops aren't cut, so a basin reads as sitting ON the worktop
rather than inset." Fixed by adding `sinkCutoutWidthMm`/`sinkCutoutDepthMm`
to `ApplianceCatalogItem` — sink rows only, resolved at render time via
`resolveSinkCutout` (`lib/applianceGeometry.ts`), same
catalogItemId-first order `resolveApplianceModel` already uses, and
for the same reason: the cutout size is a property of which sink
MODEL this is, not of any one placement.

**Deliberately NOT derived from the sink's own widthMm/depthMm.** A
real cutout is smaller than the sink's outer/rim size by a margin that
varies per product — the business types the actual number rather than
the app guessing a rim allowance. Absent (the default) means no
cutout at all, same as before this existed, so no existing catalogue
row changes behaviour until someone fills it in.

**Rendered as up to 4 boxes framing the hole, not one box with a
boolean-subtracted hole.** A true cutout needs either a CSG library
(three-bvh-csg, not a dependency this project otherwise needs) or a
`THREE.Shape` with a hole path plus `ExtrudeGeometry` (real complexity:
correct UVs around the hole edge, a second geometry type nothing else
in this file uses). `countertopSegments` (`Room3DCanvas.tsx`) instead
splits the slab into left/right/front-strip/back-strip boxes around
the cutout — plain box geometry, consistent with literally every other
mesh in this file, at the cost of up to 4 draw calls per sink instead
of 1. Clamped to the slab first, so a misconfigured cutout larger than
the slab it sits on degrades to "no cutout" rather than an inverted or
negative-size segment.

**Matching "sits on this cabinet" needs BOTH X/Y overlap and Z.** A
sink whose footprint center falls inside a cabinet's footprint but
sits at some unrelated elevation shouldn't cut that cabinet's slab —
same reasoning `lib/collision.ts` is Z-aware for, and the same
`elevationMm` convention (a stove/sink is expected to sit flush at
`elevationMm == cabinet's own top`). `SINK_COUNTER_ELEVATION_TOLERANCE_MM
= 100` absorbs ordinary rounding without matching something actually
mounted elsewhere.

**The cutout rotates with the sink.** Its stored width/depth get the
same quarter-turn swap the sink's own footprint gets from
`rotateFootprint` — turning the sink turns its hole.

Texture tiling for the finish/procedural texture stays scaled off the
FULL slab, not each segment, so a cut stone slab's pattern still reads
as one continuous piece rather than separately-tiled fragments on
either side of the sink.

**Follow-up, found on first live check: the sink z-fights with the cut
edge.** A sink's box sits with its bottom face at `elevationMm`, which
is normally set to match the counter's finished top surface exactly.
Before the cutout existed, the sink's solid body fully covered that
coincidence — nothing else was ever rendered there for it to fight
with. With a real hole next to it, the coincidence became visible as
flickering static.

**First fix, and why it was wrong:** dropped the sink's rendered
position by a flat `COUNTERTOP_THICKNESS_MM / 2` subtracted from its
OWN stored `elevationMm`. This stopped the z-fight but made the sink
disappear entirely on the next check — `elevationMm`'s actual value
for a given sink isn't reliably "the finished counter's top surface."
Some data has it at the cabinet's raw top (before the slab), some at
the finished surface (after it); guessing wrong and subtracting from
whichever one it actually was could push the sink's whole body below
where the countertop or cabinet carcass then hides it completely.

**Second fix: anchor to the HOST CABINET's own geometry instead of the
sink's stored elevationMm.** `findSinkHostCabinet` (shares its "resting
on it" test, `sinkRestsOnCabinet`, with `sinkCutoutRectMm` — same
X/Y-plus-Z check, one function, so the two questions "does this cabinet
need a hole" and "which cabinet is this sink actually on" can't drift
apart) finds which cabinet a sink belongs to, and the render position
is set to that cabinet's own `elevationMm + heightMm +
COUNTERTOP_THICKNESS_MM - SINK_RECESS_FROM_COUNTER_TOP_MM`, always
landing just under the ACTUAL finished counter surface regardless of
what the sink's own `elevationMm` happened to be. This part held up.

**Third fix: the recess amount itself was still wrong — 10mm, not the
anchor.** With the anchor correct, the next check came back solid
black regardless of lighting mode. A GLB model authored to sit ON a
flat surface has no reason to model or texture its own underside —
nobody was ever meant to see it. 10mm was picked as "half the slab
thickness," reasoning that more separation is safer, which is
backwards for breaking a z-fight: that only needs enough gap to clear
floating-point coincidence, on the order of 1-2mm, not a meaningful
fraction of the counter's own thickness. 10mm was enough to dip the
model down far enough that its lower, never-textured underside came
into view — reading as flat black because there was nothing there to
light, not because of a shadow or a broken texture (confirmed live:
unchanged across lighting modes, which is what pointed at "nothing
rendered there" rather than "something rendered wrong").

**2mm was ALSO wrong — still flat black, no sink.** Same symptom as
10mm, at a fifth of the offset. That stopped being "the offset is
slightly too large" and became "the anchor itself is landing somewhere
materially different from where the sink used to render fine,
regardless of the small distance tried on top of it" — most likely
`findSinkHostCabinet`'s cabinet, whichever one it resolved to, has a
`heightMm` that doesn't match whatever convention this business's
sink `elevationMm` was actually set against, so the computed position
(cabinet top + counter thickness − a couple of mm) landed nowhere near
the original, working position.

**Reverted entirely rather than guess a fourth time.** Three attempts
(flat offset from the sink's own elevationMm; cabinet-anchored at
10mm; cabinet-anchored at 2mm) each failed differently, and each
failure was diagnosed AFTER shipping it, from a screenshot, with no
way to inspect the actual numbers live. That's not a process that
converges — it was making the reported bug worse (invisible sink)
rather than better (a flicker with a visible sink). `appliances.map`
now renders every appliance, including a cutout sink, at its plain
`item.elevationMm` again — back to the original z-fight/flicker, which
is a real but smaller problem than "no sink at all." `findSinkHostCabinet`
and its recess constant were removed (dead code, nothing referenced
them once the call site reverted); `sinkRestsOnCabinet` stays, since
`sinkCutoutRectMm` — the hole itself — still needs it and is unaffected
by this revert.

**Root cause, once the numbers actually came back: the test sink's own
`heightMm` was 0.** Nothing to do with position, the anchor, the
recess amount, or the cutout/z-fight fix at all — a zero-height box
has no volume to render, so every position tweak tried was adjusting
where an invisible, zero-size object sat. "Plain surface," "pitch
black," and "no sink" were three different ways of describing the same
underlying nothing, at three different (irrelevant) positions. Fixed
by the business correcting the catalogue row's height, not by any code
change.

**Net result: the position-hack code stays reverted.** The original
z-fight/flicker this was trying to solve is a real, separate,
lower-severity cosmetic issue (a visible-but-glitchy sink beats an
invisible one), and it wasn't reproduced or reconfirmed once the
height was fixed. Not worth re-attempting speculatively a fourth time
against a problem that may not even be the next thing reported. If it
recurs, `sinkRestsOnCabinet` and the countertop-side cutout logic are
still in place and correct — only the appliance-side recess was pulled
out — so re-adding a position offset is a small, contained change
whenever it's actually needed again.

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

### Overlap mute: per-item flag, not a global toggle

Rejected a single global "hide all collisions" switch — it would also
hide a genuinely accidental overlap introduced later, defeating the
warning's purpose (Principle 6). Added `ignoreOverlap?: boolean` to
`PlacedCabinetItem`/`PlacedApplianceItem`/`Obstacle` instead;
`detectCollisions` skips a pair if either side has it set, so muting
one item (e.g. a chimney duct routed through a wall cabinet) silences
only overlaps involving it. Plain field on the existing JSONB array —
no migration needed.

### Remaining-space gaps: floor and wall are two bands, not one

Bug report: the 2D plan's gap label and Wall Elevation's click-to-
measure showed different numbers for what looked like the same spot —
both correct, describing different things, since a top-down plan draws
a wall cabinet at the same x/y as whatever is (or isn't) on the floor
beneath it. `computeWallGaps` only measured floor-touching items;
wall-band gaps were invisible on the plan entirely. Fixed with an
explicit `band: 'floor' | 'wall'` param (default `'floor'`) and a
`WallGap.band` field; `RemainingSpaceLayer` now draws both (teal
floor, amber wall with a `(wall)` suffix), dropping any wall-band gap
that spans the whole wall (nothing mounted on it at all).

### Dimension labels: a session-only toggle, not a stored preference

Always-on cabinet dimension text and gap labels get dense fast —
reported as clutter. `showDimensions`, local `useState` in `App.tsx`,
hides the numbers without touching underlying data. Deliberately not
persisted: this is about decluttering one viewer's screen, not a
property of the design, so it resets to visible (the safer default) on
reload.

### Global overlap/clearance toggles: hide more, never override a mute back into showing

Natural extension of `showDimensions` once per-item mutes existed —
`showOverlapWarnings`/`showClearanceWarnings`, same session-only
shape, gating `CabinetLayer`/`ApplianceLayer` and the two warning
banners. Critical rule: the global only ever hides MORE, never reveals
what an item muted itself — `isColliding` is `showOverlapWarnings &&
collidingCabinetIds.has(...)`, and a muted item never enters that set
in the first place (the mute is baked in at `detectCollisions`, before
this component sees it), so re-enabling the global can't undo an
individual mute. Detection itself is never gated, only drawing.
`ObstacleLayer`'s pre-existing room-door `blocksDoor` warning is
untouched — different system, out of scope.

### L-corner door/drawer clearance: a new warning category, with three wrong turns before it worked

New file `lib/cabinetClearance.ts` (cabinet-vs-cabinet, no room
opening involved, so it couldn't reuse `ClearanceIssue`'s
`WallOpening` key) — same amber "buildable but unusable, never
blocks" category, same conservative-rectangle approximation
`doorSwingZone` already uses for room doors. Own `ignoreClearance`
flag, separate from `ignoreOverlap` (a real overlap and an unusable-
but-clear door swing are different problems). Checks three ways two
cabinets can conflict: A's zone hits B's box, B's zone hits A's box,
or neither box is hit but the zones cross — the last is the actual
L-corner case. Scoped to cabinet-vs-cabinet only, matching what was
asked. Doors are drawn as real Konva arcs (`localDoorArcs`,
`carouselDoorArc`), not rectangles — a rectangle never reads as a
swinging door regardless of position, mirroring the CHECK-uses-a-
rectangle/VISUAL-uses-an-arc split `OpeningLayer.tsx` already
established for room doors; the rectangle is kept only for
non-swinging pull-outs (drawers/trolley), which are honestly
rectangular.

Three bugs found in successive live tests, in order:
- **Wall cabinets weren't excluded.** Shipped checking every cabinet
  regardless of height, so two wall-cabinet runs meeting at a corner
  lit up amber for a door swinging at ~1450mm that can't block
  floor-level walking space at all. Fixed by filtering both detection
  and visualization to `touchesFloor(item.elevationMm)` cabinets only.
- **A carousel's zone was drawn on its wrong, straight edge** — its
  real door is on the diagonal cut, but the reach code only knew how
  to project from one of four straight edges. First fix zeroed the
  carousel's reach entirely, which also silenced real conflicts on the
  diagonal side (a deliberately-placed test cabinet stopped
  triggering). Second attempt anchored the zone at what was called the
  "uncut far corner" but was actually — per `cornerCutSign`'s own
  definition — the CUT corner, a vertex not even on the cabinet's
  visible shape, leaving the zone floating with a visible gap back to
  the real door. Fixed for real by anchoring at the diagonal edge's
  own midpoint instead.
- **Door zones were rectangles at all, everywhere — the actual root
  cause behind the carousel confusion above.** Replaced with real
  arcs as described above once this was recognized as one bug, not
  three unrelated ones.

### Undo/redo + autosave: debounced by edit signature, not by a fixed window

Scoped to the open design only (`currentLayout`, cabinets, obstacles,
appliances, cameras, selection) — not the business catalogs, rate
card or quotes, which already persist immediately per-row and would
disagree with the database if reverted locally, and not panorama
capture/delete, an irreversible Storage side effect. `loadProject`
clears both stacks and any in-flight debounce so switching projects
can't replay one kitchen's history onto another's.

Every canvas drag/click already reaches the store once per gesture
(commits at `onDragEnd`, not per frame), but free-typed number inputs
and sliders fire once per keystroke/frame. Rather than audit every
input across every inspector, `noteDesignEdit(signature)` debounces
the undo push per `action:id` signature (500ms) — a burst under the
SAME signature (typing digits, dragging a slider) collapses to one
undo step; a DIFFERENT signature arriving mid-burst (e.g. dragging
cabinet A then B) flushes A immediately rather than merging unrelated
edits. `undo()` always flushes first, so Cmd+Z right after a single
action has no perceptible delay. Pure selection changes are not
pushed — navigation, not an edit.

Autosave reuses the same signature hook to debounce a call to the
existing `saveProject` action (2s) rather than a separate change-
tracking mechanism. Runs with a new `silent` option so it never
touches `isSaving` — that flag drives the Save button's own visual
feedback, and a background save firing every couple of seconds
shouldn't make the button flicker as if clicked. A manual click omits
`silent` and gets the normal feedback; only a small "Auto saved
h:mm:ss" text updates on its own.

### Quote export: a hosted PDF link over WhatsApp, not a manual attachment

"PDF and WhatsApp link" (docs/STATUS.md) could have meant either a
downloaded file the designer attaches by hand, or a real link the
customer can tap. Chose the latter: `generateQuotePdfBlob`
(`lib/quotePdf.ts`, new `jspdf`/`jspdf-autotable` dependency) renders
the FROZEN quote — never the live BOM — into a PDF client-side; it's
uploaded to a new public `quote-pdfs` Storage bucket
(`lib/quotePdfStorage.ts`, same permissive MVP policy as `panoramas`/
`material-swatches`); a `wa.me/<customer's phone>` link is opened with
that URL in the pre-filled message (`lib/whatsapp.ts`). The customer
gets the real document in one tap; no manual attach step.

Upload path is deterministic (`${projectId}/v${version}.pdf`) and
always re-uploaded with `upsert`, never cached — a frozen quote's
summary/pricingContext never change, so regenerating always reproduces
the same document, and there's nothing to invalidate. This sidesteps
ever writing to a `quotes` row after it's frozen.

No `businesses` table exists yet for the PDF's letterhead name/phone
(multi-tenancy hasn't landed), so those come from two new optional
`VITE_`-prefixed env vars, same pattern as the Supabase credentials —
a stopgap, not a real per-tenant profile.

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
9. ~~Whether `npx tsc --noEmit` currently passes.~~ **Resolved, and the
   question itself was wrong.** Bare `npx tsc --noEmit` checks the root
   `tsconfig.json`, which is solution-style (`"files": []`, only
   `references`, meant for `tsc -b`) — it type-checks ZERO files and
   exits clean regardless of what's broken. A whole stretch of a
   session believed "tsc clean" on the strength of that no-op, during
   which a real error (a closure-narrowing bug in `ObstacleInspector.tsx`
   — same class already documented in `lib/fixtures.ts`) sat uncaught.
   The actual check is `npx tsc --noEmit -p tsconfig.app.json`; `npm run
   build` was never affected, since `tsc -b` already builds the
   referenced project correctly. Corrected in `CLAUDE.md`'s
   verification section.

---

## 9. Multi-tenancy / auth

### Business isolation: business_id + RLS on every table, real sign-in, no sign-up

Single-business MVP had no login and RLS disabled everywhere —
anyone with the URL could read/write every customer's data (Principle
4). Added `business_id` to all ten existing tables plus three new
ones (`businesses`, `business_users`, `super_admins`), RLS policies
on all thirteen, and real Supabase Auth sign-in (`authStore.ts`,
`LoginScreen.tsx`). No self-serve sign-up — one business exists, onboarding
a second today is a manual step (`docs/SUPABASE_SETUP.md`), not a
built flow; building that now would be exactly the speculative
"foundation before anyone needs it" work this doc's own "honest
sequencing problem" section warns against.

`business_id` is passed explicitly by every write path, never a
silent DB column default — deliberately re-applying the
`calculateBOM`/`PricingContext` lesson (`CLAUDE.md`): a missing
required value should be a compile error, not something that quietly
resolves to null or the wrong business. RLS's `with check` is the
server-side backstop, not the source of truth. Reads needed no app
changes at all — RLS scopes `select` automatically, so e.g.
`fetchCustomers()`'s unfiltered `select('*')` just works.

`business_users` is a join table with a `role` column from day one
(currently always `'owner'`, unenforced) rather than a single column
on the user — explicitly so a second person, or a different access
level, is a new row later, not a schema change. This is the direct
answer to "start simple but don't make this a hassle later."

A `super_admins` table + `is_super_admin()` security-definer function
gives the software owner (not the business owner — a separate
concept) a bypass added to every table's RLS policies via `or
public.is_super_admin()`. Locked down harder than everything else in
the schema: RLS enabled with zero policies, so nothing can read it
directly except that one function. Doesn't reduce how often you have
to log in — that's `persistSession: true` (`Supabaseclient.ts`, now
explicit rather than relying on the browser default), a genuinely
separate concern from access scope.

`rate_cards` was the one real schema wrinkle: previously a single
global row (`id = 'default'`). Fixed by having `defaultRateCard()`
generate a fresh `crypto.randomUUID()` per call instead of the fixed
id — a business's first-ever save then creates its own row safely,
with no separate "does a row exist yet" check needed, and
`fetchRateCard()` dropped its `id` filter entirely in favour of
relying on RLS to return "my one row."

Storage buckets keep public READ (a quote PDF link has to work with
no login — that's the point of the WhatsApp export feature) but now
require sign-in to upload.

Not closed: catalogue cross-references (`cabinet_catalog_items
.finish_id → surface_finishes.id`) aren't composite `(id,
business_id)` FKs, so a deliberately crafted request could in
principle reference another business's finish row. RLS already
prevents a business from ever *seeing* another's rows to pick one in
the UI; closing the narrow remaining gap would mean composite FKs
across ~6 relationships for one more layer of defense-in-depth. Left
as an accepted limitation, not silently skipped.

Global/shared catalogue (a business opting in to see other
businesses' catalogue rows) was requested but deferred — see
`docs/PRINCIPLES.md`'s "Open decisions" for the `is_global` +
`business_settings.show_global_catalog` shape, not built until a
second real business exists to need it.

### Re-running schema.sql after RLS went live broke every seed insert

`schema.sql`'s idempotency was proven for a FRESH database, but not
for re-running the whole file against a database that had already
gone through this section's own migration. All 9 seed `insert`s in
the file (projects, layouts, surface_finishes, cabinet_catalog_items,
obstacle_presets, appliance_catalog_items, handles,
light_fixture_catalog, rate_cards) wrote rows without a `business_id`
column at all — safe the FIRST time the file ever runs, because
`business_id` is still nullable at that point (the `not null` is only
applied later, in this section's own `do $$ ... loop`, deliberately
AFTER seed data so the backfill has rows to catch). Re-running the
file a second time, after `not null` is already in place, broke every
one of those 9 inserts — including for rows that already existed and
`on conflict (id) do nothing` should have silently skipped. The reason
it didn't: `on conflict` only suppresses a UNIQUE-constraint conflict;
it does not suppress a NOT NULL violation, and Postgres checks NOT
NULL before it ever gets to conflict resolution. So the very case this
file's own idempotency promise exists for — "always safe to re-run" —
was exactly the case that broke.

Surfaced for real by re-running the file to apply the
`light_fixture_catalog` column fix (§10, ISSUES-FIXED.md) against an
already-migrated database — `ERROR: 23502: null value in column
"business_id" of relation "projects" violates not-null constraint`.

Fixed by adding `business_id = 'biz_default'` explicitly to all 9
inserts' column lists and every value tuple. Deliberately NOT a
column default (`alter table ... add column business_id text default
'biz_default'`) — a default would have quietly defeated the "no
silent business_id default" rule two paragraphs above: an app code
path that forgot to pass `businessId` would then fail into
`'biz_default'` silently instead of a hard NOT NULL error. These 9
seed inserts are meant to be the only place `'biz_default'` is ever
written by literal name.

Verified with a standalone script: parsed every one of the 9 inserts'
`values` tuples (handling this file's own SQL line-comments correctly
— two of them contain an apostrophe, e.g. "cabinet's", which a naive
comma-counter mis-reads as the start of a string literal) and
confirmed every tuple's value count now matches its column list.
Static text-parsing only, not a live Postgres run — I don't have
Supabase access from here, so **this still needs a real re-run against
the actual database to be considered fully verified.**

---

## 10. Inventory import/export

### Cabinet catalogue Excel round trip: the pilot, and what it settled

`docs/PRINCIPLES.md`'s import/export design assumes a "business-
supplied code column" to match sheet rows back to database rows on
re-upload. None of the 5 catalogues has one — only an internal
`crypto.randomUUID()` and a free-text label. Rather than add a new
column across 5 tables, the exported sheet's own `id` column IS the
match key: present + untouched = update that row; blank = insert new.
Zero schema change, and the business never has to read or type a
UUID — it just round-trips in a column they're told not to touch.

Built for **cabinets only** this pass — the richest catalogue (enums,
a finish FK, most likely to need a bulk price update). Obstacles/
appliances/handles/fixtures repeat the same shape later
(`lib/importExport/xlsxHelpers.ts` holds the genuinely-reusable half —
workbook building/reading, per-cell validators — deliberately without
a generic "engine" abstraction over row shape, since a second
catalogue hasn't gone through it yet to prove what should generalise).

`frontLayout` (nested discriminated-union JSONB) and `handleId` stay
in-app-only, edited through the existing Front Picker — flattening
that union into spreadsheet columns would be real design work for a
bulk-configure-fronts-by-spreadsheet feature nobody asked for.
`finishId` round-trips through the finish's **label**, not its raw
id, resolved against the live finish catalogue at import time —
same reasoning as the id match key: nobody should have to know a UUID.

**Supply-chain finding, fixed before it shipped**: `npm install xlsx`
installs SheetJS's last npm-published build (0.18.5), which carries
two unpatched advisories — prototype pollution and a ReDoS — with no
fix available on npm, because SheetJS stopped publishing new versions
there. This feature's entire job is parsing a file a business
uploads, which is exactly the surface those bugs are in, so this
wasn't a theoretical concern to note and move past. Fixed by
installing from SheetJS's own CDN instead
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned in
`package.json`'s dependency URL) — 0 vulnerabilities on `npm audit`.

**Commit is one `.upsert()` call with the whole batch**, not a loop of
one-row saves (`saveCabinetCatalogItemsBulk`, `lib/Inventory.ts`) —
Postgres executes a multi-row upsert as a single statement, which is
what makes it genuinely atomic: one bad row rolls back the whole
batch rather than leaving a partial import committed. This is what
"commit as one transaction" (`docs/PRINCIPLES.md`) actually means
here — no explicit transaction machinery needed.

**"A missing row never deletes anything"** falls out for free from the
above: the commit only ever upserts rows present in the uploaded
sheet. A row removed from the sheet before re-upload is simply never
mentioned again — deletion stays the existing per-row Delete button,
a separate and deliberate action.

No in-sheet Excel dropdowns for enum columns (`module_type`,
`material`) — real data-validation lists are a SheetJS Pro feature,
not in the free/community build this uses. Documented on the exported
Instructions sheet instead; the browser-side review grid uses a real
`<select>` when fixing a row inline, so a value typed wrong in Excel
can't be typed wrong again while fixing it.

Verified with a standalone script exercising the real
`exportCabinetCatalogXlsx`/`parseCabinetCatalogRows` functions —
including a genuine export → read-back-from-real-xlsx-bytes → parse
round trip, not just hand-built fixtures — against every path: an
untouched re-upload, an edited price, a new blank-id row, a bad enum
value, an unrecognised finish label, an unknown id, and two rows
citing the same existing id. All passed. Not verified: the actual
browser file-upload/download UI — no browser automation available
this session.

### Rolled out to the other four catalogues, same session

Once the cabinet pilot was confirmed working end to end in the
browser, repeated the pattern for obstacles, appliances, handles and
fixtures — one `lib/importExport/<catalog>ImportExport.ts` module and
one `<Catalog>ImportExport.tsx` panel each, wired above the matching
table in `InventoryManager.tsx` (obstacles, appliances) or the
matching manager component (`HandleManager.tsx`, `FixtureManager.tsx`).

The id-resolution and duplicate-id-detection logic that was inline in
the cabinet module got promoted into `xlsxHelpers.ts`
(`resolveRowId`, `flagDuplicateMatchedIds`) at this point, along with
a few more validators (`nonNegativeNumber`, `booleanValue`,
`numberInRange`, `hexColor`, `optionalString`, `optionalNumber`) —
this is the "generalise once a second real use proves the shape"
moment the original pilot's own comment anticipated, not a premature
abstraction. The cabinet module was refactored to use the same shared
helpers rather than left with its own copy, and re-verified against
its existing test script afterward to confirm the refactor changed
nothing observable.

None of the other four catalogues has an FK-like field the way
cabinets have `finishId` — appliances/fixtures do have several
genuinely optional scalar fields (model path, per-axis rotation
correction, sink cutout dimensions), included on the sheet since
they're plain scalars, not the kind of nested-union complexity that
kept `frontLayout` off the cabinet sheet.

Verified the same way as the pilot: a script per catalogue exercising
a real export → read-back → parse round trip, plus each catalogue's
own distinctive validation (a boolean column for obstacles'
floor_to_ceiling, an optional-field round-trip and a negative-value
check for appliances' sink cutout, a hex-colour and a 0–1 range check
for handles, an enum check for fixtures). All 14 checks passed. Same
caveat as the pilot: the actual browser upload/download flow is
unverified for these four too.

### Explicit delete via a `delete` column, all 5 catalogues

"Remove a row from the sheet" was always a no-op by design (see
above) — but that left no way to delete via Excel at all; deletion
stayed the existing per-row Delete button, one row at a time. Added a
dedicated `delete` column to every exported sheet instead of changing
that no-op rule: typing `delete` (case-insensitive, whitespace
trimmed — `isMarkedForDeletion`, `xlsxHelpers.ts`) is a *deliberate*
word a business has to type, whereas a row missing from the sheet is
usually an accident (a filter left on, a hidden row, a partially
filled-in sheet) — the distinction the original no-op rule existed to
protect stays intact.

A row marked for deletion skips its own field validation
(`finalizeRowErrors`) — fixing a bad enum or a blank label on a row
about to be removed is pointless work. The one thing still checked is
identity: an unknown id, a duplicate-matched id, or marking a
blank-id (new) row for deletion (nothing exists yet to delete) all
still error.

Commit splits into two calls, not one: the upsert half
(`saveXBulk`) is still a single atomic `.upsert()`; the delete half is
a separate `.delete().in('id', ids)` — genuinely two statements, not
one transaction spanning both. Accepted as a real limitation rather
than engineered around with a custom RPC — a batch that upserts 40
rows and deletes 5 could in principle upsert successfully and then
fail the delete (or vice versa), leaving a partial result. Not
expected to matter in practice at this catalogue size, but worth
remembering if it ever does.

Bulk delete functions (`deleteCabinetCatalogItemsBulk` etc.) take no
`businessId` parameter, unlike the upsert functions — RLS's delete
policy (`business_id = current_business_id() or is_super_admin()`)
already scopes `.in('id', ids)` to the caller's own rows regardless of
which ids are requested, so passing a business id would be redundant,
not a missing safety check.

Verified with a standalone script (8 checks: an ordinary re-upload, an
edited price, a new row, a deleted existing row, a delete-marked
blank-id row (error), a delete-marked unknown id (error), and a
same-id update-vs-delete conflict). All passed. First run of this
script had a false-positive failure from an unintended id collision
between two of my own test rows — fixed by giving the unrelated test
case its own distinct id, per the "distrust your own tooling" rule
this file already states.

### `light_fixture_catalog` was missing 4 columns the code always assumed existed

First real bulk write to `light_fixture_catalog` (uploading the
fixture starter file) failed: `Could not find the 'model_rotation_x_deg'
column ... in the schema cache`. Root cause: `model_url`,
`model_rotation_x_deg/y_deg/z_deg` were never actually added to this
table in `schema.sql`, even though `FixtureCatalogItem` and
`lib/fixtureCatalog.ts` always read and wrote them — a pre-existing
latent gap (predates this session's work), invisible until something
finally tried to write a real value into one of those columns.
Appliances have the same four fields and were fine, because
`appliance_catalog_items` did have them.

Fixed by adding the four `alter table ... add column if not exists`
statements right after fixtures' own pricing-mode check constraint.
Because the whole file is idempotent, re-running it against a
database that already has these columns is a no-op, and against one
that doesn't, it heals it — no separate migration. **This fix has not
yet been re-verified against a live re-run of schema.sql** — flagging
per this file's own verification-limits section, since I can't run
Supabase from here.

### Post-hoc catalogue curation, 2026-09-25

The starter-catalogue files (`scripts/generate-starter-catalogues.ts`)
always export every row with a **blank id**, so every upload inserts
fresh rows rather than matching existing ones by content — by design,
since id-matching is the only match key this feature has (see the
pilot decision above), and a blank id can only ever mean "new." That
design choice meant re-uploading the starter files (including a
partial/repeated handle upload) created real duplicate and
near-duplicate rows across cabinets, obstacles, appliances and
handles — this was always the known cost of not having a
content-based dedup key, just realized in practice here rather than
theoretically.

Resolved by hand: read back each catalogue's actual current state
from the business's own just-downloaded sheets, and produced 5
`*-final.xlsx` files (`final-catalogues/`) using the real
`buildWorkbookBlob`/header order each catalogue's own export function
uses, marking genuine duplicates `delete` and keeping one canonical
row per distinct real item. Two judgment calls worth recording
because the "why" won't survive in the data itself:

- **Appliances — two conflicting "Built-in Oven 600mm" rows** (seed:
  ₹45,000 / 850mm elevation; starter: ₹28,000 / 450mm elevation) and
  similar seed-vs-starter conflicts for chimney-600, OTG-450 and
  toaster-300. Kept the **seed** row and deleted the starter row in
  every case — not because the seed's numbers are more correct (all
  of these are placeholders per this file's pricing section), but
  because picking one consistent rule beats picking case by case. The
  single exception: `app_cat_sink_single` (seed) was kept over its
  starter duplicate specifically because it's the only sink row with a
  real `model_url` wired to an actual asset (`kitchen-sink.glb`) —
  losing that would have been a real regression, not a tidy-up. That
  seed row also has `height_mm: 0`, a pre-existing data-quality issue
  left untouched (out of scope for a dedup pass; flagged to the user
  separately).
- **Obstacles — "Lifted column"** has `floor_to_ceiling: yes` with a
  non-zero `elevation_mm`, which the app ignores whenever
  floor_to_ceiling is true. Left completely untouched rather than
  deleted or "corrected" — it wasn't created by any script this
  session, so there's no way to know whether the intent was
  floor_to_ceiling=no (making the elevation real) or the elevation is
  simply stale. Flagged to the user instead of guessed at.

Not yet done: re-verifying the actual upload of these 5 files through
the browser (same standing caveat as the rest of this section).

---

## 11. Component library and feedback (first slice)

`docs/PRINCIPLES.md`'s roadmap item 8 — "Component library and the
four states" — is a multi-part initiative (adopt shadcn/ui, the four
states, feedback on every action, consistency rules, keyboard,
first-run). Deliberately scoped to a first slice rather than
attempted whole: adopt shadcn/ui as the foundation, then use it for
the most self-contained, highest-leverage item on that list —
"feedback on every action" — since it doesn't require restyling any
existing hand-written component first. The four states, and migrating
existing hand-rolled buttons/inputs to the new primitives, are next,
not done here.

### Adopted shadcn/ui — Radix base, Vite template, Nova preset

`npx shadcn@latest init -t vite -b radix -p nova -y`. Radix over the
newer "base"/"aria" options this CLI version also offers, since Radix
is the well-established, broadly-documented choice — `docs/PRINCIPLES.md`
itself named "shadcn/ui" assuming that lineage. 14 primitives added so
far (button, dialog, input, table, dropdown-menu, card, badge,
skeleton, sonner, separator, select, checkbox, label, alert) — the set
this app's existing hand-rolled Tailwind was already approximating
(native `<select>`s, ad hoc `<button>` classes repeated across every
manager component), not an exhaustive install of the whole registry.

**Real CLI bug, not a config mistake**: the init command writes its
generated files by literally treating the `@/*` alias string as a
directory name unless `@/*` → `./src/*` is resolvable from the ROOT
`tsconfig.json` specifically — having it only in `tsconfig.app.json`
(where this project's real compiler options live, since the root file
is intentionally solution-style — `"files": []`, only `references`,
see CLAUDE.md) passed the CLI's own "Validating import alias" check
but still wrote `button.tsx`/`utils.ts` to a literal `./@/` directory
at the repo root. Confirmed by reproducing it, then fixing it by
adding the SAME `paths` mapping to the root `tsconfig.json` too (inert
for `tsc -b`, since `files: []` means nothing is compiled through that
config directly) and re-running `add` for a second component — it
landed in the right place immediately, and correctly recognised
`button.tsx` as already present rather than re-splitting it. `baseUrl`
was then dropped from both configs — TypeScript 6.0 deprecates it, and
`paths` alone resolves relative to the config file's own directory
without it.

`eslint-plugin-react-refresh`'s `only-export-components` rule flags
every shadcn file that exports a component alongside its `cva()`
variants function from the same module (`buttonVariants`,
`badgeVariants`, …) — upstream shadcn's own convention, not a mistake
in what got generated. Disabled that one rule for `src/components/ui/**`
only (`eslint.config.js`) rather than splitting vendored files apart in
a way that would fight every future `npx shadcn add`/diff against
upstream.

### Toasts on save, freeze, import, delete — PRINCIPLES.md's own list

Wired a single app-wide `<Toaster/>` (sonner) into `App.tsx`. Required
restructuring `App.tsx`'s view switch from five separate early
`return`s into one `content` variable + a single final return, so the
toaster mounts once and survives every view change instead of
unmounting and losing an in-flight toast each time `view` changes.

Added `toast.success`/`toast.error` at every action this doc's own
roadmap named as silent: the manual "Save Project" button (NOT
autosave — autosave stays silent by explicit earlier request, only
the "Auto saved HH:MM:SS" text updates), quote freeze, PDF download,
WhatsApp share, all 5 catalogues' Excel import commit, and the rate
card save.

**Real gap found while doing this, not part of the plan going in**:
per-row delete in `HandleManager.tsx` and `FixtureManager.tsx` called
`onDelete(id)` directly from `onClick` with no confirmation, no
try/catch, and no feedback of any kind — a failed delete there
surfaced nothing to the user at all. `InventoryManager.tsx`'s three
delete handlers (cabinets/obstacles/appliances) had a try/catch and an
inline error message, but still no confirmation and no success
feedback. `FinishManager.tsx` was the same shape. All six now confirm
via `window.confirm` naming the item's own label ("Delete \"X\"? This
can't be undone.") before deleting, and toast on both outcomes. Chose
a native `confirm()` over a shadcn `AlertDialog` for now — genuinely
the cheaper first pass, and upgradable later; noted here so that
decision isn't mistaken for the finished state of Principle "four
states"' confirmation rule.

Deliberately kept the existing inline error/success text (the "Saved
N rows" line under each import panel, the inline `saveError`/`error`
paragraphs) rather than removing it in favour of the toast — the toast
is what actually gets NOTICED regardless of scroll position; the
inline text is the persistent detail once you're looking. Not
redundant, two different jobs.

### Button migration, first two surfaces: App.tsx shell + inventory managers

Followed up in the same session: migrated every hand-rolled `<button>`
in `App.tsx` (the top-level view chrome — back/undo/redo/save/view-switch
buttons) and the three checkboxes (show dimensions/overlap/clearance)
to shadcn's `Button`/`Checkbox`/`Label`, then did the same for every
manager under `src/components/inventory/` — `InventoryManager.tsx`'s
three catalogue row types (Save/Delete/Add, ~10 button instances),
`HandleManager.tsx`, `FixtureManager.tsx`, `FinishManager.tsx` (including
its underlined Edit/Delete links → `variant="link"`), and
`RateCardManager.tsx`. `variant="destructive"` for every Delete button
now standardises what used to be a hand-picked `border-red-300`/
`text-red-600` combination repeated slightly differently in each file —
exactly the "one set of colours with fixed meanings" consistency rule
this same roadmap item asks for, arriving as a side effect of the
button migration rather than a separate pass.

Picked size `"xs"` for every dense table-row button (Save/Delete/Add) —
closest match to the old `text-[10px] px-2 py-1`, though not pixel-
identical; consistency with the rest of the new component set outranks
matching the exact old size.

### Confirm dialog moved off the browser's native `window.confirm`

You flagged that the delete confirmation was a native browser popup,
not part of the app's own UI. Built `confirmDialog()`
(`store/confirmDialogStore.ts`) + a single `<ConfirmDialog/>`
(`components/common/ConfirmDialog.tsx`, shadcn's `AlertDialog`) — an
imperative call from anywhere, resolving to true/false, rendered by
one instance mounted in `App.tsx` next to `<Toaster/>`. Same shape as
`toast()` deliberately, rather than each of the 6 delete call sites
owning its own dialog markup and open/close state. Replaces the
`window.confirm` in all 6 delete paths (cabinets, obstacles,
appliances, handles, fixtures, finishes).

### Real bug hunt that turned out to be tooling, again

You reported the Inventory screen going blank and bouncing back to
the dashboard after a few seconds. Re-checked the actual render logic
first (the new scroll-to-section effect, and `RateCardManager` being
rendered for the first time this session) — nothing there looked
wrong, and this app has no error boundary, so a real render crash
would leave the screen blank permanently, not recover into the
dashboard on its own. That recovery pattern is what a Vite dependency-
optimizer full-reload looks like instead: ~8 new npm packages were
installed mid-session for shadcn/ui while the dev server was still
running from before any of them existed. Confirmed by having you
fully restart `npm run dev` (not just refresh) — fixed. See
`docs/ISSUES-FIXED.md` for both of these.

### Button sweep finished, and a first real pass at the four states

Completed the rest of the button migration: `CustomerDashboard`,
`QuoteSidebar`/`QuoteFreezePanel`, all 6 toolbars, all 5 Excel import/
export panels (Download/Upload/Commit — scripted with plain literal
string replacement across the 5 near-identical files rather than
6 manual edits each; a first attempt used regex and hung on
catastrophic backtracking, killed and rewritten as literal
`.replace()` calls, which is O(n) and has no backtracking to blow up),
all 5 inspectors, `LoginScreen`, `WallElevationView`, `Cabinet3DInspector`,
`PickChooser`, `FinishPicker`, `PanoramaViewerModal`, `FrontPicker`, and
`ColorPicker`'s filter chips. Every plain `<button>` in `src/components/`
is now a shadcn `Button` except one: `ColorPicker`'s colour-swatch
cells, deliberately left native — they're colour chips rendered via
`style={{backgroundColor}}`, not really "buttons" in the design-system
sense, and forcing Button's own padding/radius onto a 20px swatch
would fight the one thing that row needs to look right.

The upload-file `<input type="file">` pattern (a styled `<label>`
wrapping a visually-hidden native file input, everywhere across the 5
import/export panels) is preserved via `Button asChild` wrapping the
`<label>` — `asChild` lets Button hand its own classes to the label
via Radix's `Slot` instead of rendering its own `<button>`, so the
label/hidden-input accessibility pattern survives untouched under
shadcn's visual treatment.

`variant="destructive"` is now the ONE red-delete-button style
everywhere (was a hand-picked `border-red-300`/`text-red-600`
combination, spelled slightly differently in nearly every file it
appeared in) — literally the "one set of colours with fixed meanings"
consistency rule from this same roadmap item, arriving as a side
effect of the button migration rather than a separate pass.

Four states: applied properly to `CustomerDashboard` and
`InventoryManager`'s three catalogue tables — the two clearest
"list of records" screens. Loading now renders `Skeleton` bars
instead of a "Loading…" sentence; each of the three catalogue tables
in `InventoryManager` gets an explicit "No X yet — add your first one
below" row instead of silently rendering as an empty table with just
a header and the add-new-row form; existing inline error text was
promoted to the `Alert` component. Not attempted for every remaining
screen — the toolbars' existing "No pieces yet" text and loading
states were left as-is (they already say the right thing, just not in
`Skeleton`/`Alert` markup), and this was a deliberate stopping point,
not an oversight.

### Not done yet

Consistency rules beyond button colour (spacing/type scale). Keyboard
beyond what already existed. First-run checklist. The four states for
every remaining screen (toolbars, inspectors, quote sidebar). Selects,
checkboxes and dense multi-field forms (`ObstacleToolbar`,
`RoomSurfacesPanel`, the inspectors' dimension fields) are still native
HTML — this pass deliberately scoped to buttons plus the two highest-
value four-states screens, not a full native-control sweep. All still
open, per `docs/PRINCIPLES.md` roadmap item 8.

### Real bug the migration introduced: buttons overflowing narrow panels

You caught this by eye — the "Light quality" row's 3 buttons, and
fixture-picker labels, running past the edge of the (`w-64`, 256px)
lighting toolbar. Root cause, confirmed by actually testing the `cn`
package's merge behaviour rather than guessing: shadcn's `Button`
bakes `whitespace-nowrap` into its base class UNCONDITIONALLY. That's
a reasonable default for a typical short-label button, but several of
this app's buttons carry longer, descriptive, multi-word text into
narrow sidebars where the OLD plain `<button>` (no forced
`white-space`) would just wrap onto a second line — `LIGHT_QUALITY_LABELS`
like `"Auto (6 lights)"`/`"Low (2 lights)"`, `LIGHTING_MODE_LABELS`'
`"True colour (no tint)"`, and every catalogue-item "+ add" button
whose label is the business's own (arbitrarily long) product name.
`whitespace-nowrap` also **inherits into children** (it's an inherited
CSS property) — the fixture placement list's mount-description text,
rendered inside a `Button`, silently stopped wrapping too, for the
same underlying reason, well past what you initially pointed at.

Checked (and disproved by directly testing the `cn` package, not by
inspecting source) whether `shrink-0` — also baked into Button's base
— was a second contributing cause: `flex-1` on a Button DOES correctly
remove `shrink-0` via `cn`'s merge logic, confirmed with
`cn('shrink-0 ... ', 'flex-1')`. So `whitespace-nowrap` was the entire
story, not two bugs.

Fixed by adding `whitespace-normal` (plus `h-auto` and a `min-h-*`
matching the button's own size token, since the fixed heights
`size="xs"`/`"sm"` set also assume single-line content) at every
call site actually carrying long/dynamic text: `LightingToolbar` (mode
buttons, quality buttons, fixture-add buttons, the "in this room" list
button), `CabinetToolbar`/`ApplianceToolbar`'s catalogue "+ add"
buttons, `ObstacleToolbar` (wall-add buttons, the dynamic "+ Add
{preset label}" button), and — defensively, since the same pattern
recurs — every remaining `flex-1` button pair (`CabinetInspector`/
`ObstacleInspector`/`ApplianceInspector`'s rotate/duplicate/delete,
`RoomSettingsPanel`'s Cancel/Apply, `QuoteFreezePanel`'s Download/
Share) even where the label is short enough that wrapping is unlikely
to ever actually trigger. Did NOT change the shared `button.tsx`
primitive's default — most of the other ~70 Button call sites in the
app are short, single-word, adequately-spaced buttons where
`whitespace-nowrap` is the correct behaviour, and changing the shared
default risked a different, harder-to-spot regression across all of
them for a problem that only actually occurs at a handful of specific
call sites.

---

## 12. Real-market rate estimates, and the RateCardManager UI polish

You gave 6 real Delhi NCR market figures rather than waiting on actual
purchase invoices (explicitly: seed realistic estimates now, a
business's own settings dashboard is where its real numbers belong —
already true architecturally, since `rate_cards` has been per-business
with RLS since §9). Three of the six mapped cleanly onto existing
fields; three didn't, and needed a real decision rather than a blind
paste:

- **"Soft-close Hinge Sets: ₹450/pair" → `hardware.hinge = 225`, not
  450.** This rate card prices hinges per PIECE, not per pair
  (`HardwareSpec`'s own comment: a door gets 2-4 individual hinges,
  unlike a drawer's `channel`, which genuinely is bought and fitted in
  pairs). Using ₹450 directly would have doubled every hinge line on
  every quote. Converted, not just copied.
- **"Tandem Box Drawers: ₹2,500/set" → `hardware.channel = 2500`, not
  a new hardware type.** A tandem-box system IS what `channel` already
  prices (a pair of drawer runners) — a specific premium brand/type of
  it, not a different real-world thing. Adding a `tandemBox` key would
  have meant extending `HardwareSpec['type']`, `RATE_LABELS`,
  `sanitizeRateCard`, `RateCardManager`'s field list, AND wiring
  `lib/fronts.ts` to actually attach it to a drawer front instead of
  `channel` — real work for a distinction that isn't real.
- **"Commercial Plywood/HDHMR: ₹1,400/sq.m" and "BWP: ₹2,200/sq.m" —
  originally left unwired, then wired in the same session.** ~~Checked
  `lib/bom.ts` before assuming these had a home: `materialCost =
  item.unitPrice * item.quantity` — a cabinet's `material` field
  (HDMR/Plywood/etc.) is costing-only DISPLAY metadata today; nothing
  multiplies it by area. That's Phase 1 item 2 ("the panel model"),
  explicitly blocked on the carpenter's construction convention and
  not started. Seeding a per-sq-m substrate rate with no formula or UI
  to consume it would have been exactly the "half-finished
  implementation" this repo's own house style rejects.~~ **CORRECTED**:
  that reasoning conflated two different things — the FULL panel model
  (an exact, per-panel cutting list, genuinely blocked on the
  carpenter's convention) and a costing-only estimate (which needs no
  panel accuracy at all, only an area figure, and `bom.ts` already had
  one — `estimateAreaSqFt`, previously used for labour only, its own
  comment already anticipating "material + labor costing" before
  either the comment or the code caught up to say so). See §13 for
  what actually got built once that distinction was made explicit.
- **"Basic Acrylic / Laminate Finish: ₹1,200/sq.m" and "Quartz
  Countertop: ₹2,800/sq.m" → two new `surface_finishes` rows**
  (`finish_default_basic`, `finish_default_quartz`), not rate_cards
  fields at all — finishes are priced per catalogue row, not on the
  rate card. Quartz uses `procedural_kind: 'quartz'` (a real generator
  in `lib/textures3d.ts`, same mechanism the wood-look defaults
  already use) rather than a flat colour guess, so a business's
  countertop actually renders like quartz instead of a beige box the
  first time they pick it.

**Idempotency, applied correctly this time**: the `rate_cards` INSERT
alone would NOT have updated an already-seeded business's row —
`on conflict (id) do nothing` skips existing rows entirely, per §9's
own lesson about this exact file. Added a separate, explicit one-time
`UPDATE ... WHERE hardware_rates->>'hinge' = '120' AND
hardware_rates->>'channel' = '450'` right after the insert — advances
a business still sitting on the OLD placeholders, leaves alone a
business that already edited either value away from the placeholder,
same "only touch what's still default" rule the corner-unit
`module_type` cleanup earlier in this file already established.
**Not verified against a live Postgres run** — reviewed by eye only,
same standing caveat as every other schema.sql change this session.

**RateCardManager UI**, the actual ask ("focus next on ensuring the
Rate Card Settings UI is clean"): converted every native `<input>` to
shadcn's `Input`, wrapped labels in `Label`, the placeholder-rates
warning and the error message in `Alert` (kept the amber colour and
kept the banner itself — CLAUDE.md is explicit that it must never be
removed, and better estimates don't change that these are still
seed defaults, not this business's negotiated price), and added a
`Separator` between the labour and hardware sections. No logic
changed — `isPlaceholder`'s comparison against `PLACEHOLDER_RATES`
still works correctly since that constant was updated to the same
`hinge`/`channel` values as the schema.sql seed, kept in sync
deliberately (see `defaultRateCard()`'s own comment on why the two
must never diverge).

---

## 13. Material cost by area — the costing-only slice of the "panel model"

You caught a real gap in §12's own reasoning: material substrate cost
was left out on the theory that nothing in `bom.ts` could consume a
per-sq-m rate without the full panel model (Phase 1 item 2, blocked on
the carpenter's construction convention). That conflated two different
things. The full panel model needs to know EXACTLY how big each panel
is — is the bottom captured between the sides or under them, is the
back grooved in or nailed on — because a wrong cutting list is
actually wrong, not approximately wrong. Pricing doesn't need that:
`bom.ts` already had a rough area estimate (`estimateAreaSqFt`, used
for labour) whose own comment already said "used for material + labor
costing" before the code caught up to match it. Reusing that estimate
for material is the same accuracy tier this app already trusted for
labour — an approximation, clearly labelled as one, not a claim that
this is the real panel model arriving early.

### What changed

- **`lib/bom.ts`**: added `carcassAreaSqM` — the identical formula to
  `estimateAreaSqFt` (front face + a 0.5-discounted side/back
  allowance), in sq m instead of sq ft, because material is rated per
  sq m (plywood/ply sheets are retailed that way) and labour per sq ft
  (the trade's own billing unit) — one estimate, two unit conversions,
  not two independently-tuned formulas that could drift apart.
  `materialCost` is now `carcassAreaSqM(item) * quantity *
  rates.materialRates[item.material]`, replacing what it used to
  mean: a bare copy of `item.unitPrice * item.quantity`.
- **That old meaning didn't just disappear** — it's now `baseCost`
  (`BOMLineItem.baseCost`, `BOMSummary.baseSubtotal`, shown in
  `QuoteSidebar`/`quotePdf.ts` as "Fabrication"), still `unitPrice *
  quantity`, still added into `lineTotal`. `unitPrice` stays a real,
  priced field rather than becoming dead data now that material has
  its own line — it represents everything about a cabinet that isn't
  material, finish, hardware or labour (assembly, margin, whatever
  else a business folds into one flat catalogue number).
- **This changes what every existing catalogue row's `unitPrice`
  should mean.** Before this change, `unitPrice` WAS the cabinet's
  entire price, material included. After it, material is charged
  separately, so a business's existing prices are now double-counting
  material unless they lower them. This is real, unavoidable
  migration work for every business using this app, not something
  fixable in code — flagged explicitly in the cabinet Excel export's
  own Instructions sheet (`unit_price`'s "meaning" column,
  `cabinetImportExport.ts`) and in `types/Catalog.ts`'s own comment on
  `CatalogItem.unitPrice`, both corrected in place rather than left to
  say the old, now-wrong thing.
- **`MaterialType` gained `'BWP'`** (Boiling Water Proof plywood) — a
  real, separately-priced product in this market, not a rename of
  Plywood. Added everywhere `MaterialType` is enumerated: the 4
  `MATERIALS` const arrays (`CabinetInspector`, `InventoryManager`,
  `Cabinet3DInspector`, `cabinetImportExport.ts`), and
  `cabinet_catalog_items`'s check constraint in `schema.sql` (same
  drop/re-add-as-`not valid`/`validate` pattern the `module_type`
  constraint already used, since `create table if not exists` is a
  no-op against an existing table and wouldn't have widened it).
- **`RateCard` gained `materialRates: Record<MaterialType, number>`**
  — a new `material_rates` jsonb column (nullable; no placeholder
  value to detect-and-preserve the way hinge/channel's migration has,
  since this column never existed before, so the backfill is a plain
  "fill if NULL" rather than "fill if still equal to the old default").
  `RateCardManager` gained a third fieldset (Material, ₹ per sq m)
  after Hardware, same `Input`/`Label` shapes the rest of that screen
  already uses.
- **Only 3 of the 5 `MaterialType` values have a real source.** HDMR
  and Plywood both take the business's own ₹1,400 (they gave one
  number for "Commercial Plywood / HDHMR", treating the two as the
  same price tier — not an error, a reflection of how those two are
  actually bought), BWP takes ₹2,200. **MDF (₹1,100) and Particle
  Board (₹850) are this session's OWN placeholder guesses** — scaled
  down from the two real figures in the usual retail ordering (MDF
  cheaper than plywood-grade boards, particle board cheapest), not
  given by the business, and carry meaningfully less confidence than
  the other three numbers on this rate card.

### Verified

A standalone script (not committed — this project's own convention
for logic worth checking numerically rather than by eye) built a
600×600×850mm HDMR cabinet with empty finish/handle/fixture catalogues
(isolating material cost from everything else) and confirmed by hand:
`carcassAreaSqM` = (600×850 + 600×850×0.5) / 1,000,000 = 0.765 m²;
`materialCost` = 0.765 × ₹1,400 = ₹1,071; `baseCost` = the cabinet's
own `unitPrice`; both flow correctly into `lineTotal` and their
matching `BOMSummary` subtotals. **Not verified**: the actual
`RateCardManager` UI rendered in a browser, or a live `schema.sql` run
against Supabase (no DB connection available here — same standing
caveat as every other schema change this session).

### Still not built

The real panel model — an exact, per-panel cutting list — remains
exactly as blocked as it was: on your carpenter's construction
convention (bottom between the sides or under them; back grooved in
or nailed on). This change makes material COST vary correctly by
substrate and by size; it does not produce a cutting list, and
`carcassAreaSqM`'s own comment says so explicitly, so the next person
reading it doesn't mistake "good enough to price" for "good enough to
cut boards against."

---

## 14. Fabrication/others rates, and cost basis vs. selling basis

§13 computed material + finish + hardware for real, for every
existing cabinet, using the app's own `calculateBOM` (not a
reimplementation) — and the result exposed a real problem: that sum
came to well under half of what every cabinet's old flat price
actually was, in every single case, not a few outliers. The gap
wasn't a bug in §13's formula. It was real cost §13 never claimed to
capture — building and edge-banding the carcass panels, assembling
the box — that the old catalogue `unitPrice` had been carrying
invisibly, plus whatever margin a business runs on top. Setting every
catalogue `unitPrice` to 0 (§13's own recommendation, to stop
material double-counting) would have made every quote roughly 40% of
its old total — probably below what these cabinets cost to make.

### What got added

- **`RateCard.fabricationRatePerUnit`** — ₹ per CABINET, flat
  regardless of size. Workshop labour: cut, edge-band, assemble the
  box. Deliberately separate from `laborRatePerSqFt` (unchanged),
  which is SITE installation billed by area, the trade's own
  convention for that different job — `RateCardManager`'s label for
  the existing field was corrected in place to say "site installation"
  now that there are two different labours to tell apart, per
  CLAUDE.md's rule on correcting a document rather than leaving it
  ambiguous next to a new field that would otherwise look like a
  duplicate.
- **`RateCard.othersRatePerUnit`** — ₹ per cabinet, defaults to **0**
  on your explicit instruction — unlike every other rate on this card,
  no real number exists for it; it's a deliberate empty slot for
  whatever doesn't fit elsewhere (packing, delivery, a specific job's
  conditions), not a guess dressed up as a placeholder.
- **`RateCard.marginPercent`** — cost-plus markup on the WHOLE job's
  cost (every subtotal, not just cabinets), answering your question
  about how professional estimating software handles this: cost basis
  (what the job actually costs) and selling basis (what the customer
  is charged) are tracked as two different numbers connected by a
  markup percentage, not conflated into one guessed catalogue price.
  25% seeded as a common trade margin — a placeholder exactly like
  every other rate on this card, not this business's real number.
- **`lib/bom.ts`**: `BOMLineItem` gained `fabricationCost`/`othersCost`
  (flat per cabinet, same shape as `baseCost`). `BOMSummary` gained
  `costGrandTotal` (every subtotal summed, before margin — what this
  job costs), `marginAmount` (`costGrandTotal × marginPercent / 100`),
  and **`grandTotal` is now `costGrandTotal + marginAmount`** rather
  than a bare cost figure. This is NOT a new meaning for `grandTotal`
  — every existing consumer (`saveProject`'s `quoteTotal`,
  `freezeCurrentQuote`'s stored summary, `quotePdf.ts`'s printed
  total) has always wanted exactly the number a customer is charged,
  and until now that number simply had no margin in it because margin
  had no field to live in. Zero code changes were needed at any of
  those three call sites — they inherit the corrected meaning for
  free, which is the whole point of computing margin inside
  `grandTotal` rather than bolting a separate "selling total" onto
  the side that every consumer would have had to remember to switch to.
- **`QuoteSidebar`** gained a Cost/Selling toggle — **internal and
  session-only, never persisted, and never available anywhere a
  customer could see it.** Selling view (default) shows the Margin
  line and `grandTotal`; cost view hides the margin line and shows
  `costGrandTotal` instead, labelled "Total Cost". `quotePdf.ts` and
  the freeze path have no toggle at all — they always print the
  selling breakdown, because a frozen quote is a document a customer
  receives, and a business's own cost basis is never information for
  a customer to see.
- **Relabelled, not just added**: the "Fabrication" line in
  `QuoteSidebar`/`quotePdf.ts` used to show `baseSubtotal` (a leftover
  from before this rate existed, back when a catalogue's own
  `unitPrice` was the closest thing to a fabrication charge) — that
  was a real mislabel once `fabricationSubtotal` existed too, corrected
  in place rather than left as two lines both trying to mean
  "fabrication." `baseSubtotal` now only renders when actually
  nonzero, labelled "Catalogue price" — a legacy per-row charge a
  business can still opt into by setting a catalogue row's own
  `unitPrice`, not a routinely-shown ₹0 line.

### Verified

A standalone script (not committed) built one cabinet through the
real `calculateBOM`, at the seeded `fabricationRatePerUnit`/
`othersRatePerUnit`/`marginPercent`, and confirmed by hand:
`fabricationCost` = the seeded rate exactly; `costGrandTotal` equals
the line's own `lineTotal` (single cabinet, no appliances/surfaces);
`marginAmount` = `costGrandTotal × 25 / 100` to within floating-point
tolerance; `grandTotal` = `costGrandTotal + marginAmount` exactly.
**Not verified**: the `RateCardManager` UI or the `QuoteSidebar`
toggle rendered in a browser, or `schema.sql`'s three new columns run
against a live database.

### What this means for your existing catalogue

`final-catalogues/cabinets-zero-baseprice.xlsx` (§13's output, `unit_price`
= 0 for all 23 real cabinets) is still the right file to upload,
unchanged by this section — fabrication/others/margin come from the
RATE CARD now, applied automatically to every cabinet regardless of
its catalogue row, not from anything that needs to be typed per row.
Uploading it plus re-running `schema.sql` (for the new columns) is
what actually turns on everything in this section for your live data.

### Confirmed, not an oversight: itemized cabinet rows stay cost-only

Asked directly rather than assumed: in Selling view, `QuoteSidebar`'s
per-cabinet table always shows `line.lineTotal` (cost, no margin),
while the Grand Total at the bottom includes margin as one separate
line — meaning the itemized rows do NOT sum to the Grand Total by
themselves; the "Margin" line is what bridges the gap. Flagged this
explicitly because most real customer-facing renovation quotes mark
up each line individually so the rows sum cleanly, and asked whether
to change it. Confirmed: keep current behaviour. No code change.

**Superseded by §15 below** — after seeing the upload validation
error this decision led to, and a follow-up conversation about how
professional software actually structures margin, this was reversed:
margin is now distributed per line after all, and moved off the rate
card entirely. Left this entry in place rather than deleting it, per
this file's own rule — the reasoning that led to the ORIGINAL "keep
one line" answer wasn't wrong given what was known then; it's what
changed once §15's three real problems surfaced together.

---

## 15. Unit price becomes decorative; margin distributed and moved to per-project

Three real problems surfaced together, from one bug report:

1. **Uploading the §13 cabinet file with `unit_price = 0` was
   REJECTED** — `cabinetImportExport.ts` validated `unit_price` with
   `positiveNumber` (requires > 0), a rule written back when
   `unitPrice` WAS the cabinet's entire price and 0 would have meant
   "free." That's no longer true, and the validator hadn't caught up.
   Fixed: `nonNegativeNumber` instead — 0 is now the expected, common
   case, not an error.
2. **"It should be the calculated cost, not zero. No?"** — a fair
   question that exposed the real design flaw: `baseCost` (from
   `unitPrice`) was still being ADDED to `lineTotal` alongside the
   live material/finish/hardware/fabrication calc. Setting
   `unit_price` to the §13 computed total would have recreated
   exactly the double-count §13 was built to fix, just via a
   different field. Fixed properly this time: `item.unitPrice` is no
   longer read by `calculateBOM` AT ALL — `baseCost`/`baseSubtotal`
   are removed from `BOMLineItem`/`BOMSummary` entirely, not just
   zeroed. `unitPrice` becomes a pure REFERENCE figure a business sees
   when browsing the catalogue — still stored, still shown in
   `InventoryManager`'s "Price" column — with zero path back into any
   real total. That makes it safe to fill with a real, non-zero
   number: regenerated `final-catalogues/cabinets-reference-price.xlsx`
   (superseding the earlier zero-price file) with `unit_price` set to
   each cabinet's own `lineTotal` under the new formula — material +
   finish + hardware + labour + fabrication, computed via the real
   `calculateBOM`, not re-derived by hand.
3. **"Don't add the margin line at the end — increase each line item
   by the margin so it sums to selling price"** — reversing the
   decision two sections above, once distributing it was understood
   to be what most real customer-facing renovation quotes actually do
   (rows that sum cleanly, no separate line to explain). Because
   `sum(x_i) × k = sum(x_i × k)`, this needed NO change to `bom.ts`'s
   totals math — `costGrandTotal`/`marginAmount`/`grandTotal` are
   unchanged. It's a display-layer change: `QuoteSidebar.tsx` and
   `quotePdf.ts` both gained a `markup()`/`marked()` helper
   (`value × (1 + marginPercent / 100)`, identity when there's no
   margin to apply) applied to EVERY shown figure — every cabinet/
   appliance/opening/fixture/countertop row, and every summary
   subtotal — not just the grand total. The standalone "Margin" line
   is gone; a small caption under the total now just says what
   percentage is included. Verified by hand: the marked-up row for a
   single cabinet equals `grandTotal` exactly, confirming the
   distributed figures actually reconcile rather than merely looking
   plausible.

### Margin moved off the rate card, onto the project

Also confirmed in the same conversation: margin should be a
per-PROJECT decision, not one number for the whole business — a big
order and a rush one-off don't have to carry the same margin, unlike
every other rate (a hinge is the same hinge on every job). This is
the same shape `RoomLayout.priceElectrical`/`priceCountertop` already
use for exactly this kind of "per-project pricing choice," so
`marginPercent` moved there rather than staying a `RateCard` field:

- **`RateCard.marginPercent` removed** — from the type, from
  `PLACEHOLDER_RATES`, from `sanitizeRateCard`, from `lib/rates.ts`'s
  row mapping, and from `RateCardManager`'s UI (which never got a
  chance to be seen rendered with it, and now never will be).
- **`RoomLayout.marginPercent?: number` added** — optional, so an
  older layout without one falls back to `DEFAULT_MARGIN_PERCENT`
  (now exported from `lib/bom.ts`, 25 — the same placeholder value,
  just relocated) rather than needing a migration. A new
  `setMarginPercent` store action follows `setPriceElectrical`'s exact
  shape (`noteDesignEdit` for undo/redo + autosave, then a clamped
  `set`).
- **Edited in `QuoteSidebar`, not `RateCardManager`** — right next to
  the Cost/Selling toggle, visible in both views (you'd want to
  change it and immediately see the effect by switching views, not
  hunt for a control that only appears in one). `BOMSummary` now
  carries `marginPercent` too (the RESOLVED value — layout's own, or
  the default), so neither `QuoteSidebar` nor `quotePdf.ts` needs to
  reach past the summary into the layout just to know what percentage
  is being shown.
- **`schema.sql` corrected before ever being run**: the `rate_cards.
  margin_percent` column added in §14 was removed from the file
  (never deployed to a live database, so this is a clean edit, not a
  migration to drop real data) and replaced with
  `layouts.margin_percent numeric` (nullable — the code's own
  `DEFAULT_MARGIN_PERCENT` is the single fallback, so there's no
  second default value in SQL that could quietly drift from it).

### Verified

Two standalone scripts (not committed): one confirmed `unitPrice` no
longer appears on a computed line item at all (`baseCost` is gone,
not just zeroed) and regenerated the reference-price file against the
real `calculateBOM`; another built a cabinet under a layout with a
custom 40% margin (not the 25% default) and confirmed `bom.
marginPercent` resolves to the LAYOUT's value, and that a row marked
up by that same percentage equals `grandTotal` exactly for a
single-cabinet case. **Not verified**: any of this rendered in a
browser, or `schema.sql`'s `layouts.margin_percent` column run against
a live database.

## 16. QuoteSidebar layout: toggle and margin box to the top; four
    states — errors/warnings promoted to `Alert` across the remaining
    screens

**QuoteSidebar reordering.** The Cost/Selling toggle and the margin
% input both moved from the bottom of the sidebar (past the whole
itemised table) to directly under the "Quote Summary" heading. Both
control every figure on the panel, so seeing them requires scrolling
past everything they affect if they sit at the bottom — moved up so
they're the first thing you see, not the last. No behaviour change:
same `view` state, same `markup()` helper, same `setMarginPercent`
action, only their position in the JSX.

**Four states, continuing item 8 of `docs/PRINCIPLES.md`'s roadmap.**
§11's pass covered `CustomerDashboard` and `InventoryManager` and
explicitly left "toolbars, inspectors, quote sidebar" for later. This
is that later. Scope: promote every screen-level (not per-row-in-a-
review-grid) hand-rolled error/warning box — a `<div
className="rounded border border-red-300 bg-red-50 ...">` or a bare
`<p className="text-red-600">` — to the shared `Alert`/
`AlertDescription` component, matching the convention
`RateCardManager` already established (`variant="destructive"` for
red; `className="border-amber-300 bg-amber-50"` +
`AlertDescription className="text-amber-800/900"` for amber, since
`ui/alert.tsx`'s `alertVariants` only defines `default`/`destructive`
— amber is layered on `default` via className override, not a third
CVA variant, so as not to invent a new primitive for one colour that
already has a working pattern).

Converted: `OpeningToolbar` (overlap + clearance-issue banners),
`LightingToolbar` (orphaned-fixture amber banner, unresolved-catalogue
-reference red banner), `CameraToolbar` (panorama-delete error),
`FixtureInspector` (deleted-catalogue-item error, host-missing amber
banner ×2 incl. the top-face/countertop case), `OpeningInspector`
(overlap-clash error, wall/ceiling-overrun amber banner), `FrontPicker`
(tambour fit error), `QuoteFreezePanel` (export error, freeze error).

**Deliberately NOT touched:**
- `LightingToolbar`'s sky-coloured "fixtures glow but don't light the
  room" box — informational, not an error or a needs-attention state;
  the stated consistency rule only fixes meaning for amber/red/green,
  so recolouring or Alert-ifying it would be inventing a fourth
  category nobody asked for.
- Short inline hint spans sitting mid-sentence in a form (e.g.
  `FrontPicker`'s and `OpeningInspector`'s single-line amber hints,
  `RoomSurfacesPanel`'s tabular-nums note) — these aren't block-level
  alerts, wrapping them in `Alert` would break their inline flow.
- The 5 Excel import/export panels' per-row validation errors — a
  deliberately dense review-grid pattern, already documented as its
  own convention, not a screen-level alert.
- Canvas overlay banners (`CollisionWarningBanner`,
  `CabinetClearanceWarningBanner`) — not part of the
  toolbar/inspector/quote-sidebar scope this item named; still hand-
  rolled `<div>`s, left open for a future pass.

Verified via `npx tsc --noEmit -p tsconfig.app.json` and `npx eslint .`
(both clean). **Not verified**: rendered in a browser — same
limitation as §15.

## 17. First-run checklist

The last unbuilt piece of roadmap item 8 (per `docs/PRINCIPLES.md`'s
"First-run experience" section): a new business signs in to an empty
dashboard with no indication of what to do first. Three steps, in the
order they actually matter: add your rates → import your cabinet
catalogue → create your first customer.

**Each step's "done" is computed from real state, not a flag some
action sets.** Rates: `!isPlaceholderRateCard(rateCard)` — the exact
same value comparison `RateCardManager`'s own amber banner already
used, now extracted to `types/rates.ts` (`isPlaceholderRateCard`,
`HARDWARE_RATE_KEYS`, `MATERIAL_RATE_KEYS`) so both places share one
definition of "still on the seed" rather than drifting if a rate key
is ever added and only one copy gets updated. Catalogue:
`cabinetCatalog.length > 0`. First customer:
`customers.length > 0` — from `CustomerDashboard`'s OWN
`fetchCustomers()` state, not the Zustand store (customers were never
moved into the store), which is also why the checklist is rendered
INSIDE `CustomerDashboard` rather than in `App.tsx` above it: threading
that count up to `App.tsx` just to render a checklist would have been
a bigger change than the checklist itself.

**Dismiss is per-business, in `localStorage`** (`firstRunChecklist:
dismissed:<businessId>`) — a genuine per-viewer convenience (which
teammate dismissed it from which browser doesn't matter to anyone
else at the business), not state that needs to survive a lost laptop
or sync across devices. Auto-hides once every step is done, with no
`localStorage` involved in that path at all — only an explicit "Skip"
click touches storage.

New: `src/components/dashboard/FirstRunChecklist.tsx`, using the
shadcn `Card` primitive for the first time in this app (it existed in
`src/components/ui/` unused since the shadcn adoption). `Manage
Inventory` and `Add a lead` buttons reuse `App.tsx`'s existing
`handleManageInventory` (now threaded into `CustomerDashboard` as a
new `onManageInventory` prop) and `CustomerDashboard`'s own
`setIsFormOpen`, rather than inventing new navigation.

Verified via `npx tsc --noEmit -p tsconfig.app.json` and
`npx eslint .` (both clean). **Not verified**: rendered in a browser.

## 18. Native selects/checkboxes migrated in the inspectors and
    toolbars; Skeleton loading added to the 3 catalog-driven toolbars

Item 8's last two pieces, scoped deliberately (confirmed with you
rather than assumed, given the size): **inspectors and toolbars only**.
`InventoryManager`'s catalogue tables and the 5 Excel import/export
review grids keep their native `<select>`/checkbox controls — those
are dense, spreadsheet-like editing surfaces where a popover-based
`Select` may genuinely be worse UX, not merely unconverted, and
converting them was never asked for. Raw number/text `<input>`s were
also left alone everywhere, including in the converted files — this
pass targeted selects and checkboxes specifically, per your own
scoping answer; a compact `py-1` inline dimension field vs. shadcn's
default-height `Input` is a separate design call nobody has made yet.

**Converted** (7 inspectors, 5 toolbars —
`ApplianceInspector/CabinetInspector/FinishPicker/FixtureInspector/
FrontPicker/ObstacleInspector/OpeningInspector`,
`ObstacleToolbar/RoomSurfacesPanel/LightingToolbar`, plus the plain
`<optgroup>`s in `FinishPicker`/`ObstacleToolbar` → shadcn
`SelectGroup`/`SelectLabel`): every native `<select>` → `Select`/
`SelectTrigger`/`SelectContent`/`SelectItem`, every native checkbox →
`Checkbox` wrapped in `Label` (`checked`/`onCheckedChange`, with
`checked === true` at each call site since Radix's `CheckedState` also
allows `"indeterminate"`, which none of these checkboxes use).

**The one real trap**: Radix `Select.Item` throws if given an
empty-string `value` — several native selects used `""` to mean "not
specified" (`FinishPicker`'s "unspecified" cabinet finish,
`OpeningInspector`'s leaf finish/handle, `RoomSurfacesPanel`'s "Not
specified"/"Behind units: not finished", `FrontPicker`'s tambour-slot
"None" and "No handles in catalogue"). Each needed a real sentinel
string (`'__none__'`, locally scoped per file) mapped back to
`undefined`/`''` in the `onValueChange` handler — same pattern
`OpeningInspector`'s pre-existing `CUSTOM_BACKDROP_VALUE` already used
for its backdrop picker, just applied everywhere else this shape
showed up. Numeric-valued selects (`FixtureInspector`'s run-direction
0°/90° toggle) needed the same `String(...)`/parse-back treatment,
since `Select`'s `value` is always a string.

**Loading states**: `CabinetToolbar` and `ApplianceToolbar` already
had a real `isInventoryLoading` branch (a plain "Loading your
pieces..." sentence) — promoted both to `Skeleton` bars, matching
`CustomerDashboard`/`InventoryManager`'s existing convention.
`LightingToolbar` had NO loading branch at all — its fixture-catalogue
list could flash "No fixtures in your catalogue yet" for a moment
before `fixtureCatalog` actually arrived, so a matching `Skeleton`
branch was added (a real gap, not just a markup inconsistency).
`ObstacleToolbar` deliberately left alone: obstacle presets are
optional decoration on top of always-available generic types, so
there's nothing genuinely blocked while they load.

**Left as-is, on purpose**: every toolbar/inspector's plain-text "no
selection" / "no items yet" empty state (already flagged in §16 as
saying the right thing, just not in `Skeleton`/`Alert` markup — empty
states aren't loading states, and there was nothing to promote them
TO here). `QuoteSidebar`'s "No cabinets placed yet" is the same
pattern and was left the same way.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean). **Not verified**: rendered in
a browser — the Select/Checkbox swap changes real interaction
mechanics (a popover instead of a native dropdown, keyboard handling
via Radix instead of the browser), so this is the one place in this
whole pricing/UI work where browser verification matters most before
calling it done.

## 19. Glass doors over open shelves, priced by tint

New feature (not a fix/consistency pass like §16-18): a business can
now put a hinged glass door in front of an open-shelf cabinet — a
display-cabinet look, shelves and whatever's on them stay visible
THROUGH the glass — in four tints: clear (plain transparent), black,
brown, yellow.

**Scoped to open-shelf only**, not every front kind, matching exactly
what was asked ("glass doors over open shelves"). Available both as a
plain open-shelf front's own `glass` field and as a `glass` field on
an open-shelf ROW inside a 'mixed' front (a shelf compartment over a
drawer stack can have its own glass door) — the data model
(`FrontRowLayout` already mirrors `FrontLayout` field-for-field) made
supporting both essentially free, and leaving mixed unsupported would
have been a surprising, hard-to-explain gap rather than a deliberate
scope line.

**Structural, not just visual — reuses the exact door-swing machinery
a plain door front already has.** A glass door splits into a single
or double leaf by the SAME `DOUBLE_DOOR_MIN_WIDTH_MM` threshold a
plain door front uses, gets the same hinge count
(`hingesPerLeaf(heightMm)`) and the same handle placement/hardware as
any door — `FrontLayout.hinge` is now reused for a narrow glassed
open-shelf's hinge side too (its own comment updated to say so), same
field, no new one needed. The shelves behind it are computed exactly
as before (`shelfBoards`) — the carcass stays a genuine open box
(`OPEN_CARCASS_KINDS` still includes `'open-shelf'` unconditionally);
only a glass panel now sits in front of that opening when `glass` is
set.

**Priced as its own thing, not folded into Material or Hardware.**
Glass is bought and cut as glass, not the cabinet's own board
substrate, so it gets its own rate-card dimension:
`RateCard.glassRates: Record<GlassTint, number>` (₹ per sq ft — the
same unit as `laborRatePerSqFt`, deliberately NOT sq m like
`materialRates`, since a glass door isn't priced the way a sheet
substrate is; `RateCardManager`'s new fieldset says so). Keyed by
TINT because tinted/lacquered glass genuinely costs more than clear
in the local market — same "different products, different rates"
reasoning `MaterialRates` already established, not a flat number with
tint as pure decoration. Placeholders (all genuine guesses, no real
invoice behind any of them): clear ₹180, black/brown ₹230, yellow
₹240 per sq ft.

`FrontBreakdown` (lib/fronts.ts) gained `glassAreaMm2` (0 unless a
glass door exists) and `FrontPanel` gained `glassTint?: GlassTint` —
deliberately NOT reusing `panelAreaMm2`/`HardwareSpec`, both of which
already have documented reasons they don't fit (panelAreaMm2 is
explicitly NOT wired into costing; HardwareSpec's `type` union would
have forced a single flat `glass` key onto `HardwareRates` when what
was needed was one rate PER TINT — see the type's own updated
comment). `bom.ts` calls `cabinetFrontBreakdown` a SECOND time
(`effectiveHardware` already calls it once internally and discards
everything but `.hardware`) specifically so a hand-entered hardware
override on a cabinet — which replaces the DERIVED hardware list —
can't also silently swallow that cabinet's glass cost; the override
is documented as being about hardware, not glass. Accepted as
deliberate, harmless duplication (pure arithmetic on a handful of
numbers) rather than reshaping `effectiveHardware`'s signature for
every other caller.

**3D rendering** (`Room3DCanvas.tsx`): a third branch in the
panel-rendering ternary (tambour / glass / everything else) — glass
panels get a `meshPhysicalMaterial` with a per-tint `color` +
`opacity` (`GLASS_TINT_COLORS`/`GLASS_TINT_OPACITY`, approximate
tint-sample colours, not a physically-measured spectral tint) instead
of the cabinet's own finish. No `transmission`/refraction — kept to
plain transparency, consistent with how nothing else in this renderer
uses physically-based glass, so this doesn't introduce a materially
different rendering technique for one feature.

**Verified numerically** (a standalone script, deleted after, per
this project's own convention) against the REAL `calculateBOM` and
`computeFrontBreakdown`: a narrow (600mm, single-leaf, black tint) and
a wide (900mm, double-leaf, clear tint) glassed open-shelf both
produced `glassCost` exactly matching `glassAreaMm2 / MM2_PER_SQFT ×
glassRates[tint]` computed by hand from the SAME breakdown; a plain
open-shelf with no `glass` field produced `glassCost: 0`; a `mixed`
front with a glassed open-shelf row correctly isolated that row's
glass cost while still combining its shelf/hinge hardware with the
other row's drawer channels; hinge counts matched
`hingesPerLeaf(heightMm)` × (1 or 2 leaves) exactly as a plain door
front's would.

Every touch point updated: `types/front.ts` (`GlassTint`,
`GLASS_TINT_LABELS`, `FrontLayout.glass`/`FrontRowLayout.glass`),
`lib/fronts.ts` (breakdown + panel geometry), `types/rates.ts`/
`lib/rates.ts`/`supabase/schema.sql` (`glassRates` column, seeded,
backfilled), `lib/bom.ts` (`glassCost`/`glassSubtotal`,
`describeFront` now names the tint), `FrontPicker.tsx` (glass
toggle + tint picker, top-level and per mixed-row, a live cost
preview), `RateCardManager.tsx` (new fieldset), `QuoteSidebar.tsx`/
`quotePdf.ts` (a "Glass doors" summary line, only shown when
non-zero — old frozen quotes with no `glassSubtotal` in their stored
summary simply don't show the row, same pattern `othersSubtotal`
already used), `Room3DCanvas.tsx` (glass rendering).

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), plus the numeric script above.
**Not verified**: rendered in a browser — this is a genuinely new
visual (transparent/tinted material) and a new form (the glass
toggle + tint picker in Front Picker), not a markup swap on an
existing control, so it's worth a real look before trusting it.

## 20. Glass extended to single-door, double-door and drawers; a
    double-charge in §19 corrected along the way

Your follow-up, same session: glass + tint on open drawers, and on
regular door fronts ("double door of brown-tint glass"). Both now
supported, plus a real bug in §19 caught and fixed BEFORE it was ever
committed.

**Which kinds, and why not the rest.** `lib/fronts.ts` now exports
`GLASSABLE_FRONT_KINDS = ['single-door', 'double-door', 'drawers',
'open-shelf']` — one list, shared by the pricing engine and
`FrontPicker`'s UI, so they can't drift. Left out on purpose: trolley
(a single shutter hiding baskets, not something shown through glass),
tambour (rolls on a track — glass doesn't roll), false-front (never
opens) and appliance-housing (no panel exists to be glass). All-or-
nothing per front: "double-door, brown tint" means BOTH leaves are
that glass, not one leaf glass and one board — the simpler, more
honest model of the one choice a business actually makes, and it
falls out of the code for free (both leaves already share one
`layout.glass`).

**A real double-charge in §19, caught while extending this.**
`finishedAreaSqM`/`carcassAreaSqM` (lib/bom.ts) charge material and
finish over the cabinet's FULL front face, regardless of front kind —
true before this feature existed, and it was ALREADY true for the
already-shipped open-shelf-with-glass case: a glass-doored open-shelf
was being charged full board substrate AND full finish on the same
area the glass door now also covers, on top of the new
`RateCard.glassRates` charge. That was a real over-charge, not just
this app's usual "estimate, not exact" imprecision — the difference
between rounding error and double-billing a customer for a shutter
that was never bought. Caught only because generalising to single/
double-door/drawers made it impossible to ignore (those kinds' panels
dominate the WHOLE estimated area, so the double-charge would have
been large and obvious, whereas open-shelf's is being flagged here
retroactively before anyone saw a wrong number). Not yet committed
when found, so this is a clean correction, not a migration — see
this project's own "correct in place, say what was wrong" convention
in CLAUDE.md.

Fixed by giving both functions a `glassAreaMm2` parameter: `frontFaceMm2
= max(0, widthMm × heightMm − glassAreaMm2)`, so a glass front's own
panel area comes OUT of what material/finish charge on, while
`carcassAreaSqM`'s `sideAllowanceMm2` (the carcass sides/back) stays
untouched — those are still real board no matter what the front is
made of. `bom.ts`'s per-cabinet loop was reordered so
`cabinetFrontBreakdown` runs ONCE, early (glass area needed for
material/finish, not just for `glassCost` later) — this also removed
the "deliberate duplicate call" §19 had accepted, a genuine
simplification alongside the fix. `estimateAreaSqFt` (site
installation labour) is deliberately NOT reduced — fitting a glass
door isn't less work than fitting a board one.

**`describeFrontRow` (lib/bom.ts)** now says "glass front" for drawers
and "glass door" for everything else — a drawer doesn't hinge open
the way a door does, even with a glass face, so calling it a "door"
would misdescribe the product on the quote itself.

**Verified numerically** (a second standalone script, deleted after):
a plain single-door control cabinet vs. an otherwise-identical
brown-tint glass one — hinge count IDENTICAL (2, unaffected by
material), `materialArea` dropped by exactly the glass panel's own
area (0.4241 sq m, matching the earlier script's independently-
computed `glassAreaMm2` for that exact geometry to the metre), and
`glassCost` present and correctly priced by tint. Same check repeated
for a wide double-door (4 hinges, unaffected) and for drawers (channel
count unaffected). A `mixed` front combining a glass double-door row
with a plain drawers row correctly isolated the glass row's own
reduced material/finish share while the drawer row's hardware and full
area charge were untouched.

**Known, deliberate simplification, not fixed here**: the carcass
BEHIND a glass single-door/double-door/drawers front stays the sealed,
opaque box it already was (unlike open-shelf, which gets a genuine
open carcass — see `OPEN_CARCASS_KINDS`, unchanged). Through a dark
tint (black/brown/yellow, all fairly opaque per `GLASS_TINT_OPACITY`)
this reads as a plausible tinted panel; through CLEAR glass on a
single/double-door front, you would see the sealed carcass's own
exterior finish directly behind it rather than an open, shelved
interior — a real visual gap, but "should choosing glass on a door
front also hollow out and shelve the carcass, and if so how" is a
genuinely open design question (it would start to make "double-door +
glass" visually indistinguishable from "open-shelf + glass, wide"),
not something with an obvious right answer, and wasn't asked for.
Flagging it here rather than silently deciding a larger scope
expansion.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), plus the numeric script above.
**Not verified**: rendered in a browser, same as §19.

## 21. The rest of item 8: native controls in InventoryManager and the
    5 Excel import/export panels

§18 deliberately left these out — "dense, spreadsheet-like editing
surfaces where a popover-based `Select` may genuinely be worse UX, not
merely unconverted." Asked for explicitly now that the inspector/
toolbar pass proved the pattern out, so the remaining ~35 native
selects/checkboxes across `InventoryManager.tsx` (the three catalogue
tables' own row editors — cabinets, obstacle presets, appliances —
plus the shared `CatalogFrontFields`/`ModelOrientationFields` helpers),
`FinishManager.tsx`, `HandleManager.tsx`, `FixtureManager.tsx`, and all
5 Excel review-grid panels (`CabinetCatalogImportExport`,
`ApplianceCatalogImportExport`, `FixtureCatalogImportExport`,
`HandleImportExport`, `ObstaclePresetImportExport`) are now shadcn
`Select`/`Checkbox`, same mechanical conversion §18 already
established: `SelectTrigger size="sm"` in place of the shared
`inputClass` string, `disabled` passed straight to the `Select`/
`Checkbox` root (both forward it to Radix, same as any other prop),
and a `'__sentinel__'` value wherever a native `<option value="">`
meant "nothing chosen yet" — `CatalogFrontFields`' "Automatic" front
override and "Default handle", and `CabinetCatalogImportExport`'s
"— select —" finish placeholder, all mapped back to `undefined`/`''`
in their handlers, same pattern as §18's `NO_FINISH_VALUE` etc.

**One deliberate non-conversion, for consistency with what's already
there, not an oversight**: `ObstaclePresetImportExport`'s
floor-to-ceiling column is a yes/no `<select>` in the review grid
(unlike `InventoryManager`'s own obstacle-preset row, which uses a
real checkbox for the same field) — kept as a `Select` with the same
two string values rather than switched to a `Checkbox` to match the
other row, because this pass is a mechanical native-to-shadcn
conversion, not a redesign of which control type each field uses;
changing the CONTROL, not just its implementation, is a separate,
unrequested decision.

**Numeric `ModelOrientationFields`** (appliance model up-axis/facing,
in `InventoryManager.tsx`) needed the same `String(...)`/parse-back
treatment as §18's fixture run-direction select, since `Select`'s
`value` is always a string — including its "Custom (N°)" fallback
option for a hand-edited angle that doesn't match any preset, which
needed no sentinel (the fallback's value IS the exact unmatched
number, already unique against the presets by construction).

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean); confirmed zero native
`<select>`/`type="checkbox"` remain anywhere under
`src/components/inventory/`. **Not verified**: rendered in a browser —
same caveat as §18, more so here since these are the densest, most
edited-in-anger screens in the app (every catalogue row, every bulk
Excel review grid).

## 22. Item 8's last two pieces: consistency rules and keyboard

**Consistency rules, audited rather than assumed.** Rather than guess
at what "one spacing scale, one type scale" should be and rewrite
panels to match a made-up standard, grepped every toolbar/inspector/
dashboard panel's own heading/description/shell classes first. The app
was already overwhelmingly consistent in practice — 14 of 16 top-level
panels use the identical `rounded-lg border border-gray-200 bg-white
p-4` shell, every heading is `text-sm font-semibold text-gray-700`,
every description line is `text-xs text-gray-400` or `-500` — just
never written down, so nothing stopped it drifting silently. One real
drift found this way: `FirstRunChecklist`'s heading (added this same
session, §17) used `text-gray-800` instead of the established `-700`;
fixed. The two apparent outliers that AREN'T violations: a `p-2`
popup menu (`PickChooser`, the dashboard's 360°-views dropdown) is a
different, deliberately denser UI category, not a panel; the quote
sidebar's Grand Total row (`text-gray-900`) is deliberate emphasis on
the one number that matters most, not a heading. The scale itself is
now written down in `docs/PRINCIPLES.md`'s "Consistency rules"
section rather than left implicit.

**Keyboard.** New global hook, `useSelectionShortcuts` (mirrors
`useUndoRedoShortcuts`'s shape — same `isEditableTarget` guard so
typing in an Inspector field never doubles as a shortcut): Delete/
Backspace removes whatever's selected (dispatches to the matching
`removeCabinet`/`removeObstacle`/`removeAppliance`/`removeOpening`/
`removeFixture` — same as that item's own Delete button, no confirm
dialog, since undo already covers the "oops" case and every OTHER
canvas delete already works this way); Escape deselects; arrow keys
nudge a cabinet/obstacle/appliance's x/y — 10mm per press, or the
room's own `gridSnapMm` (default 50) with Shift held, matching what
dragging already snaps to.

Gated by `enabled: view === 'canvas'` (a parameter, not a conditional
hook call — React doesn't allow those) — `selection` is STORE state,
not view state, so it survives switching to the dashboard or Manage
Inventory. Without the gate, a stale selection from before the switch
would let Delete or an arrow key silently act on a cabinet that isn't
even on screen, which reads as the app losing work for no visible
reason.

**New shared geometry helper**: `nudgeFootprint` (`lib/footprint.ts`),
same shape as the existing `rotateFootprint` — moves an item's
UNROTATED x/y by a room-space (dx, dy), reusing `clampFootprintCenter`
so a nudge can't push an item out of the room, without touching
`rotationDeg`. Deliberately NOT extended to openings (position is
`offsetMm` along a wall, not x/y) or fixtures (position depends on
mount kind — ceiling/wall/cabinet/free); Delete/Escape still cover
those two, arrows don't.

Verified: a standalone script (deleted after) confirmed `nudgeFootprint`
against a plain unrotated cabinet (exact delta applied), a cabinet
already pushed near the room edge (correctly clamped rather than
exceeding the boundary), and a 90°-rotated item (confirmed the
footprint-swap and unrotated-corner math both apply correctly
together, catching a case where the test's OWN starting position was
already out of bounds and observing the function correctly pull it
back in — not a bug, a confirmation the clamp works both ways).

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`
(both clean, full build check pending until the rest of this batch of
work lands). **Not verified**: rendered in a browser — keyboard
shortcuts are exactly the kind of thing that's easy to get subtly
wrong (focus stealing, a shortcut firing somewhere it shouldn't) and
hard to catch from source alone.

## 23. Cabinet library breadth: a real pantry pull-out ModuleType,
    caught a "mostly data entry" claim that wasn't quite true

Roadmap item 10 named tandem, pantry, corner carousel and wicker
baskets. Corner carousel already existed (`corner-carousel`
ModuleType). The other three turned out to split into one real code
gap and two that genuinely were just data, which is worth recording
because it's easy to get backwards:

**Pantry — needed a real ModuleType, not just a catalogue row.** The
first attempt was a `tall-unit` catalogue row with an explicit
`frontLayout` override (`{ kind: 'trolley', count: 5 }`) baked in by
`scripts/generate-starter-catalogues.ts`. A round-trip check (parsing
the generated xlsx back through the real `parseCabinetCatalogFile`)
caught that this doesn't work: `cabinetImportExport.ts` deliberately
excludes `frontLayout` from the Excel format at all (per its own
header comment, from the original inventory-import design — a front
is an in-app Front Picker edit, not a bulk-spreadsheet field). The
override would have silently vanished on upload, leaving a cabinet
labelled "Pantry Pull-out Unit" that was actually just a plain
double-door tall unit — wrong in a way nobody would notice until a
customer asked why their pantry has no pull-out. Fixed properly: a new
`ModuleType` value, `'pantry-unit'` (`types/cabinet.ts`), whose own
`defaultFrontLayout` case (`types/front.ts`) returns the trolley/
5-basket front directly — since `module_type` DOES survive the sheet
round trip (it's a real column), the correct front now arrives with
the row instead of depending on a field the format can't carry.

Every place `ModuleType` is enumerated updated: `MODULE_COLORS` in
`CabinetLayer.tsx` (a `Record<ModuleType,...>`, so this one is
TypeScript-enforced — the compiler would have caught a missed entry);
`MODULE_TYPE_LABELS` in `Cabinet3DInspector.tsx` (a plain
`Record<string,...>` with an `?? cabinet.moduleType` fallback, so NOT
enforced — easy to forget, found by reading rather than by the
compiler); the two hand-kept-in-sync `MODULE_TYPES` arrays
(`InventoryManager.tsx`, `cabinetImportExport.ts` — the latter's own
comment already said "keep in sync by hand if a module type is ever
added"); and the `module_type` check constraint in `schema.sql`, both
the inline `create table` definition and the drop/re-add widening
block that actually applies to an existing database (same mechanism
`corner-carousel` and `BWP` used before it). Deliberately NOT added to
`COUNTERTOP_MODULE_TYPES` (`lib/cabinetGeometry.ts`) — a full-height
pull-out unit doesn't carry a countertop, same as `tall-unit` is
already correctly excluded.

**Tandem — already fully supported, no code needed.** A tandem-box
drawer system is what `RateCard.hardware.channel` has been priced as
since real rates landed (§12) — every `drawer-unit` catalogue row
already gets tandem-box-priced channels, not a budget alternative.
Adding a same-width "Tandem Drawer Unit" would have been a mechanically
identical duplicate of an existing row under a different name. Instead
added a genuinely new WIDTH the catalogue didn't have — "Tandem Drawer
Bank 1200" (existing rows stop at 900mm) — real breadth, not a
relabelled duplicate.

**Wicker baskets — represented by the pantry unit itself, not a new
pricing dimension.** `RateCard.hardware.basket` ("Wire basket (each)")
is what a pantry pull-out's tiers are already priced from; a wicker
vs. wire distinction in the trade is a cosmetic/weave difference, not
a structurally different component the way clear vs. tinted glass
turned out to be (§19 — where the user gave a concrete example, "brown
tint glass," implying real distinct pricing was wanted). No user ask
here was that specific, so this stayed data (the pantry catalogue rows
above) rather than a new `GlassRates`-style pricing map invented on
spec.

New starter-catalogue rows (`scripts/generate-starter-catalogues.ts`,
regenerating `starter-catalogues/cabinets-starter.xlsx`): "Pantry
Pull-out Unit 450/600" (category "Pantry", own toolbar grouping) and
"Tandem Drawer Bank 1200". 26 cabinets total, up from 23.

Verified: a standalone script (deleted after) round-tripped the
regenerated xlsx through the real `parseCabinetCatalogFile` and
confirmed `moduleType: 'pantry-unit'` survives with zero validation
errors, then fed the resolved `defaultFrontLayout('pantry-unit', ...)`
through the real `computeFrontBreakdown` and confirmed it produces
5 channels + 5 baskets of hardware and a single shutter panel — the
actual pull-out pantry product, not just a label.

Verified via `npx tsc --noEmit -p tsconfig.app.json` and `npx eslint .`
(both clean). **Not verified**: rendered in a browser.

## 24. Kitchen-specific checks — aisle width, sink-hob distance,
    hob-under-window, counter-beside-hob, chimney-centred-on-hob

Roadmap item 12, the last of the three things asked for together this
session ("start with 3 then 2 and then move to 1"). New advisory-only
checks (`lib/kitchenChecks.ts`) — same "warn, never block" Principle 6
every existing overlap/clearance check already follows: a genuinely
tiny room has no choice about aisle width, and none of these should
ever stop someone designing what the site actually requires.

**What's checked, and the one honest gap.** Aisle width (two facing
counter runs need `MIN_AISLE_MM` = 900mm of clear walking space
between them); sink-to-hob distance (450–2700mm — closer risks
splashing near an open flame, farther is an inefficient walk); hob not
sitting under a window (curtains near a flame, draft blowing it out);
a landing counter immediately beside the hob on at least one side (a
hot pan needs somewhere to go); a chimney within 100mm of centred over
its hob. **NOT checked**: a full three-point work triangle
(sink/hob/refrigerator) — this app has no fridge `ApplianceType` at
all (`types/appliance.ts`: `'stove' | 'chimney' | 'oven' | 'otg' |
'toaster' | 'sink'`), so `checkSinkHobDistance` checks the one leg of
the triangle that's actually visible rather than fabricating a third
corner from nothing. Stated in the module's own header comment rather
than silently working around it.

**The real bug this caught before it shipped: corner ambiguity in
"which wall is this against."** The first implementation reused
`surfaceAreas.ts`'s existing `isAgainstWall` (an edge-touch test) to
decide which wall a counter run or hob belongs to. A verification
script (constructed, not assumed) caught that this is WRONG for these
checks specifically: a cabinet run spanning a wall's full length
always has an END whose edge coincides with the PERPENDICULAR wall
too — `isAgainstWall` correctly says "yes, also touching the side
wall" there, because for ITS purpose (does this stretch of the side
wall have concealment behind a cabinet) that's the right answer.
Reused here, it turned every ordinary single-wall run into a phantom
second counter run at the room's corners, producing a spurious
"aisle-east-west" finding on every single test layout, including ones
with nothing anywhere near the east or west walls.

Fixed with a DIFFERENT, deliberately separate test:
`nearestWall` picks the single wall whose plane is nearest the item's
CENTRE (not its edges), which has no corner ambiguity — a north-wall
run's centre is close to the north plane and far from east/west
regardless of where its ends happen to land. `isAgainstWall`/
`wallIncursionMm` in `surfaceAreas.ts` were left untouched (correct for
billing) and two of its internal helpers (`isAgainstWall`,
`extentAlongWall`) plus two new ones (`startAlongWall`,
`wallIncursionMm`, promoted from private to exported) are shared
rather than re-derived, so the "along a wall" convention can't
disagree between the two files.

**Geometry choices, each verified against a constructed scenario, not
assumed:**
- Aisle width only fires when BOTH opposite walls have a real
  incursion (`MIN_MEANINGFUL_INCURSION_MM` = 100mm) — an empty
  opposite wall is just open room, not a galley constraint, and this
  app's rooms are mostly single-run (docs/PRINCIPLES.md: "6×8 ft to
  12×14 ft"). Verified: a one-sided layout produces zero findings; a
  genuine L-shaped kitchen (perpendicular runs meeting at a corner, the
  exact shape the corner-ambiguity bug would have broken) produces
  zero findings; both a north-south AND an independently-tested
  east-west narrow galley each correctly produce exactly one finding.
- Sink-hob and chimney-hob use footprint CENTRES (rotation-invariant,
  per this app's own established "the centre is the rotation-invariant
  quantity" rule — CLAUDE.md) via straight-line distance, not
  along-wall distance — the concern (splash risk, extraction
  effectiveness) is about physical proximity in the room, not
  positions along a shared wall.
- Chimney-to-hob is paired by NEAREST match, not every chimney against
  every hob, so a kitchen with several of each doesn't get one finding
  per irrelevant cross-pairing.
- Counter-beside-hob only considers cabinets confirmed via `nearestWall`
  to be on the SAME wall as the hob, and only counts them "beside" it
  within a small along-wall gap tolerance (60mm, matching the existing
  wall-contact tolerance's own reasoning) — a cabinet on a different
  wall entirely isn't "beside" the hob no matter how close its raw x/y
  coordinates happen to be.

**UI**: `useKitchenChecks` (mirrors `useCollisions`/
`useCabinetClearance` — a memoised hook over the store's own layout/
cabinets/obstacles/appliances) and `KitchenChecksBanner`, a third
amber advisory banner alongside `CollisionWarningBanner`/
`CabinetClearanceWarningBanner`, gated by its own "Show kitchen
ergonomics checks" checkbox (defaults on, same "visible by default"
convention `RemainingSpaceLayer`'s own comment cites). Built with the
`Alert` component from the start rather than a raw div, unlike the two
existing canvas banners it sits beside (both still hand-rolled divs,
explicitly left open for a future pass in §16) — no reason to build a
brand-new component the OLD way when the newer convention already
exists. Listed one finding per line rather than collapsed into an
aggregate count the way the other two banners are, since each message
here is already specific about what and where — "5 issues found"
would lose the one thing that makes this useful at a glance.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), plus the constructed-scenario
script above (deleted after, run twice — once catching the corner bug,
once confirming the fix). **Not verified**: rendered in a browser —
truer here than almost anywhere else in this session, since every one
of these checks depends on wall-geometry assumptions that a single
real layout, clicked through by hand, would test far more thoroughly
than any number of constructed scenarios.

**CORRECTED, caught by you in a real layout** — proof the note above
was right to flag: `checkCounterBesideHob`'s adjacency tolerance
(`ADJACENT_GAP_TOLERANCE_MM`) was 60mm, copied from
`WALL_CONTACT_TOLERANCE_MM`'s "does this touch the wall PLANE"
reasoning in `surfaceAreas.ts`. That was the wrong precedent to
borrow — that question is a hard physical-contact test; this one is
"does a real landing counter read as right there next to the hob,"
which has to tolerate an ordinary countertop scribe gap or a hob's own
bezel. You had base cabinets on both sides of a real hob and still got
"no counter beside the hob," simply because the actual gap was more
than 60mm. Widened to 150mm (`lib/kitchenChecks.ts`'s own comment on
the constant now explains why, in place, rather than the old comment
being silently replaced) and reverified: a 100mm gap now clears, a
genuinely distant cabinet (500mm+) still correctly flags.

## 25. Gola/edge-profile handles go vertical on a trolley pull-out

Real bug, caught by you clicking through the pantry pull-out unit
(§23): a gola or edge-profile handle on ANY trolley-fronted cabinet —
the pantry pull-out and cylinder-trolley both share `FrontKind`
'trolley' — was placed horizontally along the TOP edge, the exact
same treatment `placeHandle` (`lib/fronts.ts`) gives a single-door,
double-door or drawer front. That convention is right for those three
(a continuous horizontal gola channel across a run of base/wall
cabinets, or across a drawer stack, at a reachable height) and wrong
for a trolley: a trolley has no hinge to swing from, is gripped and
pulled straight out, and — especially on a 2100mm-tall pantry unit —
a groove fixed at the very top edge sits near ceiling height and is
awkward or impossible to reach. A vertical groove down one side gives
a full-height grip reachable anywhere along it, which is the real
trade convention for this front kind, independent of how tall the
particular cabinet happens to be (confirmed deliberately: a SHORT
850mm cylinder-trolley gets the same vertical treatment, since the
"no hinge, pulled straight out" reasoning applies regardless of
height — this is a FrontKind property, not a height threshold).

Fixed by giving `placeHandle` a fourth parameter, the front's own
`kind` (both call sites already had it in scope — the shared tail's
`rectsKind`, and the glass-door case's own literal `'open-shelf'`) —
consulted ONLY inside the gola/edge-profile branch, which now special-
cases `kind === 'trolley'` to place the profile vertically (full
panel height, at the right edge — there's no hinge-side concept for a
trolley to derive which side from, since `side` is always `'center'`
for this kind, so the edge is a fixed, documented choice rather than
left to accident). Every other handle kind (bar, knob) and every other
front kind (single-door, double-door, drawers, the open-shelf glass
door) are untouched — this was confirmed by rechecking each explicitly
against the real `computeFrontBreakdown`, not assumed from reading the
diff.

Deliberately NOT changed: bar/knob placement on a trolley (still
horizontal, centred at roughly the panel's vertical midpoint). You
asked for this to be "checked", and it was — a horizontal bar/knob
centred at panel-height/2 sits at a genuinely comfortable reach height
even on a 2100mm cabinet (unlike gola's problem, which is specifically
that it clings to the TOP edge rather than being centred), so it
was left alone rather than changed on spec.

Verified: a standalone script (deleted after) confirmed gola AND
edge-profile go vertical (full height, right-edge) on both the
pantry-height trolley (2100mm) and a normal cylinder-trolley (850mm);
confirmed bar and knob on the SAME trolley front are byte-for-byte
unchanged; confirmed single-door, double-door, drawers, and the
glass-doored open-shelf front (the other `placeHandle` call site) all
still place gola horizontally along the top exactly as before — no
regression on any front kind this session didn't touch. 3D rendering
needed no changes at all: `HandleMesh` (`Room3DCanvas.tsx`) already
reads `orientation` generically and sizes/orients the handle mesh
accordingly — this was already exercised by single-door's own vertical
bar handles, so a vertical gola/edge-profile on a trolley reuses an
already-correct code path rather than a new one.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), plus the script above.
**Not verified**: rendered in a browser — you found the ORIGINAL bug
this way, so this is exactly the kind of change worth a real look
before trusting the fix.

**Follow-up, confirmed fixed in a browser**: the straddling-the-edge
inset above turned out to be the real cause (or at least enough of
one) — you confirmed the gola/edge profile is now visible on the
pantry unit's trolley front.

## 26. Manual horizontal/vertical override for gola/edge-profile on
    doors

Your follow-up ask, scoped precisely rather than left to me to guess:
a manual choice for gola/edge-profile orientation, **doors only**
(single-door/double-door — not trolley, not drawers, not the glassed
open-shelf door), defaulting to whatever already renders today, one
control per row in a `mixed` front so a stacked single-door-over-
double-door cabinet can set each independently.

**Data model**: a new `HandleOrientation = 'horizontal' | 'vertical'`
type and a `handleOrientation?` field on BOTH `FrontLayout` and
`FrontRowLayout` (types/front.ts) — mirrors exactly how `glass` and
`hinge` already exist at both levels for the same "a mixed front's
rows are configured independently" reason. `undefined` (the default,
existing cabinets are untouched) falls through to the current
kind-based logic unchanged.

**Geometry** (`lib/fronts.ts`): `placeHandle` gained a 5th parameter,
the resolved `handleOrientation`, consulted ONLY inside the gola/
edge-profile branch and ONLY when `kind` is `'single-door'` or
`'double-door'` — trolley's vertical placement (§25) and every other
kind's horizontal default are both completely unreachable from this
new parameter, by construction (the `isDoor` check gates it). When
set to `'vertical'`, reuses the SAME `side` ('left'/'right', already
computed per leaf from the door's own hinge/position logic) a bar/
knob handle already uses for ITS vertical placement — so a double
door's two verticals land on the edge nearest the CENTRE meeting
line, the same convention a bar/knob handle on a double door already
has, rather than two unrelated strips that both happen to be
vertical. The mixed-front recursive case threads `rowSpec.
handleOrientation` into each row's own `subLayout`, same pattern
`glass` already established there.

**UI** (`FrontPicker.tsx`): the control only appears when it would
actually do something — front kind is a door AND the resolved handle
is gola or edge-profile (`isProfileHandle`) — showing it for a bar/
knob/handleless front would be a control with no visible effect,
which is worse than not offering it. Placed exactly where asked:
Configuration → (glass, hinge, etc.) → **Handle** → **Orientation**,
both at the top level and per mixed-front row (reading the row's own
`kind`, but the ONE cabinet-wide `handle` — there's no per-row handle
in this app, so a mixed front's rows can each choose their own
handle's ORIENTATION but not a different HANDLE per row).

Verified: a standalone script (deleted after) confirmed — no override
on a single-door gola stays horizontal (unchanged default); an
explicit vertical override on a single-door places it correctly near
the hinge-opposite edge; an explicit horizontal override matches the
default exactly; a double-door with vertical override places BOTH
leaves symmetrically hugging the centre meeting line; a bar handle on
the same door is completely unaffected (its own pre-existing vertical-
near-edge logic is independent of this parameter entirely); trolley
and drawers both IGNORE the override even when one is explicitly set
on their layout (scope enforced, not just "happens not to be tested");
a `mixed` front with a vertical single-door row and a default
(horizontal) double-door row correctly keeps the two independent.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), plus the script above. **Not
verified**: rendered in a browser.

## 27. Rectilinear room geometry deferred; appliance-dimensions-first:
    four new ApplianceTypes, and a stale LIMITATION comment corrected

**Rectilinear room geometry (Phase 3 item 9) — deferred, 28 Sep 2026,
your call.** Before starting, three parallel research passes mapped
every rectangle-specific site: the room is stored as exactly two
scalars (`RoomDimensions.widthMm`/`depthMm`), and "which wall" is a
hardcoded 4-case switch on `WallOrientation` repeated across
`surfaceAreas.ts`, `footprint.ts`'s `clampFootprintCenter`,
`openings.ts`, `kitchenChecks.ts`'s `nearestWall`, all 8 2D canvas
layers, and `Room3DCanvas.tsx`'s room shell — around 15-20 files with
real geometry math, several of them (the drag-clamp across a concave
corner especially) genuinely tricky, verified only by hand-written
scratch scripts since there's no test runner. That's a multi-session
foundation rewrite for a feature whose customer value is unvalidated —
reasonable to defer until either real market feedback says
non-rectangular rooms matter, or the panel/cutting-list model (Phase 1
item 2, still blocked on the carpenter's construction convention) gets
unblocked, since that work touches walls too and is the one thing that
would make waiting more expensive than it is today. Full scope kept in
the plan file (`golden-herding-raven.md`) rather than re-derived from
scratch whenever this is picked back up — two useful pieces of prior
art already found: `scene3d.ts`'s coordinate helpers are already
shape-agnostic (no rectangle assumption to undo), and
`cornerCarouselGeometry` in `Room3DCanvas.tsx` already proves the exact
`THREE.Shape`+`ExtrudeGeometry` technique a polygon room floor/ceiling
would reuse.

**Appliance-dimensions-first (Phase 3 item 11) — your call on scope:
add missing `ApplianceType`s + a dimension-accuracy pass, not the
larger "cabinet cutouts driven by appliance dimensions" feature.**
Added `'fridge'`, `'microwave'`, `'dishwasher'`, `'water-purifier'` to
the 6-value enum (`types/appliance.ts`), plus the same 7 hand-synced
sites the `pantry-unit` `ModuleType` addition touched earlier this
session (`APPLIANCE_TYPE_LABELS`, `ApplianceLayer.tsx`'s
`APPLIANCE_COLORS`, `Room3DCanvas.tsx`'s `APPLIANCE_MESH_COLORS`,
`InventoryManager.tsx`'s and `applianceImportExport.ts`'s hand-synced
`APPLIANCE_TYPES` arrays, and the `appliance_type` check constraint in
`schema.sql`, both the inline definition and the migration block).
Starter catalogue got 5 new rows (2 fridge sizes, 1 each of microwave/
dishwasher/water-purifier) with realistic Delhi NCR dimensions —
`scripts/generate-starter-catalogues.ts`, regenerated
`appliances-starter.xlsx` (16 rows, up from 11). Verified the new
types round-trip through the real `exportApplianceCatalogXlsx`/
`parseApplianceCatalogRows` with zero validation errors (script written
and deleted, same discipline as the pantry-unit round-trip check).

`fridge` was added specifically because `kitchenChecks.ts`'s own header
comment already named this exact gap: *"a real work triangle is
sink/hob/refrigerator, and this app has no fridge ApplianceType...
presumably why it was never modelled."* **Deliberately not done in this
pass**: extending `checkSinkHobDistance` into a genuine 3-point work
triangle now that a fridge type exists. That's a `kitchen-checks.ts`
change, not an appliance-catalogue one, and it would need new
ergonomic distance thresholds (fridge-to-hob, fridge-to-sink) invented
with no more real basis than the existing `MIN_SINK_HOB_MM`/
`MAX_SINK_HOB_MM` constants already have — not something to add
without being asked. `kitchenChecks.ts`'s header comment still
accurately describes the current 2-leg check; only the fact that no
fridge type exists is now stale, and that's flagged in
`types/appliance.ts`'s own comment on `fridge` instead of silently
left wrong.

**Also corrected**: `types/appliance.ts`'s comment on `sink` claimed
*"LIMITATION: countertops aren't cut, so a basin reads as sitting ON
the worktop... wrong for an undermount"* — stale. `Catalog.ts`'s
`sinkCutoutWidthMm`/`sinkCutoutDepthMm` fields and `Room3DCanvas.tsx`'s
`CountertopMesh` (whose own comment says *"see the LIMITATION note...
this replaces"*) show the cutout was actually built later and the
original comment never got corrected — a real instance of one code
comment going stale while a different file's comment already knew it.
Fixed in place per this file's own convention: said what was wrong
rather than silently rewriting it.

Verified via `npx tsc --noEmit -p tsconfig.app.json` and `npx eslint .`
(both clean) plus the round-trip script above. **Not verified**: the
new types rendered/placed in a browser (colors chosen for the 2D/3D
`Record`s are new and unseen).

## 28. Present mode (Phase 3 item 13) — a new screen, not a stripped
    copy of the editing one

New `PresentMode` component (`src/components/present/PresentMode.tsx`),
reached via a new "Present" button next to "3D Preview"/"Wall
Elevation" in the canvas toolbar row (`App.tsx`, new `'present'` view).
Principle 8 ("two audiences, two views" — no grid, no warnings, no
inspector panels, price revealed only when the designer chooses) taken
literally rather than as a checklist to bolt onto the existing editing
screen.

**Two sub-views, your call**: 3D walkthrough (reuses `Room3DCanvas`
completely unchanged — the existing "3D Preview" screen was already a
pure viewer with no editing capability, so nothing needed stripping
there) and a floor plan (new — `RoomCanvas` + `CabinetLayer`/
`ObstacleLayer`/`ApplianceLayer`/`OpeningLayer`/`FixtureLayer` only,
`showDimensions`/`showOverlapWarnings`/`showClearanceWarnings` forced
`false`, no toolbars/inspectors/banners/`PickChooser`/`CameraLayer`/
`RemainingSpaceLayer`).

**The floor plan is wrapped in a `pointer-events-none` div rather than
given a new read-only prop.** `CabinetLayer`'s Konva `draggable` is a
hardcoded literal, not conditional on any prop — threading a
`readOnly`/`interactive` flag through 5 layer components just to
suppress dragging during a presentation was more invasive than the
problem needed. Blocking pointer events at the DOM level, one div,
gets the same result (a stray click during a live presentation can't
move a cabinet) without touching any layer's internals. The 3D branch
needed no equivalent: `Room3DCanvas` never supported dragging an item
in the first place.

**Price reveal**: a designer-tapped "Reveal Price"/"Hide Price"
button, default hidden, shows `useBOM().grandTotal` — the exact number
the PDF/WhatsApp quote already sends a customer (§6's "Quote export"),
never the cost-basis view `QuoteSidebar`'s Cost/Selling toggle can
show. Worth stating plainly: "designer-only" here means a control the
designer operates, not something hidden from the customer's eyes —
this is a laptop-first, same-physical-screen product (Principle: "the
one merciful constraint"), so there is no separate customer display to
hide it on. The reveal is a deliberate moment, not a secret button.

Own local `INR_FORMATTER`, not imported from `QuoteSidebar.tsx` (not
exported) or unified with `quotePdf.ts`'s separate formatter — matches
the pre-existing pattern of each display context having its own,
rather than a drive-by dedup refactor unrelated to this task.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and `npm run build` (all clean). **Not verified in a browser** — no
browser automation available this session (see CLAUDE.md's
verification-limits section); the dev server was started once to
confirm it serves without a startup error, then stopped. You'll need
to click through both sub-views and the price reveal yourself before
trusting this in front of an actual customer.

## 29. Visual assets pass — much less scope than the original brief,
    because most of it was already done

`public/VISUAL_ASSETS_PROMPT.md` (6 tasks, written in an earlier
session) explicitly warns its own paths/assumptions may be stale.
Before touching anything, three parallel research passes verified the
CURRENT state against that brief. Real finding: **Tasks 2, 5, and 6
were already fully done** in a session after the brief was written,
never folded back into it — finish scale/relief (no double-stacking,
`stone-concrete` already fixed at 512×256 with matching swatch mm),
window backdrops (real images + a working preset dropdown in
`OpeningInspector.tsx`), and asset weight (lazy per-finish texture
loading with real disposal, `pendant-industrial.glb` already
downscaled to 567KB). None of that was touched this pass — verifying
it was already correct IS the work, not a reason to redo it.

**Task 1 — HDRI, wired in alongside the Lightformer rig (your call:
keep both).** An HDRI (`public/hdri/studio-small-09.hdr`) had already
been fetched and credited in an earlier session but never loaded by
any component. Added `files="/hdri/studio-small-09.hdr"` to
`Room3DCanvas.tsx`'s `<Environment>`, which already had 4
`<Lightformer>` children (themselves having already replaced the old
CDN `preset="apartment"` — also already done, also not reflected in
the brief).

Before wiring this, read `node_modules/@react-three/drei/core/
Environment.js` directly rather than assuming `files` and `children`
can coexist — they can, but through a specific mechanism worth
recording: passing both routes `<Environment>` into its
`EnvironmentPortal` path, which places the loaded HDRI as that
portal's own virtual scene's background AND renders the Lightformer
rects as objects inside that same virtual scene, then bakes one
`CubeCamera` capture of both together into the texture that becomes
the room's real environment map. So a glossy surface now gets genuine
directional variation from the HDRI as well as the already-tuned
Lightformer highlights — not one replacing the other, and not two
separate uncombined effects either. No new runtime CDN dependency: the
file is served from `public/`, same as every other asset here.

**Task 3, partial — real metal on the sink/chimney box fallback, no
schema change.** `useMetalHardwareTextures` (`lib/textures3d.ts`) was
already fully built — real `metal-brushed-steel` maps, correct
clone/dispose handling — with a comment literally saying it's for
"the box-FALLBACK geometry of the sink and chimney/range-hood
appliances," but nothing called it. Wired into `ApplianceMesh`
(`Room3DCanvas.tsx`), applied only when `applianceType` is `sink` or
`chimney` (the hook is still called unconditionally for every
appliance — hooks can't be conditional — but its result is only used
for those two). Sized off the box's front face; the same single
repeat pair reused on every face, which is the simplification the
hook's own comment already accepts.

**Your call: skip handle texture maps.** No changes to `HandleSpec` or
the `handles` table. The brief's own Task 3 step 1 says to re-evaluate
after a real HDRI is in and skip the schema change if flat
color+metalness+roughness already reads convincingly — I have no
browser to make that visual call, and the brief's own fallback
position when it can't be justified is exactly what we did: skip it,
rather than add 3 columns on a guess.

**Task 4 — the pendant GLB, wired into `FixtureInScene` (far smaller
than the brief assumed).** Research found `FixtureCatalogItem` already
had `modelUrl`/`modelRotationX/Y/ZDeg` (mirroring
`ApplianceCatalogItem`), `schema.sql` already had the matching columns,
and `FixtureModel.tsx` was already fully built sharing `ApplianceModel.
tsx`'s `fitModelToBox` pipeline — all from a session after the brief.
The one real gap: `FixtureInScene` never called it, always rendering
the primitive regardless of `modelUrl`. Fixed by wrapping the existing
primitive body as a `fallback` and rendering `<FixtureModel>` in its
place.

**Deliberately NOT reusing `bodySize` as the model's fit box.**
`bodySize` is the primitive's generic thin disc/bar marker — the same
shape convention shared by every fixture kind (90×14×90mm for a
non-linear fixture) — and fitting a real pendant shade into that would
squash it flat, the same "smear the shutter" failure `ApplianceModel`'s
own header warns about for cabinets. Added a separate fixed constant
(`FIXTURE_MODEL_FIT_WIDTH/HEIGHT/DEPTH_MM` = 260×280×260mm) as a
plausible industrial-pendant-shade size — genuinely a guess, flagged as
such in the code comment, since there's no way to eyeball it without a
browser.

**Also folded in, replacing two now-deleted scratch scripts.**
`scripts/seed_pendant_fixture.sql` (a real, working, but never-run-via-
schema.sql insert for the pendant catalogue row) and
`scripts/add_fixture_model_columns.sql` (a migration for columns
`schema.sql` already has) were both fully superseded — the columns
already exist in `schema.sql` via `alter table ... add column if not
exists`, so only the seed row itself needed folding in. Added as its
own `insert ... on conflict (id) do nothing` statement (own id
`fix_pendant_industrial`, not the standalone script's UUID-shaped id,
matching this file's human-readable convention) rather than widening
the existing 6-row fixtures insert — same "never touch an existing
additive block" pattern used throughout this file. Two real, separate
correctness fixes made in the process, not just a copy-paste: (1) the
standalone script used `on conflict do update`, which would have
overwritten a business's own edits to that row on every re-run of
`schema.sql` — every other seed in this file uses `do nothing`
specifically to avoid that, so the standalone script was quietly
violating this file's own established rule; fixed by using `do
nothing` instead. (2) `fix_pendant` (the existing, unrelated row,
"Pendant light (shade excluded)") was correctly left untouched — this
is a genuinely separate catalogue option, not a duplicate, since it's
deliberately priced without a shade for a customer who supplies their
own. Kept the standalone script's own honest "UNVERIFIED ORIENTATION,
0/0/0 is a starting guess" flag rather than presenting it as
confirmed-correct.

**Bonus item, checked, no change**: re-queried the ambientCG API
(`https://ambientcg.com/api/v2/full_json?id=<assetId>`) for the 8
finish assets marked ESTIMATED in `scripts/seed_finishes_and_
appliances.sql`'s header comment, since I have real network access
this session. All 8 (`Chipboard004`, `Granite002A`, `Marble021`,
`Metal050A`, `Metal032`, `Metal046A`, `Metal048A`, `Tiles138`) still
return `dimensionX`/`dimensionY` = 0 — ambientCG genuinely has no
physical-size data for these assets, not a stale check. No values
changed; the existing ESTIMATED numbers remain the best available.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and `npm run build` (all clean). **Not verified in a browser** — same
limitation as the last two features. What specifically needs your own
eyes before trusting this: whether the HDRI actually improves chrome/
quartz reflections over the Lightformer-only look, whether the
sink/chimney metal texture reads correctly at that scale, and the
pendant model's actual orientation and fit size once placed — both the
0/0/0 rotation and the 260×280×260mm fit box are documented guesses,
not confirmed-correct.

**Follow-up, confirmed in a browser**: sink and chimney both show a
visible metallic reflection — the `useMetalHardwareTextures` wiring
and the HDRI are both taking effect. The pendant still renders as the
primitive stem+disc rather than the real model in the screenshot
checked — most likely because the placed fixture is still the original
`fix_pendant` catalogue row (no model) rather than the new
`fix_pendant_industrial` one, and/or `schema.sql` hadn't been re-run
yet against the live project when the screenshot was taken, so the new
row didn't exist to select. Not yet independently confirmed which;
follow up once you've checked.

## 30. Present mode's price reveal gets a category breakdown, exactly
    mirroring QuoteSidebar's Selling view

Your request, given with an exact category list and numbers copied
from your own project. Added a second-level "View price breakdown"
disclosure inside the existing price-reveal card
(`PresentMode.tsx`) — Material, Finish, Floor/walls/ceiling,
Countertop/slab, Hardware, Labour — installation, Fabrication, Other,
Glass doors, Appliances, then Grand Total.

**Reused QuoteSidebar's own rows and markup formula exactly, rather
than the 8 you listed.** Your list omitted Countertop/slab and Other —
correctly, since they're 0 on your current project — but
`QuoteSidebar`'s Selling view conditionally shows them (`> 0`) for
exactly that reason: they're real categories that just happen to be
zero for you right now. Hardcoding only the 8 you listed would silently
break on a project where countertop pricing IS enabled — the breakdown
would no longer sum to `grandTotal`, a real violation of Principle 1.
Each subtotal is converted from cost to selling via the identical
formula `QuoteSidebar`'s own `markup()` uses (`value * (1 +
marginPercent / 100)`) — kept as a local `sell()` rather than shared,
since Present mode has no Cost view to switch away from at all (unlike
QuoteSidebar, which needs both).

Built as a disclosure toggle (button + conditional render, matching
this file's existing `showPrice` pattern), not a `<select>` — despite
"dropdown" in the request, a single-choice picker that collapses after
one selection is the wrong primitive for a multi-line breakdown meant
to stay visible and readable as a list.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
`npm run build` (all clean). **Not verified in a browser.**

## 31. `docs/Issues.md` was wrong — 22 real open issues were sitting in
    a mislabeled file, not tracked as open

While preparing a doc bundle for another machine, found three files in
`docs/` where CLAUDE.md's design calls for one (`docs/ISSUES.md`, with
a "Fixed" section inside it once items are resolved): `docs/Issues.md`
(said "(none currently open)"), `docs/ISSUES-FIXED.md` (the real,
properly-dated fixed log, matching the CLAUDE.md workflow), and
`docs/Issues_fixed.md` — which, despite its name, was not a fixed log
at all: 22 undated, unresolved user-reported bugs and feature requests
(no L-shaped corner cabinet, sink cutout not controllable, tambour-on-
shelf missing, obstacles can't rotate, two live `TypeError: Failed to
fetch` reports, and more), never folded into `Issues.md` and never
treated as the current open list by anything, including this session's
own `docs/STATUS.md` draft, which repeated "ISSUES.md is currently
empty" from the previous session's STATUS.md without checking.

Fixed per this file's own rule (§"Keeping the documents true" in
CLAUDE.md — say what was wrong, don't silently overwrite): the 22
items moved into `docs/Issues.md` as the real "Open" list, with a note
at the top of that file explaining the correction; `docs/Issues_fixed.md`
deleted (its content fully preserved by the move, so nothing was lost,
just relocated to the correctly-named/correctly-treated file). Left in
place rather than auto-closed: the two `TypeError: Failed to fetch`
reports, even though `docs/ISSUES-FIXED.md`'s 2026-09-21 section
already investigated and closed what read like the same two errors
(transient network drop, not a code defect) — not certain enough
they're the same occurrences to close silently, so `Issues.md` now
carries a cross-reference note instead.

No code changed. This is a documentation-integrity fix only, caught
because a request to bundle docs for another machine required actually
reading all three files rather than assuming the filenames were
trustworthy — the same "distrust your own tooling" lesson CLAUDE.md's
verification-limits section already states, applied to file names
instead of scanners.
