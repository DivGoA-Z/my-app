# Prompt for generating the project handoff

Paste everything below the line into a fresh session, in the `my-app`
repo root, on the new machine or this one — either works, since it asks
you to read the code rather than recall it.

---

## What I need

I'm moving this project to a different machine and a different AI
account. The next assistant will have **the full codebase and nothing
else** — no conversation history, no memory of any decision.

Write the handoff it needs. Two files, because they have different
lifetimes:

1. **`CLAUDE.md`** at the repo root — loaded automatically into every
   Claude Code session, so it costs context on every single turn. Keep
   it tight and operational: what this app is, the conventions that are
   easy to break, the traps, how to verify work here, and what state
   things are in. Target roughly 200–300 lines. If you're deciding
   whether something belongs here or in the decisions log, ask "would
   an assistant get this WRONG without being told?" — if no, it goes in
   the log.

2. **`docs/DECISIONS.md`** — read on demand, so it can be long. The
   reasoning behind each significant decision, and the bug history.

## Read before writing

Do not write either file from memory or from this prompt's description.
Read the code. At minimum:

- `package.json` (exact versions — do not guess them)
- `supabase/schema.sql` (the data model, and its id conventions)
- `src/types/*.ts` — these files carry unusually detailed "why"
  comments; they are the primary source for design intent
- `src/lib/bom.ts`, `src/lib/fronts.ts`, `src/lib/fixtures.ts`,
  `src/lib/lighting3d.ts`, `src/lib/openings.ts`,
  `src/lib/surfaceAreas.ts`, `src/lib/footprint.ts`
- `src/store/layoutStore.ts`
- `src/components/canvas3d/Room3DCanvas.tsx` (the largest file)
- `public/models/README.md`, `public/textures/CREDITS*.md`,
  `TEXTURE_CAPTURE_GUIDE.md`

Where a code comment already explains something well, **cite the file
rather than paraphrasing it.** Duplicated explanations drift apart, and
the copy in a markdown file is the one that goes stale.

## `CLAUDE.md` must cover

**What the app is.** A kitchen renovation design tool for small and
medium interior businesses in India, Delhi NCR specifically: 2D floor
plan → 3D walkthrough → itemised quote → customer pipeline. Compact
rooms (6×8 ft to 12×14 ft), structural pillars, exposed piping, cabinet
modules like cylinder trolleys and sink units.

**The stack, with exact versions from `package.json`.** Flag that React
19's **compiler** is active — it rejects mutating anything returned from
a hook, which has already caused real errors.

**Coordinate conventions, stated precisely.** These are the single
easiest thing to get wrong and the errors are silent:

- 2D is millimetres, top-left origin, Konva clockwise rotation
- 3D is metres, Y-up, via `MM_TO_M`
- an item's `x`/`y` is always the **unrotated top-left corner**; the
  centre is the rotation-invariant quantity (`src/lib/footprint.ts`)
- `elevationMm` is the height of an item's **bottom** face off the floor
- room x/y maps to world x/**z**; getting that swap wrong aims lights
  sideways

**Naming.** The table is `projects`; the UI-facing word is "customer".
`CustomerProject` maps onto `projects`, and `layouts.project_id`
references `projects.id`. Don't "fix" this — it would need a migration
for no functional gain.

**Database id convention.** All ids are `text`, generated client-side
with `crypto.randomUUID()`. Not `uuid`. This is stated at the top of
`schema.sql` and is worth repeating because ignoring it produces a
foreign-key type error rather than anything subtle.

**How verification works here, and its limits.** Say plainly what the
assistant can and cannot check, and that unverified claims must be
labelled. Include the working arrangement: if the assistant edits a
scratch copy and the user copies files across, say so, and warn that
macOS is case-insensitive — a stale file differing only in case has
caused a whole class of confusing bugs before.

**Placeholders.** Every rate is editable now (rate card + catalogue
rows), but the seeded values are invented. Say which are placeholders
and that they must not reach a customer unreviewed.

**Current state.** What works, what's half-built, what's untouched.

## `docs/DECISIONS.md` must cover

Group by area. For each decision: what was chosen, what was rejected,
and **why** — the why is the part that can't be recovered from code.

Cover at least:

- **Pricing.** Why `calculateBOM` takes one required `PricingContext`
  instead of six positional parameters with defaults (defaulted pricing
  inputs silently produced ₹0 hardware on every quote, twice). Why
  quotes freeze a snapshot on send, why a revision is a new version row
  rather than an edit, and why staleness is a content fingerprint
  rather than a timestamp (cabinets are their own table, so
  `layouts.updated_at` misses a cabinet move).
- **Cabinets.** The three orthogonal axes: substrate (price only),
  finish (appearance), front layout (structure). Why hardware is
  derived from the front layout rather than stored. Why cabinets are
  parametric and must never get a `modelUrl`, while appliances and
  fixtures should have one — and why `knob` is the sole exception on
  the cabinet side.
- **Openings.** Why wall subtraction uses coordinate-grid rectangle
  decomposition (a 1-D band sweep was wrong for overlapping openings).
  The surface cost categories EXPOSED / CONCEALED / OCCUPIED / VOID and
  their precedence. Why an opening still prints at ₹0 when the builder
  supplies it.
- **Lighting.** This has the longest and most instructive bug history;
  give it room:
  - `decay=0` removed all distance attenuation, so every surface in
    reach lit identically and no placed light ever appeared to light
    anything. Fixtures now use `decay=2`; window daylight deliberately
    still uses 0.
  - `SpotLight.target` must be **in the scene graph** — a declarative
    `target-position` prop silently aims at the world origin.
  - `toneMapped={false}` on a fixture body exempted it from exposure,
    so it displayed at full brightness however dark the room was: the
    mechanical reason a fixture looked blazing while lighting nothing.
  - The `<Environment>` Lightformer panels are an image-based light and
    are **not occluded by geometry** — they sit outside the walls and
    light straight through. They were ungated, so they stayed at full
    strength while everything else receded, and kept their blue/cream
    tint in the mode that promises no tint.
  - Linear-run banding is **geometric, not a sample-count problem**: a
    point light 60mm from a wall lights a ~60mm pool, so raising 3
    samples to 6 changed banding from 99.7% to 96.0%. The fix was
    standing the light origins off the host surface (350mm → 13.6%).
    Note that `RectAreaLight` is the correct primitive and why it
    hasn't been adopted yet.
  - Removed fakes and why: automatic under-cabinet lights nobody
    placed or could price, and a shadow-casting "sun" representing
    nothing.
- **Assets.** What's in `public/`, what's wired, what deliberately
  isn't, and the two open traps: `stone-concrete` is a 2:1 image that
  renders squashed if given square swatch dimensions, and a 1024² JPG
  costs ~4MB of VRAM regardless of its file size.

## Rules for both files

- **Distinguish verified from assumed.** Anything you could not check
  in this session must say so. Do not launder a guess into a statement.
- **Record failed approaches, not just conclusions.** "X was tried and
  broke because Y" is the highest-value content here — without it the
  next assistant re-tries X.
- **Don't invent history.** If you can see *what* the code does but not
  *why* it was chosen, write "reason not recorded" rather than
  reconstructing a plausible rationale. A confident invented reason is
  worse than an acknowledged gap.
- **No praise and no marketing.** This is an operating manual.
- Keep the existing comment style in mind: this codebase explains
  **why**, not what, and several comments encode arguments that were
  worked through. Reference them; don't flatten them.

## Finally

List, separately, anything you believe belongs in the handoff but
couldn't establish from the code — so I can fill it in from memory
before the move.
