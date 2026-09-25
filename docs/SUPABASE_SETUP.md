# Setting up a fresh Supabase project

Follow this on the new machine. Verified against
`src/lib/Supabaseclient.ts`, `src/lib/finishes.ts`,
`src/lib/panoramaStorage.ts` and `supabase/schema.sql`.

## The good news first

**No code change is needed to point at a different Supabase project.**
The project URL and key are read only from environment variables
(`src/lib/Supabaseclient.ts`), and nothing anywhere hardcodes a project
id. Changing databases is entirely a `.env` change.

**`schema.sql` builds everything**, including the three storage buckets
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

- **13 tables** — the original 10 (`projects`, `layouts`,
  `surface_finishes`, `cabinet_catalog_items`, `obstacle_presets`,
  `appliance_catalog_items`, `handles`, `light_fixture_catalog`,
  `rate_cards`, `quotes`), each now with a `business_id` column and
  Row Level Security policies, plus 3 new ones: `businesses`,
  `business_users` (who belongs to which business, and their role),
  and `super_admins` (your own cross-business access — see CLAUDE.md)
- **3 public storage buckets** — `panoramas`, `material-swatches`,
  `quote-pdfs`. Read stays public (a quote PDF link works with no
  login); uploading now requires being signed in
- **Seed rows** — 6 handles, 10 light fixtures, 1 rate card, plus
  finish and catalogue starters, all tagged to one seeded business
  (`biz_default`)

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

# Optional — put your own business's name/phone on the quote PDF's
# letterhead (src/lib/quotePdf.ts). There's no `businesses` table yet
# (that's a multi-tenancy thing, not built), so this is the only way
# to set it today. Falls back to a generic placeholder if left unset.
VITE_BUSINESS_NAME=Your Business Name
VITE_BUSINESS_PHONE=+91-XXXXX-XXXXX
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

## Step 5 — Create your login

There is no sign-up screen (see `CLAUDE.md` — deliberate, not missing).
Your one account is created by hand, once:

1. **Authentication → Users → Add user** in the dashboard. Set an
   email and password — this is what you'll type into the app's own
   sign-in screen.
2. Copy that user's **UID** (shown in the users list).
3. Back in the **SQL Editor**, run (replacing `<uid>`):
   ```sql
   insert into business_users (business_id, user_id) values ('biz_default', '<uid>');
   insert into super_admins (user_id) values ('<uid>');
   ```
   The first row makes you a member of the one seeded business — this
   is what everyday data (customers, layouts, catalogue) is scoped to.
   The second gives you the software-owner bypass described in
   `CLAUDE.md`, separate from that membership.

If you ever add a second person to this business later, that's the
same first insert again with their UID and no schema change — see
`docs/DECISIONS.md` for why `business_users` is a table and not a
column.

## Step 6 — Run

```bash
npm install
npm run dev
```

If the URL or key is missing, `Supabaseclient.ts` throws a named error
at import time telling you which — it fails loudly on purpose rather
than silently rendering an empty app. Sign in with the email/password
from Step 5.

## Step 7 — Verify

Paste this into the SQL Editor:

```sql
select 'tables' as kind, count(*)::text as found, '13' as expected
from information_schema.tables
where table_schema = 'public'
  and table_name in ('projects','layouts','surface_finishes',
    'cabinet_catalog_items','obstacle_presets','appliance_catalog_items',
    'handles','light_fixture_catalog','rate_cards','quotes',
    'businesses','business_users','super_admins')
union all
select 'buckets', count(*)::text, '3'
from storage.buckets where id in ('panoramas','material-swatches','quote-pdfs')
union all
select 'handle seeds', count(*)::text, '6' from public.handles
union all
select 'fixture seeds', count(*)::text, '10' from public.light_fixture_catalog
union all
select 'rate card', count(*)::text, '1' from public.rate_cards
union all
select 'my membership', count(*)::text, '1' from public.business_users
union all
select 'my super admin row', count(*)::text, '1' from public.super_admins;
```

Every `found` should equal `expected`.

Then in the app: sign in, create a customer, draw a room, place a
cabinet, save, reload the page. If the layout comes back, persistence
works. Open **Manage Inventory** and confirm the rate card shows ₹150
labour with the amber placeholder banner.

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

## Where this now stands on security

**RLS is enabled and scoped per business** (see CLAUDE.md and
`supabase/schema.sql`'s "BUSINESS ISOLATION (RLS)" block) — the anon
key still ships inside browser JavaScript, same as always, but it can
no longer read or write another business's rows, because there isn't
a second business yet to test that against. Storage buckets still
allow public read (deliberate — a quote PDF link works with no
account) but require sign-in to upload.

**Still not built:** self-serve sign-up for a second business.
Onboarding another firm today means repeating Step 5 by hand — a new
`businesses` row, a new Auth user, a new `business_users` row. Fine
for "you plus maybe one more business you set up yourself"; a real
second customer signing themselves up is future work, tracked in
`docs/PRINCIPLES.md`.
