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
//
// SIGN-UP (§106) creates a login and nothing else. A new account belongs
// to no business, so every RLS policy shows it nothing, and App.tsx
// shows "waiting for access" until the software owner adds a
// business_users row by hand (docs/DEPLOY.md). Creating a business, or
// joining one, from the browser is deliberately impossible: the client
// has no insert policy on businesses or business_users.

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabaseclient';
import {
  fetchBusinessProfile,
  gstinProblem,
  normaliseGstin,
  removeBusinessLogo,
  saveBusinessProfile,
  uploadBusinessLogo,
  type BusinessProfile,
} from '../lib/businessProfile';

interface AuthStore {
  session: Session | null;
  businessId: string | null;
  // The business's display name, for the app shell (§70). Best-effort:
  // a failure leaves it null and the shell shows a generic label.
  businessName: string | null;
  // Name, phone, logo and GSTIN for the quote PDF (§94); businessName
  // above mirrors its name for the shell.
  businessProfile: BusinessProfile | null;
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
  // Resolves to whether the email must be confirmed before signing in
  // (Supabase's "Confirm email" setting): true → no session yet, the
  // person is told to check their inbox. Throws on failure, with
  // Supabase's message, so the form can show it.
  signUp: (details: { email: string; password: string; fullName: string; businessName: string }) => Promise<{ needsEmailConfirmation: boolean }>;
  // Looks up the membership again without signing out — the "Check
  // again" button on the waiting screen, after the owner has approved.
  recheckAccess: () => Promise<void>;
  signOut: () => Promise<void>;
  // Settings → Business (§78, §94). Each throws on failure so the form
  // can say so.
  saveBusinessDetails: (patch: { name: string; phone: string; gstin: string; showGstin: boolean }) => Promise<void>;
  setBusinessLogo: (file: File) => Promise<void>;
  clearBusinessLogo: () => Promise<void>;
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


let subscribed = false;

export const useAuthStore = create<AuthStore>((set) => {
  async function resolveSession(session: Session | null) {
    if (!session) {
      set({ session: null, businessId: null, businessName: null, businessProfile: null, isLoading: false, error: null });
      return;
    }
    try {
      const businessId = await fetchBusinessId(session.user.id);
      set({ session, businessId, isLoading: false, error: null });
      if (businessId) {
        fetchBusinessProfile(businessId)
          .then((businessProfile) => set({ businessProfile, businessName: businessProfile?.name ?? null }))
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
    businessProfile: null,
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

    saveBusinessDetails: async (patch) => {
      const { businessId, businessProfile } = useAuthStore.getState();
      if (!businessId) throw new Error('No business found for this account.');
      if (!patch.name.trim()) throw new Error('The name can’t be empty.');
      const problem = gstinProblem(patch.gstin);
      if (problem) throw new Error(problem);
      if (patch.showGstin && !normaliseGstin(patch.gstin)) throw new Error('Enter the GSTIN to print it on quotes.');
      await saveBusinessProfile(businessId, patch);
      const next: BusinessProfile = {
        ...(businessProfile ?? { logoUrl: null }),
        name: patch.name.trim(),
        phone: patch.phone.trim(),
        gstin: normaliseGstin(patch.gstin),
        showGstin: patch.showGstin,
        columnsMissing: false,
      };
      set({ businessProfile: next, businessName: next.name });
    },

    setBusinessLogo: async (file) => {
      const { businessId, businessProfile } = useAuthStore.getState();
      if (!businessId || !businessProfile) throw new Error('No business found for this account.');
      const logoUrl = await uploadBusinessLogo(businessId, file, businessProfile.logoUrl);
      set({ businessProfile: { ...businessProfile, logoUrl } });
    },

    clearBusinessLogo: async () => {
      const { businessId, businessProfile } = useAuthStore.getState();
      if (!businessId || !businessProfile) return;
      await removeBusinessLogo(businessId, businessProfile.logoUrl);
      set({ businessProfile: { ...businessProfile, logoUrl: null } });
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

    signUp: async ({ email, password, fullName, businessName }) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Where the confirmation link lands: this site, whichever
          // address it's served from.
          emailRedirectTo: window.location.origin,
          // Shown to the owner when approving (auth.users.raw_user_meta_data).
          data: { full_name: fullName.trim(), business_name: businessName.trim() },
        },
      });
      if (error) throw new Error(error.message);
      // With "Confirm email" on, Supabase returns the user but no session;
      // onAuthStateChange takes over once they confirm and sign in.
      return { needsEmailConfirmation: !data.session };
    },

    recheckAccess: async () => {
      const { data } = await supabase.auth.getSession();
      set({ isLoading: true });
      await resolveSession(data.session);
    },

    signOut: async () => {
      await supabase.auth.signOut();
      set({ session: null, businessId: null, businessName: null, error: null });
    },
  };
});
