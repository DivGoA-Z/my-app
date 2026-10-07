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

1. ~~Whether textures load lazily~~ **Resolved** — confirmed lazy
   per-finish, with real disposal, in the visual-assets pass (§29).
2. ~~Whether the seeded `swatchWidthMm`/`swatchHeightMm` values are
   correct, and whether `stone-concrete` was given 2:1 dimensions.~~
   **Resolved** — confirmed `stone-concrete` at 512×256 (2:1) with a
   matching swatch mm ratio, also in §29.
3. ~~Whether derived relief and real normal maps currently stack~~
   **Resolved — they don't.** `textures3d.ts:714`:
   `normalSource = normalMapUrl ? getUrlTexture(normalMapUrl, false) : derivedNormal`
   — a clean either/or. A real, sourced normal map is used exclusively
   when a finish has one; the procedurally-derived one (from the
   albedo image's own height/luminance) only fills in when there
   isn't. Only one `normalMap` slot is ever bound to the material —
   no double-application possible as the code is written.
4. **Diagnosed, deliberately not fixed yet.** The reclaimed-wood
   ceiling's sharp specular dot is texture-driven, not a bad seed
   value or a code bug: `finish_wood_reclaimed`'s stored `roughness`
   (0.4) is identical to its wood siblings, but its `roughnessMap`
   (`/textures/wood-reclaimed/roughness.jpg`, a real ambientCG scan)
   has at least one pixel dark enough to read as near-mirror there —
   a scalar roughness value multiplies against the map, so a low base
   value can't fix a near-zero texel. Confirmed live: the highlight
   stayed fixed on the same spot of wood grain while orbiting, ruling
   out a lighting-angle explanation. A real fix means processing the
   actual JPG (raising its darkest pixels to a floor) — judged not
   worth it for a small highlight on a ceiling most people won't stare
   at; revisit if it turns out to actually bother anyone using the
   software.
5. ~~Whether the ceiling highlight seen in `fixtures-off` is
   environmental or a fixture's emissive body.~~ **Resolved,
   confirmed live.** It's environmental — `lighting3d.ts`'s
   `fixtures-off` mode runs the Lightformer panels (including the
   broad ceiling softbox directly above the room) at 60% intensity,
   not 0%, a deliberate choice already recorded in that file's own
   comment (reduced from full strength once before, in response to
   this same complaint, rather than zeroed out — a physically dark
   room is hard to review). Confirmed by orbiting in fixtures-off: the
   highlight stayed in place, exactly the discriminating test this
   entry originally proposed. Your call, live: the 60% tradeoff looks
   fine — no further change.
6. ~~Whether `scripts/` in the live repo matches this description.~~
   **Resolved, and partly wrong.** `fetch_models.py` and
   `build_placeholder_models.mjs` both exist exactly as named. The
   third file does NOT — there is no `seed_finishes_and_appliances.mjs`;
   what actually exists is `seed_finishes_and_appliances.sql`, a SQL
   file, not a JS one. `scripts/` also holds several files this old
   entry never mentioned at all: `fetch_backdrops.py`,
   `fetch_finish_textures.py`, `fetch_hdri.py`, `fetch_textures.py`,
   `gltf_to_glb.mjs`, and `generate-starter-catalogues.ts`.
7. ~~`quote_total` on `projects` duplicates a frozen quote's
   `grand_total`. Which is authoritative for the dashboard, and whether
   the column should now be derived from the latest frozen quote, is
   undecided.~~ **Superseded, not resolved by picking one** — §34's
   `sent_at` work sidesteps the either/or entirely. The dashboard now
   shows BOTH, clearly separated: `quote_total` (still the live
   design's own running total, labelled "Current design") at the top
   of the quote-history dropdown, and every actually-sent frozen quote
   listed below it. Neither column had to become "the" authoritative
   one.
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
  **Superseded 29 Sep 2026 by §35** — replaced by two itemised lists
  (`othersRates.perSqFt`/`perUnit`). The ₹0 default survives as "both
  lists empty"; a non-zero legacy value migrates into one per-cabinet
  row on load.
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

**Correction, same day, before this ever left the repo: the fix above
was itself wrong.** While drafting a table of these items for the
external doc bundle, cross-checked each one against
`docs/ISSUES-FIXED.md` individually rather than trusting the earlier
skim. Every one of the 20 items (not 22 — miscounted the first time
too) already has a matching dated entry there: "no L-shaped corner
unit" → fixed 23 Sep (three corner solutions); "no tambour-on-shelf" →
fixed 23 Sep; "obstacles can't rotate" → fixed 22 Sep; "can't add a
cabinet with one open shelf and one drawer" → fixed 22 Sep (mixed
fronts); "sink unit needs a real hole" → fixed 22 Sep (sink cutout);
"open shelves aren't open" → fixed 22 Sep (open carcass); "manage
inventory scrolls to the wrong place" → fixed 21 Sep; "pressing enter
doesn't finalize dimensions" → fixed 21 Sep; the two
`TypeError: Failed to fetch` reports and "floor shows reflections" →
investigated 21-22 Sep and closed as not-a-code-defect (with an
explicit "reopen if it recurs" on each, which `docs/Issues.md` now
preserves); every remaining item likewise traces to a dated fix in the
21-23 Sep range. **None were actually open.**

So `docs/Issues.md`'s original "(none currently open)" was correct all
along, and the real bug was reading `docs/Issues_fixed.md` — the
ORIGINAL raw complaint list from before the triage process that
produced `docs/ISSUES-FIXED.md` — as if its undated, un-triaged
presentation meant "currently open," rather than recognizing it as a
stale pre-triage snapshot that nobody had cleared once every item on it
was resolved. Reverted: `docs/Issues.md` back to "(none currently
open)", with a note explaining both rounds of this rather than erasing
the record of getting it wrong first. `docs/Issues_fixed.md` stays
deleted — nothing lost, since `docs/ISSUES-FIXED.md` already has every
one of its 20 items logged with real dates and real fixes, which the
raw file never had.

Worth naming plainly: this is the exact failure CLAUDE.md's
verification-limits section warns about, committed twice in the same
investigation — first trusting a filename over its content, then
trusting a raw list's *shape* (undated bullets reading like open
reports) without checking whether each one already had a resolution on
record elsewhere. "Distrust your own tooling" applies to your own
reading of a file, not just to scanners and scripts.

## 32. A live browser-testing pass: a fridge work-triangle check,
    Cmd+C/Cmd+V duplication, a cabinet-vs-wall clearance gap, and one
    unified alerts panel

You went through the previous session's unverified items in the
browser directly rather than a scripted checklist — present mode,
glass fronts, gola/edge-profile handles, keyboard shortcuts, and the
kitchen ergonomics checks (aisle width including the corner-ambiguity
fix, sink-hob distance, counter-beside-hob) all confirmed working.
Real follow-on work came out of that pass:

**Fridge work-triangle check, your request.** `checkFridgeDistances`
(`lib/kitchenChecks.ts`) adds the two legs `fridge` (added earlier
this session) unblocked — sink-to-fridge and hob-to-fridge, MAX
distance only (2700mm, same threshold as sink-hob's own "too far"
case). Deliberately no MIN: `MIN_SINK_HOB_MM`'s reasoning is
specifically about splashing near an open flame, which has no fridge
equivalent, and a too-close fridge is already caught by the existing
overlap/clearance checks. Only fires when a fridge is actually placed.
The file's own stale header comment (still describing the fridge gap
as unfixed) was corrected in place.

**Cmd+C / Cmd+V duplication, your request** (`useSelectionShortcuts.ts`)
— V for paste, not the P you said, since V is the standard clipboard
key and P wasn't bound to anything; flagged rather than silently
"corrected" without saying so. Scoped to cabinets/obstacles/appliances
only, same reasoning arrow-nudge already uses (openings move by
wall-offset, fixtures by mount kind — duplicating either needs
per-kind logic disproportionate to a keyboard shortcut). Copy stores
the selected item's full data in a module-level variable (not store
state — nothing renders it, nothing needs to react to it); paste
creates a new id via `crypto.randomUUID()`, offsets position by 50mm
via the same `nudgeFootprint` clamp-to-room logic a drag already uses,
and selects the new copy.

**A real gap found from your own testing: a cabinet's door/drawer
could open straight into a wall with no warning at all.**
`lib/cabinetClearance.ts` previously only ever compared one cabinet's
reach zone against ANOTHER cabinet's (the L-corner check) — nothing
compared it against the room's own boundary. Added a fourth check:
every floor-touching cabinet's reach zone is now also tested against
`[0, roomWidthMm] x [0, roomDepthMm]`, flagged the same way (same
amber highlight, same banner), with the specific wall(s) crossed named
in the message. `detectCabinetReachConflicts` now takes room
width/depth explicitly (both call sites — `useCabinetClearance`,
`CabinetLayer`'s live-drag preview — updated).

**Unified alerts panel, your request: select an item, see only ITS
alerts with real explanations; select nothing, see everything.**
Previously four separate systems (collision, cabinet-vs-cabinet/wall
clearance, room-door-vs-item swing clearance, kitchen ergonomics) each
rendered their own aggregate-count-only banner — "3 cabinets with a
blocked door/drawer," no way to know why without guessing. New
`useDesignAlerts()` hook normalizes all four into one `DesignAlert[]`
(`itemIds`, `category`, a real human `message` — `kitchenChecks.ts`'s
`KitchenCheckFinding` gained an `itemIds` field for this, populated at
every finding site) and one `DesignAlertsPanel` replaces
`CollisionWarningBanner`/`CabinetClearanceWarningBanner`/
`KitchenChecksBanner` (all three deleted) — filtered to the current
selection when one exists, everything otherwise. The three existing
show/hide toggles still gate what's included, unchanged. Room-door
swing clearance is folded in here too (previously only a count inside
`OpeningToolbar`, which keeps its own contextual summary separately —
different job, not redundant).

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean). **Not yet re-verified in a
browser** after this batch — checkpointed here (committed and pushed)
specifically because the next piece of work (accurate door-swing
geometry, replacing the conservative bounding-box/arc mismatch this
same panel just made visible) is real geometry surgery in a part of
this codebase with a documented history of rotation/arc bugs, and you
asked for a safe point to roll back to first.

## 33. Accurate door-swing geometry — the conservative box replaced
    with the true quarter-circle everywhere, plus two real bugs caught
    only by your own live testing

The follow-up to §32's checkpoint. You confirmed the arc-vs-box
mismatch was real (a base-cabinet 150mm from a corner-carousel
correctly flagged, with no visible overlap in the drawn arc — the
detection rectangle was deliberately bigger than the arc, same
trade-off `doorSwingZone` already makes for room doors) and asked for
the full fix rather than a wording patch: **your words, "can't we make
it accurate in show as well as actuality? it would be a bug equivalent
in market."**

**The geometry.** `lib/cabinetClearance.ts`'s `cabinetReachZone`
(a `RoomRect`, one of four hardcoded rotation cases) is gone, replaced
by `reachPolygons` — a true quarter-circle sector (an 8-sided polygon
fan, `sectorPolygon`) for a swinging door, the same honest rectangle as
before for a straight pull-out (already accurate — a drawer really
does travel in a straight line), and the carousel's true diagonal
sector built from `carouselDoorArc`'s already-verified pivot/edge
math. Overlap is tested with a Separating Axis Theorem check
(`polygonsOverlap`) — exact for any two convex shapes, so a rectangle
(4 points) and a sector (9 points) are tested identically, no special
casing.

**`carouselDoorArc` relocated from `CabinetLayer.tsx` into this file**,
extended to also return the closed-leaf endpoint (it already computed
this internally as `p4`, just never returned it), and CabinetLayer now
imports it rather than keeping a second copy. Same reasoning as
`calculateBOM`'s required context or hardware being derived once: one
calculation feeds both the drawing and the check, so they can't
disagree. `winningReachRow` — "which row governs this cabinet's
reach, and is it a swinging door" — is exported for the same reason,
and used by CabinetLayer's rendering too, which is what let a `'mixed'`
front's door row finally get a real on-screen arc instead of always
falling back to the plain rectangle it used to ("kept simple rather
than picking a row's hinge to arc" — no longer necessary once the
question has one shared answer).

**Rotation math, verified before trusting it, not assumed.** The
per-leaf pivot/closed-direction/open-direction vectors are built by
rotating local unit vectors clockwise around the cabinet's true
rotation-invariant centre (`item.x + widthMm/2`, `item.y + depthMm/2`
— confirmed against `lib/footprint.ts`'s own stated Rule 1, not
re-derived from scratch) — one `rotateCW(v, deg)` formula for all four
rotations, rather than four hand-written cases. Checked against the
already-shipped, already-correct open-direction results the old
per-rotation switch returned (rotating local (0,1) by 0/90/180/270
reproduces +Y/-X/-Y/+X — south/west/north/east — exactly, for all
four) before it was trusted for anything new.

**Bug 1, caught immediately by a constructed script, before you ever
saw it: two ordinary adjacent cabinets — sharing an edge, zero real
gap — were flagged as conflicting with EVERY neighbour, and a cabinet
could conflict with its own wall while sitting nowhere near it.**
`polygonsOverlap`'s epsilon (`OVERLAP_EPSILON_MM`, meant to absorb the
same mm→px→mm float noise `collision.ts`'s own 0.5mm epsilon
exists for) had the comparison backwards: `aMax + EPSILON < bMin`
requires MORE than epsilon of real separation before two shapes count
as separated, instead of treating a touch (or a sub-epsilon overlap)
as still separated. Caught by a script, not by eye — trusting the
build-clean state without a script here would have shipped this. Fixed
to `aMax <= bMin + EPSILON`. This was verified, wrongly — a lesson in
its own right: "verified numerically" only protects against what the
script actually checks; the original 9-check script tested wall
conflicts and a specific box-vs-arc corner case, but not ordinary
edge-to-edge adjacency, which is the single MOST common real-world
cabinet arrangement. Extended the script with that exact case before
trusting the fix.

**Bug 2, NOT a bug — your own live testing, and the reason this
section exists at all rather than a one-line fix note.** After Bug 1's
fix, you found the SAME base-cabinet/corner-carousel pair still
flagged, but hand-derived geometry from the numbers you gave me
(carousel 704×750mm, rotation 0°; two open-shelf cabinets 221×457mm
and 150×457mm nearby, zero reach of their own since an open-shelf
front has no door) put the nearest corner only ~15-20mm outside the
carousel's true ~411mm sector radius — genuinely borderline, not
obviously wrong. Rather than guess a third time in the same
investigation, asked you to run the actual experiment: nudge the
narrow cabinet a few cm away and see if it clears. **It did.** This
confirms the check is correctly catching a real, tight clearance in
that corner — the carousel door's CLOSED position (part of its full
swept path, not just the final open position a static 3D screenshot
happens to show) passes close enough to that neighbour to matter in
practice. A genuinely useful finding about the layout, surfaced only
because the geometry is now accurate enough to be trusted at this
scale — the old conservative box either would have missed this
entirely or flagged something even less precise nearby.

**The whole sequence, worth stating plainly**: three real reports, three
different outcomes — one a genuine accuracy gap (the original ask),
one a real code bug this rewrite introduced and a script caught, one
not a bug at all. Distinguishing them required your insistence on
precision (exact Inspector values, a specific move-it-and-see
experiment) over accepting a screenshot-level guess at any point —
matching this file's own repeated lesson about not trusting your own
tooling, extended here to not trusting a hand-derived geometric
estimate either without a live test to confirm it.

11/11 checks pass (`npx tsx` against a scratch script, deleted after,
per this file's own convention): wall-facing/wall-facing-away for a
single door, a centred double-door, the reported carousel/base-cabinet
pair close and far, mixed-front row selection, the specific box-vs-arc
corner case, and two ordinary edge-to-edge adjacency cases (single-door
and drawers) added specifically to catch Bug 1 class regressions in
future. Verified via `npx tsc --noEmit -p tsconfig.app.json`,
`npx eslint .`, and a full `npm run build` (all clean), plus confirmed
correct in the browser by you across three separate real layouts this
session.

## 34. `sent_at` on quotes: "frozen" and "actually sent" were the same
    moment, and the button lied about it

Your report: **"the button says 'freeze and send' but it does not
actually send. it leads to 2 buttons of download or send on
whatsapp."** True, and worth taking literally rather than dismissing
as a labelling nitpick — freezing a quote (`freezeCurrentQuote`) writes
the row to the database immediately; Download PDF and Share on
WhatsApp, which only appear afterward, are pure export/share actions
on the already-frozen row, and neither one recorded anything back
until this change. So the button's own claim ("& send") was simply
false — the quote existed in the database whether or not either
follow-up button was ever touched.

**Your scope, explicit and narrower than the obvious version**: only
**Share on WhatsApp** should count as "sent" — deliberately not
Download PDF, since downloading a PDF is the designer grabbing a copy
for themselves, not evidence of anything reaching the customer. You
also asked whether ACTUAL delivery (the message really landing in
WhatsApp) could be tracked — it can't: a `wa.me` link only opens
WhatsApp with the message pre-filled, and there is no callback from
WhatsApp back to this app once that tab opens. You accepted the
button-click signal as the best available, explicitly.

**What changed**:
- New nullable `sent_at timestamptz` on `quotes` (`schema.sql`, both
  the `create table` definition for a fresh install and an explicit
  `alter table ... add column if not exists` for an existing one —
  `create table if not exists` is a no-op against a table that already
  exists, so the column-in-the-create-block alone would never have
  reached your live database).
- `lib/quotes.ts`'s new `markQuoteSent(quoteId)` sets it once, guarded
  by `.is('sent_at', null)` so a second share doesn't restamp the
  first real send — the FIRST time it actually went out is the fact
  worth keeping, even though `sent_at` itself sits outside the frozen
  pricing content this file's other rules protect.
- `QuoteFreezePanel.tsx`'s `shareOnWhatsApp` calls it right after
  `window.open(...)`, best-effort — the share itself already happened
  by that point (the tab is open), so a failure recording the
  timestamp surfaces via `quoteError` rather than reading as the share
  having failed.
- The button is renamed: `Freeze & send` → `Freeze quote` / `Freeze
  v{n} & send` → `Freeze v{n}` — it never sent anything, so it stops
  claiming to. The quote status card now shows "Sent on WhatsApp
  {date}" or, in amber (this app's fixed "needs attention" colour,
  applied consistently regardless of the card's own stale/current
  background), "Not yet sent — frozen, but never shared".
- `CustomerDashboard.tsx`'s quote-history dropdown (§ the unified
  alerts/dropdown work earlier this session) now filters to
  `sent_at IS NOT NULL` — a quote that's frozen but never shared has
  no business appearing in a "what has this customer been sent" list,
  only in "Current design" at the top, same as before. A new
  `fetchAllQuoteHistoriesByProject` (`lib/quotes.ts`) selects only the
  columns that list needs, not full `summary`/`pricing_context` JSONB,
  for the same "don't load more than the screen needs" reason
  `panoramasByProject`'s own bulk fetch already established.

**A real side-effect confirmed live, not a bug**: right after this
shipped, you saw the sidebar's "Current design" total read ~13% lower
than a frozen v2's total, despite believing nothing had changed, and
asked why. The staleness check compares a fingerprint of every priced
input — rates, margin, catalogue prices, finishes/handles/fixtures,
not just cabinet placement — so a total that size of a swing meant
something real had moved (most likely the per-project margin percent,
the single easiest number to nudge by accident) between when v2 was
frozen and now. Freezing v3 reconciled it, confirming the mechanism
was working correctly rather than pointing at a bug in this session's
own changes.

Verified via `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`,
and a full `npm run build` (all clean), and confirmed working
end-to-end in the browser: freezing, sharing on WhatsApp, the sidebar
status flipping to "Sent," and the dashboard dropdown picking up the
newly-sent quote.

## 35. Pricing stays area-based permanently; "others" itemised; sheet
    waste factor

**Principle 2 changed** (`docs/PRINCIPLES.md`). It said the panel model
would *replace* area costing, and that doing it later meant re-deriving
every quote. Your argument, from the previous session's discussion:
whether the bottom panel sits between or below the sides moves real
panel dimensions by one board thickness, invisible next to the area
estimate's own slop, and price is already `area × rate` computed fresh
from dimensions with no size table to rebuild. The "re-derive every
quote" claim was also wrong on its own terms — frozen quotes carry
their snapshot, so none is ever re-derived. Area pricing is now the
permanent method; the panel model is a production (cutting-list)
concern only and no longer blocks pricing. The old text is kept in
PRINCIPLES.md, marked superseded.

What makes area pricing honest is pricing what the estimate leaves
out, explicitly. Two things:

**1. `othersRatePerUnit` → `othersRates: { perSqFt, perUnit }`**, each
a list of `{id, label, rate}`. Per sq ft rows charge on `areaSqFt`
(the same estimated area site labour uses); per cabinet rows on
quantity. Why two lists: edge banding genuinely scales with cabinet
size, so one flat ₹/cabinet number overcharged a 300mm filler and
undercharged a tall unit. **Internal only** — `RateCardManager` shows
the breakdown; `BOMLineItem.othersCost` stays one number, and the
customer quote/PDF/Present mode still show one "Other" line,
unchanged.
- Storage: new nullable `rate_cards.others_rates jsonb`. The old
  `others_rate_per_unit` column is **kept, not dropped** (a drop isn't
  idempotent-safe against a database whose app isn't upgraded yet) and
  is read once: when `others_rates` is NULL, a non-zero legacy value
  becomes one per-cabinet row labelled "Other", so no total moves.
  Nothing writes the old column any more.
- **Trap caught during implementation**: that migrated row first got a
  `crypto.randomUUID()` id. The rate card is part of what
  `computeQuoteFingerprint` hashes, so a random id regenerated on
  every load would have marked every frozen quote "design has changed"
  on every page load until rates were re-saved. Fixed with a fixed id
  (`'legacy-other'`), and `sanitizeOtherRates` falls back to a
  position-based id for the same reason. **Rule: nothing reachable from
  `PricingContext` may be generated non-deterministically on load.**

**2. `sheetWasteFactor`** — multiplies into `materialCost` only
(`materialArea × wasteFactor × materialRates[substrate]`). Not finish
(laminate has its own waste, not modelled), not glass (cut to order).
`materialArea` itself stays the area *used*, so on-screen area and
bought area are never confused.
- **Business default on the rate card, per-project override on the
  layout** (`rate_cards.sheet_waste_factor`,
  `layouts.sheet_waste_factor`, both nullable). This deliberately
  differs from margin, whose default is a code constant
  (`DEFAULT_MARGIN_PERCENT`): how well a workshop nests its cuts is a
  fact about that workshop, which is what the rate card holds; margin
  is a commercial decision per job. The override exists because a job
  of all-600mm units nests far better than one of odd widths.
- **Seeded at 1 (no waste), not a realistic 1.1** — introducing the
  field must not silently raise every open quote's material cost by
  10%, the same rule `PLACEHOLDER_RATES` was built under. It is part
  of `isPlaceholderRateCard`, so the amber banner stays until the
  business sets it (or any other rate).
- The sidebar's override input is blank-means-default with the
  business value as its placeholder — deliberately not pre-filled, or
  every project touched would silently pin today's default and stop
  following the rate card.
- Clamped to ≥ 1 by one shared `sanitizeWasteFactor`, used by both the
  rate card and `setSheetWasteFactor`, so the two can't disagree.

**Known one-time side effect, accepted**: adding fields to `RateCard`
changes every frozen quote's fingerprint once, so existing quotes will
read "design has changed" after this lands even though no total moved.
That is `computeQuoteFingerprint`'s documented failure direction (a
needless revision is a wasted click; a missed one is a wrong price).

**Not done here**: the standalone waste calculator (PRINCIPLES.md
Principle 2, STATUS plan item 4) — real panels from an *assumed*
construction convention, nested onto real sheets, to *measure* the
waste factor this section only lets you *type*.

Verified: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`,
`npm run build`, all clean. **Not verified in the browser** — the rate
card's two new lists, the waste input, and the sidebar override have
not been looked at rendered. **`schema.sql` must be re-run against the live
database before this code is used**: reads are fine (`select('*')`
simply omits a missing column, and every new field falls back), but
every WRITE now names the new columns — `saveProject`/autosave sends
`layouts.sheet_waste_factor` on every save, and saving rates sends
`rate_cards.others_rates`/`sheet_waste_factor` — and PostgREST rejects
an unknown column, so saves fail until the migration runs.

## 36. Project charges: hand-entered lump sums, on top, at the price typed

Your request: a business must be able to charge a job however it
actually charges it — "some extra service worth 20k" added straight to
the quote, or labour as a lump sum it names itself. Your answers to the
three open questions, all explicit:

1. **As-is, no margin.** ₹20,000 typed is ₹20,000 on the quote.
2. **On top, not instead.** A lump-sum labour charge is added to the
   per-sq-ft site labour, not a replacement for it — "business has an
   option to add labor or any other charges the way they want so all
   options should be available." A business that wants lump-sum-only
   labour can set the per-sq-ft rate to 0.
3. **Printed in its own category, by name**: labour charges with
   Labour ("Labour — Installation, flat"), everything else with Other
   ("Other — Extra service"). Unlike the rate card's itemised others
   (§35), these are NOT internal — the customer is paying for a named
   thing.

**Shape**: `RoomLayout.projectCharges = { labor, other }`, each a list
of `{id, label, amount}`; one nullable `layouts.project_charges jsonb`.
Edited in `QuoteSidebar` with the same list editor the rate card uses
(extracted to `components/common/NamedAmountList.tsx` rather than
duplicated; each caller maps its own field — `rate` vs `amount` — to
the editor's `value`).

**Why separate BOM fields rather than adding into
`laborSubtotal`/`othersSubtotal`**: every display (sidebar, Present
mode, PDF) applies margin by multiplying each category subtotal by
(1 + margin%). Folding a lump sum into a subtotal would have marked it
up silently — exactly the "number on the quote nobody chose" failure
answer 1 rules out. So `BOMSummary` carries `projectLaborCharges`,
`projectOtherCharges` and `projectChargesTotal`; displays print them
unmarked; and margin is computed on everything EXCEPT them:
`marginAmount = (costGrandTotal − projectChargesTotal) × margin%`.
`grandTotal = costGrandTotal + marginAmount` is unchanged as a formula,
so nothing that reads it needed touching, and the printed lines still
sum to the printed total exactly (§15's rule).
`costGrandTotal` includes the charges: for them cost and price are the
same number.

- Zero-amount rows are dropped in `calculateBOM` so a half-filled
  editor row never prints "₹0" to a customer; a blank label prints as
  "Additional labour"/"Additional charge".
- A quote frozen before this has none of these fields; the PDF reads
  them with `?? []` and so prints that quote exactly as it was.

Verified: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`,
`npm run build`, all clean. **Not verified in the browser.** Needs
`schema.sql` re-run (new `layouts.project_charges`) — layout saves fail
without it, same as §35.

**Also this round — the rate card's Save button was effectively
invisible.** You reported that editing labour/other rates didn't update
the quote. Cause: edits stay in a local draft until **Save rates**
(deliberately — see RateCardManager's own comment on half-typed values
repricing everything), and that button sat at the very bottom of a long
form, below Material, waste and Glass. You never saw it, so nothing was
ever saved. Fixed by making the save bar sticky, in amber with
"Unsaved rate changes — quotes use the old rates until saved", whenever
the draft is dirty. The note under it also claimed "changing a rate
reprices every open quote immediately", which was false; it now says
saving does.

## 37. "Others" is one list with a per-row basis — including lump sum

§35's two fixed lists (per sq ft, per cabinet) lasted one session. You
looked at them rendered and asked for something simpler: **one "Others"
heading**, a "+ Add" button, and on each row a choice of **per sq ft /
per cabinet / lump sum**, with **per cabinet as the default** for a new
row. The lump-sum basis is new — two fixed lists had no room for a
third kind, and a business-wide charge per job (a delivery fee, a site
visit) is a real thing businesses charge.

- `RateCard.othersRates` is now `OtherRate[]`, each row
  `{id, label, rate, basis}`, `basis: 'sqft' | 'cabinet' | 'lumpsum'`.
  Same `others_rates` jsonb column.
- **Lump-sum rate-card rows ≠ §36's project charges.** A rate-card lump
  sum is a business-wide COST charged once on every project: it goes
  inside the marked-up cost (so it gets margin) and rolls into the
  customer's single "Other" line. §36's project charges are typed per
  project, at selling price, never marked up, printed by name. Both
  exist on purpose; the quote-side behaviour is unchanged ("changes on
  quote as of now remains").
- A rate-card lump sum is only charged when there is a layout — a bare
  cabinet-list price check isn't a project.
- Loading reads three stored shapes, newest first: the array; the
  §35 two-list object (converted with each row's own id, so it's
  deterministic — the §35 fingerprint trap); the original
  `others_rate_per_unit` scalar.
- **Save**: a Save rates button at the top of the rate card as well as
  the sticky amber bar at the bottom (§36), which you said works. You
  asked for "top and bottom of the catalogue page"; the rate card IS
  the top of that page, and every other section on it saves per row
  immediately, so a rate-card Save at the very bottom of the page —
  below the whole cabinet table — would have been further from the
  thing it saves, not closer. The sticky bar covers "bottom" wherever
  you are in the rate card.
- The list editor (`components/common/NamedAmountList.tsx`) gained an
  optional per-row `choices` picker rather than the rate card getting
  its own copy; the sidebar's project charges don't pass it.

Verified: `tsc -p tsconfig.app.json`, lint, build — clean. Not seen in
a browser.

## 38. Labour moves into the one charges list; every row chooses whether it prints

Your request, on seeing §37: labour belongs in the "others" section,
not as two separate fields above it — pre-filled with site
installation and fabrication — and each row gets a tick for whether it
shows on the quote separately; unticked rows combine into "Other".

**Shape**
- `RateCard.laborRatePerSqFt` and `fabricationRatePerUnit` are gone.
  They are now the first two rows of `othersRates`
  (`DEFAULT_LABOUR_RATES`: "Labour — site installation", ₹150 per sq
  ft; "Labour — fabrication", ₹2,500 per cabinet), same values, same
  units, same placeholder status. The section is headed "Labour and
  other charges".
- Every row gains `showOnQuote`. Ticked → its own named line on the
  sidebar, Present mode and PDF, **marked up** like any cost. Unticked
  → summed into one "Other". New rows start unticked; the two labour
  rows start ticked, because labour always printed as its own lines —
  so on upgrade the quote reads the same, with only the labels changed
  ("Labour — installation"/"Fabrication" → the row labels).
- `BOMSummary.shownOtherLines` carries the ticked rows (each summed
  across all cabinets, or once for a lump sum); `othersSubtotal` the
  rest. Computed from the same per-cabinet figures as the line items,
  so the tick changes presentation, never the total.
  `BOMLineItem.laborCost`/`fabricationCost` are removed —
  `othersCost` now includes labour.
- **`laborSubtotal`/`fabricationSubtotal` stay on `BOMSummary`,
  optional, never produced.** Frozen quotes carry them, and the PDF
  must print such a quote exactly as it was; it prints those two lines
  only when present.

**Migration** (`lib/rates.ts`'s `withLegacyLabour`): the old
`labor_rate_per_sqft`/`fabrication_rate_per_unit` columns become the
two rows on load, at the top, with FIXED ids (`labour-site`,
`labour-fabrication` — the §35 fingerprint trap again). Every save now
writes both columns as **0**. That is what makes deletion stick: a
business that deletes the fabrication row would otherwise get it back
from the column on the next load. Consequence: an older build of the
app reading a card saved by this one would see ₹0 labour. Accepted —
there is one business and one deployed build.

Totals are unchanged by the upgrade: per cabinet, `othersCost` =
150 × area + 2,500 × qty = the old `laborCost + fabricationCost`.
Frozen quotes read "design has changed" once (the rate card changed
shape), same as §35.

Verified: `tsc -p tsconfig.app.json`, lint, build — clean. **Not seen in
a browser**, and the totals claim above is by reading the code, not a
run.

## 39. A project can override the whole charges list; "Add margin" absorbs §36

Your request: the rate card is the business level, but a project must be
able to override it with **all** the same options — per sq ft / per
cabinet / lump sum and the show-on-quote tick. Asked what should then
happen to §36's separate "Project charges" box (added as-is, no margin),
you chose: **merge it in, with a per-row "Add margin" tick.**

**Shape**
- `RoomLayout.chargeRates?: OtherRate[]`, stored in
  `layouts.charge_rates jsonb`. **Undefined = follow the business rate
  card**, so rate changes keep flowing into every project that hasn't
  customised — same override-by-presence pattern as `sheetWasteFactor`.
  An array (even empty) = this project's own list. "Customise for this
  project" copies the business rows into it; "Reset to business rates"
  drops the copy.
- `OtherRate.applyMargin` (default true). Only the project list shows
  the tick; on the rate card it is always true, because a rate-card
  rate is a cost. Untick it for a price already fixed — ₹20,000 stays
  ₹20,000.
- One editor for both lists (`components/common/ChargeRatesList.tsx`),
  so the rate card and the project can't drift; `allowNoMargin` is the
  only difference.

**Margin arithmetic** — same rule as §36, now per row: margin is
charged on `costGrandTotal − unmarkedTotal`; `grandTotal =
costGrandTotal + marginAmount` is unchanged as a formula. Displays mark
up a shown row unless `applyMargin === false`; "Other" is
`markup(othersSubtotal) + othersUnmarkedSubtotal`; a cabinet line is
`markup(lineTotal − unmarkedCost) + unmarkedCost`, because a fixed-
price per-cabinet row lands inside the cabinet's own line total. The
sidebar, Present mode and PDF all follow this, so the printed lines
still sum to the printed total.

**§36 superseded, not deleted.** `projectCharges` is no longer edited
anywhere. A project saved with some still prices them —
`legacyProjectChargeRates` turns them into lump-sum, shown, no-margin
rows with their own ids, exactly how they priced and printed — and
customising folds them into `chargeRates` and clears the field so they
aren't counted twice. `BOMSummary.projectLaborCharges`/
`projectOtherCharges`/`projectChargesTotal` are now optional and never
produced; the PDF prints them only for a quote frozen in between.

**Also this round**: the third "labor" row you saw on the rate card
wasn't created by code — only the two labour rows are seeded. It was
the "labor ₹500 per cabinet" row you typed and saved earlier. Remove it
with ✕ and Save rates; it isn't deleted from the database on your
behalf.

Verified: `tsc -p tsconfig.app.json`, lint, build — clean. **Not seen in
a browser**; the margin arithmetic is checked by reading the code, not
by a run. Needs `schema.sql` re-run (new `layouts.charge_rates`).

## 40. "Add margin" on the rate card too — both lists identical

§39 put the Add margin tick on a project's own charges list only, on
the reasoning that a rate-card rate is always a cost. You asked for the
two sides to be uniform, and the reasoning didn't hold up anyway: a
business can have a fixed-price charge it adds to every job (a flat
delivery fee it quotes as-is), which is exactly a rate-card lump sum
with no margin. The pricing already honoured `applyMargin` on any row
regardless of which list it came from, so this was a UI-only change:
`ChargeRatesList` lost its `allowNoMargin` switch and always shows both
ticks. Existing rate-card rows all load with Add margin ticked, so no
total moves.

Verified: `tsc -p tsconfig.app.json`, lint, build — clean. Not seen in
a browser.

## 41. Cutting list, phase 1 — the carpenter's convention becomes settings

**The blocker, removed rather than waited on.** The cutting list was
blocked on "how does your carpenter build a cabinet?" because those
answers change every panel size. Instead, each answer is a setting on
a new per-business `construction_settings` row, with **every real
alternative selectable** (your explicit request: the defaults are only
defaults) and pre-filled with your answers, the common Delhi NCR
convention:

| Setting | Default | Alternatives |
|---|---|---|
| Bottom panel | between the sides | over/under the sides |
| Top panel | between the sides | over the sides |
| Back | thin (6mm), grooved in (8mm) | nailed on the rear; full-thickness inset |
| Base-unit top | two 100mm rails | full top panel |
| Drawer boxes | tandem / metal-sided | wooden boxes |
| Carcass board | 18mm | any |
| Shelf setback | 20mm | any |

Top and bottom are separate settings — you answered only for the
bottom, and a carpenter can genuinely fit them differently. An amber
"assumed construction" banner stays up on the settings and on the
cutting list until "My carpenter has confirmed these settings" is
ticked — same reasoning as the placeholder-rates banner (Principle 10:
approximation allowed, never hidden).

**Why its own table, not a column on `rate_cards`.** The rate card is
reachable from `PricingContext` and so hashed into every frozen
quote's fingerprint (types/quote.ts). Construction never changes a
price, so putting it there would mark every frozen quote "design has
changed" on a groove-depth edit — the §35 cry-wolf failure again.
Separate table, separate store field, never in `PricingContext`.

**What's listed** (`lib/cutList.ts`, derived on demand like the BOM,
never stored): per cabinet, sides, top or front/back rails, bottom,
back, dividers between a mixed front's rows, shelves (the same shelf
geometry the 3D view draws), and every board front — shutters, drawer
fronts, trolley and false fronts — with length × width, thickness,
material, finish (fronts), quantity × cabinet quantity, edge banding
per edge, and whether grain fixes the orientation (fronts only).
Carcass depth excludes the 18mm front, matching lib/fronts.ts's
"fronts are inset into the stated depth"; a nailed-on back also comes
out of the depth so the cabinet stays as deep as quoted.

**Deliberately NOT listed, and said so on screen** as "Not on this
list": drawer box parts (phase 3 — the tandem choice is recorded but
labelled not-yet-applied), tambour shutters (bought as a unit), glass
(ordered cut to size — the count and tint are listed as a note), and
the corner carousel's diagonal carcass (listed as a rectangle, flagged).
Door cabinets have no internal shelf because the design model has none
yet; the quote doesn't charge for one either, so they agree.

**A real bug caught by running it, not by reading it.** The first
version rounded to the nearest mm. On an 800mm double-door wall unit
each leaf is 395.5mm; both rounded up to 396, and 2 × 396 + three 3mm
reveals = 801mm — doors a millimetre wider than the cabinet. Exact
halves now round DOWN (`mm()` in cutList.ts): a hair more gap is
harmless, an oversized door isn't. Checked by bundling `cutList.ts`
with rolldown and running it under Node on sample cabinets across all
three back conventions, bottom-over-sides, a mixed front, a glassed
open-shelf unit at quantity 2 and a corner carousel, with every
dimension checked against hand arithmetic. That is a real run of the
real function — but it is not a test suite (there still isn't one),
and it has not been checked against a carpenter's own cutting list.

**Output**: a Cutting List screen (button beside Present), "For
cutting" (identical parts merged, cabinet refs listed) or "By cabinet",
and an Excel export via the existing `xlsxHelpers` — sheets: Cutting
list, By cabinet, Summary (area and edge-banding metres per board),
Construction (the settings used, marked ASSUMED if unconfirmed), Notes.
Excel rather than CSV per Principle 11.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the Node run
above. **Not seen in a browser.** Needs `schema.sql` re-run (new
`construction_settings` table) — until then the settings can't be
saved, though the cutting list still works on the defaults.

## 42. Board lines, per-panel specs, and board priced on real area

Three decisions from the 2 Oct discussion, built as one change because
each depends on the last:

**1. Board lines on the rate card** (your idea: "multiple lines of HDMR
with different thickness and different pricing"). `RateCard.boards` —
`{material, thicknessMm, ratePerSqM}` — replaces `materialRates` (one
₹/m² per material), which couldn't tell an 18mm carcass from a 6mm
back. Seeded: the five old rates as 18mm lines, unchanged, plus
**HDMR 6mm ₹450/m² — a placeholder guess** (about a third of 18mm,
the usual ratio; nobody has given a real figure). A business-wide
`defaultBackBoardId` names the back board. Migration: an old card's
`material_rates` become 18mm lines with FIXED ids (`legacyBoardId`) —
the fingerprint trap again — plus the 6mm line; `material_rates` is
kept, read once, never written.

**2. Per-panel spec, catalogue default, cabinet override, all ticked by
default** (your call). `PanelSpec` per role — left side, right side,
top (with full/rails), bottom, back, shelves & dividers, fronts — each
`{included?, boardId?, topStyle?}`, every field optional so "absent"
means "built, default board". Left/right are separate because an
exposed end side often gets a different board. Default board: back →
the default back board; everything else → the **thickest** line of the
cabinet's own material. Stored on `cabinet_catalog_items.panels` and
snapshotted (deep-copied) onto a placed cabinet like `frontLayout`.
**No editing UI yet** — that's the Cabinet Designer page (step 5);
today every cabinet uses the defaults.

**3. Board priced on real area** (your call: "fix it now and take up
real area"). Material cost per cabinet = Σ over the cutting list's own
parts for that cabinet of real area × that part's board rate × sheet
waste. `carcassAreaSqM` (front face + half a side) is gone. Principle 2
was REWORDED, not reversed — your rule was always "price by the area
that's really there"; the text had named the estimate as the method
and claimed panels don't feed the price. You pointed out the
contradiction; I'd wrongly called it a reversal. Consequences:
- **Construction settings are now a priced input**: required on
  `PricingContext` (no default — the compiler found all four call
  sites: sidebar, save, freeze, staleness) and hashed into the
  fingerprint. Comments from §41 saying construction "never changes a
  price" were corrected in place, with notes.
- **Thickness moved off Construction settings** onto the board lines,
  so one number can't contradict the board a panel is cut from.
- Frozen quotes record the construction they were priced with.
- Glass never reaches the board charge (not a cut part); finish is
  still front-face; site labour and per-sq-ft charges still use the
  estimated area (trade convention — a separate question).

**Measured by running the real `calculateBOM`** on a 600×600×720 HDMR
base unit: material ₹907 → **₹2,567** (2.11 m² real board vs 0.65 m²
estimated). Untick back → ₹2,385 (−₹183 = the back exactly); BWP left
side → ₹2,902; full top instead of rails → ₹2,869; quantity 2 →
exactly double. **Every open quote's material line rises by roughly
2.5–3×**; frozen quotes don't change. Rates and the fabrication charge
should be rechecked against invoices — fabrication may have been set
high to make totals look right.

**Two traps found by running it, fixed:**
- *Silent thin carcass.* Delete "HDMR 18mm" and HDMR cabinets quietly
  fall to the next-thickest HDMR line — 6mm carcasses, priced and cut —
  with no warning, because a board was still found. The rate card now
  shows, live under the board list, which carcass board each material
  resolves to (red if under 12mm).
- *Unpriced parts.* No suitable line at all → the part is still listed
  (at 18mm) but priced ₹0; the cabinet is flagged in red in the quote
  sidebar ("Some board isn't on your rate card") and on the cutting list.

**Also corrected**: phase 1 left tambour shutters off the cutting list
as "bought as a unit". `types/front.ts`'s own FrontKind comment says a
tambour is a cut, edge-banded panel, and the code comment is the better
authority (CLAUDE.md) — they're listed and priced now.

Verified: `tsc -p tsconfig.app.json`, lint, build clean, and the Node
runs above. **Not seen in a browser.** Needs `schema.sql` re-run
(`rate_cards.board_rates`, `rate_cards.default_back_board_id`,
`cabinet_catalog_items.panels`).

## 43. Workshop settings get their own page; rails/full moves to the cabinet; boards in use can't be deleted; only priced boards offered

Four points from your review of §42.

**1. Construction moves off the catalogue to a "Workshop settings"
page** (dashboard button, and a link from the cutting list's banner).
Your rule: the catalogue page holds what sets prices. I measured what
the remaining settings do to a price before agreeing, since §42 made
construction a priced input: on a 600mm base unit and a wall unit,
every fitting setting (top/bottom between or over the sides, back
fixing, groove depth) moves board cost by **₹0–15 on ~₹2,500**, rail
width ~₹30. So "doesn't impact price" is right to within a rounding
error — it stays in `PricingContext` and the fingerprint (it does move
the number, slightly), but it doesn't belong among the pricing screens.

**2. "Full top vs rails" moved to the cabinet** — the one setting that
DID move price (~₹300). It isn't how the workshop fits panels, it's
which panels a cabinet has, so it now lives on the cabinet's own top
panel (`PanelSpec.topStyle`): base units default to rails (your 29 Sep
answer), everything else a full top, overridable per catalogue row and
cabinet once the Designer exists. `ConstructionSettings.baseTop` is
gone; a stored row with it is ignored. Your question "why two options
for top panel?" exposed that the old screen mixed the two ideas; the
remaining top setting is relabelled "Carcass top — how it meets the
sides" (fitted between / sits on top of the sides). There is only ever
ONE carcass top; the countertop is not part of the cabinet.

**3. A board line in use can't be removed** — and the business is told
which projects and catalogue rows use it (`lib/boardUsage.ts`). "In
use" = any INCLUDED panel resolves to that line, explicitly or BY
DEFAULT (thickest line of the material, or the default back board),
checked with the same `resolvePanels` pricing uses, across each
project's latest saved layout, the open project's unsaved cabinets,
and the catalogue. Frozen quotes aren't checked: they carry their own
copy of the rate card. This replaces §42's softer fix for the "delete
HDMR 18mm → silent 6mm carcasses" trap; the live "carcass board each
material uses" line stays as a visible check.

**4. Only priced boards are offered for a cabinet** — a shared
`MaterialSelect` (catalogue add/edit rows, cabinet inspector) lists
only materials with a board line at a non-zero rate
(`pricedMaterials`), plus "+ Add a new board…", which creates the line
on the business rate card and saves it immediately (a rate is
required). The 3D inspector's native dropdown is filtered the same way
but has no create option (it floats over the canvas). A cabinet whose
current material has no priced line still shows it, marked, rather
than the dropdown misreporting the value.
- *Trap handled:* the rate card editor sits on the same page as the
  catalogue rows. Adding a board from a row saves the rate card, and
  the editor's resync used to REPLACE its draft — which would have
  discarded unsaved rate edits. It now merges the new line into a dirty
  draft instead. "Dirty" is compared field by field (one shared
  `cardsDiffer`), not by object identity, which would have mis-fired
  right after the editor's own Save.

**Process slip, recorded so it isn't repeated**: running
`prettier --write` on three touched files reformatted them entirely
(~800-line diff) — this repo isn't Prettier-formatted. Restored from
git, edits re-applied by hand; final diff on those files is +23/−53.

Verified: `tsc -p tsconfig.app.json`, lint, build clean. **Not seen in a
browser**, including the delete guard's Supabase query.

## 44. Cabinets pick a board line, not a material; Workshop settings declared optional (Principle 12)

**The catalogue didn't say which board.** You noticed a catalogue row
said "HDMR" without saying 18mm or 6mm — it silently meant "the
thickest HDMR line", which was also the root of §42's deleted-line trap.
Cabinets and catalogue rows now carry `carcassBoardId` — an exact board
line ("HDMR 18mm — ₹1,400/m²") — picked in a `BoardSelect` dropdown that
replaced §43's `MaterialSelect` (catalogue add/edit rows, cabinet
inspector; the 3D inspector's native dropdown lists board lines too).
Choosing a line also sets `material` to match, because the quote's
Material column, the Excel import and the DB check constraint still read
it. The back board is shown under the picker, read-only; per-panel
changes are the Designer's job. §43's rules carry over: only priced
lines offered, "+ Add a new board…" saves to the rate card, an unpriced
current value is shown marked. New column:
`cabinet_catalog_items.carcass_board_id`.

**A second "thickest line" trap, found by running it.** For a cabinet
with no board chosen (every cabinet before this), the fallback was "the
thickest line of its material". A run showed that merely ADDING an "HDMR
25mm" line silently made every older HDMR cabinet a 25mm carcass
(₹2,567 → ₹3,364 on a 600mm base unit, 25mm parts on the cutting list)
with nobody touching them. The fallback now prefers the material's
ORIGINAL 18mm line (`legacyBoardId` — the line every such cabinet was
priced on), and only uses "thickest" if that line is gone, which the
§43 delete guard prevents while it's in use. Rule: **adding a board
never moves an existing cabinet; only choosing one does.**

**Workshop settings are optional — now a written principle.** Your
statement: they must never be indispensable for designing a kitchen;
they exist for the cutting list and, later, measuring waste, which can
also be estimated from experience. That was already how the code
behaved (nothing in design/quote reads, links to, or warns about them;
pricing runs on defaults; the sheet waste factor is typed from
experience), and it's now Principle 12 in `docs/PRINCIPLES.md`, with
the test: a setting belongs on the Workshop page only if a business
that never opens it still gets a correct quote.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the Node run
above (explicit 18mm/25mm choices, legacy fallback after adding a 25mm
line). **Not seen in a browser.** Needs `schema.sql` re-run.

## 45. The Cabinet Designer page (step 5)

One page, `components/designer/CabinetDesignerPage.tsx`, opened two
ways: **"Panels & boards…"** on a catalogue row (edits that product's
defaults — saved to the catalogue) or in the cabinet inspector (edits
that cabinet only — saved to the layout, undoable). Back returns to
whichever screen opened it.

**Left:** the carcass board (`BoardSelect`, back board shown beneath),
then one row per panel — left side, right side, top (plus full/rails),
bottom, back, shelves & dividers, fronts — each with a **Built** tick
and a board picker whose first option is "Default — HDMR 18mm" (or the
back default), so a panel can always be put back to following the
cabinet. Only priced boards are listed. One-line hints in the trade's
words ("Often left off a sink unit for the plumbing").

**Right:** the cabinet's parts with size, board, edge banding and ₹ each,
"board as cut" and "board on the quote (× sheet waste)" — computed by
`cabinetCutParts`, the same function the quote prices from and the
cutting list prints, so the page can't disagree with the quote. Board
only, at cost; finish/hardware/labour/margin are added on the quote.

**Draft until Save**, like the rate card: the right side shows the
draft, so "untick back → ₹183 less" is visible before committing.
Discard reverts. Choices equal to the default are dropped on save
(`normalizePanels`), so a spec that only restates defaults reads as
"nothing customised" and isn't flagged dirty (`samePanels`). An
unticked panel keeps its board choice, so re-ticking restores it.

**Apply to this kitchen** (placed-cabinet mode only), each confirmed
and undoable in ONE step via a new `updateCabinets` store action (N
separate `updateCabinet` calls would have been N undo steps):
- "Use this carcass board for every cabinet" — the common "BWP
  throughout" case. Panels given their own board keep it.
- "Copy these panels to every <type>" — same module type only, because
  copying "no back" from a sink unit onto every cabinet would be wrong.
Deliberately not "copy panels to every cabinet".

**Catalogue rows** show a one-line panel summary under the board
("All panels, default boards" / "No back · rails top · 1 custom
board"); so does the inspector.

**Two bugs avoided while wiring, worth knowing:**
- A catalogue row keeps a local draft copied once on first render. Its
  own Save would have written that stale copy's `panels` over whatever
  the Designer saved since. The row now always saves the current
  saved row's panels.
- Reusing `previousView` for the Designer's Back would have broken
  Manage Inventory's own Back (it reads the same slot): catalogue →
  Designer → back → Back reloaded the catalogue forever. The Designer
  has its own return slot.

Not yet: the 3D preview of the cabinet alone (agreed as later).

Verified: `tsc -p tsconfig.app.json`, lint (incl. the React compiler
rules), build clean; the panel helpers run under Node on sample specs.
**Not seen in a browser.**

## 46. Catalogue "refreshing" fixed; 3D cabinet preview in the Designer

**The catalogue reloaded far more often than intended — two causes.**
1. *A real bug.* Inventory loading was keyed on the Supabase `session`
   object, and Supabase hands back a NEW session object on every auth
   event — including whenever the browser tab regains focus and on the
   hourly token refresh. So every tab switch reloaded the whole
   catalogue: a flash of loading placeholders, every row remounted, and
   any unsaved catalogue-row edit thrown away. A comment in
   `authStore.ts` claimed such events "just re-set the same values";
   corrected in place. Now keyed on `session.user.id`, so inventory
   loads once per signed-in user. Rule: **key on the user id, never on
   `session` identity.** (Nothing else in the app was keyed on it.)
2. *Within the app*, leaving Manage Inventory unmounts it, so coming
   back reset the scroll to the top and replayed the toolbar's "scroll
   to section" smooth-scroll — which looked like a refresh though no
   data was refetched. Returning from the Designer now restores the
   scroll position and drops the stale section request.
Your expectation — load when opened, not on every screen change — is
met: data is fetched once at sign-in and every edit goes through the
store, so what's shown on opening is already current.

**The 3D preview draws PANELS, not the finished cabinet.** The
walkthrough's `CabinetMesh` draws a sealed box behind doors in its
finish; in the Designer that would look identical whether or not the
back was ticked, i.e. it would ignore everything the page edits. So
`CabinetPreview3D` draws each actual piece — sides, top or rails,
bottom, back, shelves, dividers, fronts — at its real cut size and
position, coloured by board (legend underneath; fronts in the finish's
solid colour, slightly see-through; a part with no board line in red).
"Show fronts" off to look inside; "Pull panels apart" explodes each
panel out along its own face. Hovering a table row lights its panel in
3D; clicking a panel highlights and scrolls to its row.

**Positions come from the cutting list itself.** Each `CutPart` now
carries `boxes: PartBox[]` — one per physical piece in a single
cabinet, mm, cabinet-local (+x right, +y up, +z front, the same
handedness as three.js, so it's a straight × `MM_TO_M`) — computed in
`cabinetCutParts` from the same thicknesses and fits as the cut sizes.
The picture therefore can't show a panel the cutting list doesn't list,
or at a different size. Pricing never reads `boxes`.

**Checked by running it**, across three construction conventions and
four cabinets (base, wall with a BWP left side, a mixed tall unit, a
sink unit with no back and a full top): all 90 pieces' boxes match
their cut sizes within 1mm (the half-mm is the documented round-down),
every box sits inside its cabinet, box counts match piece counts, and
**no two panels overlap** (the grooved back excluded — it's meant to sit
in the grooves). The grooved back's distance from the rear edge isn't a
setting, so the preview places it 10mm in — picture only; its cut size
doesn't depend on it.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the Node runs
above. **Not seen in a browser** — I can't sign in to the app from here,
so how it actually looks (framing, colours, lighting) is unchecked.

## 47. Depth convention, rails follow the top's corner rule, a confirmed-settings lock, customer-facing edge banding

From your questions about why a 600×600×850 cabinet's side is 850×582
(not 564): a side is height × carcass depth, and 582 = 600 − the 18mm
shutter, because the app had always treated the stated depth as
INCLUDING the shutter. 564 is the bottom's width (600 − two 18mm
sides). That convention, and which panel runs past which at each
corner, were partly settings and partly hardcoded — you asked for all of
them to be one-time, business-wide Workshop settings with defaults.

**1. Depth convention — new setting.** `depthIncludesFront` (default
true = the original convention: carcass 582 behind an 18mm shutter;
false = "600" is the carcass, the shutter adds 18mm in front). Moves
every side, top, bottom and shelf by a shutter's thickness — measured
+₹57 board on a 600×600×850 base unit. It's the most likely real
mismatch with a carpenter, so the Workshop page lists it first.
**Known gap, flagged on that page:** only the cutting list and price
follow it. The 2D plan, 3D walkthrough and collision still treat the
stated depth as the finished cabinet, so with "carcass only" they draw
it 18mm shallower than reality. Fixing that touches footprints,
collision and clearance everywhere — its own piece of work. **Closed in §61.**

**2. Corner rules — all on the Workshop page now.** Top, bottom and back
already were. The one remaining HARDCODED rule a carpenter could
reasonably do differently — rails always between the sides — is gone:
the top's rule now applies to rails too ("over the sides" → 600mm rails,
sides 832). Shelves and dividers still always fit between the sides;
there's no other physical way to fit them. Rules are business-wide and
symmetric (left = right); no per-cabinet or per-side override, by
design (Principle 12 — the Designer stays light).

**3. "Set once, then fixed" — a lock.** Once the SAVED settings are
confirmed ("my carpenter has confirmed"), every field on the Workshop
page is disabled under a green "Confirmed — locked" banner. "Change
settings" unlocks after a warning that this changes every cutting list
in every project (frozen quotes unaffected); saving confirmed settings
re-locks. It's a guard against stray clicks, not a permission system.

**4. Edge banding: customer-facing edges only, never the wall** (your
rule). Front edges of sides, top, bottom, shelves, dividers and the
front rail; all four edges of fronts; never rear edges, the back rail or
the back. Newly counted: the BOTTOM edge of the sides of anything
mounted off the floor (`elevationMm > 0`) — a wall cabinet's sides are
seen from below. A cabinet stacked on another (a loft over a tall unit)
would be over-counted; accepted as rare.

Checked by running it: the 600×600×850 base and a wall unit under both
depth conventions and with rails over the sides (numbers above), and the
geometry check extended to five convention combinations — 150 pieces,
sizes match cut sizes within 1mm, nothing outside its cabinet (fronts
allowed 18mm proud when carcass-only), no overlaps.

Verified: `tsc -p tsconfig.app.json`, lint, build clean. **Not seen in a
browser.**

## 48. Editing what's on the cutting list; a shelf double charge fixed

**The cutting list is never edited directly** — it's derived from the
design, and the same parts set the price, so an edit made on the list
itself would make the list and the quote disagree. Every change happens
one step upstream, and the gap was that some parts had no upstream home.
Built, as you agreed:

1. **Extra shelves in any cabinet** — `PanelSpec.extraCount` on the
   Shelves row of the Cabinet Designer (0–8). Spread evenly through the
   cabinet's TALLEST compartment that has no shelves of its own (a plain
   door cabinet: the whole carcass), so they never collide with an
   open-shelf row's shelves or a divider. Each is a board part AND a
   "Shelf supports & fitting" hardware line, like any shelf.
2. **Extra parts on a cabinet** — `PlacedCabinetItem.extraParts` /
   `CatalogItem.extraParts` (`cabinet_catalog_items.extra_parts`):
   name, length × width, quantity, board ("Carcass board" by default),
   banded long/short edges. Listed and priced inside the cabinet's own
   line (they come out of `cabinetCutParts`). Not drawn in the 3D preview
   — they have no fixed position — and the preview says so.
3. **Loose parts for the project** — `RoomLayout.looseParts`
   (`layouts.loose_parts`), edited on the Cutting List page: fillers,
   plinth, end panels. Always name a board (no cabinet to inherit from).
   Priced inside the Material subtotal as real area × board rate × sheet
   waste, via the same `loosePartsCut` the list prints;
   `BOMSummary.loosePartsCost` carries how much of Material they are.
   Undoable design edits.
4. **Jump to the source** — every C-number on the cutting list opens
   that cabinet in the Designer; Back returns to the cutting list.
5. **Last-minute workshop trims stay in the exported Excel** — paperwork,
   not a design change, so they don't move the quote.
- Extra and loose parts' named boards count for the "board in use"
  delete guard (§43) — including loose parts in the open project's
  unsaved design.
- One shared `ExtraPartsEditor` serves both the Designer and the cutting
  list, offering only priced boards (the BoardSelect rule).
- `computeCutList` now takes `looseParts` as a REQUIRED argument (pass
  `[]`), same no-defaults rule as `PricingContext`.

**A shelf double charge, found while pricing extra shelves — introduced
by §42.** The rate card's ₹350 "Shelf, cut and edge-banded (each)"
priced the shelf BOARD back when board had no price of its own. Once
§42 priced board on real area, every open-shelf unit's shelves were
charged twice (≈₹439 board in Material + ₹350 here, for a 600mm shelf).
Your call: keep the line, narrow it to **"Shelf supports & fitting"**,
placeholder **₹80** (a guess). `schema.sql` moves any card still on the
₹350 placeholder to ₹80 (same "only touch what's still the placeholder"
rule as the hinge/channel update); a business that set its own shelf
rate is left alone and should review it. Until `schema.sql` is re-run,
a live card still says ₹350.

**On board efficiency** (your question): the cutting list fixes WHICH
parts and their sizes; it says nothing about how they're laid out on
sheets, which is where waste happens. Today's waste is only the typed
sheet waste factor. Phase 2 (nesting) will lay parts out with a known
heuristic and measure waste — good layouts, not provably optimal ones;
2D sheet packing is a hard problem every cutting tool approximates.

Checked by running it: extra shelf +₹439 board +₹80 fitting; unticked
shelves add nothing; a 564×100 stiffener +₹79; two 720×75 loose fillers
₹151 inside Material; geometry test now 245 pieces across six cabinets
(incl. extra shelves in a door cabinet and in a mixed tall unit's door
band) — sizes match, all inside, no overlaps.

Verified: `tsc -p tsconfig.app.json`, lint, build clean. **Not seen in a
browser.** Needs `schema.sql` re-run (`cabinet_catalog_items.
extra_parts`, `layouts.loose_parts`, the shelf-rate update).

## 49. Cutting list phase 2 — sheet nesting and measured waste

`lib/nesting.ts` lays each board's parts out on whole sheets; the
Cutting List page's new **"Sheets & waste"** view shows a summary per
board, the two measured waste factors with a button to use either on
this project's quote, and a drawing of every sheet. The Excel export
gains a **Sheet layout** tab (board, sheet number, part, cabinet, size,
turned or not, x/y from the sheet corner).

**Method — a known heuristic, per PRINCIPLES ("don't invent one"):**
Jylänki's guillotine bin packing ("A Thousand Ways to Pack the Bin",
2010). Guillotine specifically, because every implied cut runs edge to
edge across a piece — what a small workshop's panel saw can follow;
MaxRects packs tighter on paper but can produce layouts a panel saw
can't cut. All combinations of its placement rules (best area / short
side / long side fit), split rules (shorter / longer leftover axis,
min / max area) and four standard part orderings are run — 48 passes,
~milliseconds — with free-rectangle merging; the best wins (fewest
sheets, then the emptiest last sheet). Kerf is reserved on every piece;
factory edges are trimmed first; grain-fixed parts (fronts) never turn.
Nested per cutting-list group (board, and finish for fronts), since
each is physically its own stack of sheets.

**Workshop settings** gained sheet length/width (default 2440 × 1220,
8×4 ft), kerf (4mm) and edge trim (10mm per side) — defaults, so nobody
has to open the page (Principle 12). One size for all boards for now; a
board sold in another size would need a per-board override. These live
in ConstructionSettings, which is fingerprinted, so editing them marks
frozen quotes "changed" though no price moves — the safe direction.

**Two waste figures, not one.** On a typical 11-cabinet L-shaped kitchen
(83 pieces): 13 sheets, 26.8 m² of parts on 38.7 m² bought → **×1.45**
counting every sheet; but 8.2 m² of that is each board's LAST-sheet
leftover — usually a big clean rectangle a workshop keeps for the next
job — and excluding it gives **×1.14**, in line with the 10–15% waste
workshops usually quote. Which is right depends on whether the business
really reuses offcuts, so it chooses; the button only sets THIS
project's override, never the rate card default.

**Measured, not assumed, that the packing is reasonable.** The single-
rule first version and the 48-pass version produced the same sheet
counts here; the gap to the naive area bound (7 vs 6 carcass, 3 vs 2
backs, 3 vs 2 fronts) is geometry, not packing — e.g. a 2080×580 tall
back plus two 700×880 backs don't tessellate onto two sheets with
guillotine cuts, and fronts can't rotate at all. Validity checked on
every piece: placed exactly once, inside the trimmed area, kerf-
separated from every neighbour, never a grain-fixed part turned, sizes
unchanged; a part too big for any sheet is listed as unplaced (shown in
red), never dropped.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the Node run
above. **Not seen in a browser** (the SVG drawings in particular), and
not yet compared with a carpenter's real sheet count — that comparison
is the real test.

## 50. Dimension lines on the sheet drawings; plainer waste wording

**Dimensions with arrows**, your request: each sheet drawing now shows
the sheet's overall length and width as dimension lines outside its
edges, and every piece's length and width inside it — lines with an
arrowhead at each end, the value centred (vertical values turned to read
bottom-to-top, the drafting convention), with a white halo so text stays
legible over lines and edges. A strip too thin for arrow lines (a rail,
a filler) gets one compact "564×100" label along its long side; a turned
piece is marked ⟲. The drawing moved into its own store-free component,
`components/cutlist/SheetDrawing.tsx`.

**Checked by looking at it, for once.** The drawing was rendered outside
the app — the real component, fed a real nested layout, rendered to SVG
with react-dom/server and turned into an image — and viewed before
shipping. That first look caught a real gap: the 564×100 rail on the
first sheet showed no size at all (too thin for arrows), which is what
the compact label fixes; the second render confirmed every piece on a
nine-piece sheet carries its size.

**Plainer wording** after you asked what "measured sheet waste" and
"last-sheet offcut" meant: the column is now "Leftover on last sheet
(m²)" with a tooltip, the section "Waste factor measured from these
layouts" with a one-line explanation (how much board the job buys per
1 m² that ends up in cabinets), and the buttons say what they assume —
"leftovers are waste" vs "leftovers kept for the next job".

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the rendered
images. Still not seen inside the running app.

## 51. One measured waste factor, every sheet counted

§49 offered two figures — every sheet bought (×1.45 on the test
kitchen) and one excluding each board's last-sheet leftover as a
reusable offcut (×1.14). You asked for one: combine the earlier and the
last sheets, and give a single factor. Now: total sheet area bought ÷
total area of parts, every sheet counted in full — one number, one
"Use ×… on this project's quote" button (disabled when the project
already uses it). The table shows parts m², sheets m² and waste % per
board and in total; the "Leftover on last sheet" column and
`NestResult.lastSheetOffcutSqM` are gone. The reasoning for the
two-figure version — that a workshop may reuse last-sheet offcuts —
isn't wrong, but it's the business's call how to price that, and the
rate card's typed waste factor remains the place to express it.

## 52. Sheet sizes per board — any number, per board line

You asked where the purchased board's size is decided (it was one
2440 × 1220 size in Workshop settings, for every board) and ruled:
different boards can have different sizes, and the same board can come
in several. So `BoardRate.sheetSizes?: SheetSize[]` — on the rate card,
each board line lists the sizes it's bought in, edited as removable
chips plus an add box ("Sheet sizes: 2440 × 1220 ✕  2135 × 1220 ✕").
None listed → 8×4 (`DEFAULT_SHEET_SIZE`). `lengthMm` is the sheet's
grain direction. Stored inside the existing `board_rates` jsonb — no
schema change. Saw cut (kerf) and edge trim stay on Workshop settings:
they describe how the workshop cuts, not what it buys. The global sheet
length/width settings are gone (a stored row with them is ignored).

Sheet size isn't a price input — board is still priced per m² — it only
decides how the nesting lays parts out, hence the MEASURED waste. Like
anything on the rate card it's fingerprinted, so editing a size marks
frozen quotes "changed" though no price moves (the safe direction).

**Choosing among sizes** is a simple, explainable rule on top of the
same guillotine packer (§49), not a new algorithm:
1. for each size, fill with sheets of that size; pieces too big for it
   go on the smallest other size they fit;
2. then try to finish smaller — re-pack the last sheet's pieces onto
   each smaller size, smallest first, taking the first that holds them
   all on one sheet;
3. keep the plan with the fewest unplaced pieces, then the least sheet
   area bought, then the fewest sheets.
Each `NestedSheet` now carries its own size; drawings and the Excel
"Sheet layout" tab (new "Sheet size" column) read it per sheet.

Measured on the test kitchen's 18mm carcass (57 pieces): 8×4 only → 7
sheets, 21.1% waste; 8×4 or 7×4 → 6 + one 7×4, 19.7%; 6×4 or 8×4 → 6 +
one 6×4, 18.2%; 6×4 only → the two 2100mm tall-unit sides reported
unplaced (shown in red: "won't fit on any size its board is bought in"),
never dropped; 8×4 or 8×6 → 4 × 8×6 + 1 × 8×4. Every sheet checked to be
an offered size, every piece inside its own sheet's trimmed area and
kerf-separated.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the runs above.
Not seen in the running app.

## 53. Approx vs calculated sheet waste — one factor, or per board from the layout

You agreed waste should be per BOARD LINE (HDMR 18mm and HDMR 6mm waste
very differently — ×1.37 vs ×1.80 on the test kitchen) and set the rule:
- **Approx** — the experience-based factor stays ONE factor, used
  everywhere on the quote (the rate card default, or a project's own
  override in the sidebar). The default; needs nothing on the
  production side (Principle 12).
- **Calculated** — each board line's own factor, measured from THAT
  project's sheet layout, used on the quote automatically.
- A business-wide switch on the catalogue page's rate card ("Sheet waste
  on quotes": Approx — one factor / Calculated — per board) "upgrades"
  every quote from the one factor to its measured per-board factors.

`RateCard.wasteMode` (`rate_cards.waste_mode`, NULL = approx, so the
column changes no quote). The calculated factors are NEVER stored: they
depend on each kitchen's actual parts, so `calculateBOM` works them out
live — all cabinets' and loose parts' cut parts are computed up front,
nested per cutting-list group on each board's own sheet sizes
(`measuredBoardWaste` in lib/nesting.ts, groups of one board line
combined: sheets bought ÷ part area), and each part's board cost is its
area × its board's rate × ITS board's factor. `BOMSummary` gains
`wasteMode` and `boardWasteFactors`. The quote sidebar shows the
per-board factors read-only in calculated mode (no single number to
override); the Sheets view lists each board's measured factor and says
plainly which waste the quote is using — its old "Use ×… on this
project's quote" button is gone, since that mixed the two modes.

**Why per board line is more than detail — it fixes a mispricing.** On
the test kitchen: one blended ×1.45 priced board at ₹47,484; calculated
mode priced it at **₹45,694 — exactly** what the sheets actually cost
(each board's sheets bought × its rate, computed independently). The
blend over-charged because it applied the backs' heavy waste to
expensive 18mm board.

**Speed.** Calculated mode re-prices — and so would re-nest — on every
design edit, including every frame of dragging a cabinet. `nestParts`
now keeps a small bounded cache keyed on every piece's size and grain,
the sheet sizes and the cut; a drag moves a cabinet without changing
any part's size, so it's a hit. Measured: 11ms the first time, 0.6ms
after a drag, on the 83-piece kitchen. Results are deterministic, so a
hit is always correct; a hit whose part labels differ (same sizes,
different cabinets) recomputes, so the Sheets view never shows stale
labels.

Verified: `tsc -p tsconfig.app.json`, lint, build clean; the Node run
above. Not seen in the running app. Needs `schema.sql` re-run
(`rate_cards.waste_mode`).

## 54. Catalogue Excel re-import silently wiped fronts, handles, panels, boards and extra parts — fixed

Found while reviewing what's left in the panel/cutting-list work. The
cabinet catalogue's Excel import (`lib/importExport/cabinetImportExport.
ts`) built each row from the sheet's columns alone, and the save is a
whole-row upsert. Its header said `frontLayout` and `handleId` were
"deferred from the sheet … in-app-only edits" — but nothing carried
them over, so every UPDATED row was saved with them blank. That bug is
older than this session; §42-§48 widened it to `panels`,
`carcassBoardId` and `extraParts`. A routine "export the catalogue, fix
prices in Excel, re-import" reset every product's doors/drawers, handle,
panel choices, board and extra parts.

Fix: an updated row keeps every field the sheet doesn't carry from the
stored row. One exception: if the sheet CHANGES the row's material, its
chosen board line is dropped (it belonged to the old material) and the
row falls back to the new material's default board. Verified by calling
`parseCabinetCatalogRows` on a stored sink unit (double door, a handle,
no back, HDMR 18mm board, one extra part): a price-only re-import kept
all of them; a re-import changing HDMR → BWP kept all but the board.
New rows are unaffected (nothing to carry over).

Lesson worth keeping: **any whole-row upsert from a partial source (a
spreadsheet, a form showing some fields) must merge onto the stored row,
or it silently deletes what it doesn't show.** The obstacle, appliance,
handle and fixture importers were then checked against their types AND
their database rows: each sheet carries every field today, so none was
losing data. They were made robust anyway — each updated row now starts
from the stored row with the sheet's values laid over it — so a field
added later without a sheet column can't recreate the bug.

## 55. A test runner: Vitest, 57 tests on the money and size code

You agreed (after asking what a test runner is) to add one. Through
§35-§54 every price, cut size and sheet layout was checked by a
throwaway script that was then discarded — so nothing re-checked old
behaviour when new code landed, which is how the §42 shelf double charge
and the old import data-wipe went unnoticed. Vitest (built for Vite;
reads the project's own config) now keeps those checks permanently:
`npm test` runs them in ~0.3s.

**57 tests, in four files beside the code** (`src/lib/*.test.ts`),
shared builders in `src/test/fixtures.ts` (a cabinet, the 600×600×720
base unit, the 11-cabinet L-shaped test kitchen, a layout, a pricing
context on the app's own seeded rates):
- `cutList.test.ts` (28): part sizes for every construction convention,
  half-mm rounds down, customer-facing edge banding, unticked panels,
  per-panel boards, extra shelves/parts, loose parts, drawer fronts
  replacing the door; and for four conventions × 12 cabinets, every 3D
  box matches its cut size, sits inside its cabinet, and no two panels
  overlap.
- `bom.test.ts` (14): ₹2,567 board on the base unit; −₹183 for no back;
  BWP left side; adding a thicker line never moves an old cabinet; no
  board line → ₹0 AND flagged; extra shelf +₹439 board +₹80 fitting;
  stiffener; loose parts inside Material; calculated waste = exactly the
  sheets' cost; approx = one factor; labour rows; business lump sum once
  per project; fixed-price rows unmarked and lines summing to the total.
- `nesting.test.ts` (8): every layout valid (each piece once, inside the
  trimmed sheet, kerf-separated, grain respected, sizes unchanged); 13
  sheets for the test kitchen; oversize reported; waste formula;
  multi-size finish-smaller; too-short sizes report long parts; cache.
- `panels.test.ts` (7): spec normalising/describing; carcass-board
  fallback pinned to the original 18mm line; the §54 re-import keeping
  fronts/handles/panels/board/extra parts, and dropping the board on a
  material change.

**Proved it bites**: re-introducing the old round-half-up bug made
exactly the "double doors never exceed the cabinet" test fail by name.

Prices are pinned to the SEEDED placeholder rates on purpose — changing
a seed should make the affected tests fail, so it's a deliberate act.
Tests sit under `src`, so `tsc -b`/lint check them too; Vite never
bundles them (nothing imports them). No component or browser tests:
UI is still checked by eye. CLAUDE.md's "There is no test runner"
corrected in place.

## 56. Drawer boxes on the cutting list and the price

Every drawer unit was under-quoted: the board inside its drawers was
never listed or charged. Now every drawer front gets a box behind it —
rows in the existing cutting list and price (no separate page; your
worry about complexity), pieces in the Designer's 3D preview, and a new
**"Drawer boxes"** panel row in the Designer (Built tick + board; untick
when boxes are bought ready-made; default board = the cabinet's).

- **Tandem / metal-sided** (your default): per drawer, a **bottom**
  (inner width − 75, runner length − 10) and a **back** (inner width −
  87, drawer front height − 60), from the drawer-box board; the back's
  top edge is banded. The metal sides come with the runner system.
- **Wooden**: per drawer, two **sides** (runner length × box height), an
  **inner front & back** (box width − 2 × board), and a **bottom** from
  the thin back board, grooved into all four; box width = inner width −
  25 (runner clearance), box height = front height − 40.
- **Runner length** is automatic: the longest standard size, 270–650mm
  in 50mm steps, that fits the cabinet's inner depth with 10mm spare. A
  cabinet too shallow for any gets a warning, never a guessed box.
- All the deductions are Workshop settings (defaults = common tandem
  figures; each brand publishes its own), only the chosen type's set
  editable. The old "recorded, not applied yet" note is gone.

Measured: a 600×600×720 3-drawer unit gains 1.044 m² of 18mm board —
**+₹1,462** at the seeded ₹1,400/m².

**Caught by the new test suite (§55), twice, before shipping:** the
wooden drawer bottom was drawn in the 3D preview without its grooves —
16mm smaller than its cut size — which the "every box matches its part"
test flagged; it's now drawn at cut size, reaching into its grooves like
a grooved back. (And my own hand arithmetic for the price was ₹1 off;
the test had the exact figure.) 64 tests now, including tandem and
wooden sizes, ready-made boxes, too-shallow cabinets, and wooden boxes
in the geometry/overlap checks.

## 57. Fronts cut from the carcass board by default; grain only where it really applies

You confirmed fronts (all cabinet fronts — shutters, drawer/trolley/
false fronts, tambours; not the room's doors and windows, which aren't
cut in the workshop) are cut from the same board as the carcass and
laminated after. New Workshop setting **"Fronts are cut from"**:
- **Same board as the carcass, laminated after** (default): fronts share
  that board's sheets with the carcass parts, and may turn on the sheet
  — plain HDMR/MDF has no grain; the laminate's grain is lined up when
  it's pressed on.
- **Pre-laminated sheets**: fronts get their own sheets per finish, and
  any patterned finish keeps its grain direction; only a solid colour
  (`patternCategory: 'solid'`) may turn. Stone veining counts as
  patterned — the cautious choice.

**How**: each `CutPart` now carries a `stockKey` — which physical stack
of sheets it's cut from (the board line, plus the finish for a
pre-laminated front) — set where the part is made, from the setting.
`groupKey` returns it, so the cutting list's groups, the nesting, the
measured per-board waste and the consolidation all follow the setting
without each re-deriving it. A side effect, deliberate: a back cut from
the carcass's own board (an inset 18mm back) now shares its sheets too —
before, `groupKey` included the part's kind, so backs and fronts always
got sheets of their own even when cut from the same board. Groups are
labelled by what they hold ("HDMR 18mm — carcass, fronts").

**Measured on the test kitchen**: 12 sheets with fronts on the carcass
board (9 of HDMR 18mm carcass + fronts, 3 of 6mm backs) vs 13
pre-laminated (7 + 3 + 3) — one sheet saved, drawer boxes included.

**Your other question — does a drawer reduce the front?** No double
counting either way. The drawer FRONTS are the cabinet's front: three
594×236 drawer fronts (0.421 m²) replace one 594×714 door (0.424 m²);
the small difference is the reveal gaps. The drawer BOXES sit inside,
behind the fronts — extra board, never a replacement for any front
area. Price and cutting list come from the same breakdown, so they
agree. (Pinned by a test: a drawer unit has three fronts and no shutter.)

Four tests failed when this landed, correctly — they had pinned the old
grain-always and fronts-on-own-sheets behaviour. They now pin both
settings: 68 tests.

## 58. Edge banding priced by the metre, from the cutting list

The cutting list already knew each part's banded edges (customer-facing
only, §47) and so the exact running metres. Edge banding had only ever
been priced as a guess — a per-sq-ft "others" row. Now the rate card has
**"Edge banding (₹ per running metre)"**, and every cabinet is charged
its exact metres × that rate (loose parts too), shown as an "Edge
banding" line in the sidebar, Present mode and PDF (marked up like any
cost; hidden at ₹0).

**Default ₹0, on purpose.** The business already has an "edge banding"
row in Labour & other charges, priced per sq ft; a non-zero default
would have charged edge banding twice on every open quote. Setting the
rate is the switch, and the rate card warns in amber when both a rate
and an edge-banding "others" row are set. Rate per metre is single for
now — one tape for all boards; 0.8mm vs 2mm tape would need per-board or
per-edge rates.

Measured: the 600×600×720 base unit has 5.184 m of banded edge (sides
1.44, front rail 0.564, bottom 0.564, shutter 2.616) → ₹51.84 at ₹10/m.
(The test first expected 4.188 m — my own mis-addition; the code was
right.) No allowance yet for the few centimetres trimmed off each edge.
70 tests.

## 59. Per-sq-ft charges (site labour included) on the cabinet's total area

Your call: labour should use the TOTAL area, not just the front. Every
per-sq-ft charge row now bills on `areaSqFt` = the real area of all the
cabinet's cut parts (sides, top or rails, bottom, back, shelves, drawer
boxes, fronts, extra parts — exactly what's priced as board) plus any
glass door area, since fitting a glass door is no less work. Until now
it was `estimateAreaSqFt`: front face + half a side — removed.

**This is a big, deliberate price change.** 600×600×720 base unit:
7.0 → 22.7 sq ft, so site labour at the seeded ₹150/sq ft goes ~₹1,046
→ ₹3,406. ₹150 was a placeholder chosen against the old, smaller area —
it almost certainly needs lowering to the business's real per-sq-ft
labour rate for a total-area basis. Any other per-sq-ft row scales the
same way; notably the business's own "edge banding ₹200/sq ft" row,
which §58's per-metre rate now replaces. Frozen quotes don't change.

Consequences that follow automatically: unticking a panel reduces
labour; drawer boxes and extra parts add to it; the glass test shows a
glass-door cabinet keeps the same labour area as its board twin while
its board area drops. 72 tests (one more ₹1 correction to my hand
arithmetic: 22.706 sq ft × ₹150 = ₹3,406).

## 60. The cutting list is frozen with each quote

A sent quote's PRICE was frozen, but its cutting list stayed live — so
if the design changed after quote v3 went out, the workshop could cut a
different kitchen than the customer agreed to. Now:

- **Freezing a quote saves its cutting list** in `quotes.cut_list`
  (jsonb, written once like `summary`, never updated): exactly the parts
  priced in that version, from the same inputs, with their 3D positions
  dropped to keep each row small (`freezeCutList`). Groups aren't
  stored — `thawCutList` rebuilds them with the same `groupCutParts` the
  live list uses (extracted from `computeCutList` for this), so a frozen
  list groups exactly as it did; a test round-trips one through JSON.
- **Where you see it** (your question): on the Cutting List page — a
  selector "Current design / Quote v3 (sent 2 Oct)". A frozen version is
  read-only: no loose-parts editor, no links into the Designer (those
  cabinets may have changed or gone), a blue banner saying when it was
  frozen/sent and — if it's the latest quote and the design has changed
  since — "cut from this list only if the customer agreed to this
  version". Its sheet layout and Excel export use the boards (sheet
  sizes) and workshop settings saved WITH that quote, not today's
  (`SheetLayoutView` now takes them as props for this). The export's
  filename carries the version.
- The quote panel's frozen-quote card has a "Cutting list for v3 →"
  link that opens straight to that version.

Quotes frozen before this have no cutting list and simply don't appear
in the selector. The sheet LAYOUT of a frozen list is recomputed from
its frozen parts and settings rather than stored; that's deterministic,
but a future change to the packing code could lay the same parts out
differently — the PARTS (what to cut) are what's guaranteed frozen.

One React-compiler snag on the way: it rejects a manual `useMemo` keyed
on a value found by searching a list; the memo was dropped (the
compiler memoises the component itself). 73 tests.

## 61. The depth convention everywhere — plan, 3D, collision — with a project override

§47 added "cabinet depth includes the shutter / carcass only", but only
the cutting list and price followed it: with "carcass only" the plan, 3D
view and collision checks drew every cabinet 18mm shallower than the
one built. You asked for a business-level setting (Workshop page),
overridable per project, with the 2D/3D views and collision/overlap
alerts following it, and anything else that needed rework.

**One resolver, one footprint.** `lib/physicalDepth.ts`:
- `effectiveConstruction(settings, layout)` — the business setting with
  the project's `RoomLayout.depthIncludesFront` on top (new
  `layouts.depth_includes_front`, edited in Room Settings: Business
  default / Includes shutter / Carcass only). The cutting list, price,
  frozen quote (it now stores the EFFECTIVE settings) and geometry all
  resolve through it, so they can't disagree. That was a gap of its own:
  before, a project override would have reached nothing.
- `physicalCabinet(item, extra)` — the cabinet as it physically stands.
  The extra shutter depth grows on the FRONT only: x/y are the unrotated
  corner and rotation is about the centre (footprint rule 1), so "depth
  + 18" alone would grow both faces and push a 180°-turned cabinet's
  back 9mm into the wall. The centre moves forward by half the extra,
  along the front direction (the same 0→+y / 90→−x / 180→−y / 270→+x
  rule `cabinetClearance.ts` already verified).
- `storedPositionFromPhysicalCenter` — the inverse, for the 2D drag:
  without it each drag under "carcass only" would save the physical
  corner as the stored one and creep the cabinet forward.

**Who uses physical cabinets** (`usePhysicalCabinets()`; same array back
for the default convention, so it costs nothing there): the 2D cabinet,
appliance, obstacle, opening, fixture and remaining-space layers;
collisions, door-swing clearance, kitchen checks, design alerts,
picking; the 3D room; the wall elevation; the lighting/opening toolbars;
the surfaces panel; and inside `calculateBOM`, the countertop and the
floor area cabinets occupy (both physical — a carcass-only cabinet's
slab covers its shutter). **Who keeps stored cabinets**: anything that
edits (inspector — including the 3D one, which would otherwise show
"618" for a cabinet typed as 600 — designer, nudging, double-click
rotation) and pricing/the cutting list (which apply the convention
themselves). The 2D drag reads physical and writes stored; snapping
uses physical edges, so carcass-only fronts line up flush.

Geometry uses `FRONT_THICKNESS_MM` (18) for the extra, as the 3D shutter
already does; the cutting list uses the fronts board's real thickness. A
25mm shutter would make the picture 7mm short — noted, not fixed. **Fixed in §65.**

Tests (86): at every rotation the extra is on the front and the back
stays put; drag write-back round-trips; the default returns the same
array; the project override wins; a carcass-only countertop is
600+40 × 18mm larger; the override reaches the cutting list. Not seen
in a browser — dragging and the 3D view under "carcass only" are worth
a look.

## 62. Corner carousel: its real parts on the cutting list and price

You pointed out the 3D view already draws the carousel's diagonal front.
It did — but the cutting list and price still treated it as the plain
rectangular box (two full-depth sides, one back, a full-width door), and
said so in a warning. Now the parts match the 3D shape (the same 0.4
corner cut as `cornerCarouselGeometry`): the W×D square with its
front-right corner cut diagonally.

- **Two return panels** at the open edges beside the door, each 60% of
  its side (720 × 540 on a 900 × 900 unit) — in place of full sides.
- **Two backs**, one along each wall.
- **Pentagon top, bottom and any extra shelves** — listed and priced on
  their W×D bounding rectangle (882 × 882 between the returns): the
  workshop cuts that rectangle and trims the corner off, a triangle too
  small to reuse. Their diagonal edge is banded — a new per-part
  `extraEdgeBandMm`, since a diagonal is neither a long nor a short edge.
- **The diagonal door**: 509mm edge minus reveals → **503 × 714**,
  instead of a ~894mm door. Edge banded all round.

Simplifications, stated in the code: returns and backs butt rather than
follow the back-fit setting; the top is always a full pentagon (no
rails). The Designer's 3D preview draws the returns, backs and the door
(rotated onto the diagonal — `PartBox.rotY`); pentagons aren't boxes,
so they're listed as "not drawn here". Board cost changes accordingly
(much smaller door, slightly bigger top/bottom, shorter returns).

5 new tests (91).

## 63. Glass order sheet

Glass panels used to appear only as a warning ("2 glass panels not
listed — order cut to size from the glass supplier"). They're now a
proper order list, `CutList.glass` — one line per glass panel with its
cabinet, height × width (the same front-breakdown size the quote prices
glass on), tint and quantity — shown as **"Glass to order"** on the
Cutting List page and as a **Glass order** tab in the Excel export, ready
to send to the glass supplier. Glass isn't nested on sheets: the
supplier cuts it. Frozen with a quote like the rest of the list
(`FrozenCutList.glass`, absent on older frozen lists). Thickness isn't
recorded anywhere in the app, so the export leaves a blank Thickness
column for the business to fill in rather than guessing one. The cut
list's header comment, which still listed drawer boxes, glass and the
carousel as known gaps, is corrected — all three are now handled. 93
tests.

## 64. Printable workshop documents: cutting list PDF and part labels

Two buttons on the Cutting List page, built with the same jsPDF +
autotable the quote PDF uses, from the same `CutList` and nesting the
page shows — and from whichever version is selected (live design or a
frozen quote's list), so paper and screen can't disagree:

- **Print (PDF)** — header (project, version, date) and, if the
  workshop settings aren't confirmed, the same "ASSUMED settings"
  warning the screen shows; a parts table per board (identical parts
  merged, as a saw operator works: part, length, width, qty, edge,
  grain, cabinets); the glass order; any notes; then one landscape page
  per nested sheet, every piece drawn and labelled with its cabinet,
  name, size and "(turned)" where rotated.
- **Part labels (PDF)** — one label per physical piece, 3 × 8 = 24 per
  A4 page (the common 63.5 × 33.9 mm sticker sheet): cabinet + part,
  L × W × thickness, board, edge banding (+ "diagonal" for a carousel
  pentagon), and "piece n of N" — so every cut piece can be tagged at
  the saw and matched at assembly.

No prices on either (they're for the workshop). jsPDF's built-in
Helvetica is WinAnsi-only — "×", "—", "²" print; "₹", arrows and "⟲"
don't — so rotation is said in words.

Checked by eye: both PDFs were generated from the test kitchen (plus a
glass door) and their pages rendered to images — page 1 of each via
macOS `sips`, a sheet page via a small PDFKit script (poppler isn't
installed). Tables, the assumed-settings warning, the glass order, the
labels and a sheet layout all read correctly.

## 65. Shutter thickness follows the fronts board everywhere

Your rule: front thickness should be as per the board used, with overlap
and the rest following. The cutting list and price already used the
fronts board's real thickness; the 3D view, the plan's physical
footprint (under "carcass only"), collision/overlap checks and the drag
write-back still assumed a fixed 18mm (`FRONT_THICKNESS_MM`), so a 25mm
shutter board drew — and was collision-checked — 7mm short.

Now `frontThicknessMm(item, rates)` (lib/physicalDepth.ts) resolves each
cabinet's shutter thickness from its FRONTS board (lib/panels.ts —
per-cabinet override, else the carcass board), falling back to 18mm only
when there's no board at all. It drives: the 3D renderer's shutter and
the carcass inset behind it (one constant in `CabinetMesh` controlled
every front, so one line), the physical footprint (`physicalCabinets`
now grows each cabinet by its own shutter, not a uniform 18), and the
2D drag write-back (`useFrontExtraFor`, per cabinet). Test: a 25mm-front
cabinet reaches 625 under "carcass only", an 18mm one 618 (94 tests).

Also closed by your decisions in the same message: **edge-banding tape
thickness** isn't needed — one ₹/m rate for whatever tape the business
uses; the **corner carousel's simplifications** (backs/returns butt; full
pentagon top) stay, since they move a few mm on two panels of one rare
cabinet type.

## 66. Screen tests, and three things that couldn't be found

**Found in use (3 Oct):**
- **"Reset to business rates"** in the quote sidebar's charges box was
  unclear. Renamed, in your words, to **"Use business-level rate-card
  charges again"**.
- **The frozen cutting-list dropdown didn't appear**, even after you
  re-ran `schema.sql`. Two causes. (1) It was hidden completely unless
  some quote carried a frozen list, and only quotes frozen AFTER §60 do.
  Hiding a control when it has nothing to offer made it impossible to
  discover. (2) The Cutting List page never loaded the project's quotes
  itself; only the quote sidebar did, so opening the Cutting List first
  showed nothing. Now the dropdown is always shown. Older quotes are
  listed greyed out as "frozen before cutting lists were saved", and the
  page loads quotes itself. The quote card says "freeze a new version to
  keep its cutting list" when the latest quote has none. Lesson, the same
  as the Save button: a control that only appears in the right state is
  a control nobody finds.

**Screen tests (your choice: components first, browser later).** React
Testing Library + jsdom under Vitest. 16 tests in
`src/components/__tests__/`, aimed where screen bugs have actually been:
- Rate card: the placeholder banner; an edit shows the unsaved bar and
  Save saves; unsaved edits survive a board added from another screen;
  the waste switch.
- Boards: the dropdown offers only priced boards; "+ Add a new board…"
  needs a rate, saves to the rate card and is picked; a board in use
  can't be removed (and the project is named); an unused one can; the
  default back board can't.
- Cabinet Designer: unticking a panel removes its part and enables Save,
  and Discard restores it; Save writes the catalogue row; Back leaves.
- Quote sidebar: Customise and "Use business-level…" switch the
  project's charges.
- Cutting List: the dropdown is always present, loads quotes itself,
  greys out old quotes, says "No frozen quotes yet", and shows a frozen
  quote's parts.

**Proof the tests bite.** Five real fixes were undone one at a time:
Save ignoring an edit, unpriced boards offered, the Cutting List not
loading quotes, a board in use being removable, and Discard doing
nothing. A test failed every time, and the code was restored after each.
The 3D preview is mocked (no WebGL in jsdom), so drawing is still
checked by eye. 110 tests in total.

## 67. Every frozen version on the quote

You asked to see every quote frozen to date at the bottom of the quote,
with a cutting list for each version, like the Cutting List page has.
The quote panel showed only the latest version, though the database
keeps them all. Now an **"All frozen versions (n)"** dropdown sits at the
bottom of the quote panel. Picking a version shows its total, freeze
date, sent status and note. It offers **Download PDF (vN)**, rebuilt
from that version's own frozen figures, so it prints exactly as quoted.
It also offers **Cutting list for vN →**, or says the version predates
saved cutting lists.

Deliberately not offered for older versions: **Share on WhatsApp**. It
stays on the latest version only, because sending a customer an
outdated quote should take a deliberate re-freeze, not a misclick in a
history list (and `sent_at` records the first share of the version
that was sent). One screen test covers it. It was checked by making the
PDF button download the latest version instead of the one picked, and
the test failed as it should. 111 tests.

## 68. The UI overhaul's design system ("Calm workshop") goes in as theme tokens first

You said the app is unusable as it is and asked for a professional
redesign of every screen. The plan is in `docs/UX_PLAN.md`, with mockups
linked there. You approved the look and the editor layout on 3 Oct, and
the UI principles are now in `PRINCIPLES.md` Part 1.

**First build step: the theme only.** The shadcn CSS variables in
`src/index.css` now hold the "Calm workshop" values:
- Paper #F6F5F2 background, Ink #1D1C1A text
- Forest #1F5C4A primary, with a Forest tint as accent
- Brick #B42318 for destructive
- New `warning` / `warning-soft` / `warning-foreground` (Brass), `info`
  and `success` tokens, because shadcn has no slot for "attention"

Fonts: Plus Jakarta Sans for text, JetBrains Mono for measurements (via
`@fontsource-variable`, bundled rather than loaded from Google, so the
app works offline). Geist was removed.

Why theme first: every screen picks it up with no layout change, so the
risky part (restructuring the editor) starts on the final colours and
type. What it does NOT fix yet:
- hard-coded `text-[11px]` sizes and raw Tailwind greys such as
  `text-gray-500`, which ignore the tokens
- 32px button heights

Those go screen by screen as each one is rebuilt. Rule for that work:
use the tokens (`text-muted-foreground`, `bg-warning-soft`), never raw
greys or hex values, so a later palette change stays one file.

## 69. Two pipeline end stages: Installed, and Lost with a reason

Reviewing the Home mockup showed the pipeline had no end: "In
Production" was the last stage, so a finished job stayed active for
ever, and a customer who said no had nowhere to go. You agreed to two
additions on 3 Oct:
- **Installed** ends a job.
- **Lost** requires a **reason** (price, went elsewhere, postponed,
  other) plus an optional note.

A job in production also gets an **install date**.

**Data.**
- New `projects` columns: `lost_reason`, `lost_note`, `install_date` and
  `status_changed_at`. `status_changed_at` is backfilled from
  `updated_at`, and is needed for "follow-up due" and "installed in the
  last 30 days".
- The status check is dropped and re-added in `schema.sql`. The inline
  check on `create table if not exists` never changes an existing table,
  which is a trap worth remembering for any future change to an
  existing constraint.

**The new columns are written only by `lib/customers.ts`'s dedicated
updates, never by `projectToRow`.** Two reasons:
1. A project save keeps working on a database where `schema.sql` hasn't
   been re-run yet.
2. A stale copy of the project open in the editor can't overwrite a
   stage, reason or date set on the Customers page.

**A Lost reason is enforced by the type.** `updateCustomerStatus` takes
a `StatusChange` where `{status: 'Lost'}` must carry `reason`, so a
screen can't forget to ask. Leaving Lost clears the reason. The current
customer list offers Installed but not Lost: the reason picker comes
with the rebuilt Customers page.

**Home's cards follow from this (your correction).** "Approved jobs
(open)" counts every job approved and not yet installed, started or
not, with the split shown. It was not "approved this month", which is a
sales report, not daily work.

## 70. App shell, Home and Customers built

The first screens of the UI overhaul, built from the agreed mockups.
- **`AppShell`** wraps the four business pages: Home, Customers,
  Catalogue and Settings. It shows a labelled sidebar on a laptop (lg),
  an icon rail on a tablet (md) and a bottom tab bar on a phone. The
  design editor and its sub-screens stay outside the shell as a
  full-screen workspace; its back button now says "← Customers".
- **`lib/pipeline.ts`** holds every pipeline rule as pure, tested
  functions, so Home and Customers can't disagree:
  - Home's four cards
  - follow-ups: a stage older than 3 days, or in production with no
    install date
  - "Continue designing"
  - Installed on the board for 30 days
- **Home**: greeting, the four cards (including "Approved jobs (open)"
  as you corrected it), the first-run checklist (restyled), the
  sample-rates banner, Follow up with one action each (WhatsApp, Start
  design, Open design, Set date), and Continue designing.
- **Customers** replaces the old dashboard table and keeps everything it
  did: search, add, open the design, change stage, sent-quote history
  and 360° views.
  - Board columns, with drag to move (desktop), plus the same actions
    in every card's menu (touch).
  - A list view, which is the only view on a phone.
  - A Lost filter.
  - The Lost reason and install date dialogs.
- **Settings** has three tabs: Rate card (moved out of the catalogue
  page), Workshop, and Account (sign out). The catalogue is now only
  what you pick from when designing. The placeholder-rates warning moved
  with the rate card, and Home repeats it until the rates are replaced.

**Tried and dropped: submenus in the card menu** ("Move to…" opening a
second menu). Radix closes a submenu when the pointer leaves its
trigger. That made the screen test fail, and on a phone nested menus
are fiddly anyway. The stages are listed directly in the menu instead.

**Security fix found along the way:** the `businesses` table had RLS
off, and Supabase serves such a table to anyone holding the public anon
key, so every business's name was readable. It now has RLS (members
read their own row; super admins read all), added in `schema.sql`. The
shell reads the business name from there.

**Touch sizes:** new Button sizes `touch` (44px), `touch-lg` (48px) and
`icon-touch`, added alongside the dense ones, so screens not yet rebuilt
keep their layout.

Tests: 6 pipeline-rule tests and 3 screen tests (Home cards and
follow-ups; Lost needs a reason; other stages change directly). 122 in
total. The screen test fails if Lost is allowed without a reason
(checked by breaking it). **Not yet seen in a browser** at any of the
three sizes.

## 71. Catalogue page redesign, sidebar sub-list, cutting list from Customers

Your review of the first shell screens: they "look fine, not great". You
asked for:
- the Catalogue's sections as a sub-list in the sidebar
- a properly designed Catalogue page (headings, descriptions, boxes,
  colours, partitions)
- an answer to where the cutting list and the other screens now live

**Catalogue.**
- **One frame per section (`CatalogueSection`).** Each section is a
  card with:
  - an icon tile, the title and an item count
  - ONE line saying what it's for
  - a divider before the content
  - the old explanation paragraphs (11px, up to five sentences each)
    behind a "How this works" toggle, rewritten shorter
- **Section order: most used first.** Cabinets, Appliances, Finishes,
  Handles, Light fixtures, Pillars & shafts. This replaces the old
  "dependency order" (finishes before the cabinets that use them),
  which served the code, not the person; nothing breaks if a finish is
  added after a cabinet.
- **Tables restyled with design-system tokens.** 14px text, roomier
  cells, and theme colours (secondary header row, muted text, destructive
  and success colours) instead of raw greys. The Excel panels became
  dashed "secondary" boxes. This was a mechanical class mapping across
  `components/inventory/*`, which also restyled the rate-card editors
  that moved to Settings.
- **The sidebar sub-list.** Under Catalogue, while it's open, the
  sections are listed and scroll to on click, with the current section
  highlighted (an IntersectionObserver scroll-spy). Tablet and phone
  have no room for it, so the page has a sticky chip bar instead. The
  section list lives in `catalogueSections.ts`, so the page, the sidebar
  and the toolbars' "Manage" links agree.

**Cutting list from Customers.** An Approved or In-production customer's
card menu now has "Cutting list", which loads the project and opens its
cutting list without going through the editor. It's the workshop's way
in. The editor's own link stays.

Not seen in a browser yet.

## 72. Production page (the workshop's view)

You agreed to a page for the workshop. It's called **Production** in
the sidebar, not "Workshop": Settings already has a Workshop tab (the
construction rules), and two different things called Workshop would
confuse.

The page lists every Approved and In-production job, soonest install
date first, grouped "In production" then "Approved, not started". Each
row has:
- **Cutting list**, which opens the job's cutting list with print,
  labels, glass order and Excel
- the install date, highlighted if it's missing or past
- one button to move the job along: Start production → Mark installed

The cutting list's Back now returns to wherever it was opened from:
the design, Customers or Production (`cutListReturn`). The phone tab bar
now has five items.

Also explained on review: **the two Cabinet Designers are one screen
with two scopes**. From a catalogue row it edits the template that
future cabinets start from; from a placed cabinet it edits that cabinet
in that kitchen only. Today the scope shows only as small grey text
under the title. When the Designer is rebuilt it gets a coloured banner
naming the scope.

1 test (123).

## 73. Premium A ("Atelier") applied; Rate card and Workshop on the sidebar

You chose **Premium A** over B (Editorial, serif), after saying the
first screens weren't "premium enough to show" a customer. Applied to
everything built so far:
- **Theme tokens (`src/index.css`).**
  - The sidebar tokens are now dark forest #10261F with brass #C8A24A
    (mark, current-page dot, phone active tab).
  - New tokens: `brass`, `shadow-card` (soft two-layer), `shadow-float`
    and `shadow-cta`.
  - Paper is #F7F6F3.
- **Cards float on `shadow-card` instead of a grey outline**, across
  Home, Customers, Production, Catalogue sections and the checklist.
- **Page headers**: an uppercase letter-spaced eyebrow over an
  extra-bold, tightly tracked title.
- **Home**:
  - The four numbers are one hairline-divided white strip, not four
    equal boxes.
  - "Continue designing" cards are topped with the **design's main
    material**: the finish most of its cabinets use, as its photo, its
    generated texture, or its colour (`lib/designFinishes.ts`; one small
    `layouts` query for up to 6 projects, best-effort).
  - Follow-up avatars are tinted.

**Navigation (your order):** Home · Customers · Production · Catalogue
· **Rate card** · **Workshop** · Settings.
- Rate card and Workshop moved out of Settings onto the sidebar, and
  Settings now holds only the account.
- The standalone `workshop` view and `WorkshopSettingsPage` are gone.
  The Workshop sidebar page replaces both, and opening it from a cutting
  list shows "← Back to cutting list".
- **Phone**: seven tabs don't fit, so it shows Home, Customers,
  Production and Catalogue, plus **More**, a bottom sheet with Rate
  card, Workshop, Settings and Sign out.

Tests: 2 for the material picker (125 in total). **Still not seen in a
browser**: no screenshot tooling exists yet (see STATUS).

## 74. Playwright screenshots, so screens are looked at before you see them

Every screen until now was built from code alone. That's likely part of
why the first version read as "fine, not great". **`npm run screens`**
(Playwright, Chromium) starts its own dev server on port 5199, signs in
with a **separate test login**, and photographs every shell page at
laptop (1440×900), tablet (iPad landscape) and phone (iPhone 13). The
photos go to `e2e/screens/<device>/`, git-ignored.
- Read-only by design: it navigates and looks, and never writes data.
- Credentials: `E2E_EMAIL` and `E2E_PASSWORD` in `.env.e2e.local`
  (git-ignored). Setup is in `docs/SUPABASE_SETUP.md` Step 5b. Without
  them, only the sign-in screen is captured.
- Vitest now excludes `e2e/`, so the two runners don't pick up each
  other's files.
- The same setup is where the planned browser tests will live.

**First use: the sign-in screen**, which was still the plain old design
(sign-in was planned last, but it's the first impression and cheap). It
is now Premium A: a walnut material panel with the product line on
tablet and laptop, and a large brand mark, "Welcome back" and 48px
fields and button. It was checked by screenshot at all three sizes
before committing; this is the first screen in the overhaul that
genuinely was.

## 75. First screenshot pass: phone overflow (four causes) and the Customers board

The first full `npm run screens` with the test login looked at every
page at three sizes. **Every page on a phone was checked; five pages
were wider than the screen**, so the page scrolled sideways and the
bottom tab bar couldn't be tapped. There were four different causes,
all now fixed:
1. **A CSS grid with no base column count** (`grid lg:grid-cols-…`)
   sizes its one phone column to its widest content, so long follow-up
   lines widened Home. The fix is `grid-cols-1` (`minmax(0,1fr)`),
   applied to every such grid in `src/components`, including three
   (cutting-list sheets, Cabinet Designer, the Customers skeleton) that
   hadn't bitten yet.
2. **`<fieldset>` defaults to `min-width: min-content`.** The rate
   card's Boards fieldset couldn't shrink. Fixed once, globally, in
   `index.css`.
3. **Fixed-width grid columns** in the board rows (`1fr_6rem_7rem…`),
   with a dropdown that wouldn't shrink. The first column is now
   `minmax(0,1fr)` with narrower number columns on phones.
4. **Non-wrapping buttons with long labels** (the waste switch). They
   now wrap.

**Overflow is now a permanent browser check.** Every screenshot asserts
the page is no wider than the screen, and on failure it names the
widest element and its ancestors. That's how causes 2 to 4 were found
in minutes instead of by guessing.

**Customers board:** six columns squeezed into the width cut names off
("Rohan M…") and wrapped status lines badly. The columns are now a
fixed 280px and scroll sideways when they don't all fit. A card with no
total shows nothing (it used to show "—"), and the status reads "Quote
sent 44 days ago".

**Seen and still not premium (next):**
- **Catalogue:** about 70 cabinet rows (plus 44 appliances), each a
  permanently open edit form. Names are clipped in tiny inputs and the
  tables scroll sideways inside their boxes. It needs read-only rows or
  tiles with editing in a side panel.
- **Rate card:** still the old dense layout with long paragraphs.
- **Business name:** shows the seed "My Business". There's no screen
  to set it yet.

## 76. Catalogue: read-only lists, one edit panel

The screenshots showed what still wasn't premium: about 90 cabinets, 44
appliances and 36 handles, each a permanently open form row of tiny
inputs. Names were clipped and the tables scrolled sideways inside their
boxes. Now every section is a **read-only list, and tapping a row (or
"+ New") opens one `EditPanel`**. The panel slides in from the right on
laptop and tablet and is full screen on a phone. It has large labelled
fields, and a fixed footer with Delete on the left and Cancel and Save
on the right. (UI principle 4: one way to edit a list.)
- **Cabinets**: search, category chips, and rows showing the finish
  swatch, name, type · category · size, board, finish and price. The
  panel has every field plus "Panels & boards…" into the Designer.
  - Rule kept: a save takes `panels` from the CURRENT stored row, never
    the copy taken when the panel opened (§45), so it can't undo a
    Designer change made meanwhile.
- **Appliances**: search, type chips, a type icon, and the 3D-model
  settings grouped in their own box. Orientation is named by what you
  see ("Lying on its side"), as before.
- **Handles**: a colour dot and price per piece or per metre. Rules
  kept: the kind preselects how it's priced, and the default handle
  can't be deleted (the panel says why). A length shows only for bars
  and knobs; it used to read "0 mm" on profiles.
- **Light fixtures**: the light's own colour glowing on a dark tile,
  plus K and lm.
- **Finishes**: picture cards. A generated finish now shows its
  texture's real colour map, not a yellow "wood" placeholder. The full
  finish editor (photo upload, relief, gloss sliders) moved into the
  panel.
- **Pillars & shafts**: the same list and panel.

Shared pieces: `EditPanel`, `Field`, `NumberField` and `TextField` in
`common/EditPanel.tsx`; `CatalogueKit.tsx` (search, chips, row, tiles);
`useItemEditor.ts` (copy, save, delete with confirm). `InventoryManager`
went from 1,422 lines to 192.

Dropdowns need `h-11!`: the trigger's own `data-size` height outranks a
plain `h-11`. The screenshot showed them shorter than the text boxes.

**Seen in the data, not fixed:** most handles appear 3 or 4 times, often
differing only in capitals ("Bar handle 128mm — brushed steel" vs "Bar
Handle 128mm — Brushed Steel"), and some cabinets and fixtures repeat
too. It looks like seed rows plus repeated Excel imports. Deleting is
the user's call, because cabinets reference handle ids. A duplicates
tool has been offered.

The screenshot run now also opens and cancels a cabinet's panel, and
photographs each Catalogue section.

## 77. Rate card redesigned

It was the old dense layout: tiny fieldset legends, paragraphs of
explanation, 32px inputs, and two Save buttons. It's now five
`SectionCard`s, each with one line on what it's for and the long text
behind "How this works":
- Labour and other charges
- Hardware
- Boards
- Sheet waste and edge banding
- Glass doors

`SectionCard` is the Catalogue's section frame (§71) made general;
`CatalogueSection` now wraps it.
- **Rate rows**: a label with its unit underneath ("Hinge" / "each"),
  and the rate in a 44px box with ₹ inside it. Glass tints get a colour
  chip.
- **Charges**: each charge is a card. Name and ₹ amount sit on top;
  underneath are a Per sq ft / Per cabinet / Lump sum switch and the
  Show on quote / Add margin ticks. This is a new `comfortable` mode of
  `NamedAmountList`. The quote sidebar keeps the compact one-line rows
  because it's narrow.
- **Boards**: each line is a card with labelled Material, Thickness (mm
  inside) and Rate (₹ … /m² inside), and its sheet sizes as chips.
  Default back board is a proper labelled row.
- **Waste**: Approx and Calculated are two large choice cards with a
  one-line explanation each.
- **Save**: one action. While there are unsaved edits it floats at the
  bottom of the screen as a dark bar with Discard and a brass Save. The
  old top Save is gone (the reason the bottom bar is sticky is recorded
  in the code). The placeholder-rates warning uses the warning tokens.

Three screen tests were updated for the new wording and the single Save
button; what they check is unchanged.

## 78. Business details in Settings

The sidebar showed the seed name "My Business", and there was no screen
to change it. Settings now has two `SectionCard`s:
- **Business**: an editable business name with its own Save. A logo
  for the quote PDF is noted as coming later.
- **Account**: who is signed in, and Sign out.

`authStore.renameBusiness` updates `businesses.name`. That needed a new
RLS policy in `schema.sql`: a member may update only their own
business. **Trap handled:** RLS turns a refused update into "0 rows
changed", not an error, so the function checks the returned rows. If
there are none, it says "re-run supabase/schema.sql" instead of
reporting a save that didn't happen.

## 79. Waste factor explained with your numbers; Workshop page redesigned

**You asked whether 1.10 means quote = 1.1 × area × rate.** Yes, but
for **board only**. Confirmed in `calculateBOM`:

> board cost = area × board rate × factor

Labour and other per-sq-ft charges, finishes, hardware, handles, glass
and edge banding are not multiplied, and margin is added on top
afterwards. The rate card now says exactly that, under the factor,
followed by a **live worked example** using the business's own first
carcass board and factor: "10 m² of HDMR 18mm at ₹1,400/m² = ₹14,000 ×
1.10 = ₹15,400 of board on the quote, before margin. A ₹150/sq ft labour
charge stays ₹150/sq ft." When the business is on Calculated, the
example also explains the measured factor: sheets bought ÷ board the
parts use. The code confirms that definition: `sheetsAreaSqM /
partsAreaSqM` in `measuredBoardWaste`. A draft wording that said "18%
unused → 1.18" was wrong (that's about 1.22) and was corrected before
commit.

**Workshop page, the same treatment as the Rate card.** Five
`SectionCard`s: Cabinet depth, How the carcass is joined, Fronts, Drawer
boxes, Cutting sheets.
- **Every choice is a set of large option cards, each with a worked
  example cut by `cabinetCutParts` itself**, using the draft settings
  with that one choice changed. So an example can never disagree with
  what the workshop is told to cut. On a 600 × 600 × 720 base unit with
  18mm board:
  - bottom between the sides is 564 × 582 with sides 720 × 582; sides
    standing on it gives 600 × 582 with sides 702 × 582
  - back: grooved 700 × 580, nailed on 720 × 600, inset 684 × 564
  - tandem drawer bottom 540 × 489 and back 477 × 176, against wooden
    side 550 × 196 and bottom 530 × 519
- **Sizes**: roomy rows with mm inside the box and a line saying what
  each is for. Only the chosen drawer system's sizes show.
- **States**: an "assumed, not confirmed" warning; "Confirmed and
  locked" with Change settings; a confirmation tick card; and the same
  floating save bar as the Rate card.

## 80. Possible duplicates: find and merge, safely

You said the duplicate finding named something you'd sensed but
couldn't put into words. The data has **60 groups, 110 extra copies**
(handles, cabinets, fixtures and more): seed rows plus Excel imports
run more than once.

**What's a duplicate.** Same name, ignoring capitals, spacing and dash
style ("Bar Handle 128mm — Brushed Steel" = "bar handle 128mm - brushed
steel"), AND the same kind: a handle's kind, a fixture's kind, an
appliance's type, a cabinet's type and size, a pillar's type and size.
Same name with a different size is not a duplicate. The rules are pure
and tested (`lib/duplicates.ts`).

**What a merge must move first** (found by tracing references):
- handles: catalogue cabinet rows (`handleId`), and every placed
  cabinet in every saved design (`layouts.cabinets`)
- fixtures and appliances: every placed item's `catalogItemId`
  (`layouts.fixtures`, `layouts.appliances`)
- cabinets and pillar presets: nothing points back (a placed cabinet
  copies its row), so copies are simply removed
- finishes: left out for now. They're referenced from cabinets, walls,
  floor and countertop, and none are duplicated.

**Order: move references, then delete.** A failure half-way leaves an
extra row, never a reference to something gone. The steps:
1. Saved designs are read fresh and only changed rows are written
   (`repointDesigns`).
2. The open design in memory is patched too, so autosave can't write
   the old ids back.
3. Catalogue rows are updated.
4. Only then are the copies deleted.

Frozen quotes are never touched. A screen test pins the order: it fails
if a copy is deleted before its references move (checked by reversing
the order).

**Review panel** (banner at the top of the Catalogue, then Review): each
group shows its copies with price and size and "Used: 3 in 2 designs ·
1 catalogue cabinet". You pick the one to keep:
- The suggested pick is the default handle if it's in the group (it
  can't be deleted, so the copies can't be picked instead), else the
  most used copy, else the oldest.
- **Groups whose copies differ in price or size are flagged** "Copies
  differ, check the one kept". The three "Base Cabinet 1200" are
  ₹17,800, ₹17,800 and ₹10,052, and "oldest" picks ₹10,052. "Merge all"
  says how many groups differ before it runs.

**Not yet run on real data.** It's tested with the network mocked, and
the panel was screenshotted open and closed without merging. Known edge
case: undo history taken before a merge could restore an old id. That's
harmless, because the item would show the default handle, but it's
noted here.

Also: Rate card and Workshop now use the full page width, like the
other sidebar pages (they were capped at 5xl and 3xl).

**Follow-up (4 Oct, your request):**
- **"Merge all" closes the panel at once** and runs in the background
  behind one notice ("Merging 58 groups…", then "Merged 58 groups"),
  instead of showing groups vanish one by one. The picks are fixed
  before the panel closes, and `mergeGroup` is now module-level so it
  doesn't depend on the panel staying open.
- **Each group has an "Include in Merge all" tick**, on by default; the
  button reads "Merge N selected" when any are unticked.
- A single group's Merge still runs inside the panel. A test covers
  unticking one group: the panel closes and only the ticked group
  merges.

## 81. Design editor, stage 1: the frame

The old editor page stacked seven toolbars, four display checkboxes, the
canvas, every inspector and the quote side by side, with 3D and
Elevation as separate full-screen pages. It's now **`DesignEditor`**,
built to the agreed mockup:
- **Top bar**: back to Customers; the customer; **Plan / 3D /
  Elevation as views inside the editor** (the separate `preview3d` and
  `elevation` screens are gone); saved state (click to save now); Room;
  Cutting list; Present.
- **Left rail**: Cabinets, Appliances, Pillars, Doors, Lights, Cameras,
  Surfaces. **One tool panel open at a time**; tap again to close. It's
  open on a laptop and closed by default on a tablet or phone, where it
  would cover the plan.
- **Centre**: the plan now **fills the available space**. Every Konva
  layer gets the same measured `maxWidthPx`/`maxHeightPx`
  (`useElementSize`, a callback ref), so they keep sharing one scale. It
  used to be a fixed 800 × 600.
- **Right**: the inspector for the selection (by `selection.type`, so
  the cabinet inspector's "select something" placeholder no longer shows
  beside another type's inspector), otherwise the quote. Below xl it's a
  slide-over.
- **Bottom bar**:
  - a design-checks button with a count; its popover holds the alerts
    and the four display switches (their reasoning moved here verbatim
    from App.tsx)
  - undo/redo
  - the live total (tap it for the quote)
  - **Finalise quote**, which shows the quote and scrolls to its
    freeze-and-send section (`#quote-finalise`)

Stage 1 deliberately reuses the existing tool panels, inspectors and
quote inside the frame; they're rebuilt in stages 2 and 3, with
tablet/phone touch layout in stage 4.

**Found by screenshot and fixed before commit:**
- the phone bottom bar overflowed (Finalise cut off); it now shows the
  check count only, hides undo/redo and uses a shorter label
- "Finalise  quote" had a gap between the words (two flex children
  inside the button)
- the phone checks button had no accessible name once it showed only a
  number

Two lint traps: the React Compiler rejects reading a ref during render
(hence the callback ref), and its rule treats any property whose name
ends in "Ref" as a ref, so it's called `measure`. The screenshot run
now opens a priced design and photographs Plan, 3D and the checks
popover at all three sizes.

**Seen in data:** chimney catalogue rows point at
`/models/range-hood.glb`, which isn't in `public/models`, so the 3D view
falls back to a box.

## 82. Editor overlay fix; elevation embedded; the 3D wall view

**Overlay (you found it):** the Room pop-up slid under the quote panel.
The top bar is now `relative z-40`, so its pop-ups always sit above the
editor body. Reproduced first by screenshot at 1440 and 1280 wide, then
checked fixed.

**Elevation inside the editor.** `WallElevationView` gained an
`embedded` mode: no "Back to 2D" (Plan is a tab), the wall chosen by the
editor, and a width from the space it's given. It used to be a fixed
900px, which cropped it inside the editor.

**The 3D wall view (your request, "like other popular tools").** The
Elevation tab now has **Drawing | 3D** plus North / East / South / West
wall chips, shared by both modes. In 3D, `Room3DCanvas wallView`:
- **places a camera across the room from the wall, facing it**, pulled
  back so the whole wall fits a 16:9 frame (`WallViewCamera`; the
  distance comes from the 40° field of view and the wall's length and
  height)
- **leaves out the wall behind the camera**, so it doesn't block the
  view
- shows everything on that wall in real finishes and lighting, with a
  little of the side walls for depth
- still lets you orbit and zoom around the wall's centre
- hides the walkthrough and capture controls and the camera floor
  markers

It reuses the whole 3D renderer, so materials, lighting modes and models
are identical to the 3D view. It's checked by screenshot on a real
design (the West wall of Neha Verma's kitchen), and the screenshot run
now photographs it at all three sizes.

## 83. Cutting list page redesigned

- A sticky header: back; a "CUTTING LIST" label over the customer; a
  version picker; and **Excel / Labels / Print** at full size, with
  Print as the primary.
- Views as a segmented switch, and a stats strip: pieces, cabinets,
  boards, board area, edge banding, and glass when present.
- Each board, the glass order and loose parts are `SectionCard`s.
  Tables use larger text with monospace, right-aligned numbers;
  cabinet numbers are tappable chips that open the Designer; grain is a
  badge.
- The Sheets view summary, waste and sheet drawings are cards.
- Frozen and assumed-construction states are token-coloured banners.
  The warning's button wraps below the text on a phone.

The editor now shows a Cutting list icon on tablet and phone; before,
there was no way to reach it from a design on those screens (found by
the screenshot run). The screenshot run photographs all three cutting
list views.

## 84. The 3D wall view becomes a real elevation; quote panel toggle; download labels

**3D wall view (your correction): not a camera across the room, but
the room taken apart.** It now draws **only the chosen wall** (no side
walls, far wall or ceiling) and **only the items standing against it**,
in full 3D with real finishes. **Corner pieces that belong to the
neighbouring wall** (they touch this wall, but their back is against the
other one) are drawn as **translucent grey blocks at the edges**, so you
see something turns the corner there.
- The rule lives in `lib/wallView.ts`, tested. "Against a wall" is the
  same 60mm test the 2D elevation uses (`isAgainstWall`), so the drawing
  and the 3D view agree. An item's back wall comes from its rotation.
- A test fixture got the rotated-corner trap wrong first: x/y are the
  UNROTATED corner, so a turned unit's stored position isn't where its
  footprint lands. The fixture is fixed and commented.
- The camera uses a narrow 28° lens, square to the wall, so it reads
  close to a flat elevation while keeping 3D shading. Camera markers and
  walkthrough targets are hidden.

**Quote panel open/close** on every screen size: a **Quote** button in
the editor's top bar and a close × on the panel. It's open by default
on a wide laptop (1280px and up), otherwise closed. Selecting an item
still shows its inspector.

**Cutting list downloads labelled**: a "Download" caption and clearer
names: Excel sheet, Part labels PDF, Cutting list PDF, each with a
tooltip saying what it downloads.

2 tests (134).

## 85. Design editor, stage 2: tool panels

- **Cabinets**: search, category chips and a 2-column grid of **picture
  tiles**. Each picture is a `CabinetThumb`: a front drawing generated
  from the cabinet's size and front (single/double door, drawers, open
  shelves, trolley, appliance opening), in proportion, wall units hung
  at the top, and **filled with its finish's real texture or colour**.
  The tile shows name and size. Tap to add, with a note saying where it
  went and to drag it into place.
- **Appliances**: type chips, tiles with a type icon (hob, chimney,
  sink, fridge…), and an "In this kitchen" list with remove.
- **Pillars & shafts**: **your presets as one-tap tiles**, then a
  "Custom size" card (type, width and depth with mm inside, floor to
  ceiling, height and height off the floor) and an "In this room" list.
- **Doors, Lights, Cameras, Surfaces**: a consistent restyle. The
  editor's panel is now the frame (their own boxes are gone), with
  larger text, token colours, full-size dropdowns and roomier inputs.
  These are mostly settings rather than catalogues, so they stay as
  forms.

The screenshot run now photographs every tool panel.

## 86. Design editor, stage 3: inspectors and the quote panel

Laid out for designing WITH the customer.

**Cabinet inspector**: name and size at the top, then four large quick
actions (turn left, turn right, duplicate, delete), then what the
customer chooses:
- **Finish as big swatches**: the real texture or colour, a tick on the
  current one, the type as a caption. It's one grid, not grouped under
  type headings: grouping left one swatch per row with a small
  catalogue (tried first, then dropped).
- **Front as nine picture tiles**, each drawn in this cabinet's own
  size and finish (`CabinetThumb`, which now also draws mixed rows,
  tambour slats and a handle-less false front).

Below those come workshop settings: size (always visible, with an
"Apply new size" button that appears only after a change), height off
the floor, board, and Panels & boards. The two alert switches are
folded under "More". The other inspectors (appliance, pillar, light,
door) and the rest of the front picker get the token restyle.

**Quote panel**:
- Margin, sheet waste, the charge editor and the Selling/Cost switch
  move into one fold, **"Your pricing (not shown to the customer)"**,
  closed by default. Closing it returns to Selling, so the panel can't
  be left in Cost view by accident. Cost view shows an amber "these are
  your costs" note.
- "Includes 25% margin" under the Grand Total now appears only in
  Cost view; it gave the margin away to anyone reading the screen.
- Cabinet lines are stacked rows (name and price, then size, front and
  handle, finish, hardware) instead of a five-column table squeezed
  into 400px.

## 87. Design editor, stage 4: phone layout

Tablet already worked (rail, slide-over panels, 44px targets). The
phone didn't: the top bar ran off the right edge, and the tool rail ate
a fifth of the plan's width.

- **Top bar**: back, view tabs, a Room icon (`RoomSettingsPanel
  compact`), and a **More** menu holding Cutting list, Quote and
  Present. Before this, the Room button was simply hidden on phone,
  so room size couldn't be changed there at all.
- **Tools**: a strip of tabs along the bottom, above the total.
- **Tool panels**: a **sheet rising from the bottom** (rounded, up to
  62% of the height), leaving the top of the plan visible.
- The quote and inspector panel was already full width on phone.

Small item: "+ Add part" (Loose parts / Cabinet Designer) is now a
normal-size button with an icon.

The screenshot run photographs the phone tool sheet and More menu, and
opens the cutting list through the menu.

## 88. Editor and cutting-list fixes from review

- **Room button toggles.** A second press closes the room pop-up, the
  same as the Quote button.
- **"Show on the plan" has its own button.** The four display ticks
  (dimensions, overlaps, clearances, ergonomics) moved from the checks
  pop-up to a **Show** button (layers icon) at the plan's top-right.
  They're view settings, not design problems. The bottom-left checks
  button now opens only the list of problems.
- **Cutting-list downloads, second try.** §84 added a "⤓ DOWNLOAD"
  caption beside the buttons, but a caption with a download icon reads
  as a button that does nothing, so it's gone. Each button now carries
  the download arrow instead (Excel sheet, Part labels PDF, Cutting
  list PDF), with a tooltip naming the file.

**Cabinet pictures need no image file**: `CabinetThumb` draws the
front from the catalogue row's type, size, front layout and finish, so
a new catalogue cabinet appears with its picture straight away, and
editing those fields changes it.

## 89. Present mode in the editor's frame; plan centred; "Guides"

- **Present mode rebuilt** (it had never been restyled). Top bar: Back
  to design, a 3D walkthrough / Floor plan switch, and Reveal price.
  The view fills the screen. **The price opens as a panel on the
  right**, like the editor's quote panel (a slide-over below 1280px),
  with the total large and a "Price breakdown" fold. It used to appear
  as a card at the top centre and push the whole view down when
  revealed. Still selling figures only, never cost or margin.
- **The plan is centred in its space.** `computeRoomScale` always put
  the room at the top-left padding, so a wide space left the plan
  hugging the left edge (obvious in Present mode, hidden in the
  narrower editor). The origin is now centred on both axes, never
  closer than the padding. Every layer reads `originX`/`originY` from
  there (checked: all 9 users), so they move together. Tested
  (`canvasScale.test.ts`).
- **"Show" renamed "Guides".** Dimensions, overlaps, clearances and
  ergonomics are drawing aids over the plan, not part of the design;
  "Guides" is the usual word for those in design tools. Alternatives
  considered: Layers (suggests the items themselves), View (clashes
  with the Plan/3D/Elevation tabs), Overlays (jargon).

## 90. 3D view controls restyled

- **"Look from"** (was "Viewpoint") is a full-size select, with one
  plain hint line under it. The hint is about floor markers only when
  the design has cameras; otherwise it explains drag to turn and pinch
  to zoom.
- **360° photos** fold: the camera select, Capture / Capture again,
  View 360° and Delete (an icon), with the calibration settings
  (mirror, flip, exposure, walkthrough lens) below them. Capturing is
  occasional, and the controls took half a phone screen. Same
  component in the editor's 3D tab and Present mode.
- The 3D frame, the 3D cabinet overlay (`Cabinet3DInspector`) and the
  360° viewer get the token restyle.
- **Bug fixed: the phone's tool strip was squashed in 3D view.** The
  editor's `<main>` lacked `min-h-0`, so in the phone's column layout
  the 3D content pushed the strip down and cut off its labels. The plan
  view didn't show it because its container already had `min-h-0`.

## 91. Drag to place, with auto-turn against walls

Before this, adding a unit meant clicking its tile, finding it in the
middle of the room, and dragging it again. Now you **press a tile in
the Cabinets, Appliances or Pillars panel and drag it onto the plan**.
A dashed outline shows where it will land, with a solid bar on its
front edge. A label under the pointer says what you carry and which
wall it will go against. Letting go adds it there. A plain click still
adds in the middle, and Escape cancels.

**Where it lands** (`lib/placement.ts`, 11 tests, mutation-checked):
- Under the pointer, clamped into the room. A drop up to 400mm
  outside still counts; farther out cancels.
- **Auto-turn**: within the unit's own depth of a wall (at least
  600mm), it turns so its back is against the nearest wall and slides
  flush (north 0°, east 90°, south 180°, west 270°, matching
  `frontDirection`). In the open it keeps 0°. Pillars and shafts never
  turn.
- **Cabinets snap like a plan drag** (`snapCabinetFootprint`), in
  PHYSICAL size, then convert back to the stored corner (§61). Skipping
  the conversion would place every drop half a shutter off under
  carcass-only depth; a test pins this for the north and south walls.
  The new cabinet is passed to the snapper too, so a wall unit isn't
  pushed off a base unit below it. Appliances turn but don't snap,
  same as their plan drag.

**The gesture** (`components/editor/placeDrag.ts`):
- Mouse: a drag starts after 6px of movement.
- Touch: a drag starts after a 250ms hold or a clearly sideways move.
  An early vertical move is a scroll and ends the gesture, so scrolling
  the tiles never picks one up. Once dragging, the page's own scrolling
  is cancelled.
- Window listeners rather than pointer capture: on a phone the tool
  sheet hides during the drag so you can see the plan, and a hidden
  element can't be relied on to keep getting events.
- The click a tile would get after a drop back onto itself is
  swallowed, so it can't add a second unit.
- Plan view only: the plan registers a resolver while it's on screen;
  without one, tiles don't start a drag.

**Verified**: the maths by tests. The mouse drag was seen in a browser:
the preview pulls flush to the north wall, turns and pulls to the west
wall, and in the open slides beside the cabinet it was over. The
screenshot run cancels with Escape, so nothing is saved.
**Not verified**: touch on a real tablet or phone (hold timing versus
scrolling), and appliance facing in 3D after a turned drop (the models
are meant to face +y at 0° like cabinets; not checked by eye).

## 92. Elevation views rethought; 3D pop-up only in Present mode

Your review: the drawing was meant for checking each item's size and
the space between items, and the 3D view for a better look. Both were
failing.

**Drawing: running dimensions** (`lib/elevationDims.ts`, 11 tests).
The old drawing was bare outlines in less than half the width, with
every number behind a click (chosen originally because labels on small
items cluttered). It now follows architectural elevations, with the
numbers OUTSIDE the drawing:
- the base run along the bottom (each item's width, gaps in amber);
- the wall-unit run along the top;
- key heights up the left (floor → counter → underside of wall
  units → their top → ceiling);
- the overall wall length.

A size too wide for its span (a 150mm filler) steps out to a second
row with a leader rather than vanishing. Items get light fills by kind
and their name and width inside when they fit. It fills the editor's
width, and the click-to-measure panel moved under the drawing.
- **A merge rule that broke on a real kitchen**: merging every
  overlapping span turned two 600 cabinets under a straddling hob into
  one "1200". Now each cabinet keeps its width, an appliance within
  the cabinet run is left out, and a free-standing one (a fridge) is
  its own span. Both cases are tests.
- On Neha Verma's west wall the chain shows what clicking never
  surfaced: an 18mm gap at the start, 15mm between two base units, and
  a 150mm filler (18+588+650+15+600+600+150+750 = 3371).

**3D wall view.** The wall *was* drawn; the problems were framing and
readability:
- **Sky-blue backdrop** around a narrow wall read as open air. It's
  now a neutral sheet, darker than the wall so the wall's edge shows.
- **Top cut off**: units stand 600mm proud of the wall, nearer the
  camera than the plane the fit was measured on. The lens is now 20°
  (was 28°), with a larger margin.
- **Corner pieces from the next wall** were whole translucent volumes
  that spilled over this wall's units in perspective. Now only the
  corner they occupy (650mm off this wall) is drawn, in opaque matte
  grey.
- **Ceiling pendants hung in front of the units.** The wall view now
  shows only lights on the units shown or on this wall.
- **Flat, washed-out fronts.** A light from the camera was tried first
  and made it worse. Now there's a key light from high on the left
  casting the units' shadows onto the wall, which is what gives depth.
- **Phone**: the frame fills the height that's left, and the camera
  fits the frame's real shape. A fixed 4:5 ran under the tool strip.
  The wall buttons read North/East/South/West on a phone.

**The floating cabinet panel over 3D appears only in Present mode**
(`inspectorOverlay`). The editor already shows the selection in its
right-hand inspector.

## 93. 3D wall view: backdrop chosen to contrast

You asked for a backdrop that contrasts with the wall: dark when it's
mostly white, light otherwise. `lib/backdrop.ts` (8 tests) works out
how light the wall view is and picks between two fixed tones
(`#4f4b45` dark, `#e8e5df` light):
- **Lightness** is perceptual (CIE L*), so a bright yellow and a pale
  grey of similar brightness count alike.
- **Each unit is weighted by its front area**, and the wall by what's
  left **uncovered**. Counting the whole wall let a large plaster wall
  outvote wood fronts in front of it.
- **Per surface**: the colour override, else the solid colour, else the
  texture kind (wood 0.45, quartz 0.82, tile 0.80, an uploaded photo
  0.55). No finish means bare plaster. The texture values are
  estimates, but the choice is only light-or-dark, so they just need
  to land on the right side.
- **Threshold**: an average lightness of 0.78 or more counts as a light
  scene and gets the dark backdrop.

Seen: Neha Verma's white units on plaster get the dark backdrop on
both walls. The light-backdrop case (wood fronts, a dark painted wall)
is covered by tests only; no saved design has one to look at.

## 94. Business profile on the quote PDF: name, phone, logo, GSTIN, ₹

**Found while planning the logo**: the PDF read its name and phone from
`.env` (`VITE_BUSINESS_NAME`), with a comment that there was no
`businesses` table. That stopped being true at §70, so a name set in
Settings never reached a customer, and two businesses would both print
`.env`'s name. Logged in ISSUES and fixed here.

**What's built:**
- **`businesses` gains `phone`, `logo_url`, `gstin`, `show_gstin`**
  (`schema.sql`, idempotent). Re-run it before these can be saved. The
  app detects the missing columns and says so in Settings instead of
  failing, and the name still loads and saves.
- **Settings → Business**: name, phone, GSTIN and "Print the GSTIN on
  quotes" (off by default: not every business is registered, or wants
  it on a quote), plus a **Logo** card (upload, replace, remove) and a
  preview of the quote header.
- **GSTIN is validated**, including the 15th check character (GSTN's
  mod-36 scheme), so one mistyped character is caught before it's
  printed. Tested against a published sample. Empty is allowed; ticking
  "print" with no GSTIN is refused.
- **Logo storage**: a new public-read `business-logos` bucket. Writes
  are limited to the business's **own folder**
  (`storage.foldername(name)[1] = current_business_id()`), so one
  business can't replace another's logo. (The older `material-swatches`
  policies only check "signed in", which allows exactly that; noted as
  a separate job.) The image is shrunk to at most 600×300 PNG in the
  browser before upload, with a new file name each time (no stale
  cache) and the old file removed.
- **The PDF header**: logo top-left, fitted to 120×48pt without
  stretching, with name, phone and GSTIN right-aligned beside it.
  Without a logo, the old arrangement. `generateQuotePdfBlob` now
  takes a **required** `PdfBranding`, so a call site that forgets it
  fails to compile (the PricingContext lesson).
- **₹ instead of "Rs."**: the PDF embeds the app's own font, Plus
  Jakarta Sans, instanced to static Regular/Bold (jsPDF can't use the
  variable font) and subset to Latin, punctuation, × and ₹: about 22KB
  each, in `public/fonts` with its OFL licence. Tables use it too. The
  embedded font has no italic, so italic lines print Regular. **If the
  font can't load, the PDF still generates** in Helvetica with "Rs.",
  because a quote must never fail to go out over a font.
- **Current, not frozen, branding**: re-downloading an old quote uses
  today's name and logo. Branding isn't part of a quote's figures; the
  prices, items and totals stay frozen as ever. (My recommendation,
  built as the default; you hadn't chosen yet. Freezing the branding
  with the quote instead is a small change if you'd prefer it.)

**Verified**: a real quote PDF downloaded from the app prints ₹ in Plus
Jakarta Sans and the name from the business record. The header with
logo and GSTIN is tested by reading the generated PDF back
(`quotePdf.test.ts`). It isn't seen with a real logo, because uploads
need the schema re-run first.

## 95. The logo in the sidebar too

The uploaded logo (§94) replaces the letter badge at the top of the
sidebar, beside the business name. It sits on a small white tile,
because most logos are dark or transparent and the sidebar is dark
green. Without a logo, or if the image fails to load, the badge shows
the first letter as before. Screen-tested (`AppShell.test.tsx`). The
phone has no sidebar header, only bottom tabs, so nothing changes
there. Not yet seen with a real logo: uploads need `schema.sql`
re-run first.

## 96. Customer notes

`projects.notes` existed in the schema and the save path from the
start, but nothing in the app showed it. You asked for notes when
adding a customer, and without a way to read them back they'd vanish
from view, so this does both:
- **New customer** form: an optional **Notes** box for anything
  (budget, timing, who decides, site access). It's trimmed on save.
- **Each card's ⋯ menu**: **Notes** (or **Add notes**) opens a dialog
  to read and edit. Blank clears them. `updateCustomerNotes` checks for
  the zero-row result a refused update returns, rather than reporting
  success.
- **On the card**: the first line of the notes with a note icon, on
  the board and in the wide list. Tap it to open the dialog. Notes
  are team-only and never printed on a quote.

Screen-tested: a new customer saves trimmed notes, and notes show on
the card and save from the menu.

## 97. Image brief: the 3D view, exported for a photo-realistic render

**What.** An **Image brief** button beside "Look from" in the 3D view
downloads two files:
- `<design>-render-view.png`: exactly what's on screen. Camera markers,
  hotspots and the selection outline are hidden for the shot.
- `<design>-render-brief.json` (`kitchen-render-brief/v1`, built by
  `lib/renderBrief.ts`), which holds:
  - the room, with the axes explained in the file itself;
  - per wall, everything against it left to right;
  - every cabinet with its box in mm, the wall it's on, which way it
    faces, its finish (name, type, pattern, sheen, colour as hex and
    words, the swatch photo's URL), its fronts panel by panel and its
    handle;
  - each appliance and how it sits ("on the countertop over C3", "built
    into C7", "above the hob"), plus the sink cutout;
  - pillars and shafts, doors and windows (with what's beyond them and
    the daylight), and the light fixtures;
  - the camera (position, heading, pitch, field of view), exact counts,
    and a list of what is **not** in the room;
  - a generated prompt: instructions for an LLM or multimodal model, a
    text-to-image prompt and a negative prompt.

**Why two files.** Text can't fix geometry. No image model places a
600mm drawer unit 900mm from a corner because a sentence says so. The
PNG carries the geometry (img2img, a depth or edge ControlNet, or "edit
this image" in a multimodal model). The JSON says what each shape *is*.
The prompt is generated from the same data, so the three can't
disagree. Most hallucination comes from what isn't said: an empty
counter gets a fruit bowl, and a kitchen with no chimney gets a hood.
So absences are listed explicitly (`notInThisRoom`, also merged into
the negative prompt), and "not chosen" is spelled out as what the
preview already shows (plaster, plain tile, plain stone). That way it
doesn't read as licence to invent a finish.

**Decisions inside it.**
- Geometry is **physical** cabinets (§61), the same ones the 3D view
  draws, because the brief describes the picture, not the cutting list.
- Refs (C1, A1, P1, O1, L1) are numbered by wall (N, E, S, W), then
  left to right as you face the wall, then bottom to top. That's the
  order a person describes a kitchen in, and it lets the prompt say
  "C3" and mean one thing.
- **No customer data and no prices.** The file exists to be sent to an
  outside model, and neither helps draw the kitchen.
- The snapshot renders on demand and reads the canvas in the same call
  (`lib/viewSnapshot.ts`). Rejected: `preserveDrawingBuffer` on the
  canvas, which costs every frame on a phone for a button pressed once.
  The camera is read at click time through `useThree`'s `get()`. A
  captured camera would go stale when the walkthrough swaps the default
  camera.
- Colour words (`colourName`) are coarse and deterministic: "dark
  brown", "beige", "off-white". Image models follow words better than
  hex, so both are given. `#f5f3ef` plaster must read as off-white,
  not white, and a walnut `#5c3a1e` as dark brown, not very dark. Both
  thresholds were moved once to get there; the tests pin them.

**Not done.** No depth or edge map is exported yet; a ControlNet user
derives one from the PNG. No model is called from the app; the
business chooses the image service. Appliance colours aren't stored,
so they're "as in the reference image". The countertop's per-side
overhang (`countertopOverhangs` in Room3DCanvas) is reported as the
nominal 20mm.

**Verified**: `renderBrief.test.ts` covers left-to-right measurement on
all four walls, facing, colour words, camera conversion, ref order,
boxes, hob-on-counter, opening offsets, swatch URLs, absences and
determinism. A sample prompt was printed and read. **Not seen in a
browser**: the PNG capture (WebGL is mocked in tests) and the
two-file download. Chrome may ask once to allow multiple downloads.

## 98. Image brief: a four-wall elevation sheet replaces the 3D still

You looked at §97's PNG of the 3D view and found it didn't help. The
brief's reference image is now **one sheet with all four walls**
(`<design>-elevations.png`), drawn by `lib/elevationSheet.ts` from the
brief's own data. The 3D still remains, behind an **"Include this 3D
view"** tick that is off by default. Its future is still being
discussed.

**Why elevations.** A perspective view hides half the room and
foreshortens the rest. An elevation shows everything on a wall at true
scale. Each wall is seen from inside the room, and all four share one
scale, so the walls keep their proportions next to each other. The
sheet's refs (C1, A1, O1, P1) are the brief's, because both come from
the same pass.

**Why not a screenshot of the elevation screen.** `WallElevationView`
is a designer's tool, with dimension chains, amber gaps and
click-to-measure. Image models copy lines and numbers into the "photo".
It also draws a unit as one box, and the box's contents are exactly
what image models get wrong. So the sheet draws:
- each cabinet's real fronts from `computeFrontBreakdown`, as panels
  with handle marks (bar, knob, gola/profile; nothing for handleless);
- open shelves, glass, tambour slats, and the carcass interior where
  there's no front, so a niche reads as a niche;
- the countertop band; a hob as a dark slab; a chimney as canopy plus
  duct; a sink as its rim and a tap;
- windows (frame and mullion), doors (leaf and handle on the swinging
  edge), and hatched pillars;
- the sides of the neighbouring wall's corner units as dashed grey
  blocks, so an L-shaped run doesn't look as if it stops.

Labels sit in strips above and below each wall, never on the units.
They're stacked into rows so they don't overlap. Colour is left out:
finishes come from the JSON and swatch photos, and a flat fill here
would contradict them.

**Things deliberately not drawn, because the data doesn't say them:**
- a fridge's door or freezer split;
- a sink bowl's depth (the first draft drew the stored box as a dashed
  outline, which read as an object on the counter);
- the countertop's sideways overhang, which ran into a neighbouring
  tall unit. The front overhang only shows in plan.

**How it's built.** The sheet is an SVG string, a pure function so it
can be tested. `lib/svgToPng.ts` rasterises it at 2× in the browser,
so thin lines survive. The brief changed from one `referenceImage` to
`referenceImages[]`, each with a `kind` (`elevations` / `perspective`)
and a fixed explanation. Instruction 1 of the prompt is written for
whichever images are attached. The camera (`view`) is still recorded
without the still, because it says where the photo should be taken
from.

**Verified**: `elevationSheet.test.ts` checks four walls on one sheet,
fronts split into the right panels with a handle each, refs as labels,
corner sides in brackets, one shared scale and escaping. A sample L-shaped
kitchen was rendered to PNG and looked at; that's how the sink and
overhang faults were found. **Not seen in the app**: the in-browser
SVG→PNG step and the downloads.

## 99. Top view: a plan in the elevation tab (2D and 3D) and on the sheet

You decided the room needs a view from above wherever the elevations
are, regardless of the image work. The reason: four wall elevations
can't show how the runs meet, anything standing free of a wall (an
island), or where a photo is taken from.

- **Editor, Elevation tab:** the wall picker gains **Top view**.
  - **Drawing:** shows `PlanTopView`, an `<img>` of `lib/planDrawing.ts`'s
    SVG. It's the exact picture the image brief exports, not a second
    rendering that could drift from it.
  - **3D:** shows `Room3DCanvas topView`, an orthographic camera straight
    down with north at the top like the 2D plan. Pan and zoom work;
    rotating is off. It has no ceiling, no ceiling fittings and no
    camera markers. `topView` is a separate prop rather than a fifth
    `wallView` value, because everything keyed on `wallView` means "one
    wall and what's against it". `camera.up` is −Z, because looking down
    the Y axis the default up (+Y) lies along the view and is undefined.
    Checked: east lands on screen-right, so it isn't mirrored.
- **The sheet** (§98) is now 3 × 2: the plan with a symbol key, then
  the four walls. The plan has its own fit-to-panel scale; a deep room
  wouldn't fit at the walls' shared scale. Walls are drawn 800px long
  (was 1000), so the 1× sheet stays near the 1,500–2,000px that image
  models shrink their inputs to. It's rasterised at 2×.
- **What the plan shows:**
  - walls as a dark band, cut for openings, with windows in blue;
  - in-swinging doors as a leaf plus a dashed arc;
  - base units under the countertop in grey and tall units darker,
    each with a heavy front edge;
  - wall-hung units and the chimney dashed (they hang above);
  - the sink bowl (from the catalogue cutout, if any), the hob dark,
    and hatched pillars;
  - the camera as a wedge, only for a real standing position;
  - wall names with lengths.

  Labels are stacked through a unit's depth (hung unit at the back,
  appliance in the middle, base unit at the front), so three items
  sharing one footprint don't collide. The chimney isn't labelled on
  the plan; the elevation names it.
- **A hinge-side bug found on the way.** The stored `'in-left'` means
  the hinge is at the wall's start (`OpeningLayer.tsx`'s
  `swingGeometry`). That end is your **right** on the south and west
  walls. §98's elevation read the label as "left as you face it", so it
  drew the door handle on the wrong side on those two walls. The brief
  now records `door.hingeSide` (as faced from inside) and `door.opensIn`,
  via the tested `hingeSideFacingWall`.
- `useRenderBriefInput` is the one place the brief's store inputs are
  gathered, for both the download and the Top drawing.
- The sheet's SVG is checked for duplicate attributes in a test. A
  browser refuses to load an SVG image that has them, and the first
  draft of the plan's labels produced them.

**Verified in a browser** (Playwright, the read-only test login, the
laptop size):
- Top view opens in Drawing and 3D.
- **Image brief** downloads the sheet PNG (5640 × 3196) and the JSON.

This also settles §98's "downloads not seen in the app". The test
account's design is empty, so the 3D top view hasn't been seen with
units in it. Its orientation rests on the camera maths, which says east
is on the right.

## 100. The condensed prompt (review of the JSON)

A review of the brief asked for:
1. a prompt fit for diffusion models;
2. materials grouped rather than listed per cabinet;
3. a 150–200 word cap in a fixed order;
4. the negative prompt built from `notInThisRoom`;
5. a separate `imagePromptCondensed` key.

All five are done, with these choices:

- **Both prompts are kept.** `imagePrompt` (complete, with refs and
  sizes) is for a chat-style image model that reads it alongside the
  JSON and the sheet; that's your first target. `imagePromptCondensed`
  is for diffusion text encoders, which truncate (CLIP at 77 tokens)
  and can't use millimetres or refs. The review assumed the JSON also
  feeds the Three.js view and the price. It doesn't; it's export only.
  The 3D view and `calculateBOM` read the store, so nothing there
  changed.
- **Condensed order is fixed:**
  1. camera and room, with a shape word (single-wall, L, galley, U,
     "with an island") from which walls carry a run;
  2. materials grouped by what you see: base run, upper run, tall
     units, then the countertop (with "inset sink and tap" if there is
     one), walls, floor;
  3. appliances and pillars;
  4. light (daylight and fixtures with their Kelvin);
  5. style tags.

  Over the cap (`CONDENSED_MAX_WORDS` = 200), whole optional sentences
  are dropped in a set order: pillars, then tall units, then walls and
  floor, then appliances and light. Nothing is cut mid-sentence, and
  the style tags always stay. Tested with a 40-cabinet kitchen.
- **Finish words** (`shortFinish`): colour word, then pattern, type and
  sheen. No brand, code or hex: an encoder can't use them, and they
  cost tokens. A photographed finish has no stored colour, so its name
  minus codes ("walnut") stands in. Without that, a walnut laminate came
  out as just "wood-grain laminate".
- **Neutral metal handles** read as the trade says them, "brushed steel"
  or "polished chrome", not "light grey polished metal".
- **Negative prompt:** it already carried `notInThisRoom`. Two fixes:
  - The generic list held `'island'`, which would negate an island that
    *is* designed. It's removed; "kitchen island" comes only from
    `notInThisRoom`, i.e. only when there's none.
  - Terms are deduplicated, and absence phrases contain no commas,
    because the prompt is a comma-separated list and a phrase with
    commas would split into fragments.
- **There is no backsplash data.** The review's hierarchy names a
  backsplash, so the condensed prompt says "no backsplash tiles unless
  stated" rather than inventing one.
- **Bug found reading real output:** an empty room said "modular modular
  kitchen". Fixed and tested.

## 101. Leonardo.ai: structure render + ready requests; what the brief got wrong

You chose Leonardo.ai to start with, and gave a brief for it. Several
points in it were checked against docs.leonardo.ai (6 Oct 2026) and
are wrong as written, so the build follows the docs:

| The brief said | The docs say | Built |
|---|---|---|
| Phoenix + a depth/edge map | Edge (19) and Depth (20) to Image are **SDXL-only**; Phoenix takes style/content/character/image-to-image references | Structure lock on **Vision XL** (SDXL); Phoenix offered prompt-only |
| strength 0.7–0.85 | `strengthType` bucket on a 0–2 scale: Low/Mid/High | `High` (0.7–0.85 of 1 ≈ 1.4–1.7 of 2) |
| `presetStyle` "INTERIOR" | doesn't exist; `CINEMATIC` does (SDXL/PhotoReal); Phoenix uses `style_ids` | `CINEMATIC`; Phoenix "Pro color photography" |
| alchemy + photoReal on Phoenix | PhotoReal is SDXL-only (v2 needs alchemy + Kino/Vision/Diffusion XL); Phoenix's quality switch is `mode` | Vision XL + `photoRealVersion` v2 + alchemy; Phoenix `mode: QUALITY` |
| "octane render" in the prefix | (ours) names a CG renderer, pulls towards a CG look; "CGI look" is in our negative prompt | prefix kept without it |
| (size not stated) | with Alchemy, ≤ 1024 and multiples of 8 | 1024 × 576 |

Agreed and done as asked: one structure image, not the elevation
sheet. The prefix is prepended to the condensed prompt, staying within
200 words. The prompt reads as prose ("It has…", "Lit by…" rather than
"Appliances:"). `negative_prompt` is passed through unchanged.

**The structure render** (`lib/viewSnapshot.ts`, `renderStructure`)
replaces the textured 3D still from §97/§98, which didn't help. From
the camera you stand at, it renders:
- a **line render**: every surface white, every edge black (EdgesGeometry
  at 25°). Door and drawer seams, handles, the countertop edge, window
  openings and pillars all survive as lines. That's what stops a model
  inventing a third drawer.
- a **depth map**: linear, near = white, far = black, spanning to the
  farthest room corner. It's for pipelines that take depth directly.

Both are rendered at exactly 1024 × 576. The renderer is resized for
one frame and restored; materials are swapped per mesh, not via
`overrideMaterial`, which would also whiten the edge lines. Hidden for
the shot:
- editor furniture (camera markers, hotspots, selection outline);
- the photo behind a window (`HIDE_IN_STRUCTURE`), so the window reads
  as an opening.

Free orbit is refused, because Leonardo would render the cut-away as a
dollhouse. You choose a camera first.

**The pack** (`lib/leonardo.ts`, `buildLeonardoPack`): **Image brief
for → Leonardo** downloads three files: `-leonardo-guide.png`,
`-depth.png` and `-leonardo.json`. The JSON is the brief plus a
`leonardo` section containing:
- the prompt and negative prompt;
- the upload steps (`/init-image`, a presigned multipart POST within 2
  minutes, then the id goes into `controlnets`);
- two complete request bodies: `structureLocked` (Vision XL, Edge to
  Image) and `phoenix` (v2, prompt-only, `prompt_enhance: OFF` so
  Leonardo doesn't rewrite the grounded prompt).

"Chat image model" keeps the plan + elevations sheet (§98–§100).

**Nothing calls Leonardo yet.** A Leonardo API key can't live in this
app: every `VITE_` value ships to the browser. Sending needs a
server-side proxy (a Supabase Edge Function or a Cloudflare Worker,
next to the existing deploy) holding the key. It would also spend
Leonardo credits and send designs to an outside service. That's your
decision, so it isn't built.

"Disconnect from BOM/pricing": the pack carries no prices or customer
details (tested). `computeFrontBreakdown` still takes the hardware
rates to compute where fronts and handles go; only the geometry is
used.

**Verified.** `leonardo.test.ts` pins every documented value: model,
preprocessor, strength bucket, size limits, Phoenix `style_ids` with no
`presetStyle`, no "octane", ≤ 200 words and ≤ 2,000 characters, no
prices. `renderStructure` was run in a real browser (WebGL) on a test
room. The line render showed both door pairs with handles, three
drawers, the counter edge, the window opening and the pillar. The
renderer's size, camera aspect, background and meshes were all
restored afterwards. **Not yet seen**: a line render from a real design
in the app (the test login has no cameras), and any Leonardo output.
The init-image endpoint path comes from Leonardo's API reference name;
the upload page doesn't spell it out, so confirm it on the first real
call.

## 102. A camera is a saved view: height, tilt, lens, and "Save this view"

The first real Leonardo try exposed two things:
- The pack's **depth map** was uploaded instead of the guide image. The
  Leonardo pack now downloads only the guide (line render) and the
  JSON. `renderStructure('depth')` stays in the code for other
  pipelines; nothing downloads it.
- **A camera couldn't be framed.** It had a spot, a heading and a height
  you couldn't edit. Drag-to-look in the walkthrough was a live aid,
  reset on every teleport and never saved (a deliberate choice back
  then). The image brief renders exactly what the camera sees, so the
  view you frame by eye has to persist.

What changed (your decision, 6 Oct 2026):
- **`CameraNode`** gains optional `pitchDeg` (tilt, + up) and `fovDeg`
  (lens). They live in the `cameras` JSONB, so there's no schema
  change. A camera without them is level and uses the session lens, as
  before.
- **Cameras panel (2D):** each camera has **Height** (mm, 300 to the
  ceiling minus 100) and **Tilt** (±60°) boxes, plus a readout of the
  saved lens. They're typed because a plan can't drag either. They
  commit on Enter or when you leave the box, clamped. Committing on
  every keystroke turned the "1" of "1600" into 300. An empty box puts
  the saved value back.
- **3D walkthrough:** the camera honours the saved tilt, using the same
  `'YXZ'` Euler order as drag-look, so a saved drag comes back exactly.
  Stepping to a camera loads its saved lens into "Walkthrough lens".
  **Save this view** (shown while standing at a camera) writes the
  current heading, tilt and lens to it, via `lookAnglesFromDirection`
  (`lib/scene3d.ts`). `viewFromWorldCamera` now uses the same function,
  so the brief and the camera can't disagree about angles.
- The guide image is rendered from the live camera, so it is exactly
  the view on screen. Saving the view makes that repeatable.

**Verified**:
- `scene3d.test.ts`: compass directions, and a save → walkthrough →
  save round trip for four views to 0.1°.
- `CameraToolbar.test.tsx` (screen test): no save mid-typing, save on
  Enter, ±60° clamp, an empty box restored.

**Not seen in a browser**: "Save this view" and the tilted walkthrough.
The test login is read-only, and adding a camera would save to it.

## 103. Hold-to-move pad for cameras

You asked for six hold-to-move buttons to fix a camera's position,
after the first real Leonardo guide image came out framed too close to
the left run.

- **Where:** the Cameras panel (left), under the camera list. It has a
  **Move [camera]** picker, because cameras aren't selectable items,
  and six buttons: Forward, Back, Left, Right (a cross) and Up, Down
  (height).
- **Directions are the camera's, not the room's** (`lib/cameraMove.ts`).
  Forward is towards what it looks at; left and right are sideways to
  that. Fixing a framing is "a bit further back", and nobody should have
  to work out which compass point that is.
- **Speeds:** slow on purpose, 300 mm/s across and 200 mm/s up and down.
  These fine-tune; big moves are dragging on the plan. The camera is
  kept 100 mm off the walls, at least 300 mm high, and 100 mm under the
  ceiling. Positions are whole millimetres.
- **How a press works:** a `requestAnimationFrame` loop starts on pointer
  down and stops on up, cancel or lost capture. Pointer capture means
  sliding off the button still stops it. Each frame's step is capped at
  0.1 s, so a stalled tab can't jump the camera. The first frame only
  sets the clock: reading `performance.now()` in the handler tripped the
  React compiler's purity rule, and the code was restructured rather
  than the rule disabled. Keyboard: Enter or Space on a button moves one
  ~20 mm step per key repeat.
- **Undo:** each frame is an ordinary `updateCamera` with the signature
  `updateCamera:<id>`. The store's debounced history groups a press
  into one undo step. This is from reading `noteDesignEdit`; the screen
  test stubs the store, so it doesn't prove it.
- **The 3D walkthrough follows the glide**, and gliding no longer throws
  away an unsaved look-around. `AnimatedFirstPersonCamera`'s one effect
  was split: position (x, y, height) only re-targets, while view (node,
  heading, tilt) re-targets and resets free-look.

**Verified**:
- `cameraMove.test.ts`: directions for all four headings, height only
  for up and down, and the clamps.
- Screen tests: three frames while held move 60 mm and the loop stops
  on release; Enter moves a ~13 mm height step.

**Not seen in a browser**: the glide, and the 3D view following it.

## 104. First real Leonardo result: edges over-followed; prompt fixes

**The run:** Leonardo Lightning XL (free plan), Edge to Image at High,
the §101 guide image. The full prompt was too long for the free plan,
so it was shortened by another model (Gemini) first.

**Result:** the geometry was exact, with every unit, drawer, the
tambour, the hob, the corner unit and the uppers in place and nothing
invented. But:
- every edge was drawn as a stitched seam on grey "cardboard";
- the off-white gloss was lost.

**Reading:**
- The edges were followed too literally. Strength is the first lever.
- Lightning XL is a fast model and follows prompts less closely than
  Vision XL.
- Shortening the prompt in another model loses the grounding we built.

**Changes:**
- The Leonardo request uses `strengthType: "Mid"` (was "High"). Notes
  say to go Low if lines still show, and High only if units drift.
- `LINE_ARTEFACT_TERMS` (visible outlines, sketch lines, wireframe,
  stitched seams, cardboard texture, monochrome) lead every Leonardo
  negative prompt.
- `promptShort` (≤ 400 characters, colours and materials first, no
  counts or sizes) and `negativePromptShort` (≤ 300) are in the pack,
  ready to paste on a length-limited plan. The free plan's exact limit
  isn't documented where we could see it; 400 is a guess that fits.
- **Wording bugs, visible in the real prompt:**

  | Was | Now | How |
  |---|---|---|
  | "a under-sink ro purifier", "off-white pu" | "an under-sink RO purifier", "off-white PU" | `withArticle` picks a/an by sound, including acronyms: "an RO"; `proseCase` keeps acronyms |
  | "(600mm)" leaking from catalogue labels | gone | `withoutSizes` |
  | "teak veneer wood-grain veneer" | "teak matte wood-grain veneer" | `shortFinish` drops name words the type or pattern repeats |
  | "off-white acrylic, high gloss and cream acrylic, high gloss" | "off-white high-gloss acrylic and cream high-gloss acrylic" | finishes are "colour sheen pattern type", with no internal comma |

**Length.** Leonardo's prompt box takes 1,500 characters on paid plans
too, so the pack's full `prompt` is now capped at
`LEONARDO_MAX_PROMPT_CHARS` (1,500) as well as 200 words. Over the
limit, the word budget tightens, so whole optional sentences drop
rather than one being cut mid-way. Image models never read the JSON
itself; it's the record the prompts are generated from. A chat model
(ChatGPT, Gemini, Claude) can take the JSON as an upload with the
sheet, which is the "Chat image model" route. There's no need to have
another model rewrite a prompt for Leonardo: `prompt` (≤ 1,500) and
`promptShort` (≤ 400) are both written from the same data.

**Next lever if Mid isn't enough:** a shaded "clay" guide (grey-lit
faces, faint lines) instead of pure line art. A canny edge detector
finds both sides of a drawn line, which may be what doubles into the
"stitched" look. That's untried, so it's not built.

**Verified:** tests for the a/an, acronym, size and repeated-word rules,
the Mid strength, the artefact terms in the negative, and the short
prompt's limits and order. A short prompt for a kitchen like the one
tried was printed and read (350 characters). **Not yet tried on
Leonardo.**

## 105. One Image brief, no model names; Leonardo set aside

**Tried, 6–7 Oct 2026**, on one design with the same guide image and
data:

| Model | Result |
|---|---|
| Leonardo Lightning XL + Edge to Image | exact layout, but drawn "stitched" edges and lost colour (§104) |
| Leonardo + Flux with a plain image reference | right look, but rearranged the layout: hob and sink swapped, window moved, tambour gone |
| Gemini (thinking image model) with the full JSON + guide image | kept the layout and the look; invented only a wooden ceiling |
| Qwen Image 2.0 (3.0 was "high demand" on the free plan) | ignored most of the guide: tall unit and tambour gone, window moved, and **an oven added** despite "oven" in the negative prompt |

**Decision:** for now, the target is a chat-style model that reads the
JSON and looks at the guide image (Gemini did best). The app names no
model until that's final.

**What changed:**
- **One "Image brief" button**, no selector:
  - Standing at a camera: `<design>-guide.png` (the line drawing of
    that exact view) plus `<design>-render-brief.json`.
  - Free orbit: `<design>-elevations.png` (plan + four walls) plus the
    JSON, since a cut-away orbit view would be painted as a dollhouse.
- **Leonardo-specific code removed:** `lib/leonardo.ts` (request bodies,
  model IDs, the "Masterpiece…" prefix, the line-artefact negative
  terms, the 1,500-character cap) and the depth-map variant of
  `renderStructure`. It's all kept on the git branch `leonardo-pack`.
- **The short prompt is model-neutral and stays.** The brief carries
  `prompt.imagePromptShort` (≤ 400 characters) and
  `prompt.negativePromptShort` (≤ 300) for any tool with a length
  limit. The short negative now leads with "decor or utensils on the
  counters": when that term was the one cut off, a dish rack and a
  towel appeared. A fixture is called "warm" only at 3,500 K or below.
- A test checks that the brief names no image model.

Still to do, from the Gemini result: guard the ceiling ("plain white,
no wooden or false ceiling" when none is chosen), and say that an
under-sink RO purifier stays inside the sink unit.

## 106. Sign-up, with approval

You asked for a sign-up button on the web app. Self-serve sign-up was
parked ("hand-onboard first", `AFTER_FIRST_CUSTOMERS.md`), so the
question was what a new account gets. You chose **an account that
waits for approval**. The rejected options:
- **Its own new business:** needs a starter-catalogue copy, a
  server-side setup step and the two-business isolation check first.
- **Joining the existing business:** anyone who signed up would see all
  your customers and quotes.

**Built:**
- **Sign-in screen:** a **Create an account** mode asking for name,
  business name, email and password (at least 8 characters).
  - Name and business name are stored on the login
    (`raw_user_meta_data`), so you know who you're approving.
  - If Supabase requires email confirmation, the screen says "Check
    your email".
  - Supabase's own errors are shown as they come (e.g. "Signups not
    allowed" while sign-up is off in Supabase).
- **App gate:** a signed-in account with **no business** sees **Waiting
  for access** (`AwaitingAccessScreen`), with Check again and Sign out,
  instead of an app full of empty screens and failed saves. It isn't
  shown when the membership lookup itself *failed*, so a network blip
  doesn't tell an approved user they're unapproved.
- **No path from the browser to a business.** Checked:
  - `business_users` has only a read-own-row policy.
  - `businesses` has no insert policy.
  - Every table's policy is scoped by `current_business_id()`, which is
    null for a waiting account.
- **A real hole closed first.** The panoramas, material-swatches and
  quote-pdfs buckets allowed upload and overwrite by any signed-in
  account (`auth.role() = 'authenticated'`). That was harmless while
  only the team could sign in. With sign-up open, a stranger could have
  overwritten a customer's quote PDF at its predictable path. Writes
  now need `current_business_id() is not null`. **Needs `schema.sql`
  re-run before sign-up is switched on in Supabase.** Cross-business
  overwrite (one member writing into another business's files) is
  still possible, and is part of the isolation check before a second
  business: scope writes to the business's own folder, as
  `business-logos` already is.
- **Approving** is SQL for now (`docs/DEPLOY.md`, "Sign-up and approving
  a new account"): list waiting accounts with their name and business,
  then insert a `business_users` row.

A super admin with no `business_users` row would now see the waiting
screen. Today the owner's login is a member of `biz_default`, so this
doesn't arise.

**Verified:**
- Screen tests (`SignUp.test.tsx`): the request carries name and
  business; "Check your email"; a short password is refused before
  Supabase is asked; Supabase's error is shown; the waiting screen's
  Check again and Sign out work.
- The sign-up screen was looked at in a browser at laptop and phone
  size, with no sideways overflow. No account was created against the
  real Supabase.

**Not seen:** a real sign-up end to end (email, approval, Check again).
That needs the Supabase steps above.

## 107. Separate businesses: approve as new, starter catalogue, own default, isolation proven

You asked for what a second, outside business needs, plus a starter
catalogue every business gets, which it can change and go back to.
Your choices:
- **Copy, not live:** the starter is copied into each business on
  approval, not shared live, so principle 6 holds.
- **Restore point:** each business can **save its own default** and go
  back to it. A new business's first default is the starter.

**Built (schema.sql, "STARTER CATALOGUE AND EACH BUSINESS'S OWN DEFAULT"):**
- **Master starter:** `biz_starter` is a business with no members.
  `refresh_starter_catalog('biz_default')` (owner, SQL editor) rebuilds
  it from a curated catalogue. Refreshing never touches businesses
  already approved.
- **`approve_new_business(user, name?)`** (owner, SQL editor):
  - creates `biz_<10 hex>`, named from the sign-up form, and makes the
    person its owner;
  - copies the starter in via `copy_catalog`. Ids become
    `<business>:<original>`, since ids are global primary keys, and each
    cabinet row's `finish_id`/`handle_id` is remapped to the copies;
  - saves that copy as the business's default.
- **`save_my_catalog_default()` / `restore_my_catalog_default()`** (the
  app, via the Catalogue page's "Your default catalogue" card):
  - Save snapshots the six catalogue tables as JSON rows in
    `catalog_defaults`.
  - Restore upserts them back: edited items return to the saved values
    (prices included), deleted ones come back, and items added since are
    kept, because deleting them could break designs. Each saved row is
    laid over the current row, so a column added after the save keeps
    its value instead of being blanked.
  - The confirm warns that open quotes using a reset item move with it;
    frozen quotes never change.
- All of these run **as the caller, under RLS**. Owner-only functions are
  revoked from the app's roles. `save_catalog_default(b)` refuses an app
  login naming a business other than its own. RLS alone would have made
  that a silent no-op; the isolation check caught it.
- **No super-admin bypass in the app's rules.** Nothing used it, and a
  super admin's app would have loaded every business's customers and
  catalogue mixed together. The single-row reads (rate card, Workshop
  settings) could even have picked another business's row. The owner
  sees everything via the SQL editor, which RLS doesn't apply to. This
  settles the "super-admin view" item in `AFTER_FIRST_CUSTOMERS.md`.
- **Storage:**
  - Every bucket's writes (upload, overwrite, delete) are limited to
    `<business_id>/...`.
  - The app writes panoramas, swatches and quote PDFs there; the
    business id is passed explicitly.
  - Older files outside any folder stay readable but can't be written.
    Quote links already sent keep working.
  - `deleteSwatch` deletes only a file in the business's own folder. A
    copied starter finish shares the source business's photo, and the
    old code (last URL segment) would have tried to delete it.

**`supabase/isolation_check.sql`**, the two-business check (principle
4). It runs in the SQL editor inside a transaction and rolls back. It
creates three sign-ups, approves two as businesses, then acts as each
person through RLS and proves seven things:
1. Approval works: a separate business, the starter copied, a default
   saved.
2. Reads stay within the business.
3. Writes into the other business are refused.
4. A person can't create or join a business, or call owner-only
   functions.
5. Files can only be written in the business's own folder.
6. Restore behaves as specified.
7. A waiting sign-up sees and writes nothing.

**Verified** against a local Postgres 14, with the real `schema.sql`
loaded on small stand-ins for Supabase's `auth` and `storage`:
- `schema.sql` loads and re-runs cleanly.
- The check passes, and leaves no rows behind.
- **The check bites:** with the old "any login can upload" storage rule
  put back it fails at check 5, and with a super-admin read bypass put
  back it fails at check 2.
- App tests: storage paths and the swatch-delete rule
  (`storagePaths.test.ts`), and the default-catalogue card (screen test,
  database calls mocked).

**Not yet done in the real Supabase:** re-running `schema.sql`, the
starter refresh, and running the isolation check there. Supabase's real
`auth` and `storage` are richer than the stand-ins, so the real run is
the one that counts.

**Notes:**
- A new business's rate card and Workshop settings start on the in-app
  defaults; the catalogue is the only thing copied.
- A copied cabinet row naming a custom board that only `biz_default`'s
  rate card has falls back to the standard 18mm line (§44).

## 108. The 3D "hang": measured, then three fixes

The app sometimes hung. A performance plan listed seven suspects and
asked for measurement before any fix. Measured on a real design (Neha
Verma's kitchen, about 38 items on the plan, two cameras) with a
local production build on an M1 laptop. A Playwright script drove it
with **every write to Supabase blocked**. It recorded main-thread busy
time, frame times and long tasks via CDP and in-page observers, and a
CPU profile of each phase.

**Before:**

| Phase | Result |
|---|---|
| App load / open project | 0.4 s / 0.9 s, fine |
| Drag a cabinet on the plan | 60 fps, 12% busy, no long tasks, fine |
| **First 3D open, cold shader cache** | **3.97 s frozen**; 3,860 ms of it in three.js `onFirstUse`, waiting for the GPU driver to compile shader programs |
| 3D open, warm cache | 0.25 s frozen |
| Reopening 3D after another tab | 0.67 s frozen (the view unmounted, so it rebuilt and recompiled every visit) |
| Elevation's 3D wall view | 0.75 s frozen |
| **3D sitting idle** | **26% main thread, non-stop** (default frameloop: the whole room, shadows included, redrawn 60×/s) |

Ruled out by checks:
- whole-store Zustand subscriptions;
- both canvases mounted at once;
- the HDRI from drei's CDN (self-hosted since §29);
- textures (1024 px) and models (3–650 KB);
- pricing per mouse-move: a drag updates local state, and the store is
  written on drop. `useBOM` does run in five components, each with its
  own memo.

**Found wrong in CLAUDE.md: "React 19 compiler is active".** Only its
lint rules run (`eslint-plugin-react-hooks` 7); the compiler transform
isn't enabled in `vite.config.ts` or installed. Corrected. On this
machine React work wasn't the bottleneck, so turning it on is a separate
decision, not part of this fix.

**The fixes:**
1. **Draw on demand.** `Room3DCanvas` and the Cabinet Designer preview
   use `frameloop="demand"`. What changes the scene outside a React
   render now calls `invalidate()`:
   - The walkthrough camera, on a new target, on drag-look, and every
     frame until the ease arrives. `delta` is capped at 1/30 s, or the
     first frame after an idle spell would jump straight to the target.
   - The exposure slider.
   - Textures that finish loading (`redrawWhenLoaded` in
     `textures3d.ts`).

   The active hotspot now pulses for 3 s after you arrive instead of
   forever; a permanent pulse would have kept the room redrawing at
   60 fps for as long as you stand at a camera. The panorama capture
   and the image-brief render draw explicitly, so they're unaffected.
2. **Compile shaders in the background before the first frame.**
   - `ShaderWarmup` runs `renderer.compileAsync(scene, camera)`
     (KHR_parallel_shader_compile) after the scene's suspended parts
     (the HDRI) arrive.
   - The canvas draws nothing ("Preparing 3D…") until it's done, then
     switches to demand rendering.
   - A 10 s timeout means a driver that never answers can't strand the
     overlay.
   - `onReady` is the state setter, so the effect can't restart and
     abandon the compile on every parent re-render.
3. **Keep the editor's 3D tab alive.** `Room3DCanvas` gained `active`;
   when inactive it uses `frameloop="never"`, since `display:none` alone
   doesn't stop r3f. `DesignEditor` mounts the 3D tab on its first visit
   (a session that never opens 3D pays nothing) and keeps it hidden
   while Plan or Elevation shows. Side effect: the 3D tab keeps its
   viewpoint, e.g. standing at a camera, across tab switches.
   Elevation's 3D view is still a separate instance; after fix 2 it
   opens without a long task, so it was left alone.

**After** (warm cache; two runs each, consistent):

| Phase | Before | After |
|---|---|---|
| 3D idle, main thread busy | 26% | **3%** |
| Time blocked in `onFirstUse` on 3D open | 3,860 ms (cold) | 85 ms |
| 3D open freeze (warm) | 0.25 s | 0.15 s (texture upload and a few programs compile-ahead can't see: shadow depth, the HDRI capture, appliance models that load later) |
| Reopening 3D | 0.67 s | **none** |
| Elevation 3D view | 0.75 s | **none** |
| Orbiting | 60 fps | 60 fps |
| Drag on the plan with 3D alive in the background | — | 13% busy (12% without) |
| Plan idle with 3D alive | 2–3% | 4–5% |

**Verified in a browser** (screenshots on her design): the room renders
fully after idling; stepping to a camera arrives (the ease doesn't stall
under demand rendering); the move pad's glide moves the view; returning
to the 3D tab shows it at full size.

**Not verified:**
- The cold-cache first open after fix 2. macOS keeps compiled Metal
  shaders across runs, so a cold run couldn't be reproduced. By the
  profile, the blocking compile path is now 85 ms of the former 3,860,
  so a cold open should freeze far less, but that's inferred.
- The hotspot pulse, by eye.
- Weaker hardware (Windows integrated graphics, phones), where shader
  compiles are slower; these fixes matter most there.

**Out of scope, noticed:** a catalogue model URL fails to load (the
error reads "Could not load /models/range-hood.glb."; the file exists,
so the stored URL is probably slightly off). It falls back to a box.

## 109. The 360° viewer opens facing the camera's direction

Reported 7 Oct 2026: "360 view click gives us the default view opposite
to the camera angle it is towards." This was older than §108 and not
caused by it.

**Cause.** The capture (`lib/panoramaCapture.ts`) always puts world +Z,
which is **south** on the plan, at the centre of the 360° image,
whatever the camera's heading. Photo Sphere Viewer opens on the centre,
and was never given a heading. So a north-facing camera, the usual
case, opened looking the opposite way.

**Fix.** `panoramaStartView(heading, tilt)` gives the viewer its start
yaw and pitch.
- It's derived from the capture shader's mapping: θ = heading + 180°
  with the default horizontal mirror, θ = 180° − heading without.
- The tilt is passed straight through.
- All three viewers pass the camera's `viewAngleDeg` and `pitchDeg`: the
  3D view's "View 360°", the Cameras panel, and the Customers page.

Existing panoramas need **no re-capture**. The image is fixed to the
room, not to the camera, so the camera's current heading is the right
start even if it was re-aimed after capturing.

**Verified:** `panoramaCapture.test.ts` checks, for nine headings with
and without the mirror, that the start column looks along the camera's
heading (to 6 decimal places), and that a north camera doesn't open on
the centre. **Not yet seen in the viewer by eye.** One assumption: a
panorama captured with "Mirror horizontally" switched off starts
mirrored round. The capture setting isn't stored, and the default is on.
