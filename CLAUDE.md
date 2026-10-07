# my-app — kitchen renovation designer

**This file belongs at the REPO ROOT.** Claude Code auto-loads
`CLAUDE.md` only from there; it once sat in `docs/` and sessions ran
without it, silently.

Operating manual, loaded every session, so it stays short. **For the
reasons behind anything, read `docs/DECISIONS-INDEX.md` first** (one
line per decision). Open the full section in `docs/DECISIONS.md` (the
archive) before changing pricing, lighting, wall geometry or the
cutting list. *(Trimmed 3 Oct 2026: stories replaced by § pointers. Two
corrections: quote export is no longer "not started", and the resolved
carcass "B2" note was removed.)*

## What this is

A kitchen design, quoting and production tool for small/medium interior
businesses in Delhi NCR. The flow: draw a 2D plan, walk it in 3D, produce
an itemised quote, track the customer, and optionally produce a cutting
list for the workshop.

Market assumptions, not taste:
- Rooms are compact (6×8 to 12×14 ft).
- Pillars and plumbing shafts are normal; they're obstacles that consume
  wall and floor area.
- `cylinder-trolley` and `sink-unit` are module types.
- Electrical is usually a separate contractor: lighting is designed, but
  its cost sits behind `layout.priceElectrical`.
- Money is ₹. Per-sq-ft charges (labour) bill on area; all geometry is
  in **mm**.

## Stack

Check `package.json` for versions. Main pieces: React 19, TypeScript 6,
Vite 8, Zustand 5, Konva/react-konva, three + @react-three/fiber/drei,
Supabase, Tailwind v4, shadcn/ui (Radix), Vitest.

- **`package.json` has been incomplete before.** It was rebuilt by
  scanning TS imports, which missed `@tailwindcss/vite`. If a build fails
  on an unresolved module, first check whether it's merely missing from
  `package.json`. Suspect anything reached only from `vite.config.ts`,
  `eslint.config.js` or CSS.
- Tailwind **v4**: `@import "tailwindcss";`, no `tailwind.config.js`.
- `npm run dev` / `npm run build` (`tsc -b && vite build`) /
  `npm run lint` / `npm test`.
- **React 19 compiler is active.**
  - Never mutate anything returned from a hook. Example: write
    `gl.toneMappingExposure` inside a `useFrame` callback.
  - Never sync state in an effect body; adjust it during render.
  - Never manually `useMemo` on a derived value (§60).
  - Don't eslint-disable; restructure.
- **Never run `prettier --write`.** The repo isn't Prettier-formatted, so
  it rewrites whole files (§43).

## Tests

- `npm test` (Vitest). Maths tests sit beside the code
  (`src/lib/*.test.ts`); shared builders are in `src/test/fixtures.ts`
  (§55).
- **Run it before trusting a change** to pricing, the cutting list,
  nesting, panels or importers.
- **Add a test for any money or size rule you add or fix.**
- Prices are pinned to the seeded placeholder rates on purpose.
- Screen tests (§66) live in `src/components/__tests__/`.
  - Each file starts with `// @vitest-environment jsdom`.
  - `resetStore` (`src/test/store.ts`) replaces network actions with
    spies; a screen test must never reach Supabase (the env values in
    `vite.config.ts` are dummies).
  - WebGL is mocked out, so 2D/3D drawing is still checked by eye.
  - There are no browser tests yet.

## Coordinate conventions

The easiest thing to break; every failure is silent (a wrong picture,
no error).

- **2D**: mm, origin top-left, Konva rotation **clockwise**.
- **3D**: metres, **Y-up**, `MM_TO_M = 0.001` (`src/lib/scene3d.ts`).
  Room x/y → world x/z (`groundPosition`); plan depth is world Z.
  `clockwiseDegToThreeY(deg) = -(deg·π/180)`.
- **An item's `x`/`y` is the UNROTATED top-left corner.** The centre is
  the rotation-invariant quantity. Never mix a rotated extent with the
  unrotated corner. Use `src/lib/footprint.ts`.
- Front direction by rotation: 0→+y, 90→−x, 180→−y, 270→+x.
- **`elevationMm`** is the height of an item's BOTTOM face (cabinets,
  appliances, obstacles); Z-aware collision uses it.
- **Physical vs stored cabinets** (§61). Under "carcass only" depth, a
  cabinet physically reaches its shutter's thickness further forward.
  - Geometry consumers (plan, 3D, collisions, countertop) use
    `usePhysicalCabinets()`.
  - Editors, pricing and the cutting list use stored cabinets.
  - The 2D drag reads physical and writes stored
    (`storedPositionFromPhysicalCenter`).

## Naming and schema traps

- Table `projects` = UI "customer" (`CustomerProject`). Don't rename.
- **All ids are `text`, made client-side** (`crypto.randomUUID()`). A
  `uuid` column once broke a FK (§1).
- **Nothing reachable from `PricingContext` may be generated
  non-deterministically on load.** Random ids made every frozen quote
  read stale (§35). Migrated rows get fixed ids.
- Cabinets, appliances, obstacles, walls, cameras and fixtures are
  **JSONB arrays on `layouts`**.
- Eleven business tables: `projects`, `layouts`, `surface_finishes`,
  `cabinet_catalog_items`, `obstacle_presets`, `appliance_catalog_items`,
  `handles`, `light_fixture_catalog`, `rate_cards`, `quotes`,
  `construction_settings`. Plus auth: `businesses`, `business_users`,
  `super_admins`.
- **`schema.sql` is idempotent and is the migration mechanism**:
  `if not exists` / `on conflict do nothing`, never `do update`. Re-running
  is always safe and never overwrites edited rates. No numbered
  migrations. Seed inserts carry `business_id = 'biz_default'` (§9).
  After adding columns, tell the user to re-run it, because writes fail
  until they do.
- **RLS is live.** Every table has `business_id`, scoped by
  `current_business_id()`. **No super-admin bypass in the app** (§107):
  the owner reaches all data via the SQL editor.
  `supabase/isolation_check.sql` proves two businesses can't touch each
  other (run it after any RLS or storage change). Every write path
  passes `business_id` explicitly; never use a DB default. Sign-in is
  real, and there's one business today. **Sign-up exists but only
  requests access** (§106): a new login is in no business, sees nothing
  and waits until it's linked by hand (`docs/DEPLOY.md`). Nothing in the
  browser may create or join a business; `approve_new_business()` (SQL
  editor) does, with a copy of the master starter catalogue. Storage
  buckets allow public read; writes go only into `<business_id>/...`,
  the business's own folder. Pass the business id into every upload
  path.
- Supabase credentials come only from `.env` (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`), set up per machine (`docs/SUPABASE_SETUP.md`).
- **Key data loading on `session.user.id`, never on the `session` object.**
  Supabase replaces it on every tab focus (§46).
- **A whole-row upsert from a partial source must merge onto the stored
  row**, or it deletes what it doesn't carry (§54).

## Pricing rules

- **`calculateBOM(items, appliances, ctx)` takes one REQUIRED
  `PricingContext`, never defaulted.** Defaults priced hardware at ₹0,
  twice (§2). `construction` is required too: board is priced on the
  cutting list's real part sizes (§42). Both call sites
  (`src/hooks/useBOM.ts`, `saveProject`) and the freeze/staleness paths
  must pass the same context.
- **Every seeded rate is a placeholder.** That includes labour ₹150/sq ft
  (it bills on TOTAL cut-part area since §59), HDMR 6mm ₹450, shelf
  fitting ₹80, and catalogue prices. The amber banner in
  `RateCardManager` stays while they're untouched. Never present such a
  quote as final.
- **A frozen quote never changes.** A revision is a new `version`. Never
  `UPDATE` a quote's `summary` or `cut_list`. Staleness is a content
  fingerprint (§2).
- Hardware units differ: `channel` = a pair; gola/edge profile = running
  metres; a hinge = one piece (`HardwareSpec`).
- **Adding a board line never moves an existing cabinet** (§44). Only
  choosing one does. A board line in use can't be deleted (§43).
- Margin is per project and distributed into every displayed line, so the
  lines sum to the total (§15, §39).

## Verification, and its limits

- **Type-check with `npx tsc --noEmit -p tsconfig.app.json`.** Bare
  `npx tsc --noEmit` checks ZERO files: the root tsconfig is
  solution-style. It once hid a real error (§8).
- **Label unverified claims as unverified.** Say "static scan only, not
  type-checked" or "not seen in a browser".
- Distrust your own tooling. Scanners have matched their own comments
  (§6). Read file contents, not filenames (§31).
- macOS is case-insensitive. A stale duplicate differing only in case
  can shadow the real file (14 files once). Check before debugging
  anything inexplicable. Rename case-only via a two-step `git mv`.
- If working in a scratch copy the user copies into
  `/Users/dgoyal2/my-app`, say so.

## Current state

See `docs/STATUS.md` for the snapshot.

**Not started**:
- self-serve business creation (sign-up with approval and approving a
  new business by SQL are built, §106–§107)
- the shared catalogue
- appliance-driven cabinet cutouts
- rectilinear rooms (deferred)
- CNC boring
- Draco decoding
- browser tests

Quote export (PDF + hosted WhatsApp link) has been built for a while;
this file wrongly listed it as not started until 3 Oct 2026.

## Keeping the documents true

Obligations, not suggestions:

- **Non-obvious decision →** a full section in `docs/DECISIONS.md` (what,
  what was rejected, WHY, what was tried and broke) **and** one line in
  `docs/DECISIONS-INDEX.md`.
- **A decision that changes what the product is →** update
  `docs/PRINCIPLES.md`, and say so to the user; they must agree
  explicitly. Part 1 rarely changes; Part 2 (roadmap) often.
- **Fixed something in `docs/ISSUES.md` →** move it to
  `docs/ISSUES-FIXED.md` with the date. Never delete it.
- **Found a document wrong →** correct it and say what was wrong. Don't
  silently overwrite.
- **End of session →** update `docs/STATUS.md` (a snapshot: built, not
  built, unverified, blocked, next), then remind the user to commit and
  push.

## Document map

- `docs/DECISIONS-INDEX.md`: one line per decision. **Read first.**
- `docs/DECISIONS.md`: full archive of reasons and bug history.
- `docs/PRINCIPLES.md`: what the product is trying to be, plus the
  roadmap.
- `docs/AFTER_FIRST_CUSTOMERS.md` — work parked until a few customers
  are onboarded, its principles, and the before-customer-#1 list.
- `docs/UX_PLAN.md` — the UI/UX overhaul: users, tasks, devices, screen
  map, editor layout, proposed UI principles, mockup links.
- `docs/WALKTHROUGH.md` — the end-to-end manual test script with expected
  numbers; the basis for the browser tests.
- `docs/STATUS.md`: snapshot for planning conversations outside the repo.
- `docs/ISSUES.md` (open) / `docs/ISSUES-FIXED.md` (resolved, dated).
- `docs/SUPABASE_SETUP.md`, `docs/SETUP_NEW_MACHINE.md`: environment.
- `docs/PROJECT_INSTRUCTIONS.md`: instructions for the separate Claude
  Project; versioned here.

## House style

Comments explain **why**, and several encode worked-through arguments
that must not be flattened: `HandleSpec` (why a handle isn't a
`SurfaceFinish`), `textures3d.ts` (colour space; null rather than a
substitute map), `types/quote.ts` (fingerprints vs timestamps). Add to
them; don't paraphrase them away. Match the surrounding code. Where this
file and a code comment disagree, **the code comment is closer to the
truth**.
