#Issues fixed

Moved here from `docs/ISSUES.md` (named `Issues.md` until 3 Oct 2026) once resolved (or, as with the two
below, once investigated and found not to be a code defect). Kept,
never deleted — see `CLAUDE.md`.

## 2026-10-04

- **Quote PDF prints the business name from `.env`, not from Settings.**
  Found 4 Oct 2026 by Claude while scoping the PDF logo. `lib/quotePdf.ts`
  reads `VITE_BUSINESS_NAME` / `VITE_BUSINESS_PHONE`, and its comment
  says "there is no `businesses` table yet", which stopped being true
  (§70: the table exists, and Settings → Business renames it). So
  renaming the business in Settings never reaches the customer's PDF,
  and with a second business, every business's quotes would carry
  whatever name the `.env` on that machine has. This blocks
  hand-onboarding customer #1 (listed in `AFTER_FIRST_CUSTOMERS.md`).
  The fix comes with the business profile + logo work.
  **Fixed 4 Oct 2026 (§94):** the PDF now takes name, phone, GSTIN and
  logo from the business record (Settings → Business); the `.env`
  variables are ignored. Needs `schema.sql` re-run for phone, logo and
  GSTIN to save.

## 2026-09-21

- **"tried to change appliance info - Failed to save appliance catalog
  item: TypeError: Failed to fetch (gave an error)"** — investigated,
  not a code bug. Live-checked: the Supabase project responds and the
  anon key in `.env` authenticates successfully right now
  (`GET /rest/v1/projects` → 200). The save path
  (`saveApplianceCatalogItem` in `src/lib/Inventory.ts:253`) already
  throws a proper error, and `upsertApplianceCatalogItem`
  (`src/store/layoutStore.ts:733`) deliberately lets it propagate — by
  design, per the comment at `layoutStore.ts:690-694` — so
  `InventoryManager`'s per-row `ApplianceCatalogRow` (`InventoryManager.tsx:833-848`)
  can catch it and show/roll back just that one row. `TypeError: Failed
  to fetch` is the browser's own message for a request that never got a
  response — consistent with a transient network drop at the time, not
  a defect in this code. Reopen if it recurs against a confirmed-live
  connection.

- **"can't save the project - Failed to save: Failed to save project:
  TypeError: Failed to fetch"** — same investigation, same conclusion.
  `saveProject` (`src/store/layoutStore.ts:878-921`) already wraps the
  call in try/catch and surfaces the message via `saveError`. Supabase
  connectivity confirmed live at time of investigation. Not a code bug.

- **"pressing enter to fnalize dimension change on layout for anything
  like cabinets"** — fixed. `CabinetInspector.tsx`'s `DimensionsForm`
  was a plain `<div>` with an `onClick` button — no `<form>` element, so
  there was nothing for the browser to submit on Enter. `ApplianceInspector.tsx`'s
  own `DimensionsForm` already used a real `<form onSubmit={...}>` with
  a `type="submit"` button, so appliances never had this problem — only
  the cabinet one was missing it. Changed the cabinet version to match:
  wrapped it in a `<form>`, made the button `type="submit"`, and added
  the same width/depth/height > 0 guard the appliance version has.

- **"when I choose 'manage' in the inventory section of the UI, it
  should take me to that section on inventory and not only the top page
  of that inventory page"** — fixed. `handleManageInventory` in
  `App.tsx` took no arguments, so all three toolbars (`CabinetToolbar`,
  `ObstacleToolbar`, `ApplianceToolbar`) and the dashboard's generic
  "Manage Inventory" button always opened the same scrolling page at the
  top. Added an `InventorySection` type (`'cabinets' | 'obstacles' |
  'appliances'`), gave each toolbar's call site its own section, added
  `id`s to the three section headings in `InventoryManager.tsx`, and
  added a `scrollIntoView` effect keyed on the new `initialSection` prop.
  The dashboard's generic button still passes no section, so it opens at
  the top as before — that's correct, it doesn't know which catalog you
  want.

## 2026-09-22

- **"floor shows some reflections or some other things rather than
  simple floor"** — no code change made. Traced to the intentional
  Lightformer environment panels (`Room3DCanvas.tsx:509-549`,
  `DECISIONS.md` §5/§8) that give stone/acrylic finishes their sheen;
  since environment maps aren't occluded by geometry, they can leak
  through walls, and two of the four panels are tinted. On live
  re-inspection in the browser, the floor looked correct — not
  reproducible as reported. Reopen with a fresh screenshot if it
  recurs; a real fix here needs a live render, not a blind numeric
  tweak (this exact file has had three rounds of lighting constants
  churn before, per `DECISIONS.md` §5).

- **"if there is any object which does not have an inspector opening
  up, add it like for appliances, doors and windows, lighting, etc."**
  — not a bug. Confirmed live: selecting an appliance or a light
  fixture did highlight it on the 2D plan and did open its inspector —
  the panel was just scrolled out of view. `App.tsx`'s inspectors
  (`CabinetInspector`, `ObstacleInspector`, `ApplianceInspector`,
  `OpeningInspector`, `FixtureInspector`) are flex siblings after the
  canvas, each a fixed-width box that only appears when its type is
  selected; cabinet comes first in that order, appliance and fixture
  come later, so on a narrower window they can end up past the visible
  edge with no obvious scroll cue. Confirmed by having the user scroll
  right, at which point the (correctly rendering) fixture inspector
  appeared. No inspector was actually missing for any selectable type.
  Worth a follow-up UX fix (e.g. wrap the row, or scroll the new panel
  into view on selection) if this keeps tripping people up, but that's
  a UX improvement, not a bug fix, and wasn't requested.

- **"there is no option for me to rotate the obstacles like pillar or
  shaft like that of cabinets, give me that option too"** — added.
  `Obstacle` had no `rotationDeg` field at all (`types/layout.ts`);
  cabinets and appliances already had one via the shared
  `RotatableFootprint`/`getFootprint`/`rotateFootprint` machinery in
  `lib/footprint.ts`, obstacles just never got wired into it. Added
  `rotationDeg: 0 | 90 | 180 | 270` to `Obstacle`, backfilled to `0` for
  old saved obstacles in `normalizeObstacle` (`Persistence.ts`), and
  defaulted new ones to `0` in `ObstacleToolbar.tsx`. Wired rotation
  through everywhere the footprint actually matters, mirroring
  `CabinetLayer`'s existing pattern exactly:
  - `lib/collision.ts` `getObstacleBounds` — was flatly "obstacles don't
    rotate, so X/Y is just their stored rectangle"; now swaps
    width/depth on a quarter turn like `getCabinetBounds` does.
  - `lib/clearance.ts` and `lib/surfaceAreas.ts` (`wallAreas`) — both
    built an obstacle rect straight from raw `widthMm`/`depthMm`; both
    now call `currentFootprintRect(obstacle)`, since `Obstacle` already
    has the exact shape `RotatableFootprint` expects.
  - `ObstacleLayer.tsx` — added `rotation={obstacle.rotationDeg}` on the
    Group (drawn unrotated, same "draw at 0,0 and let Konva's rotation
    prop do the turn" convention `CabinetLayer` uses, so the rotation
    pivot lands on the shape's own center, not a corner), rotation-aware
    drag clamping via `getFootprint`, and the same double-click/tap
    rotate gesture cabinets use, via `rotateFootprint`.
  - `ObstacleInspector.tsx` — added a Rotation readout + ±90° buttons,
    identical to `CabinetInspector`'s.
  - `Room3DCanvas.tsx` `ObstacleMesh` — added
    `rotation={[0, clockwiseDegToThreeY(obstacle.rotationDeg), 0]}`,
    matching `CountertopMesh`/`CabinetMesh`.
  Floor and ceiling obstacle area in `surfaceAreas.ts` (`floorAreas`,
  `ceilingAreas`) already used plain `widthMm * depthMm`, which is
  rotation-invariant — left untouched, correctly.

  **Follow-up, same day, found while testing the above:**
  - **Inspector stopped reappearing after rotating an obstacle.**
    `lib/hitTest.ts` — which decides what a click actually selects,
    independently of what Konva renders — still built the obstacle's
    clickable rectangle from raw `x/y/widthMm/depthMm`, the one spot
    that got missed when wiring in rotation. After a turn, the visible
    (rotated) shape and the clickable (unrotated) shape disagreed, so
    clicking the obstacle where it visibly was hit nothing. Fixed the
    same way as every other call site: now uses `currentFootprintRect(obstacle)`.
  - **A rotated 3066mm obstacle dragged next to a 305mm cabinet reported
    an overlap the user didn't expect** (305 + 3066 = the full
    3371mm wall, so it looked like it should fit flush). Not a
    collision-math bug — `ObstacleLayer.tsx` only grid-snaps a drag to
    `gridSnapMm` (50mm by default), and 305 isn't a multiple of 50, so
    the nearest the obstacle could actually be dragged to is 300 or 350,
    not 305. At 300 it genuinely overlaps the cabinet by 5mm — the
    warning was correct given where the obstacle actually landed; it
    just couldn't be dragged to where it was meant to be. Cabinets avoid
    this with magnetic edge-to-edge snapping (`cabinetSnapping.ts`);
    obstacles have no such thing and also had no way to type an exact
    position. Added X (mm) / Y (mm) fields to `ObstacleInspector.tsx`,
    matching the numeric fields already there for width/depth/height/
    elevation, so a position can be typed exactly rather than only
    reached via grid-snapped dragging.

- **"I don't have control over the material and finish of the
  slab/stone over lower cabinets (or should we add it separately)"**
  — added, and priced. `CountertopMesh` (`Room3DCanvas.tsx`) hardcoded
  a built-in procedural "quartz" texture for every countertop, and a
  comment in `cabinetGeometry.ts` said pricing it was explicitly
  deferred — the slab had zero price in every quote, always. Added
  `RoomLayout.countertopFinishId` (one finish for the whole layout, FK
  into the same `SurfaceFinish` catalogue floor/wall/ceiling already
  use — a kitchen's slab is one continuous material, same reasoning as
  `floorFinishId` being singular) and a picker for it in
  `RoomSurfacesPanel.tsx`. `CountertopMesh` now renders through the
  same `resolveMaterial`/`useFinishTextures` pipeline `CabinetMesh`
  uses for shutters, falling back to the original procedural quartz
  only when no finish has been assigned yet (so an existing project
  looks unchanged until someone visits the surfaces panel).

  Pricing added too, not left as "control only": `countertopAreaSqM`
  (`cabinetGeometry.ts`, shared by `lib/bom.ts` and the surfaces panel
  so the price and the on-screen area can't disagree) × the chosen
  finish's own `pricePerSqM`, same as every other surface. But charging
  for it is a separate toggle, `RoomLayout.priceCountertop` — identical
  shape to `priceElectrical`, and for the equivalent reason: in Delhi
  NCR the kitchen business usually doesn't supply the slab, the
  homeowner arranges stone separately. Full reasoning, including why a
  finish picker with no pricing behind it was rejected outright (a
  choice that looks real but doesn't affect the quote is worse than not
  offering it), is in `DECISIONS.md` §2 under "Countertop: one finish,
  optional charge."

  **Follow-up, found while testing the above:** with a real, visually
  distinct textured finish instead of flat grey quartz, the existing
  20mm overhang (`COUNTERTOP_OVERHANG_MM`, pre-dates this fix and was
  always symmetric on every side) became clearly visible poking into a
  tall unit standing right next to a base cabinet — the slab drew
  straight through the neighbour's face rather than stopping at the
  seam. This is very close to the older, previously-not-a-bug item "I
  am adding a cabinet but it is taking more space because of the slab
  stone placed on top of it" — same overhang, now actually visible.
  Fixed by making the overhang per-side rather than uniform:
  `countertopOverhangs` (`Room3DCanvas.tsx`) checks, for each of the
  4 sides, whether some other cabinet or obstacle is flush against that
  edge AND vertically overlaps the thin slab itself (`counterTopMm` to
  `counterTopMm + COUNTERTOP_THICKNESS_MM`) — a tall unit or a
  floor-to-ceiling pillar does, a wall cabinet mounted well above the
  counter does not. Where it does, that side's overhang drops to 0.
  Two adjacent countertop-bearing base units are deliberately NOT
  checked against each other — their overhangs merging is what a
  continuous slab run actually looks like, not a bug.
  `CountertopMesh` also no longer applies its own mesh rotation — the
  slab's box is now built directly from the already-rotated footprint
  (`currentFootprintRect`) with per-side overhangs added, so it's
  already axis-aligned in room space and rotating it again would have
  doubled the rotation.

- **"I should be able to see the dimensions of each cabinet, each
  length, breadth, height on the layout. also, the remaining spaces
  for instsance, I am trying to fit in cabinets on floor and last
  remaining space is left, I should be able to see what its dimensions
  are"** — added, in three parts:
  1. Every cabinet on the 2D plan (`CabinetLayer.tsx`) now always
     shows `moduleType` plus `width×depth×height mm`, not just its
     module type.
  2. `RemainingSpaceLayer.tsx` + `computeWallGaps`
     (`lib/surfaceAreas.ts`) auto-label the leftover floor space along
     each wall — the gap between consecutive floor-touching
     cabinets/obstacles, plus what's left at each end of the run.
     Overlapping footprints are merged into one occupied span first
     (unlike the area functions elsewhere in that file, which
     deliberately let overlaps double-count) so a gap can't come out
     negative or wrong. `MIN_GAP_MM` was originally 20mm, on the
     reasoning that a small gap was probably snap noise — dropped to
     1mm after a real 4mm gap on a 3371mm wall went unlabelled, making
     the visible numbers not sum to the actual wall length. Approximate
     is fine here; hiding a real number is not (Principle 10).
  3. A new **Wall Elevation** view (`components/elevation/`,
     `computeWallElevationItems` in `lib/surfaceAreas.ts`) — a
     straight-on, outline-only front view of one wall at a time
     (tabs + ‹ › to move between all four without leaving the view),
     built because the top-down gap number structurally can't answer
     "would a taller cabinet clear that wall unit mounted above it" —
     that needs to be seen, not inferred from two numbers. Click
     anything — an item or empty space — for a dimension arrow drawn
     on the drawing plus a text readout (width, height, depth into the
     room, height off the floor). Includes cabinets, appliances,
     obstacles, and doors/windows.

     **A real mirroring bug found and fixed along the way:** south and
     west walls initially drew as a mirror image of what you'd
     actually see standing in the kitchen facing them. Cause: the
     along-wall axis is always measured in the same room-coordinate
     direction (`WallOpening.offsetMm`'s convention), but facing south
     or west is a 180° turn from facing north or east, so the same
     room direction reads right-to-left instead of left-to-right.
     Fixed with an explicit flip for those two walls only
     (`isMirrored` in `WallElevationView.tsx`).

     **Scope note:** an identical click-to-measure-with-arrows
     treatment was tried on the 2D plan too, using the same footprint
     data (`MeasurementLayer.tsx`, since removed). Pulled back out at
     the user's request — it looked cluttered next to the cabinet
     dimension labels and remaining-space gaps already on that screen.
     The measuring feature now lives only on the Wall Elevation view.

- **"I can't add a cabinet with one open shelf and other drawer"** —
  added. `FrontLayout.kind` was a single value for the whole face — a
  cabinet was entirely `'drawers'` or entirely `'open-shelf'`, never
  both. Added a new `'mixed'` kind carrying `rows: FrontRowLayout[]`
  (top to bottom, each row any other kind with its own count/hinge/
  ratios plus a `heightRatio` share of the total height).
  `computeFrontBreakdown` (`lib/fronts.ts`) splits the face into bands
  and calls itself once per row, offsetting the results back into the
  full face — merging hardware by type across rows so two drawer rows
  read as one line instead of two. Editable via `FrontPicker.tsx`
  (a new rows editor: add/remove row, per-row kind/count/hinge/height
  share) whenever a cabinet's Configuration is set to "Mixed (stacked
  rows)".

  Nothing downstream needed to change: `Room3DCanvas.tsx` already
  draws `FrontBreakdown.panels`/`.shelves` generically (every panel
  carries its own absolute position, never assumes it spans the whole
  cabinet), so a mixed cabinet just renders as more panels/shelves in
  the same array. One real gap found and fixed along the way:
  `cabinetDrawerCount` (`lib/fixtures.ts`, the in-drawer sensor light's
  auto-quantity hint) only checked `kind === 'drawers'` directly and
  would have silently read 0 for a mixed cabinet's drawer row — now
  recurses into `rows`.

  Full reasoning, including why a row can't itself be `'mixed'` and why
  the cabinet-catalogue default-front picker deliberately does NOT get
  a rows editor (only a placed cabinet's own `FrontPicker` does), is in
  `DECISIONS.md` §3 under "Mixed fronts are a recursive composition,
  not a new geometry system."

  **Follow-up, found while testing the above:** every row's handle
  showed up at the same height — a single door, a drawer stack and a
  double door all had their handles clustered around the middle of the
  whole face instead of each sitting in its own row. Cause: a panel's
  `handle` is a NESTED `HandlePlacement` object with its own
  `centerYMm`, computed by `placeHandle()` in the row's LOCAL frame
  (band-local, before the band offset is applied). The 'mixed' case
  offset each panel's own `centerYMm` back into the full face, but
  never touched the handle object riding inside it, so every handle
  stayed at its pre-offset, band-local height. Fixed by offsetting
  `panel.handle.centerYMm` by the same `band.centerYMm` the panel
  itself gets.

- **"shouldn't sink unit have a hole on top instead of the
  stone/slab? we should be able to control its hole dimensions to be
  able to match iot with different sized sinks put in inventory by
  the businesses"** — added. `types/appliance.ts` already stated the
  limitation outright ("countertops aren't cut, so a basin reads as
  sitting ON the worktop"). Added `sinkCutoutWidthMm`/
  `sinkCutoutDepthMm` to `ApplianceCatalogItem` — sink rows only,
  editable in Manage Inventory → Your Appliances (a new column, shown
  only for the sink type) — resolved at render time by
  `resolveSinkCutout` (`lib/applianceGeometry.ts`), same
  catalogItemId-first order `resolveApplianceModel` already uses.
  Deliberately not derived from the sink's own width/depth: the real
  margin between a sink's outer size and its cutout varies per product,
  so the business types the actual number.

  `CountertopMesh` (`Room3DCanvas.tsx`) now cuts the hole — as up to 4
  boxes framing it (`countertopSegments`) rather than one box with a
  boolean-subtracted hole, avoiding a CSG dependency this project
  otherwise has no use for. Matching "this sink sits on this cabinet"
  checks both X/Y (footprint center inside the cabinet's footprint)
  AND Z (`elevationMm` close to the cabinet's own top, within
  `SINK_COUNTER_ELEVATION_TOLERANCE_MM = 100`) — X/Y alone isn't
  enough, same reason `lib/collision.ts` is Z-aware. The cutout
  rotates with the sink, and is clamped to the slab so a
  misconfigured cutout larger than the slab degrades to "no cutout"
  rather than a broken segment. Absent cutout dimensions (the default
  for every existing catalogue row) keeps the old behaviour exactly —
  nothing changes until a business fills the fields in. Full reasoning
  in `DECISIONS.md` §3 under "Sink cutout: a catalogue-row property,
  cut as a box frame not a boolean hole."

  **Follow-up, live testing:** the sink appeared to render as a plain
  surface, then pitch black, across three different attempts at
  recessing it to avoid a z-fight with the cut edge. Root cause turned
  out to be unrelated to any of that — the test sink's catalogue
  `heightMm` was 0, so there was never any sink geometry to see
  regardless of where it was positioned. Fixed by correcting the
  catalogue row, not by code; the recess attempts were reverted since
  they were solving a problem that wasn't actually there (see
  `DECISIONS.md`'s "Sink cutout" entry for the full account, including
  why the original z-fight fix is left out for now rather than
  re-added speculatively).

- **"open shelves does not seem like open, they are simply surfaces
  (inside feels like a surface on top/outside)"** — fixed. This was
  the "Cabinet carcass (B2)" work `CLAUDE.md` already listed as
  half-built: `open-shelf`/`appliance-housing` fronts rendered inside
  a single, fully sealed carcass box with the exterior finish on
  every face — there was no actual opening cut anywhere, so the shelf
  boards behind it were completely hidden and it read as a plain
  closed cabinet. Fixed with `carcassBands` (`lib/fronts.ts`, one band
  per row for a `'mixed'` front or one for the whole cabinet
  otherwise) and per-band rendering in `CabinetMesh`
  (`Room3DCanvas.tsx`): a closed band keeps the exact old sealed-box
  treatment; an open band gets a real 5-panel shell (both sides, top,
  bottom, back, no front) with a plain fixed interior liner colour
  (`PLASTER_COLOR`) instead of the exterior finish — the other half of
  what `CLAUDE.md` flagged as half-built. Because the split is per-row,
  a mixed cabinet with an open-shelf row gets a real opening for just
  that row, for free — the mixed-fronts feature didn't need to know
  anything about this. `CLAUDE.md`'s own "Half-built" note has been
  corrected in place; full reasoning in `DECISIONS.md` §3 under "Open
  carcass: 5 thin panels per open band, not a sealed box."

## 2026-09-23

- **"if a chimney goes through the cabinet then layout will be
  overlapped only. so give me an option to turn on or off the overlap
  alert thing so that we may give a proper visualization."** — added.
  A per-item `ignoreOverlap?: boolean` on `PlacedCabinetItem`,
  `PlacedApplianceItem`, and `Obstacle` (checkbox in each Inspector: "Ignore
  overlap alerts for this item"). `detectCollisions` (`lib/collision.ts`)
  skips flagging a pair when either side has it set, so muting the
  chimney silences only overlaps involving the chimney — an unrelated
  accidental overlap elsewhere still gets flagged normally. Deliberately
  NOT a single global toggle (would also hide a genuine accidental
  overlap introduced later). Full reasoning in `DECISIONS.md` §6 under
  "Overlap mute: per-item flag, not a global toggle."

- **"I can't fit 2 horizontal wall cabinets of 760mm each and one
  turned wall cabinet of 305mm on a 1825mm wall"** — no bug was ever
  found in the fit math itself, but three real bugs turned up in the
  drag-to-close-a-gap path while trying to verify it, and fixing them
  is what actually makes fitting cabinets flush by dragging reliable:
  1. The magnetic snap's capture radius (`SNAP_THRESHOLD_MM`) was
     40mm — too tight for closing a small residual gap, since an
     ordinary drag easily overshoots or stops short of that by more
     than 40mm, falling back to blind grid-rounding with no neighbor
     awareness. Raised to 100mm, and backed with a real 2D
     minimum-translation-vector fix-up (`resolveOverlaps` in
     `lib/cabinetSnapping.ts`) for the case where the fallback still
     lands inside a neighbor.
  2. That fix-up was not elevation-aware, so it could shove a base
     cabinet sideways away from a wall cabinet mounted directly above
     it — a normal, intentional stacked arrangement, not a real
     conflict. Fixed by excluding any neighbor whose height band
     doesn't actually overlap the dragged cabinet's, same Z test
     `detectCollisions` already uses.
  3. Even after the gap genuinely closed to 0mm, the red collision
     highlight sometimes stayed on with no visible gap either way.
     Root cause: the committed x/y goes through an mm -> pixel -> mm
     round trip (`canvasScale`'s `scale`, essentially never a round
     number) that can introduce ~1e-13mm of floating-point noise —
     enough, about half the time, to flip `boxesOverlap`'s strict
     inequality even though the touch was intentionally exact. Fixed
     by giving `boxesOverlap` a 0.5mm epsilon (real overlaps are still
     caught; noise-level ones are not).
  Full reasoning, including how each was confirmed against the app's
  own code rather than guessed, in `DECISIONS.md` §3.

- **Live testing, 2D plan clutter:** cabinet width×depth×height labels
  and the remaining-space gap labels together made a busy layout hard
  to read. Added a "Show dimensions" toggle above the 2D plan
  (session-only — not saved with the layout) that hides both at once;
  each cabinet's module-type label stays visible either way.

- **Live testing, gap labels next to a wall cabinet didn't match Wall
  Elevation's number for the same spot** (2D plan said 18mm, Wall
  Elevation said 7mm) — both were correct, just for two different
  things: the plan's `RemainingSpaceLayer` only ever measured gaps
  between floor-touching items, so a number next to a wall-mounted
  cabinet was actually describing whatever's on the floor beneath it,
  not the wall cabinet itself. `computeWallGaps` (`lib/surfaceAreas.ts`)
  now takes an explicit `band: 'floor' | 'wall'` and the plan draws
  both — floor gaps in teal as before, wall-cabinet-band gaps in amber
  with a `(wall)` suffix, offset further into the room so the two can
  never overlap on screen. Full reasoning in `DECISIONS.md` §6 under
  "Remaining-space gaps: floor and wall are two bands, not one."

- **"there is no tamboure unit to be put on shelf"** — added. A new
  `FrontKind: 'tambour'` (not a new cabinet type — selectable via the
  Front picker on any existing cabinet, same as open-shelf/appliance-
  housing), priced like a false-front (material + finish, no hinges, no
  handle) since nothing in the rate card prices a track mechanism yet.
  Renders as a stack of ridged slats instead of a flat panel, so it
  reads as a roll-up shutter rather than a door with a missing handle.
  Confirmed working. Full reasoning in `DECISIONS.md` §3 under
  "Tambour: a `FrontKind`, not a new module type."

- **"we don't have an L-shaped corner unit taking some space from both
  sides of L shaped kitchen"** — added, as three separate real
  solutions rather than one generic type: `'corner-blind'` (fixed
  shelves), `'corner-magic'` (pull-out mechanism), `'corner-carousel'`
  (rotating lazy susan, diagonal door) — replacing the old inert
  `'corner-unit'`. Only the carousel gets the diagonal cut, in both the
  2D plan and the 3D carcass (an extruded pentagon matched to a normal
  door's flush-fit slot) and now the countertop above it too — a
  rectangular slab was overhanging past the cut corner into thin air
  until the countertop got the same diagonal treatment, computed
  separately since `CountertopMesh` builds directly in room-space
  rather than the cabinet's own rotated frame. Magic-corner and
  carousel mechanisms are priced via two new hardware rates
  (`cornerMagic`, `cornerCarousel`) keyed on module type rather than
  front kind — the one exception to "hardware is derived from the
  front" in this app, since a magic corner and a blind corner can share
  the exact same plain door. Interior mechanism geometry (the actual
  trays/rotating shelf) and any "open this cabinet" animation are
  explicitly deferred to a later stage. Confirmed working, including
  all four rotations. Full reasoning in `DECISIONS.md` §3 under "Three
  corner solutions, not one generic corner-unit" and the two entries
  following it.
  **Migration note:** the Postgres `CHECK` constraint on
  `cabinet_catalog_items.module_type` had to be dropped and re-added
  with the new value list (`not valid` + backfill + `validate
  constraint`, since an existing `'corner-unit'` catalogue row would
  otherwise fail validation against the new list) — a real gap in the
  original migration guidance, corrected once hit.

- **"at the L point, we have a cabinet facing one side when applied
  should have a check mechanism to see if another wall will have
  cabinet placed so close that their doors/drawers are in each other's
  way... alert which can be turned off"** — added, as a new warning
  category (`lib/cabinetClearance.ts`) parallel to the existing
  door-vs-room-opening clearance rather than folded into it. Every
  floor-touching cabinet gets an implicit door/drawer reach zone (a
  hinged door swings, a drawer/trolley pulls straight out); two
  cabinets conflict if either's zone hits the other's box, or — the
  actual L-corner case — neither box is hit but the two zones cross
  each other over open floor. Visualized as a real quarter-circle arc
  plus the door leaf at 90° open (matching `OpeningLayer.tsx`'s
  existing treatment for a room door's swing), not the bounding
  rectangle itself — a rectangle never read as "a door" through three
  rounds of live-testing fixes. Mute-able per cabinet
  (`ignoreClearance`, independent of the collision system's own
  `ignoreOverlap`), plus a new global "Show clearance warnings"
  toggle (see below). Wall-mounted cabinets are correctly excluded — a
  door swinging at ~1450mm doesn't block floor-level space. The
  carousel corner unit's diagonal door gets the identical arc
  treatment, anchored to its own diagonal edge rather than a straight
  one. Full reasoning, including three real bugs found and fixed via
  live testing along the way (wall cabinets wrongly included; the
  carousel's zone on the wrong side entirely; then floating off its
  own diagonal edge; then finally a rectangle where an arc belonged),
  in `DECISIONS.md` §6.

- **Live testing: asked for a global on/off for both the overlap and
  clearance warnings, on top of the existing per-item mutes** — added.
  `showOverlapWarnings`/`showClearanceWarnings`, same session-only
  shape as the "Show dimensions" toggle. The global only ever hides
  MORE: turning it off suppresses the warning everywhere regardless of
  any item's own setting, but turning it back on never force-reveals
  something an item explicitly muted with `ignoreOverlap`/
  `ignoreClearance` — that stays respected underneath. Detection itself
  never stops running either way; only whether it's drawn changes. Full
  reasoning in `DECISIONS.md` §6 under "Global overlap/clearance
  toggles."

- **"if we want to put something in the cabinet like any appliance and
  see it in the 3D view like microwave/air fryer in the tamboure
  unit, we should be able to do it to visualize"** — added. A tambour
  front can have 0+ shelves; each shelf is its own slot with an
  appliance picker right in the cabinet's Front panel (no more manual
  placement), checked against that specific slot's real clear space
  before it's allowed. The shutter opens automatically once a slot
  has an appliance — a placeholder until a real open/close animation
  exists, at which point it should default closed instead. Full
  reasoning in `DECISIONS.md` §3.

- **"lighting was fine until I added an opening... would want to
  control that in the inventory section only. ask there if want an
  incoming light from this opening"** — resolved, but no code was
  written for it: a "Light from outside" checkbox already existed on
  the Opening Inspector (select the door/window on the 2D plan), off
  by default for a door. Confirmed working after being pointed to it —
  the shadow originally reported was not this feature failing, it was
  a case of not having found an existing control.

## 2026-09-24

- **"Failed to run sql query: ... violates check constraint
  'cabinet_catalog_items_module_type_check' ... Failing row contains
  (cat_corner_900, ..., corner-unit, ...)"** — re-running
  `supabase/schema.sql` after this session's own three-corner-solution
  change (see `DECISIONS.md`) failed, because the seed insert for
  `cat_corner_900` had been left seeding the OLD value, `'corner-unit'`
  — now rejected by the CHECK constraint that same change tightened.
  Postgres validates a row's CHECK constraints even when `on conflict
  do nothing` will end up skipping it, so this failed on every run
  against a database with the new constraint already applied,
  regardless of whether the old row existed. Fixed by replacing that
  one seed row with three (`cat_corner_blind_900`/`_magic_900`/
  `_carousel_900`), one per real product.

  Also found while fixing it: the constraint tightening itself had only
  ever been applied to this user's database by hand, from SQL given in
  chat — never folded into `schema.sql` itself, contradicting "schema.sql
  is the migration mechanism, there are no numbered migrations." Fixed
  by adding a guarded drop/re-add block (`not valid` + backfill delete of
  the stale seed row + `validate constraint`) so any database, old or
  new, ends up with the right constraint just by re-running the file —
  and corrected a comment on the table definition that pointed at a
  DECISIONS.md migration note which no longer contained the SQL after
  this session's own editorial tightening pass.

- **"there is nothing at the bottom of grand total on quote. there is
  no button for freeze or send"** — fixed. `QuoteFreezePanel.tsx` (the
  freeze/download-PDF/share-on-WhatsApp UI) existed as a real,
  self-contained component, but was never imported or rendered by
  anything — `QuoteSidebar.tsx` rendered its own totals and stopped;
  nothing in `App.tsx` referenced `QuoteFreezePanel` either. Fixed by
  rendering `<QuoteFreezePanel />` inside `QuoteSidebar`'s `<aside>`,
  right where its own header comment already said it belonged ("the
  bottom of the quote sidebar").

  Went looking for the same pattern elsewhere and found two more:
  `RateCardManager` (the rate-card editor + the amber "these are
  placeholder rates" banner `CLAUDE.md` says must never be removed) was
  also built but never rendered from `InventoryManager.tsx` — fixed,
  placed first among the managers there so the banner is the first
  thing a business sees. `FixtureModel` (a real GLB body for a placed
  light fixture, mirroring `ApplianceModel`) is ALSO built but never
  rendered — `Room3DCanvas.tsx`'s `FixtureInScene` still draws every
  fixture as a procedural bar/point shape regardless of any catalog
  `modelUrl`. Left as-is for now: cosmetic (every fixture still renders
  something, just never the real pendant GLB), not blocking, and
  belongs with the already-tracked "Assets… deliberately not wired"
  item in `DECISIONS.md` §7 rather than being fixed as a rushed
  side-effect of this investigation.

- **"why is '1' appearing as the superscript in each line's total
  value?"** — fixed. Root-caused by dumping the raw (uncompressed)
  PDF content stream and reading the actual `Tj` text-showing operator
  for a total: `( ¹\x001\x000\x00,\x001\x005\x000)` — i.e. `₹10,150`,
  not `1`. jsPDF's standard fonts (Helvetica etc.) are the base-14 PDF
  fonts under WinAnsiEncoding, which has no ₹ glyph (U+20B9); asking
  jsPDF to draw it doesn't error, it silently truncates to the code
  point's low byte (0xB9), which WinAnsi happens to map to a real but
  unrelated glyph — superscript one, "¹". So every `formatAmount`-style
  amount in the PDF specifically (not on-screen, not in the WhatsApp
  message text — both are real Unicode contexts and were never
  affected) rendered a stray superscript 1 where the ₹ should have
  been. Fixed by giving `lib/quotePdf.ts` its own ASCII-only formatter
  ("Rs. 10,150") instead of `style: 'currency'`, scoped to that one
  file — embedding a whole Unicode font for one symbol would be a lot
  of machinery for this.

## 2026-09-25

- **"loading the kitchen of Neha Verma is leading to collision
  detected error for a toaster kept inside the tambour unit"** —
  fixed. `pickTambourAppliance` (`FrontPicker.tsx`) places the chosen
  appliance DELIBERATELY inside its host cabinet's own footprint —
  that's the entire point of a tambour appliance — but never set
  `ignoreOverlap` on it, the same flag a chimney duct through a wall
  cabinet already relies on for exactly this "expected, not a real
  collision" case. Every tambour appliance read as an unfixable
  collision warning as a result. Fixed at the source (the picker now
  sets `ignoreOverlap: true`) and backfilled for existing data
  (`normalizeAppliance`, `lib/Persistence.ts`, now defaults it to
  `true` for any appliance whose `mount.kind === 'tambour'` that
  doesn't already have an explicit value) — the second part is what
  actually fixes Neha Verma's already-saved layout, since the code
  fix alone only applies to appliances placed from now on.

- **"Failed to save light fixtures: Could not find the
  'model_rotation_x_deg' column of 'light_fixture_catalog' in the
  schema cache"** — fixed. Genuine pre-existing schema gap:
  `model_url`/`model_rotation_x_deg`/`_y_deg`/`_z_deg` were never
  actually added to `light_fixture_catalog` in `schema.sql`, even
  though `FixtureCatalogItem` and `lib/fixtureCatalog.ts` always read
  and wrote them — invisible until the first real bulk write to that
  table (uploading the fixture starter file) finally tried to write a
  value into one of those columns. Fixed with four
  `alter table ... add column if not exists` statements right after
  fixtures' pricing-mode check constraint — safe to re-run per the
  file's own idempotency rule. See `docs/DECISIONS.md` §10. **Not yet
  re-verified against a live schema.sql re-run.**

- **`ERROR: 23502: null value in column "business_id" of relation
  "projects" violates not-null constraint`, re-running schema.sql**
  (surfaced while re-running the file to apply the fixture-columns fix
  above) — fixed. All 9 of this file's seed `insert`s (projects,
  layouts, surface_finishes, cabinet_catalog_items, obstacle_presets,
  appliance_catalog_items, handles, light_fixture_catalog, rate_cards)
  wrote rows without a `business_id`, relying on the column still
  being nullable at that point in a fresh run. On a database that had
  already gone through BUSINESS ISOLATION (RLS) — where business_id
  is `not null` — re-running the whole file failed immediately,
  because `on conflict (id) do nothing` only suppresses a UNIQUE
  conflict; it does not suppress a NOT NULL violation, which Postgres
  checks first, before conflict resolution even runs. So this broke
  even for rows that already existed and should have been silently
  skipped. Fixed by adding `business_id = 'biz_default'` explicitly to
  all 9 inserts' column lists and every value tuple — not a column
  default, which would have quietly defeated the "no silent
  business_id default" rule this file already established for the
  app's own write paths. See `docs/DECISIONS.md` §9.

- **"if I go to inventory, the screen goes blank and it moves to the
  dashboard automatically after a few seconds"** — not a code bug.
  Root cause: ~8 new npm packages (`radix-ui`, `cn`, `lucide-react`,
  `sonner`, `next-themes`, `class-variance-authority`,
  `tw-animate-css`, `@fontsource-variable/geist`) were installed
  mid-session (shadcn/ui adoption, `docs/DECISIONS.md` §11) while the
  dev server was still running from before. The first request that
  imported one of them forced Vite to stop, re-optimize its dependency
  cache, and do a full page reload — which looks exactly like this:
  blank for a couple seconds, then back to whatever the app's default
  screen is (`dashboard`, since `view` is a plain `useState` with no
  URL-based routing). Fixed by fully restarting `npm run dev` (not
  just refreshing the browser). Same class of issue as the earlier
  "new catalog items invisible until refresh" bug this session — see
  that entry above.

- **Per-row delete used a native `window.confirm()` popup, not an
  in-app dialog** — fixed. Built a small reusable imperative confirm
  dialog (`confirmDialog()`, `store/confirmDialogStore.ts` +
  `components/common/ConfirmDialog.tsx`, using shadcn's
  `AlertDialog`) mirroring how `toast()` already works — call it from
  anywhere, no per-caller markup, one instance mounted in `App.tsx`.
  Replaced all 6 `window.confirm` call sites (cabinets, obstacles,
  appliances, handles, fixtures, finishes). See `docs/DECISIONS.md` §11.
