// src/lib/Supabaseclient.ts
//
// Requires a .env file in the project root (never commit this):
//
//   VITE_SUPABASE_URL=https://your-project.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-public-key
//
// Both values come from your Supabase project's dashboard:
// Project Settings -> API. The "anon public" key is safe to expose in
// browser code by design (that's what it's for) — it's not a secret,
// access control comes from Row Level Security policies (see
// supabase/schema.sql's "BUSINESS ISOLATION (RLS)" block) plus real
// sign-in (src/store/authStore.ts), not from keeping this key hidden.
//
// Vite only exposes env vars prefixed with VITE_ to browser code, and
// only variables read as import.meta.env.VITE_* — hence the prefix.

import { createClient } from '@supabase/supabase-js';
import { demoAwareFetch } from './demoMode';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add a .env file in the project root — see the comment at the top of this file.'
  );
}

// Explicit rather than relying on the browser default (which is also
// `true`) — this is what keeps you signed in across a `npm run dev`
// restart or a page refresh: the session token lives in localStorage
// until you sign out or the refresh token itself expires (weeks, not
// hours), not "until the next reload".
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  // The public demo (§138): writes are answered locally (lib/demoMode.ts).
  global: { fetch: demoAwareFetch },
});
