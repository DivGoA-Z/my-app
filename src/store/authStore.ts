// src/store/authStore.ts
//
// Session + business membership. Kept separate from layoutStore.ts on
// purpose: "who is signed in and which business are they in" is a
// different concern from "what does the open design look like", and
// folding it into that already-large store would make it harder to
// reason about for no benefit.
//
// businessId is looked up ONCE per session, via `business_users` — RLS
// on that table already scopes the select to `user_id = auth.uid()`
// (see supabase/schema.sql), so this is "read my own membership row",
// not a privileged lookup. Every write path elsewhere in the app
// (layoutStore.ts's upsert/save actions) reads `businessId` from here
// and passes it explicitly into the lib/*.ts function doing the
// write — see CLAUDE.md's PricingContext story for why that's a
// required, explicit value here rather than a silent default.

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabaseclient';

interface AuthStore {
  session: Session | null;
  businessId: string | null;
  // The business's display name, for the app shell (§70). Best-effort:
  // a failure leaves it null and the shell shows a generic label.
  businessName: string | null;
  // True until the FIRST resolution (existing session restored, or
  // confirmed there isn't one) completes — this is what lets App.tsx
  // show a brief loading state instead of flashing the login screen
  // for a session that's actually about to restore from localStorage.
  isLoading: boolean;
  error: string | null;
  // Idempotent — safe to call every time App.tsx mounts, including
  // React StrictMode's double-invoke in dev (guarded below).
  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

async function fetchBusinessId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('business_users')
    .select('business_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load business membership: ${error.message}`);
  return data?.business_id ?? null;
}

async function fetchBusinessName(businessId: string): Promise<string | null> {
  const { data } = await supabase.from('businesses').select('name').eq('id', businessId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

let subscribed = false;

export const useAuthStore = create<AuthStore>((set) => {
  async function resolveSession(session: Session | null) {
    if (!session) {
      set({ session: null, businessId: null, businessName: null, isLoading: false, error: null });
      return;
    }
    try {
      const businessId = await fetchBusinessId(session.user.id);
      set({ session, businessId, isLoading: false, error: null });
      if (businessId) {
        fetchBusinessName(businessId)
          .then((businessName) => set({ businessName }))
          .catch(() => {});
      }
    } catch (err) {
      set({
        session,
        businessId: null,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load business.',
      });
    }
  }

  return {
    session: null,
    businessId: null,
    businessName: null,
    isLoading: true,
    error: null,

    init: () => {
      if (subscribed) return;
      subscribed = true;

      supabase.auth.getSession().then(({ data: { session } }) => resolveSession(session));
      // Covers sign-in, sign-out, and a token refresh happening
      // elsewhere (another tab). CORRECTED: this said resolveSession
      // "just re-sets the same values" for an event on an already-
      // resolved session. Not quite — Supabase passes a NEW session
      // object each time (it fires on tab refocus and hourly token
      // refresh too), so anything keyed on `session` identity re-runs.
      // That reloaded the whole inventory on every tab switch until
      // App.tsx keyed its load on the user id instead. Key on
      // session.user.id, never on `session`.
      supabase.auth.onAuthStateChange((_event, session) => resolveSession(session));
    },

    signIn: async (email, password) => {
      set({ isLoading: true, error: null });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        set({ isLoading: false, error: error.message });
        return;
      }
      // onAuthStateChange's SIGNED_IN event fires from here and
      // resolveSession() takes it from there, including setting
      // isLoading back to false once businessId resolves.
    },

    signOut: async () => {
      await supabase.auth.signOut();
      set({ session: null, businessId: null, businessName: null, error: null });
    },
  };
});
