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
// access control is meant to come from Row Level Security policies.
// This app doesn't have auth/RLS set up yet (see schema.sql), so treat
// this as a local-dev/demo setup only.
//
// Vite only exposes env vars prefixed with VITE_ to browser code, and
// only variables read as import.meta.env.VITE_* — hence the prefix.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add a .env file in the project root — see the comment at the top of this file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
