# my-app — kitchen renovation designer

Operating manual. Loaded into every session, so it stays short.
Reasoning and bug history live in `docs/DECISIONS.md` — read that
before changing anything in pricing, lighting, or wall geometry.

## What this is

A kitchen design and quoting tool for small/medium interior businesses
in India, Delhi NCR specifically. One flow: draw a 2D floor plan → walk
through it in 3D → produce an itemised quote → track the customer
through a pipeline.

Design assumptions that come from that market, not from taste:

- Rooms are compact — 6×8 ft to 12×14 ft.
- Structural pillars and exposed plumbing shafts are normal, not edge
  cases. They're modelled as obstacles that consume wall and floor area.
- Module types include `cylinder-trolley` and `sink-unit`
  (`src/types/cabinet.ts`).
- Electrical work is usually a separate contractor, so lighting is
  designed and specified but its cost is behind one global toggle
  (`layout.priceElectrical`).
- Everything is priced in ₹, labour per **sq ft** (still the trade's
  billing unit) while all geometry is in **mm**.

## Stack

Versions from `package.json` — check there, don't trust this list after
any upgrade.

| Package | Version |
|---|---|
| react / react-dom | ^19.2.8 |
| typescript | ~6.0.2 |
| vite | ^8.2.2 |
| zustand | ^5.0.15 |
| konva / react-konva | ^10.3.2 / ^19.2.5 |
| three | ^0.170.0 |
| @react-three/fiber | ^9.0.0 |
| @react-three/drei | ^10.0.0 |
| @supabase/supabase-js | ^2.112.4 |
| tailwindcss + @tailwindcss/vite | v4 (see below) |

**`package.json` has been incomplete before, and in a specific way.**
It was once an empty stub and was reconstructed by scanning TypeScript
imports — which silently missed every dependency that nothing in `src/`
imports. Tailwind was the casualty: 31 components use its classes, but
it is referenced only by `vite.config.ts` and the CSS entry, so it was
invisible to that scan and the app failed with
`could not resolve '@tailwindcss/vite'` on a fresh install.

If a build fails on an unresolved module, check whether it is merely
absent from `package.json` rather than assuming a code problem. The
candidates are anything reached from `vite.config.ts`, `eslint.config.js`
or CSS rather than from TypeScript — the Tailwind plugin, and
`babel-plugin-react-compiler` if the React Compiler is wired through
Babel.

Tailwind is **v4**: the CSS entry uses `@import "tailwindcss";`, not the
v3 `@tailwind base/components/utilities` directives, and there is no
`tailwind.config.js`.

`npm run dev` / `npm run build` (`tsc -b && vite build`) / `npm run lint`.

**There is no test runner.** No vitest, jest or playwright. Correctness
here is `tsc`, `eslint`, and looking at the render.

**React 19's compiler is active.** It rejects mutating anything
returned from a hook. This has caused two real errors: writing
`gl.toneMappingExposure` where `gl` came from `useThree()` (fixed by
moving the write into a `useFrame` callback parameter), and syncing
state in an effect body (fixed by adjusting state during render). Do
not reach for an eslint-disable; restructure.

## Coordinate conventions

The easiest thing to break, and every failure is silent — no error, just
a wrong picture.

- **2D**: millimetres, origin top-left, Konva rotation is **clockwise**.
- **3D**: metres, **Y-up**, via `MM_TO_M = 0.001` (`src/lib/scene3d.ts`).
- **Room x/y → world x/z.** `groundPosition(xMm, yMm)` returns
  `[worldX, worldZ]`. Plan *depth* is world Z; height is world Y.
  Getting this swap wrong aims lights sideways.
- Rotation: `clockwiseDegToThreeY(deg) = -(deg * π / 180)`.
- **An item's `x`/`y` is always the UNROTATED top-left corner.** The
  rotation-invariant quantity is the **centre**. Never mix a rotated
  extent with the unrotated corner — that was a real bug in
  `surfaceAreas.ts`. Use `src/lib/footprint.ts`
  (`getFootprint`, `currentFootprintRect`, `clampFootprintCenter`); it
  exists so cabinets and appliances can't diverge.
- **`elevationMm` is the height of an item's BOTTOM face off the
  floor** — shared by cabinets, appliances and obstacles, and used by
  Z-aware collision.

## Naming and schema traps

**`projects` vs "customer".** The table is `projects`. The UI-facing
word is "customer". `CustomerProject` (`src/types/customer.ts`) maps
onto `projects`, and `layouts.project_id` references `projects.id`.
Don't rename it — a migration for no functional gain.

**All ids are `text`, generated client-side** with
`crypto.randomUUID()`. Not `uuid`. Stated at the top of
`supabase/schema.sql`, repeated here because ignoring it produces a
foreign-key type error (`incompatible types: uuid and text`) — which is
exactly what happened when the `quotes` table was first written.

**Cabinets, appliances, obstacles, walls, cameras and fixtures are
JSONB arrays on the `layouts` row**, not their own tables. Ten tables
total: `projects`, `layouts`, `surface_finishes`,
`cabinet_catalog_items`, `obstacle_presets`, `appliance_catalog_items`,
`handles`, `light_fixture_catalog`, `rate_cards`, `quotes`.

**`schema.sql` is idempotent and is the migration mechanism.** Every
statement is `if not exists` / `on conflict do nothing`, so re-running
the whole file is always safe and never overwrites a business's edited
rates. There are no numbered migrations. Keep it that way.

**RLS is disabled on every table, and both storage buckets
(`panoramas`, `material-swatches`) are public.** Single-business MVP;
there is no tenant column anywhere. The anon key ships in browser code,
so this is a dev/demo posture — see the end of
`docs/SUPABASE_SETUP.md`.

**Supabase credentials come only from `.env`** (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`). Nothing hardcodes a project id, so switching
databases is a `.env` change and no code change. `.env` is not in the
repo — it is created by hand per machine. Setup:
`docs/SUPABASE_SETUP.md`.

## Pricing rules

**`calculateBOM(items, appliances, ctx)` takes one REQUIRED
`PricingContext`.** It previously took six positional parameters, five
with `= []` defaults, and that silently priced hardware at ₹0 on every
quote — twice. Never give this parameter a default. A missed field must
stay a compile error. Both call sites (`src/hooks/useBOM.ts`,
`saveProject` in `src/store/layoutStore.ts`) must pass the same
context, or the sidebar and the saved total disagree.

**Every seeded rate is a placeholder.** `rate_cards` seeds labour at
₹150/sq ft and hinge/channel/basket/shelf at 120/450/1400/350; handle
and fixture catalogue prices are likewise invented. They are the right
order of magnitude for Delhi NCR retail and they are **not a price
list**. `RateCardManager` shows an amber banner while they're
untouched. Do not remove that banner, and don't present a quote built
on them as final.

**A frozen quote never changes.** `quotes` rows are written once. A
revision is a new `version`, never an edit. Nothing should ever `UPDATE`
a quotes row's `summary`.

**Units differ per hardware row and are not all piece counts.**
`channel` is a **pair** of runners; a gola or edge profile's count is
running **metres**. See `HardwareSpec` in `src/types/cabinet.ts`.

## Verification, and its limits

If you are working in a scratch copy that the user copies into
`/Users/dgoyal2/my-app`, say so and expect that:

- **macOS is case-insensitive.** A stale duplicate differing only in
  case shadows the real file and produces genuinely baffling bugs. This
  has happened — 14 files once. Check for it before debugging anything
  inexplicable.
- Without `npm`/`tsc`/a browser, you cannot type-check or render.
  Python mirrors of the maths and static scans over the source are
  useful, but they are **not** a compiler.

**Label unverified claims as unverified.** Say "static scan only, not
type-checked" rather than "verified". Two scanners in this project's
history produced false positives that nearly became conclusions: a
guard string that matched the comment it was checking for, and an
unused-import check that split `type X` inline imports and searched for
the literal `"type RateCard"`. Distrust your own tooling before you
trust it.

Always ask the user to run `npx tsc --noEmit` before trusting a change.

## Current state

**Working:** 2D plan (room, obstacles, cabinets, appliances, doors and
windows, light fixtures, overlap picker, unified selection, clearance
and collision detection); parametric cabinet fronts with derived
hardware; 3D walkthrough with camera nodes and 360° panorama capture;
three lighting modes with a device-selectable light budget and an
exposure control; itemised quote with a global electrical toggle; rate
card; quote snapshotting; customer pipeline dashboard; Supabase
persistence; inventory managers for finishes, handles, fixtures,
cabinets and appliances.

**Half-built:**

- **Cabinet carcass ("B2").** `appliance-housing` and `open-shelf`
  fronts still render inside a sealed box, so an open shelf reads as a
  missing door. Interiors use the shutter finish rather than a white
  liner. The `inside` cabinet-light mount is deferred.
- **Assets.** `public/textures/` (15 ambientCG CC0 PBR sets) and
  `public/models/` (10 GLBs) exist. Several are deliberately unwired —
  see `docs/DECISIONS.md` and `public/models/CREDITS*.md`. There is no
  HDRI, so `<Environment>` uses hand-built `Lightformer` panels.

**Not started:** quote export (PDF / WhatsApp / share link) — the last
piece of the original brief, and the reason a quote currently cannot
leave the app. Multi-tenancy. Draco decoding.

## House style

Comments explain **why**, not what, and several encode arguments that
were worked through and should not be flattened — e.g. the
`HandleSpec` note on why a handle is not a `SurfaceFinish`, the
`textures3d.ts` note on colour space and on returning null rather than
substituting a map, and the `types/quote.ts` note on fingerprints
versus timestamps. Add to them; don't paraphrase them away.

Where this file and a code comment disagree, **the code comment is
closer to the truth** — it sits next to what it describes.
