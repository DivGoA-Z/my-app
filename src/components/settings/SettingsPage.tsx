// src/components/settings/SettingsPage.tsx
//
// The account, for now (§70, §73). Rate card and Workshop used to be tabs
// here; you moved them onto the sidebar on 3 Oct, so they're one tap
// away. Business details (name, logo for the quote PDF) will join this
// page when built.

import { PageHeader } from '../shell/AppShell';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/authStore';

export function SettingsPage() {
  const email = useAuthStore((s) => s.session?.user.email);
  const businessName = useAuthStore((s) => s.businessName);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader title="Settings" subtitle="Your account" />
      <div className="flex max-w-lg flex-col gap-5 rounded-2xl bg-card p-6 shadow-card">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-muted-foreground">Business</span>
          <span className="text-base font-semibold">{businessName ?? '—'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-muted-foreground">Signed in as</span>
          <span className="text-base font-semibold">{email ?? '—'}</span>
        </div>
        <Button variant="outline" size="touch" className="self-start" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
