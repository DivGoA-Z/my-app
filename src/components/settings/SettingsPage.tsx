// src/components/settings/SettingsPage.tsx
//
// The business and the account (§70, §73, §78, §94). Rate card and
// Workshop used to be tabs here; you moved them onto the sidebar on
// 3 Oct. Business details are what the quote PDF prints in its header:
// name, phone, logo, and the GSTIN when the business chooses to print it
// (not every business is GST-registered, or wants it on a quote).

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Building2, ImageUp, Trash2, UserRound } from 'lucide-react';
import { PageHeader } from '../shell/AppShell';
import { SectionCard } from '../common/SectionCard';
import { TextField } from '../common/EditPanel';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useAuthStore } from '../../store/authStore';
import { gstinProblem, normaliseGstin } from '../../lib/businessProfile';

interface Draft {
  name: string;
  phone: string;
  gstin: string;
  showGstin: boolean;
}

export function SettingsPage() {
  const email = useAuthStore((s) => s.session?.user.email);
  const profile = useAuthStore((s) => s.businessProfile);
  const saveBusinessDetails = useAuthStore((s) => s.saveBusinessDetails);
  const setBusinessLogo = useAuthStore((s) => s.setBusinessLogo);
  const clearBusinessLogo = useAuthStore((s) => s.clearBusinessLogo);
  const signOut = useAuthStore((s) => s.signOut);

  const saved: Draft = {
    name: profile?.name ?? '',
    phone: profile?.phone ?? '',
    gstin: profile?.gstin ?? '',
    showGstin: profile?.showGstin ?? false,
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = draft ?? saved;
  const edit = (patch: Partial<Draft>) => setDraft({ ...shown, ...patch });
  const dirty =
    draft !== null &&
    (draft.name.trim() !== saved.name ||
      draft.phone.trim() !== saved.phone ||
      normaliseGstin(draft.gstin) !== saved.gstin ||
      draft.showGstin !== saved.showGstin);
  const gstinError = gstinProblem(shown.gstin);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await saveBusinessDetails(shown);
      setDraft(null);
      toast.success('Business details saved', { description: 'New quote PDFs will use them.' });
    } catch (err) {
      toast.error("Couldn't save", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    try {
      await setBusinessLogo(file);
      toast.success('Logo saved', { description: 'It will appear on new quote PDFs.' });
    } catch (err) {
      toast.error("Couldn't save the logo", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      await clearBusinessLogo();
      toast.success('Logo removed');
    } catch (err) {
      toast.error("Couldn't remove the logo", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setLogoBusy(false);
    }
  }

  const printedGstin = shown.showGstin && !gstinError ? normaliseGstin(shown.gstin) : '';

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader title="Settings" subtitle="Your business and account" />
      <div className="flex max-w-2xl flex-col gap-6">
        {profile?.columnsMissing && (
          <div className="flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">One setup step left:</span> re-run <code>supabase/schema.sql</code> in Supabase (SQL editor) so
              the phone, logo and GSTIN can be saved. Your name still saves.
            </span>
          </div>
        )}

        <SectionCard Icon={Building2} title="Business" description="What your quote PDFs print at the top.">
          <TextField label="Business name" value={shown.name} onChange={(name) => edit({ name })} placeholder="e.g. Sharma Modular Kitchens" />
          <TextField label="Phone" value={shown.phone} onChange={(phone) => edit({ phone })} placeholder="e.g. +91 98765 43210" />
          <TextField
            label="GSTIN (optional)"
            value={shown.gstin}
            onChange={(gstin) => edit({ gstin })}
            placeholder="e.g. 07AAACS1234A1Z5"
            hint={gstinError ? <span className="font-medium text-destructive">{gstinError}</span> : '15 characters. Checked for typos.'}
          />
          <Label className="flex items-center gap-2.5 text-sm font-medium">
            <Checkbox checked={shown.showGstin} onCheckedChange={(c) => edit({ showGstin: c === true })} />
            Print the GSTIN on quotes
          </Label>
          <div className="flex items-center gap-3">
            <Button size="touch" onClick={save} disabled={!dirty || saving || Boolean(gstinError)}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SectionCard>

        <SectionCard Icon={ImageUp} title="Logo" description="Printed at the top left of your quote PDFs.">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={logoBusy}
                onChange={(e) => {
                  void pickLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <span
                className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary ${logoBusy ? 'pointer-events-none opacity-60' : ''}`}
              >
                <ImageUp className="size-4" /> {logoBusy ? 'Saving…' : profile?.logoUrl ? 'Replace logo' : 'Upload logo'}
              </span>
            </label>
            {profile?.logoUrl && (
              <Button variant="ghost" size="touch" className="text-muted-foreground hover:text-destructive" onClick={removeLogo} disabled={logoBusy}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
          <span className="text-[13px] text-muted-foreground">PNG or JPG. A wide logo on a transparent or white background prints best.</span>

          {/* How the quote header will look (§94), same arrangement as
              lib/quotePdf.ts's drawBusinessHeader. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-muted-foreground">On the quote</span>
            <div className="flex min-h-20 items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 text-[#1f2937]">
              {profile?.logoUrl ? (
                <>
                  <img src={profile.logoUrl} alt="Your logo" className="max-h-12 max-w-[120px] object-contain" />
                  <div className="flex flex-col items-end text-right">
                    <span className="font-bold">{shown.name || 'Business name'}</span>
                    {shown.phone && <span className="text-xs">{shown.phone}</span>}
                    {printedGstin && <span className="text-xs">GSTIN {printedGstin}</span>}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-lg font-bold">{shown.name || 'Business name'}</span>
                  <div className="flex flex-col items-end text-right text-xs">
                    {shown.phone && <span>{shown.phone}</span>}
                    {printedGstin && <span>GSTIN {printedGstin}</span>}
                  </div>
                </>
              )}
            </div>
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
