// src/components/auth/LoginScreen.tsx
//
// Sign-IN only, deliberately no sign-up form — there is no self-serve
// onboarding for other businesses yet (see docs/PRINCIPLES.md's
// "honest sequencing problem" and the DECISIONS.md entry for this
// pass). The one account that exists is created via the Supabase
// dashboard — docs/SUPABASE_SETUP.md has the exact steps.

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';

export function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void signIn(email, password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-sm font-semibold text-gray-700">Sign in</h1>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isLoading}
          className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
