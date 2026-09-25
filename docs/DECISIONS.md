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

### Not done yet

Excel import/export panels' Download/Upload/Commit buttons, the
toolbars, the inspectors, `QuoteSidebar`/`QuoteFreezePanel`'s own
buttons, `LoginScreen`, and `CustomerDashboard` still render hand-rolled
Tailwind markup. The four states (full/empty/loading/error) per screen.
Consistency rules beyond button colour. First-run checklist. All still
open, per `docs/PRINCIPLES.md` roadmap item 8.
