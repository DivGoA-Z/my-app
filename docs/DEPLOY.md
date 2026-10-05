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

## Good to know

- Supabase's free plan pauses a project after about a week with no use;
  press Restore in its dashboard if the app stops connecting.
- Every push to `main` updates the live site. Other branches get their
  own preview address when Preview builds are on.
