# Prompt for Claude Code — wiring the `public/` visual assets

Paste everything below the line into Claude Code, in the `my-app` repo root.

---

## Context

`public/textures/` and `public/models/` were populated in an earlier session
by `scripts/fetch_textures.py`, `scripts/fetch_models.py` and
`scripts/build_placeholder_models.mjs`. The files are on disk and credited,
but several of them are **organised rather than wired** — the credits files
say so themselves. This task connects them to the renderer and fixes the
scale/lighting problems that currently make the 3D view read as flat.

Current inventory (verified on disk):

- **15 texture sets**, each `color.jpg` + `normal.jpg` + `roughness.jpg`,
  1K JPG, CC0 ambientCG:
  - Legacy procedural-replacement set: `wood`, `quartz`, `tile`
  - Finish-backing set (12): `wood-dark-walnut`, `wood-plywood-edge`,
    `wood-reclaimed`, `stone-black-granite`, `stone-white-quartz`,
    `stone-concrete`, `metal-brushed-steel`, `metal-polished-chrome`,
    `metal-matte-black`, `metal-brushed-brass`,
    `tile-large-ceramic-floor`, `tile-moroccan-geometric`
  - All are 1024×1024 **except `stone-concrete`, which is 1024×512**.
- **10 GLB models**, 7.7 MB total:
  - Real scans: `appliances/cooktop-induction.glb` (2.4 MB),
    `appliances/microwave.glb` (2.1 MB),
    `lighting/pendant-industrial.glb` (3.1 MB)
  - Kenney furniture kit: `kitchen-sink.glb`, `kitchen-stove.glb`,
    `range-hood.glb`
  - **Generated box-stack placeholders** (do not wire — see Task 6):
    `hob-gas-4burner.glb`, `oven-built-in.glb`,
    `sink-undermount-single.glb`, `sink-topmount-double.glb`
- **No HDRI / environment map anywhere.** This is the gap that holds back
  everything else.

Work through the tasks **in order** — Task 1 is a prerequisite for Task 3,
and Task 2 changes what Task 3 looks like. Commit after each task so any one
can be reverted independently.

Before starting, read these to confirm the current shape of things (paths as
of the last session — verify, don't assume, and tell me if any have moved):
`src/types/finish.ts`, `src/lib/textures3d.ts`, `src/lib/materials3d.ts`,
`src/types/front.ts` (HandleSpec), `src/types/fixture.ts`
(FixtureCatalogItem), `src/types/opening.ts` (WallOpening),
`src/components/canvas3d/Room3DCanvas.tsx`,
`src/components/canvas3d/ApplianceModel.tsx`, `supabase/schema.sql`.

---

## Task 1 — Self-host an HDRI environment map

**Why first.** `<Environment preset="apartment">` in `Room3DCanvas.tsx`
fetches an HDR from drei's CDN at runtime. Two problems: it breaks with no
network, and more importantly it is the *only* thing supplying reflections.
Four metal finishes and three stone finishes were just added — with no real
environment map, polished chrome and quartz render as flat grey no matter how
good their maps are. A metal surface is almost entirely a reflection of its
surroundings; give it nothing to reflect and it looks like painted cardboard.

**Do:**

1. Download one CC0 **indoor** HDRI from Poly Haven at **1K or 2K** (not 4K —
   see the weight budget in Task 6). Good candidates:
   `studio_small_09`, `lebombo`, `small_empty_room_1`. An indoor HDRI matters:
   an outdoor sky map puts a blue cast and a hard sun on every glossy front.
2. Save to `public/hdri/<name>.hdr`. Extend `scripts/fetch_models.py` (or add
   `scripts/fetch_hdri.py` following the same shape) so this is reproducible
   rather than a hand-download, and write a `public/hdri/CREDITS.md` matching
   the existing credits format.
3. In `Room3DCanvas.tsx`, replace `preset="apartment"` with
   `files="/hdri/<name>.hdr"`. Keep the existing `<Lightformer>` panels only
   if they still improve the result once a real HDRI is in — test both and
   tell me which you kept and why.
4. Keep `background={false}` (or whatever the current setting is) — the HDRI
   should light the room, not become a visible skybox behind the walls.

**Acceptance:** the 3D view makes no network request to any CDN at runtime;
`metal-polished-chrome` on a handle or sink shows a recognisable bright/dark
reflection gradient rather than a uniform grey.

---

## Task 2 — Correct physical scale and relief on the 12 finish rows

**Why.** `SurfaceFinish.swatchWidthMm` / `swatchHeightMm` declares what
real-world area one copy of the albedo covers. If these are wrong, walnut
grain renders at four times life size and reads as burl plywood; ceramic tiles
render as mosaic or as slabs. This is the single biggest realism lever in the
folder and it costs nothing but correct numbers.

**Do:**

1. Find where the 12 finishes are seeded (`scripts/seed_finishes_and_appliances.mjs`
   per `textures/CREDITS_FINISHES.md`, plus any seed rows in
   `supabase/schema.sql`). Report what `swatchWidthMm`/`swatchHeightMm` and
   `reliefStrength` they currently carry.

2. **Get the real physical size for each ambientCG asset rather than guessing.**
   ambientCG publishes a physical dimension per asset; the asset IDs are in
   `public/textures/CREDITS_FINISHES.md` and in each folder's `SOURCE.txt`.
   Try `https://ambientcg.com/api/v2/full_json?id=<assetId>` and read the
   dimension fields. If that is unreachable, fall back to the estimates in the
   table below — but **mark in the code comment which values were verified and
   which were estimated**, so the guesses are visible rather than laundered
   into looking authoritative.

   | folder | assetId | starting estimate (mm) | note |
   |---|---|---|---|
   | wood-dark-walnut | Wood051 | 1000 × 1000 | plank scan |
   | wood-plywood-edge | Chipboard004 | 1000 × 1000 | |
   | wood-reclaimed | Wood066 | 1000 × 1000 | |
   | stone-black-granite | Granite002A | 1000 × 1000 | |
   | stone-white-quartz | Marble021 | 2000 × 2000 | veining wants a large repeat |
   | stone-concrete | Concrete034 | **2000 × 1000** | **2:1 image — see below** |
   | metal-brushed-steel | Metal050A | 500 × 500 | small; brush lines |
   | metal-polished-chrome | Metal032 | 500 × 500 | |
   | metal-matte-black | Metal046A | 500 × 500 | |
   | metal-brushed-brass | Metal048A | 500 × 500 | |
   | tile-large-ceramic-floor | Tiles141 | set so **one tile = 600 mm** | count tiles in the image first |
   | tile-moroccan-geometric | Tiles138 | set so **one tile = 200 mm** | count tiles in the image first |

3. **`stone-concrete` is 1024×512, a 2:1 image.** If it was seeded with equal
   width and height it is currently rendering horizontally squashed. Its mm
   values must keep the 2:1 aspect.

4. **For the two tile sets, open the image and count the tiles per repeat**
   before setting the numbers. The mm value describes the whole texture repeat,
   not one tile — a 2×2 grid of 600 mm tiles is a 1200 mm swatch. Getting this
   backwards is the classic version of this bug.

5. **Lower `reliefStrength` on all 12.** Per the comment in `types/finish.ts`,
   real normal maps override the luminance-derived relief in `textures3d.ts`.
   Where a genuine `normalMapUrl` is present, the derived relief should not
   also be applied — check `materials3d.ts` for whether both are currently
   stacking, and if they are, that is a bug to fix rather than a value to tune.
   Metals and polished stone want near-zero relief; only the tiles want real
   depth (grout lines).

6. **Set `tilingMode: 'repeat'`, not `'mirror'`, for all 12.** These are
   ambientCG scans, which tile seamlessly by construction. `'mirror'` exists
   for photographed swatches that don't; using it here costs visible symmetry
   for no benefit.

**Acceptance:** place a 600 mm base cabinet in walnut next to a 3 m run of
floor tile — grain and grout read at plausible physical size in both, and
neither changes scale when the cabinet is resized. Concrete is not squashed.

---

## Task 3 — Real metal on handles, sink and chimney

**Why.** Four metal texture sets are sitting unused. The eye finds the
specular highlight on hardware first — it's what makes a render read as a
photograph rather than a diagram. Handles are currently a flat `colorHex` plus
`metalness`/`roughness` scalars.

**Read `HandleSpec` in `src/types/front.ts` first.** There is a deliberate
design note there explaining why a handle is *not* a `SurfaceFinish`
reference: handles are solid metal, priced per unit or per metre, and share
none of a laminate's pattern/tiling machinery. **Respect that decision.** Do
not make handles reference finishes.

**Do:**

1. After Task 1 is in, **re-evaluate whether this task is still needed.** With
   a real HDRI, a plain `colorHex` + `metalness: 0.9` + `roughness: 0.35`
   already reads convincingly as brushed steel, because reflection is doing
   the work rather than albedo. Render before and after Task 1 and tell me
   whether maps still add enough to justify the schema change. **If they
   don't, say so and skip to step 4** — I would rather not carry three unused
   columns.

2. If maps do help: add three optional columns to the `handles` table
   (`albedo_url`, `normal_map_url`, `roughness_map_url`, all nullable text)
   and the matching optional fields to `HandleSpec`. No tiling or pattern
   fields — that's the machinery the design note is keeping out. Follow the
   existing idempotent `alter table ... drop constraint if exists` pattern in
   `schema.sql`, and update `src/lib/handles.ts` CRUD plus the handle editor UI.

3. **UV orientation gotcha:** a brushed-metal scan has directional grain. On a
   128 mm bar handle the brush lines must run *along* the bar, not around it.
   Check how `HandleMesh` in `Room3DCanvas.tsx` builds its geometry and set the
   texture rotation/repeat accordingly — brush lines running the wrong way are
   more obviously wrong than no texture at all.

4. **Regardless of the above**, point the sink and chimney/range-hood
   materials at `metal-brushed-steel`. These are large, always-visible metal
   objects currently rendering as flat grey boxes or untextured GLBs, and they
   need no schema change.

**Acceptance:** a screenshot from inside the room shows handles and sink
catching a highlight that moves as the camera orbits.

---

## Task 4 — Wire `pendant-industrial.glb`

**Why.** `models/CREDITS_SOURCED.md` states plainly: *"Organized for future
use only — FixtureCatalogItem (types/fixture.ts) has no modelUrl field yet, so
this isn't wired into the app."* A 3.1 MB asset is sitting on disk doing
nothing. This also helps the long-running "the light glows but doesn't light
the room" complaint: a recognisable lamp body reads as correct lighting even
when the pool it casts is subtle, whereas a featureless emissive blob reads as
broken.

**Do:**

1. Add `modelUrl?: string` to `FixtureCatalogItem` in `src/types/fixture.ts`,
   plus `model_url text` on `light_fixture_catalog` in `schema.sql`, and the
   field in the fixture catalogue editor UI — mirroring exactly how
   `appliance_catalog_items.model_url` and its `InventoryManager` field work,
   so there is one pattern rather than two.
2. Also mirror the appliance orientation correction: appliances carry
   `model_rotation_x/y/z_deg` because GLB authors don't agree on up-axis. A
   pendant hanging sideways is the same bug. Add the same three columns.
3. In `Room3DCanvas.tsx`, `FixtureInScene` should render the GLB when
   `modelUrl` is set, falling back to the current primitive when it is not or
   when loading fails — reuse the normalise-and-scale logic in
   `ApplianceModel.tsx` rather than writing a second copy. `models/README.md`
   documents that behaviour; keep it true.
4. **The emissive part must stay separate from the model.** The light source
   and its glow are computed from the fixture's lumens/temperature; the GLB is
   body geometry only. Don't let a model with a baked-bright material
   reintroduce the "bright by itself, lights nothing" symptom we just fixed.
5. Seed the industrial pendant as a catalogue row pointing at
   `/models/lighting/pendant-industrial.glb`.

**Acceptance:** placing a pendant shows a lamp hanging at the right height and
orientation, casting a pool on the counter below; deleting the `modelUrl`
falls back cleanly to the primitive with a console warning and no blank view.

---

## Task 5 — Window backdrops

**Why.** `WallOpening.backdropUrl` already exists in `src/types/opening.ts`
and there is no image anywhere for it to point at. A window showing a real
view instead of a flat panel is the cheapest large jump in perceived quality
in this whole list.

**Do:**

1. Add 2–3 CC0 exterior JPGs to `public/backdrops/` — one urban balcony/
   building view (the Delhi NCR default), one green/tree view, one plain sky.
   Source them the same reproducible way as everything else, with a
   `CREDITS.md`. Downscale to ~1600 px wide; these sit behind a window opening
   and are never inspected closely.
2. Seed them as selectable options in the opening inspector so a user picks
   from a dropdown rather than typing a URL, while leaving the free-text URL
   field for a business's own photo of the actual site.
3. Check the backdrop plane's placement: it must sit *outside* the wall
   thickness and be large enough that the frame edges are never visible
   through the opening at oblique viewing angles. Confirm this by orbiting to
   a shallow angle, which is where it will break if it's going to.

**Acceptance:** from inside the room, a window shows a view with visible
parallax against the wall, and no backdrop edge is visible from any camera
position inside the room.

---

## Task 6 — Asset weight and what NOT to wire

**Why.** This app targets small businesses in Delhi NCR, often on mobile data.
Three GLBs account for 7.6 MB of the 7.7 MB model budget, and texture memory
is worse than the disk figures suggest: **a 1024² JPG decodes to roughly 4 MB
of VRAM regardless of its 500 KB on disk.** 15 sets × 3 maps is on the order
of 180 MB of texture memory if everything loads at once — enough to make a
mid-range Android tab drop frames or lose the WebGL context entirely.

**Do:**

1. **Verify textures load lazily, per finish actually used in the layout** —
   not eagerly at app start, and not all 15 sets because the picker is open.
   If they are eager today, fix that; it is the single most important item in
   this task.
2. Dispose textures and geometries when a finish stops being used, and confirm
   `THREE.WebGLRenderer.info.memory` doesn't climb without bound as finishes
   are switched repeatedly. Report the before/after numbers.
3. Downscale to 512² anything never seen close up — floor tile and concrete
   are viewed at a distance; cabinet-front wood and metal handles are not.
   Keep 1K only where it earns it, and record the choice per set.
4. Consider re-exporting the three heavy GLBs at lower poly/texture budget.
   Do **not** add Draco — `models/README.md` correctly notes the loader has no
   decoder configured, and adding one is its own task.

**Do NOT wire these four models:** `hob-gas-4burner.glb`,
`oven-built-in.glb`, `sink-undermount-single.glb`, `sink-topmount-double.glb`.
Per `models/CREDITS.md` they are generated box stacks, not real assets. A box
stack pretending to be an oven reads *worse* than the plain parametric box,
because it promises detail it doesn't have. Leave them until real CC0 assets
turn up. Likewise `kitchen-sink.glb` has no wiring point — `PlacedCabinetItem`
has no `modelUrl` field the way appliances do, and adding one is a separate
decision, not part of this work.

---

## Where `modelUrl` belongs, and where it doesn't

Task 4 adds `modelUrl` to fixtures, so it will then exist on appliances and
fixtures but not on cabinets or handles. That asymmetry is intentional. **Do
not "fix" it by adding `modelUrl` everywhere for consistency.**

The rule: *`modelUrl` belongs on things whose shape is fixed and bought;
parametric geometry belongs on things whose shape is derived from the
dimensions the quote is priced against.*

- **Appliances — mesh.** A microwave is a manufactured object at a catalogue
  size. Correct as-is.
- **Fixtures — mesh.** Same reasoning. That's Task 4.
- **Cabinets — never a mesh.** A cabinet is built from `FrontLayout` at
  whatever width and height the user set. `ApplianceModel` scales **per-axis**
  to stored dimensions, so a 600 mm cabinet GLB stretched to 900 mm would
  smear the shutter, stretch the reveals and grow the handle with the door —
  the exact failure the parametric front system was built to avoid. Cabinets
  get their appearance from **finishes**, i.e. the texture sets in Tasks 2
  and 3. They are already the largest consumer of these assets.
- **Handles — split by kind.** `bar`, `edge-profile` and `gola` are
  length-parametric: 128 mm and 320 mm are the same shape at different
  lengths, and stretching a mesh would deform end caps and mounting bosses.
  These stay geometry + material. **`knob` is the exception** — a fixed object
  with one meaningful dimension, whose shape is the thing being sold. If a
  `modelUrl` is ever added on the cabinet side, `knob` is the only defensible
  place for it.

Nothing here is blocking today: there is no cabinet, handle or knob GLB in
`public/models/`. Do not add the field speculatively. If you think a case
above is wrong, argue it rather than implementing it.

## Constraints

- **No new runtime CDN dependencies.** The point of Task 1 is removing one.
- **Don't suppress lint or type errors.** If React Compiler objects (it has
  before, on `gl` mutation from `useThree()`), restructure the code — the last
  fix moved the write into a `useFrame` callback parameter. Don't add an
  eslint-disable.
- **Keep every rate and price out of this work.** These tasks are appearance
  only; nothing here should move a quote total. If a change would alter
  `calculateBOM` output, stop and tell me instead.
- **Preserve the existing comment style.** This codebase explains *why*, not
  *what*, and several comments encode decisions that were argued through
  (the HandleSpec note, the null-vs-substitute note in `textures3d.ts`, the
  colour-space note). Don't strip or paraphrase them; add to them.

## Verify before reporting done

- `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` succeeds.
- Screenshots from inside the room, before and after, for Tasks 1, 3, 4, 5.
- Re-run whatever texture/model sync scripts exist and confirm they're
  idempotent — re-running `schema.sql` must not error.
- State explicitly which ambientCG dimensions you **verified** versus
  **estimated** (Task 2 step 2), and which acceptance checks you actually ran
  versus reasoned about.

## Report back

For each task: what changed, which files, what you tested, and anything you
disagreed with. In particular I want a straight answer on **Task 3 step 1** —
whether handle texture maps still earn their schema change once a real HDRI is
in place. If the answer is no, say no.
