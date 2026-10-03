# my-app — kitchen renovation designer

**This file belongs at the REPO ROOT, not in `docs/`.** Claude Code
auto-loads `CLAUDE.md` from the project root only. It was found in
`docs/` once, which means sessions had been starting without any of the
conventions below — silently, since nothing reports a missing file.

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

`npm run dev` / `npm run build` (`tsc -b && vite build`) / `npm run lint`
/ `npm test` (Vitest, `vitest run`).

**Tests: Vitest, `npm test`** — added 3 Oct 2026 (`docs/DECISIONS.md`
§55). This line used to say "There is no test runner … correctness here
is `tsc`, `eslint`, and looking at the render"; that was true until the
pricing, cutting-list and nesting code grew big enough that hand-run
checks kept being thrown away and regressions (a shelf double charge, an
import that wiped data) slipped through. Tests sit beside the code they
check (`src/lib/*.test.ts`), with shared builders in `src/test/
fixtures.ts`. **Run `npm test` before trusting a change to pricing, the
cutting list, nesting, panels or the importers, and add a test for any
money or size rule you add or fix.** UI is still checked by `tsc`,
`eslint` and looking at the render — there are no component or browser
tests.

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
JSONB arrays on the `layouts` row**, not their own tables. Eleven
business-data tables: `projects`, `layouts`, `surface_finishes`,
`cabinet_catalog_items`, `obstacle_presets`, `appliance_catalog_items`,
`handles`, `light_fixture_catalog`, `rate_cards`, `quotes`,
`construction_settings` (plus the auth tables `businesses`,
`business_users`, `super_admins`). This said "ten" until 29 Sep 2026,
when `construction_settings` was added for the cutting list
(`docs/DECISIONS.md` §41). Since §42 construction settings ARE a
priced input — board is priced on the cutting list's real part sizes —
so they're passed as `PricingContext.construction` (required) and
hashed into the frozen-quote fingerprint. (This paragraph said in §41
that construction never changes a price; that stopped being true.)

**`schema.sql` is idempotent and is the migration mechanism.** Every
statement is `if not exists` / `on conflict do nothing`, so re-running
the whole file is always safe and never overwrites a business's edited
rates. There are no numbered migrations. Keep it that way.

**Real auth + RLS are live.** Every table has a `business_id` column
and RLS policies scoped to it (`current_business_id()`, keyed off
`business_users` — see `supabase/schema.sql`'s "BUSINESS ISOLATION
(RLS)" block), plus a `super_admins` bypass for the software owner.
Sign-in is real (Supabase Auth, `src/store/authStore.ts`) but there is
no self-serve sign-up — one business exists today, created via a
manual step in `docs/SUPABASE_SETUP.md`. `business_id` is passed
explicitly by every write path (never a silent DB default — see the
`calculateBOM`/`PricingContext` story above; this is the same lesson
applied again). The three storage buckets (`panoramas`,
`material-swatches`, `quote-pdfs`) still allow public READ — a
customer opens a quote PDF link with no account, which is the point —
but uploading to them now requires being signed in.

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

**Run `npx tsc --noEmit -p tsconfig.app.json` before trusting a change
— NOT bare `npx tsc --noEmit`.** This was wrong here for a real reason,
not a typo: the root `tsconfig.json` is a solution-style file
(`"files": []`, only `references`), meant for `tsc -b`. A bare
`tsc --noEmit` against it type-checks ZERO files and exits clean no
matter what's broken — a silent no-op that reads exactly like a
passing check. This was believed to be "clean" for a stretch of a
session before the mistake was caught, during which a real type error
(a closure-narrowing bug in `ObstacleInspector.tsx`, same class of
issue as the one already documented in `lib/fixtures.ts`) sat
uncaught. `npm run build` (`tsc -b && vite build`) is unaffected — it
already builds via the referenced project — so this only matters for
an ad hoc `tsc --noEmit` sanity check.

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

- **Cabinet carcass ("B2").** RESOLVED for the two things this used to
  say: `appliance-housing`/`open-shelf` fronts (whole-cabinet, or a
  single row of a `'mixed'` front — see `carcassBands` in
  `lib/fronts.ts`) now get a genuinely open carcass — 5 thin panels,
  no sealed front — instead of rendering inside a fully closed box,
  and the inside of that opening uses a fixed plain liner colour
  (`PLASTER_COLOR` in `Room3DCanvas.tsx`) rather than the exterior
  shutter finish. The `inside` cabinet-light mount is still deferred —
  that's a fixture-mounting gap, unrelated to the carcass geometry
  itself, and wasn't touched by this fix.
- **Assets.** `public/textures/` (15 ambientCG CC0 PBR sets) and
  `public/models/` (10 GLBs) exist. Several are deliberately unwired —
  see `docs/DECISIONS.md` and `public/models/CREDITS*.md`. There is no
  HDRI, so `<Environment>` uses hand-built `Lightformer` panels.

**Not started:** quote export (PDF / WhatsApp / share link) — the last
piece of the original brief, and the reason a quote currently cannot
leave the app. Multi-tenancy. Draco decoding.

## Keeping the documents true

These files are only worth loading if they stay accurate. Three rules,
and they are obligations on you, not suggestions.

**When you make a non-obvious decision, record it in
`docs/DECISIONS.md`** — what was chosen, what was rejected, and WHY.
The why is the part that cannot be recovered from the code later. Also
record failed approaches: "X was tried and broke because Y" is the
highest-value content in that file, because without it the next
session retries X.

**When a decision changes what the product is trying to be, update
`docs/PRINCIPLES.md`** — and say so out loud, because that is a bigger
change than a code edit and the user should agree to it explicitly.
Part 1 (the principles) should change rarely; Part 2 (the roadmap)
changes often.

**When you fix something from `docs/ISSUES.md`, move it to a "Fixed"
section in that file with the date — never delete it.** Two reasons: a
regression is only recognisable if the original report survives, and the
pattern of what keeps breaking says more about where the app is
structurally weak than any single fix does. If a fix turns out to be
interesting — a wrong assumption, a non-obvious cause — it also belongs
in `docs/DECISIONS.md`.

**When you find that a document is wrong, correct it and say what was
wrong** rather than quietly overwriting. There is precedent: the
fingerprint reasoning in `types/quote.ts` was corrected in place with a
note explaining that the original claim about cabinets being a separate
table was false. A silent correction loses the information that someone
once believed the wrong thing.

## At the end of a working session

**Update `docs/STATUS.md`.** It is the bridge to planning conversations
held outside this repo — a Claude Project cannot see these files, so
that one document is what gets pasted across. Keep it a snapshot, not a
history: what is built, what is not, what is unverified, what is
blocked, what is next. Reasoning belongs in `docs/DECISIONS.md`.

Then remind the user to commit and push. A session's work that is not
pushed does not survive a lost laptop.

## Document map

- `CLAUDE.md` (this file) — conventions and traps. Loaded every session.
- `docs/PRINCIPLES.md` — what the product is trying to be, and the
  roadmap. Read before proposing direction.
- `docs/DECISIONS.md` — why things are the way they are, and the bug
  history. Read before changing pricing, lighting or wall geometry.
- `docs/STATUS.md` — current state, for conversations outside the repo.
- `docs/ISSUES.md` — problems found in real use, when present.
- `docs/SUPABASE_SETUP.md`, `docs/SETUP_NEW_MACHINE.md` — environment.
- `docs/PROJECT_INSTRUCTIONS.md` — custom instructions for the separate
  Claude Project. Not used by this repo; kept here so it is versioned.

## House style

Comments explain **why**, not what, and several encode arguments that
were worked through and should not be flattened — e.g. the
`HandleSpec` note on why a handle is not a `SurfaceFinish`, the
`textures3d.ts` note on colour space and on returning null rather than
substituting a map, and the `types/quote.ts` note on fingerprints
versus timestamps. Add to them; don't paraphrase them away.

Where this file and a code comment disagree, **the code comment is
closer to the truth** — it sits next to what it describes.
