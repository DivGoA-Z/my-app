# Setting up on a new Mac

## Step 0 — Check you transferred the right thing (read this first)

**The files I hand you in chat are not a runnable app.** They're only the
files I authored or edited. My working copy has no `tsconfig.json`, no
`vite.config.ts`, no `index.html`, no `src/main.tsx`, no `src/index.css`,
no `eslint.config.js` and no `.gitignore` — I never touched those, so
they were never presented.

What must be in Downloads is a copy of **your whole `~/my-app` folder**
from the old machine. Check before going further:

```bash
cd ~/Downloads/my-app          # adjust to the actual folder name
ls -a
```

You need all of these. If any are missing, stop and go back to the old
machine for a complete copy:

```
index.html          vite.config.ts      tsconfig.json
eslint.config.js    package.json        .gitignore
src/main.tsx        src/App.tsx         src/index.css
src/ (types, lib, hooks, components, store)
supabase/schema.sql public/
```

Quick check:

```bash
for f in index.html vite.config.ts tsconfig.json package.json \
         eslint.config.js src/main.tsx src/App.tsx supabase/schema.sql; do
  [ -e "$f" ] && echo "ok   $f" || echo "MISSING  $f"
done
```

`.env` will be missing and that's correct — it's gitignored and you
recreate it in step 4.

## Step 1 — Move it out of Downloads

Don't work in Downloads. Two reasons: macOS quarantines downloaded
files, and Downloads is the folder people clear out without thinking.

```bash
mkdir -p ~/projects
mv ~/Downloads/my-app ~/projects/my-app
cd ~/projects/my-app
xattr -dr com.apple.quarantine .    # clears the download flag
```

**Copy into a fresh, empty folder — never merge into an existing
`my-app`.** macOS filesystems are case-insensitive, so a leftover
`Fixtures.ts` alongside a new `fixtures.ts` silently shadows the real
file. That has already cost this project a day, across 14 files. A
clean destination makes it impossible.

Then delete anything machine-specific that came along:

```bash
rm -rf node_modules dist .vite
find . -name '.DS_Store' -delete
```

`node_modules` in particular must go — it contains compiled binaries
built for the old machine's architecture.

## Step 2 — Prerequisites

```bash
node -v      # need a current LTS; Node 22 LTS is a safe choice
npm -v
git --version
```

Vite 8 and TypeScript 6 both want a modern Node. If yours is older,
`npm install` will warn you about `engines` — believe the warning. If
you need to install or switch:

```bash
# Homebrew, if you don't have it:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 git
```

Git may prompt you to install Xcode Command Line Tools. Accept.

## Step 3 — Install dependencies

```bash
cd ~/projects/my-app
npm install
```

Takes a few minutes; `three` and the Supabase client are the slow ones.
Warnings are normal, errors are not.

## Step 4 — `.env`

This is the one file that does not travel with the code. Create it in
the project root, alongside `package.json`:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Use the credentials from your **new** Supabase project — see
`docs/SUPABASE_SETUP.md` for where to find them and the gotchas (the
`VITE_` prefix is mandatory; no quotes; Vite only reads this at
startup).

Then confirm it's ignored before your first commit:

```bash
git check-ignore -v .env     # should print a .gitignore line
```

If it prints nothing, add `.env` to `.gitignore` now.

## Step 5 — Create the database

Follow `docs/SUPABASE_SETUP.md` end to end: create the project, paste
the whole of `supabase/schema.sql` into the SQL Editor, run it, then run
the verification query at the end of that document.

Nothing in the code references a project id, so a new database needs no
code change — only step 4.

## Step 6 — Run and verify

```bash
npx tsc --noEmit     # type-check. Do this BEFORE trusting anything.
npm run lint
npm run dev
```

`npx tsc --noEmit` matters more than usual here: there is no test
runner in this project, and the last round of changes was checked only
by static scans and Python models of the maths — never by a compiler.
This is the first real compile of that work.

Then in the browser:

1. Create a customer, draw a room, place a cabinet, **save**, reload.
   If the layout comes back, persistence works.
2. Open **Manage Inventory** — the rate card should be the first panel,
   ₹150 labour, amber placeholder banner showing.
3. Open the 3D view, place a pendant, check it lights the room.
4. Freeze a quote, then change a rate — the frozen figure must stay put
   while the live table moves, and the banner should turn amber.

## Step 7 — Git

If `.git` didn't come across:

```bash
git init
git add -A
git commit -m "Import project onto new machine"
```

If it did, just confirm: `git status` and `git log --oneline | head`.

## Step 8 — Get the AI assistant up to speed

Install Claude Code:

```bash
npm install -g @anthropic-ai/claude-code
cd ~/projects/my-app
claude
```

`CLAUDE.md` at the repo root is read automatically at the start of every
session, so the conventions and traps load themselves. `docs/DECISIONS.md`
is not — it's read on demand.

**First prompt for the new session:**

> Read CLAUDE.md and docs/DECISIONS.md before doing anything. This
> project was handed over from another machine and you have no history
> with it. Then tell me, in your own words, three things: the coordinate
> conventions and why they're easy to break, why `calculateBOM` takes a
> single required `PricingContext`, and what section 8 of DECISIONS.md
> says is still unverified. Don't write any code yet.

Asking it to explain those back is worth the minute it takes. If it gets
the coordinate conventions or the pricing-context reasoning wrong, it
hasn't actually read the docs, and you want to find that out before it
edits `bom.ts`.

## Where we left off

**Next feature, and the last piece of the original brief: quote export.**
The app can compute and freeze a quote but cannot get one out — no PDF,
no WhatsApp link, no share link. I grepped for it; there's no PDF
library installed. In this market WhatsApp is the delivery channel, so
this is the difference between a design tool and a business tool.

A frozen `quotes` snapshot is exactly the right input for it: stable,
self-contained, and already carrying the catalogue rows it was priced
against.

**Then, in rough priority order:**

1. **Auth + RLS.** Currently RLS is off on every table and the anon key
   ships in the browser bundle, so anyone with the app URL can read and
   write everything — including `projects`, which holds client names,
   phones and addresses. Fine on localhost; not fine once deployed or
   once it holds one real customer. See the end of
   `docs/SUPABASE_SETUP.md`.
2. **Real rates.** Every seeded price is invented. This is the
   commercial blocker, not a technical one.
3. **The "B2" carcass.** `appliance-housing` and `open-shelf` fronts
   still render inside a sealed box, so an open shelf reads as a missing
   door.
4. **Visual assets.** `VISUAL_ASSETS_PROMPT.md` (in your old `public/`
   folder) is a ready-to-run brief: HDRI first, then finish scale, then
   metals on hardware.
5. **The nine unverified items** in `docs/DECISIONS.md` §8 — worth
   clearing early, since several are quick checks that change what
   you'd do next.
