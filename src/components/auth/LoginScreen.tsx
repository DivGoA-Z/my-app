// src/components/auth/LoginScreen.tsx
//
// Sign-IN only, deliberately no sign-up form — there is no self-serve
// onboarding for other businesses yet (see docs/PRINCIPLES.md's
// "honest sequencing problem" and the DECISIONS.md entry for this
// pass). The one account that exists is created via the Supabase
// dashboard — docs/SUPABASE_SETUP.md has the exact steps.

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';

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

        <Label className="flex flex-col items-stretch gap-1 text-xs font-normal text-gray-600">
          Email
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Label>

        <Label className="flex flex-col items-stretch gap-1 text-xs font-normal text-gray-600">
          Password
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Label>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
