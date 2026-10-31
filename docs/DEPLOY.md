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

## Adding a business or a person (quick guide)

Everything you need while adding someone is in this section. The setup
you do once is in the next section.

### The three things

| Thing | What it is | Its id looks like |
|---|---|---|
| **User** | One login: a person's email and password | `450641c5-2980-4e8d-ac06-8574ef58edab` |
| **Business** | One firm: its customers, quotes, catalogue, rates | `biz_default` (yours) or `biz_3f9a1c2d7e` (one you approved) |
| **Link** | Joins a user to a business (`business_users`) | — |

- A user with **no link** sees "Waiting for access" and nothing else.
- A user with **a link** sees that business, and only that business.
- A business's **name** ("FirstSeparateBiz") is only a label. The SQL
  below always needs the **id**.

The flow: a person signs up (that makes a **user**), then you either make
a **new business** for them, or **link** them to one that exists.

### Where to run these

Supabase → your project → **SQL Editor**. Run **one statement at a time**:
clear the box first, or highlight just the line you want. The editor runs
everything in the box, so an old line left there runs again.

### Step 1: find the person's user id

If they signed up on the site, they're in the "waiting" list:

```sql
select u.id, u.email,
       u.raw_user_meta_data->>'full_name' as name,
       u.raw_user_meta_data->>'business_name' as business,
       u.created_at
from auth.users u
where not exists (select 1 from business_users b where b.user_id = u.id)
order by u.created_at desc;
```

To create the user yourself instead: Authentication → Users → **Add
user** (email, password, tick auto-confirm), then copy their id from that
list.

### Step 2: either A or B

**A. A new firm (its own, separate business):**

```sql
select public.approve_new_business('<user id>');
```

- This one line creates the business, makes the person its owner, and
  copies in the starter catalogue (saved as their default).
- **Name:** taken from "Business name" on their sign-up form, or their
  email if that's empty. To choose it yourself:
  `select public.approve_new_business('<user id>', 'Verma Interiors');`
- It returns the new **business id** (`biz_…`). Note it down if more of
  their people will join.
- Run it **once per firm**. It's never needed again for that firm.

**B. A person joining a business that already exists** (yours, or a firm
you approved earlier):

```sql
-- find the business id
select id, name from businesses order by created_at desc;

-- link them
insert into business_users (business_id, user_id) values ('<business id>', '<user id>');
```

- For your own business, the business id is `biz_default`.
- Everyone in a business sees all of its customers, quotes and rates.

Then the person presses **Check again** (or signs in again) and they're in.

### Check who is where

```sql
select u.email, b.id as business_id, b.name as business, bu.role
from business_users bu
join businesses b on b.id = bu.business_id
join auth.users u on u.id = bu.user_id
order by b.name, u.email;
```

### Removing someone

- **From a business:**
  `delete from business_users where user_id = '<user id>';`
  They go back to "Waiting for access".
- **Altogether:** Authentication → Users → delete the user.

### Errors and what they mean

| Error says | Means | Do |
|---|---|---|
| `That user already belongs to a business` | They're already linked, often because the approve line ran a second time | Nothing. Check with "who is where" above |
| `violates foreign key constraint ... business_id` | The business id is wrong; often the business **name** was used | Look up the id with `select id, name from businesses` |
| `duplicate key value ... business_users_pkey` | That person is already in that business | Nothing |
| `No user with id ...` | Mistyped user id | Copy it again from step 1 |
| `The starter catalogue is empty` | The one-time starter step hasn't been run | Run it (next section), then approve again |

## Sign-up: one-time setup (§106–§107)

The sign-in screen has **Create an account**. It creates a login and
nothing else; the person waits until you add them (quick guide above).
Nothing in the browser can create or join a business.

Do these once, in this order:

1. **Re-run `supabase/schema.sql`** in the SQL editor (also after any
   future change to it).
2. **Fill the master starter catalogue** from your own catalogue. Re-run
   it whenever you want the starter to change; firms already approved
   keep their own copies.

   ```sql
   select public.refresh_starter_catalog('biz_default');
   ```

3. **Run the isolation check.** Paste `supabase/isolation_check.sql` and
   run it. It creates two test businesses, tries everything one shouldn't
   be able to do to the other, and rolls it all back. The result should
   be one row: "ALL ISOLATION CHECKS PASSED". A failure shows a red error
   naming the check. Run it again after any change to who can see or
   write what.
4. **Turn sign-ups on.** Authentication → Sign In / Providers: **Allow new
   users to sign up** on, and under Email, **Confirm email** on
   (recommended).
5. **Site URL.** Authentication → URL Configuration → the live address,
   so the confirmation email's link opens the live site, not localhost.

Supabase's built-in email sends only a few messages an hour on the free
plan (see `docs/AFTER_FIRST_CUSTOMERS.md` for when to set up your own).

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

## Help assistant (chatbot): one-time setup

The **Help** panel in the app sends questions to `/api/help`, a small
Cloudflare Worker (`worker/`) on the same deployment as the app. It
checks the person is signed in, adds the assistant's guide
(`docs/chatbot/APP_GUIDE_FOR_ASSISTANT.md`) and calls the model on RunPod.
The RunPod key stays in Cloudflare; it never reaches the browser.

Until it's set up, the panel answers "The help assistant isn't set up
yet." Nothing else in the app is affected.

1. **RunPod**: create a **Serverless** endpoint with the **vLLM** worker,
   model = your Hugging Face repo (the fine-tuned Qwen3-4B, or
   `Qwen/Qwen3-4B-Instruct-2507` to start). Set the max model length to
   at least **12288** (the guide alone is about 6,000 tokens). Note the
   endpoint ID, and create an API key (RunPod → Settings → API Keys).
2. **Cloudflare** → Workers & Pages → `my-app` → **Settings → Variables
   and secrets**, add:
   - `HELP_LLM_BASE_URL` = `https://api.runpod.ai/v2/<endpoint-id>/openai/v1`
   - `HELP_LLM_MODEL` = the model name exactly as RunPod serves it (the
     Hugging Face repo name)
   - `HELP_LLM_API_KEY` = the RunPod API key, as a **Secret**
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` = the same values as the
     app's `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, as **Secrets**.
     `SUPABASE_URL` is the bare project address,
     `https://<ref>.supabase.co`, with no `/rest/v1` and no trailing slash.
   - Leave `HF_TOKEN` empty on RunPod for a public model: an invalid
     token makes Hugging Face refuse even public downloads (§131).
3. Redeploy (or push any commit). Open **Help** in the app and ask
   something.

**Branch previews** (§131): a preview build needs the `previews` block
in `wrangler.jsonc`, and that block's `vars` REPLACE the branch's
dashboard variables. Set everything else for the preview as **Secrets**
in the dashboard, which a build can't overwrite.

A serverless endpoint sleeps when idle: the first question after a quiet
spell can take 30–60 s while it wakes (the panel says so). Set "active
workers" to 1 on RunPod if that's too slow, at the cost of paying for it
all the time.

**On your laptop**, `npm run dev` answers `/api/help` with the same code,
pointed at a local Ollama (no sign-in check, since it only listens
locally), and asks it for a context long enough for the guide:

```
ollama serve
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

To use RunPod from your laptop instead: `HELP_LLM_BASE_URL=… HELP_LLM_MODEL=… HELP_LLM_API_KEY=… npm run dev`.


## Make image (Gemini) and AI usage limits: one-time setup (§132)

**Make image** in the 3D tab sends the image brief to Google's Gemini
image model (the API behind AI Studio) through the same Worker
(`/api/render`), shows the result, and keeps every image under
**Images**. Every Help question and every image counts against the
business's limits, which you set on the **Usage** page.

1. **Supabase**: re-run `supabase/schema.sql`. It adds the usage tables,
   the limit functions, `design_renders` and the `renders` bucket. Until
   then, Help and Make image both refuse, because the limits can't be
   checked (they fail closed).
2. **Make yourself the super admin** (SQL editor, once):
   ```sql
   insert into public.super_admins (user_id)
   select id from auth.users where email = '<your login email>'
   on conflict do nothing;
   ```
   Sign out and in again: **Usage** appears in the menu, and the image
   brief downloads appear in the 3D tab. Nobody else sees either.
3. **Google AI Studio** (aistudio.google.com) → **Get API key** → create a
   key in a project with billing on (image models aren't on the free
   tier). Set a budget alert on that Google Cloud project.
4. **Cloudflare** → `my-app` → **Settings → Variables and secrets**:
   - `GEMINI_API_KEY` = that key, as a **Secret**
   - optional `GEMINI_IMAGE_MODEL`: the model name. Default
     `gemini-3-pro-image-preview` ("Nano Banana Pro"). For the cheaper
     Flash model, `gemini-2.5-flash-image`. Check AI Studio for current
     names.
   - For a branch preview, add `GEMINI_API_KEY` as a preview **Secret**
     too.
5. On **Usage**, set the defaults, and any business's own limits.

**On your laptop**: `GEMINI_API_KEY=… npm run dev` (it uses the real
Supabase limits, so step 1 must be done).
