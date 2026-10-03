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

  // Premium A (§73-74): a material panel beside the form on tablet and
  // laptop — the first thing anyone sees is a kitchen material, not a
  // grey box. On a phone the form stands alone with the brand above it.
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="relative hidden w-[46%] max-w-[680px] overflow-hidden bg-sidebar md:block">
        <img src="/textures/wood-dark-walnut/color.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/60 to-sidebar/20" />
        <div className="absolute inset-x-10 bottom-12 flex flex-col gap-3 text-white">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-sidebar-primary">Kitchen design &amp; quoting</span>
          <p className="max-w-md text-[32px] font-extrabold leading-tight tracking-[-0.03em]">
            Design it with the customer. Quote it on the spot.
          </p>
          <p className="max-w-md text-[15px] text-sidebar-foreground">
            Plan, 3D, an itemised quote and the cutting list, from one drawing.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={handleSubmit} className="flex w-full max-w-[380px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-sidebar text-lg font-extrabold text-sidebar-primary">
              K
            </div>
            <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">Welcome back</h1>
            <p className="text-[15px] text-muted-foreground">Sign in to your business account.</p>
          </div>

          <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className="h-12 rounded-xl bg-card text-base"
            />
          </Label>

          <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
            Password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="h-12 rounded-xl bg-card text-base"
            />
          </Label>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" size="touch-lg" className="mt-1 w-full shadow-cta" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-[13px] text-muted-foreground">
            No account? Your business's login is set up for you. Ask whoever manages it.
          </p>
        </form>
      </div>
    </div>
  );
}
