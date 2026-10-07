// src/components/auth/LoginScreen.tsx
//
// Sign in, or create an account (§106). Creating an account was left
// out at first (docs/PRINCIPLES.md's "honest sequencing problem"); it now
// exists, but only as a REQUEST: the new login belongs to no business,
// sees nothing, and waits on AwaitingAccessScreen until the software
// owner links it to a business by hand (docs/DEPLOY.md). Self-serve
// business creation is still not built. The name and business name are
// asked for so the owner knows who they're approving.

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';

// Supabase's own minimum is 6; asked for here so the form says so before
// a round trip does.
const MIN_PASSWORD_LENGTH = 8;

export function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const isLoading = useAuthStore((s) => s.isLoading);
  const signInError = useAuthStore((s) => s.error);

  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);
  // Set once an account is created and the email must be confirmed first.
  const [checkEmailFor, setCheckEmailFor] = useState<string | null>(null);

  const signingUp = mode === 'sign-up';
  const error = signingUp ? signUpError : signInError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signingUp) {
      void signIn(email, password);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setSignUpError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      return;
    }
    setSignUpError(null);
    setIsSigningUp(true);
    try {
      const { needsEmailConfirmation } = await signUp({ email, password, fullName, businessName });
      if (needsEmailConfirmation) setCheckEmailFor(email);
      // Otherwise Supabase signed them straight in, and App.tsx moves on
      // to the waiting-for-access screen.
    } catch (err) {
      setSignUpError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setIsSigningUp(false);
    }
  }

  function switchMode(next: 'sign-in' | 'sign-up') {
    setMode(next);
    setSignUpError(null);
    setCheckEmailFor(null);
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
        {checkEmailFor ? (
          <div className="flex w-full max-w-[380px] flex-col gap-4" role="status">
            <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">Check your email</h1>
            <p className="text-[15px] text-muted-foreground">
              We sent a link to <span className="font-semibold text-foreground">{checkEmailFor}</span>. Open it to confirm
              your address, then sign in. Your account will then wait for approval before you can use it.
            </p>
            <Button variant="outline" size="touch-lg" onClick={() => switchMode('sign-in')}>
              Back to sign in
            </Button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex w-full max-w-[380px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-sidebar text-lg font-extrabold text-sidebar-primary">
              K
            </div>
            <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">{signingUp ? 'Create an account' : 'Welcome back'}</h1>
            <p className="text-[15px] text-muted-foreground">
              {signingUp
                ? 'New accounts are approved by hand before they can be used.'
                : 'Sign in to your business account.'}
            </p>
          </div>

          {signingUp && (
            <>
              <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
                Your name
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="name"
                  className="h-12 rounded-xl bg-card text-base"
                />
              </Label>
              <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
                Business name
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  autoComplete="organization"
                  className="h-12 rounded-xl bg-card text-base"
                />
              </Label>
            </>
          )}

          <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={!signingUp}
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
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              minLength={signingUp ? MIN_PASSWORD_LENGTH : undefined}
              className="h-12 rounded-xl bg-card text-base"
            />
          </Label>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {signingUp ? (
            <Button type="submit" size="touch-lg" className="mt-1 w-full shadow-cta" disabled={isSigningUp}>
              {isSigningUp ? 'Creating account…' : 'Create account'}
            </Button>
          ) : (
            <Button type="submit" size="touch-lg" className="mt-1 w-full shadow-cta" disabled={isLoading}>
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
          )}
          <p className="text-[13px] text-muted-foreground">
            {signingUp ? 'Already have an account? ' : 'New here? '}
            <button
              type="button"
              onClick={() => switchMode(signingUp ? 'sign-in' : 'sign-up')}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              {signingUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </form>
        )}
      </div>
    </div>
  );
}
