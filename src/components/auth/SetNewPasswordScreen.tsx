// src/components/auth/SetNewPasswordScreen.tsx
//
// Shown after opening a password-reset link (§133): Supabase has signed
// the person in for this one purpose, so the app waits here until a new
// password is saved. "Sign out" leaves without changing it.

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';

// Same rule as creating an account (LoginScreen).
const MIN_PASSWORD_LENGTH = 8;

export function SetNewPasswordScreen() {
  const email = useAuthStore((s) => s.session?.user.email);
  const setNewPassword = useAuthStore((s) => s.setNewPassword);
  const signOut = useAuthStore((s) => s.signOut);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await setNewPassword(password);
      // App moves on to the app once passwordRecovery is cleared.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the new password.');
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">Set a new password</h1>
          <p className="text-[15px] text-muted-foreground">
            For <span className="font-semibold text-foreground">{email ?? 'your account'}</span>. You’ll stay signed in afterwards.
          </p>
        </div>
        <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
          New password
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            className="h-12 rounded-xl bg-card text-base"
          />
        </Label>
        <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
          Type it again
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            className="h-12 rounded-xl bg-card text-base"
          />
        </Label>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" size="touch-lg" className="mt-1 w-full shadow-cta" disabled={saving}>
          {saving ? 'Saving…' : 'Save new password'}
        </Button>
        <button type="button" onClick={() => void signOut()} className="self-start text-[13px] font-semibold underline underline-offset-2">
          Sign out instead
        </button>
      </form>
    </div>
  );
}
