# Setting up a fresh Supabase project

Follow this on the new machine. Verified against
`src/lib/Supabaseclient.ts`, `src/lib/finishes.ts`,
`src/lib/panoramaStorage.ts` and `supabase/schema.sql`.

## The good news first

**No code change is needed to point at a different Supabase project.**
The project URL and key are read only from environment variables
(`src/lib/Supabaseclient.ts`), and nothing anywhere hardcodes a project
id. Changing databases is entirely a `.env` change.

**`schema.sql` builds everything**, including the two storage buckets
and their policies — there is no manual dashboard clicking beyond
creating the project itself.

## Step 1 — Create the project

1. Go to <https://supabase.com/dashboard> and sign in.
2. **New project**. Pick your organisation.
3. Name it something you'll recognise (`my-app-kitchen`, say).
4. **Set a database password** and save it in your password manager
   now. You won't need it for this app — the browser client uses the
   anon key, not the password — but it's needed for direct `psql` or
   connection-string access, and Supabase won't show it again.
5. **Region: choose one near you.** For Delhi NCR that's
   `Southeast Asia (Singapore)` — the closest available. Region cannot
   be changed later without recreating the project, and it directly
   affects how snappy every save feels.
6. Create, then wait ~2 minutes for provisioning.

## Step 2 — Run the schema

1. In the project: **SQL Editor → New query**.
2. Open `supabase/schema.sql` from the repo, copy the **entire file**,
   paste it in.
3. **Run**.

Expect "Success. No rows returned." That's correct — it's all DDL and
seeds.

This creates:

- **10 tables** — `projects`, `layouts`, `surface_finishes`,
  `cabinet_catalog_items`, `obstacle_presets`,
  `appliance_catalog_items`, `handles`, `light_fixture_catalog`,
  `rate_cards`, `quotes`
- **2 public storage buckets** — `panoramas`, `material-swatches`,
  each with public read and insert policies
- **Seed rows** — 6 handles, 10 light fixtures, 1 rate card, plus
  finish and catalogue starters

Every statement is `if not exists` / `on conflict do nothing`, so
**re-running the whole file is always safe.** That is also how you apply
future schema changes — there are no numbered migrations. It will never
overwrite a row you've edited.

### If it errors

Read the error rather than retrying. The one that has actually bitten
this project: a foreign key declared `uuid` against a `text` primary
key, which fails with *"Key columns are of incompatible types: uuid and
text"*. **Every id in this schema is `text`.** See `CLAUDE.md`.

Statements before the failure will have applied. Fix the offending
statement and re-run the whole file — idempotency makes that clean.

## Step 3 — Get the credentials

**Project Settings → API**, and copy two values:

| Dashboard label | Goes into |
|---|---|
| Project URL | `VITE_SUPABASE_URL` |
| `anon` `public` key | `VITE_SUPABASE_ANON_KEY` |

Take the **anon public** key, not `service_role`. The service role key
bypasses all access control and must never reach browser code.

## Step 4 — Create `.env`

In the repo root — the same folder as `package.json`:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Four things that catch people:

- **The `VITE_` prefix is mandatory.** Vite only exposes variables with
  it to browser code.
- **No quotes, no spaces around `=`, no trailing semicolon.**
- **`.env` is not in the repo and never should be.** This is the one
  file that does not travel with the code — you create it by hand on
  each machine. Confirm `.gitignore` covers `.env` before your first
  commit on the new box.
- **Vite reads env only at startup.** Editing `.env` while `npm run
  dev` is running changes nothing until you stop and restart it.

## Step 5 — Run

```bash
npm install
npm run dev
```

If the URL or key is missing, `Supabaseclient.ts` throws a named error
at import time telling you which — it fails loudly on purpose rather
than silently rendering an empty app.

## Step 6 — Verify

Paste this into the SQL Editor:

```sql
select 'tables' as kind, count(*)::text as found, '10' as expected
from information_schema.tables
where table_schema = 'public'
  and table_name in ('projects','layouts','surface_finishes',
    'cabinet_catalog_items','obstacle_presets','appliance_catalog_items',
    'handles','light_fixture_catalog','rate_cards','quotes')
union all
select 'buckets', count(*)::text, '2'
from storage.buckets where id in ('panoramas','material-swatches')
union all
select 'handle seeds', count(*)::text, '6' from public.handles
union all
select 'fixture seeds', count(*)::text, '10' from public.light_fixture_catalog
union all
select 'rate card', count(*)::text, '1' from public.rate_cards;
```

Every `found` should equal `expected`.

Then in the app: create a customer, draw a room, place a cabinet, save,
reload the page. If the layout comes back, persistence works. Open
**Manage Inventory** and confirm the rate card shows ₹150 labour with
the amber placeholder banner.

## About your existing data

**A new project starts empty.** Creating a fresh database does not carry
across your existing customers, layouts, or edited inventory — the
schema is recreated, the rows are not.

If you want the old data, do it *before* decommissioning the old
project. Roughly: in the old project's SQL Editor, `select * from
<table>`, use the **Export** button on the results grid to download
CSV, then use **Table Editor → Import data from CSV** on the new
project. Order matters because of the foreign keys — `projects` before
`layouts`, and `projects` before `quotes`.

I have not performed this migration, so treat those steps as the shape
of the answer rather than a tested recipe. If the data matters, say so
and we'll work through it properly — `layouts` in particular holds large
JSONB columns (cabinets, appliances, fixtures) that CSV round-tripping
can mangle, and a `pg_dump` of just those tables via the connection
string is likely safer.

If the old data is throwaway, skip all of this. Starting clean is the
simpler path and the seeds give you a working catalogue immediately.

## One thing to decide, now that you're starting fresh

**RLS is disabled on every table and both buckets are public.** The
anon key ships inside browser JavaScript, so anyone who opens the app
can read and write every row and upload to storage. The comment at the
top of `Supabaseclient.ts` is explicit that this is a local-dev and demo
posture.

That is fine while you are the only user. It stops being fine the moment
this is deployed anywhere reachable, or holds a real customer's name,
phone number and address — which is exactly what `projects` is for.

Not something to fix today, but the right time to notice it is while
setting up a new database rather than after it has real client data in
it. Auth plus RLS policies is the fix; ask when you want to do it.
