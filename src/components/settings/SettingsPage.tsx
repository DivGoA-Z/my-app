// src/components/settings/SettingsPage.tsx
//
// Everything about how the BUSINESS works, in one place (docs/UX_PLAN.md
// §5; §70): the rate card (moved here from the catalogue page), Workshop
// settings, and the account. The catalogue page keeps the things you
// pick from when designing (cabinets, appliances, finishes, handles,
// fixtures). Business details (name, logo for the quote PDF) will join
// this page when built.

import { useState } from 'react';
import { PageHeader } from '../shell/AppShell';
import { RateCardManager } from '../inventory/RateCardManager';
import { ConstructionSettingsManager } from '../workshop/ConstructionSettingsManager';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/authStore';
import { cn } from '@/lib/utils';

export type SettingsTab = 'rates' | 'workshop' | 'account';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'rates', label: 'Rate card' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'account', label: 'Account' },
];

export function SettingsPage({ initialTab = 'rates' }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const email = useAuthStore((s) => s.session?.user.email);
  const businessName = useAuthStore((s) => s.businessName);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader title="Settings" />
      <div role="tablist" aria-label="Settings" className="flex w-fit gap-1 rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-10 rounded-[9px] px-4 text-sm font-semibold',
              tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-5xl">
        {tab === 'rates' && <RateCardManager />}
        {tab === 'workshop' && <ConstructionSettingsManager />}
        {tab === 'account' && (
          <div className="flex max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-muted-foreground">Business</span>
              <span className="text-[15px] font-semibold">{businessName ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-muted-foreground">Signed in as</span>
              <span className="text-[15px] font-semibold">{email ?? '—'}</span>
            </div>
            <Button variant="outline" size="touch" className="self-start" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
