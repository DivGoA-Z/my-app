# Deploying (Cloudflare)

The app is static files after `npm run build` (the `dist/` folder); the
backend is Supabase, already hosted. Cloudflare serves `dist/` at a free
`*.workers.dev` address, rebuilding on every push to `main`.
`wrangler.jsonc` in the repo root tells it what to serve.

## First deploy (dashboard: Workers & Pages → Create → Import a repository)

- Repository: `DivGoA-Z/my-app`, branch `main`.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- **Build variables** (Advanced settings → Build variables, NOT runtime
  variables; `VITE_*` values are baked into the JavaScript at build time):
  - `VITE_SUPABASE_URL`: from your `.env`
  - `VITE_SUPABASE_ANON_KEY`: from your `.env` (the anon key, never `service_role`)
  - `NODE_VERSION` = `22`
- Then in Supabase → Authentication → URL Configuration, set **Site URL**
  to the deployed address.

Missing build variables give a site that loads but can't sign in.
Changing them later needs a **redeploy** (they're read at build time).

## Adding a person to the business

`docs/SUPABASE_SETUP.md` Step 5: Supabase → Authentication → Users → Add
user (auto-confirm), then in the SQL editor:

```sql
insert into business_users (business_id, user_id) values ('biz_default', '<their uid>');
```

## Sign-up and approving a new account (§106)

The sign-in screen has **Create an account**. It creates a login and
nothing else: the person sees "Waiting for access" until you link them
to a business. Nothing in the browser can create or join a business.

**Once, before relying on it (in this order):**

1. **Re-run `supabase/schema.sql`** in the SQL editor. It changes the
   storage rules so only business members can upload. Until it's re-run,
   a waiting account could still upload to (and overwrite files in) the
   panoramas, swatches and quote-PDF buckets.
2. Supabase → Authentication → Sign In / Providers → Email: turn on
   **Allow new users to sign up**. While it's off, the form shows
   Supabase's "Signups not allowed" message, which is harmless.
3. Same page: **Confirm email** on (recommended) means a new person must
   click an emailed link before they can sign in. Make sure Site URL
   (Authentication → URL Configuration) is the live address, or the
   link points at localhost. Supabase's built-in email sends only a few
   messages an hour on the free plan; set up your own SMTP (Authentication
   → Emails) before inviting many people.

**Approving someone.** Find who's waiting:

```sql
select u.id, u.email, u.created_at,
       u.raw_user_meta_data->>'full_name' as name,
       u.raw_user_meta_data->>'business_name' as business
from auth.users u
where not exists (select 1 from business_users b where b.user_id = u.id)
order by u.created_at desc;
```

To add them to **your** business (they'll see all of its customers,
quotes and rates):

```sql
insert into business_users (business_id, user_id) values ('biz_default', '<their id>');
```

A **new, separate** business needs the steps in
`docs/AFTER_FIRST_CUSTOMERS.md` first (starter catalogue copy, the
two-business isolation check). Don't put an outside firm into
`biz_default`.

They press **Check again** (or sign in again) and they're in. To turn
someone away, leave them unlinked or delete the user in Authentication →
Users.

## A forgotten password

Supabase can't show a password (it stores only a hash), and the app has
no "set a new password" screen yet, so the recovery email isn't useful.
Set one by hand in the SQL editor; it should report 1 row:

```sql
update auth.users
set encrypted_password = extensions.crypt('New-Password-Here', extensions.gen_salt('bf'))
where email = 'their@email.com';
```

The screenshot test login's password lives in `.env.e2e.local`
(git-ignored); update it there too if you reset that account.

## Good to know

- Supabase's free plan pauses a project after about a week with no use;
  press Restore in its dashboard if the app stops connecting.
- Every push to `main` updates the live site. Other branches get their
  own preview address when Preview builds are on.
