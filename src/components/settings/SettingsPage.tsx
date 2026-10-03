// src/components/settings/SettingsPage.tsx
//
// The business and the account (§70, §73, §78). Rate card and Workshop
// used to be tabs here; you moved them onto the sidebar on 3 Oct.
// Business details: the name shown in the sidebar (and, later, on the
// quote PDF with a logo).

import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, UserRound } from 'lucide-react';
import { PageHeader } from '../shell/AppShell';
import { SectionCard } from '../common/SectionCard';
import { TextField } from '../common/EditPanel';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/authStore';

export function SettingsPage() {
  const email = useAuthStore((s) => s.session?.user.email);
  const businessName = useAuthStore((s) => s.businessName);
  const renameBusiness = useAuthStore((s) => s.renameBusiness);
  const signOut = useAuthStore((s) => s.signOut);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = name ?? businessName ?? '';
  const dirty = name !== null && name.trim() !== (businessName ?? '');

  async function save() {
    setSaving(true);
    try {
      await renameBusiness(shown);
      setName(null);
      toast.success('Business name saved');
    } catch (err) {
      toast.error("Couldn't save the name", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader title="Settings" subtitle="Your business and account" />
      <div className="flex max-w-2xl flex-col gap-6">
        <SectionCard Icon={Building2} title="Business" description="How your business appears in the app.">
          <TextField label="Business name" value={shown} onChange={setName} placeholder="e.g. Sharma Modular Kitchens" />
          <div className="flex items-center gap-3">
            <Button size="touch" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <span className="text-[13px] text-muted-foreground">A logo for the quote PDF can be added here later.</span>
          </div>
        </SectionCard>
        <SectionCard Icon={UserRound} title="Account" description="The login you're using on this device.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px] text-muted-foreground">Signed in as</span>
              <span className="text-[15px] font-semibold">{email ?? '—'}</span>
            </div>
            <Button variant="outline" size="touch" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
