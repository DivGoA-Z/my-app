// src/components/auth/AwaitingAccessScreen.tsx
//
// Shown to a signed-in person who belongs to no business yet (§106): a
// new sign-up waiting for approval. Until the software owner adds their
// business_users row (docs/DEPLOY.md), RLS shows them nothing and lets
// them write nothing, so the app itself would only be empty screens and
// failed saves. This says what's happening instead, and offers "Check
// again" so they don't have to sign out and back in once approved.

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/button';

export function AwaitingAccessScreen() {
  const email = useAuthStore((s) => s.session?.user.email ?? '');
  const recheckAccess = useAuthStore((s) => s.recheckAccess);
  const signOut = useAuthStore((s) => s.signOut);
  const [checked, setChecked] = useState(false);

  async function handleCheck() {
    await recheckAccess();
    // Still here means still not approved.
    setChecked(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-[420px] flex-col gap-4" role="status">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-sidebar text-lg font-extrabold text-sidebar-primary">K</div>
        <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">Waiting for access</h1>
        <p className="text-[15px] text-muted-foreground">
          Your account{email ? <> (<span className="font-semibold text-foreground">{email}</span>)</> : null} is created. It
          needs to be linked to a business before you can use the app. We set that up by hand, usually within a day.
        </p>
        {checked && <p className="text-[13px] text-muted-foreground">Not linked yet. Try again a little later.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="touch" onClick={handleCheck}>
            Check again
          </Button>
          <Button size="touch" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
