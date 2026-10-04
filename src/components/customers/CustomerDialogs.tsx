// src/components/customers/CustomerDialogs.tsx
//
// The small forms the pipeline needs, shared by Home and Customers
// (§70): a new customer, the reason a customer was lost (§69 — required,
// so the button stays disabled until one is picked), a job's install
// date, and the customer's notes (§96).

import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { LOST_REASON_LABELS, type CustomerProject, type LostReason } from '../../types/customer';
import { createCustomer, type NewLeadInput } from '../../lib/customers';
import { useAuthStore } from '../../store/authStore';
import { cn } from '@/lib/utils';

const EMPTY: NewLeadInput = { clientName: '', phone: '', address: '', locality: '' };

export function NewCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerProject) => void;
}) {
  const businessId = useAuthStore((s) => s.businessId);
  const [form, setForm] = useState<NewLeadInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof NewLeadInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create() {
    if (!form.clientName.trim() || !form.phone.trim()) {
      setError('Name and phone are needed.');
      return;
    }
    if (!businessId) {
      setError('No business found for this account. Sign out and back in.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createCustomer(
        { ...form, clientName: form.clientName.trim(), phone: form.phone.trim(), notes: form.notes?.trim() || undefined },
        businessId
      );
      setForm(EMPTY);
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>They start as a Lead. You can add the design straight after.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
            Name
            <Input value={form.clientName} onChange={set('clientName')} className="h-11 text-[15px]" autoFocus />
          </Label>
          <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
            Phone
            <Input value={form.phone} onChange={set('phone')} inputMode="tel" className="h-11 text-[15px]" />
          </Label>
          <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
            Address
            <Input value={form.address} onChange={set('address')} className="h-11 text-[15px]" />
          </Label>
          <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
            Locality
            <Input value={form.locality} onChange={set('locality')} placeholder="e.g. Dwarka, Delhi" className="h-11 text-[15px]" />
          </Label>
          {/* Anything at all (§96); editable later from the card's menu. */}
          <Label className="flex flex-col items-stretch gap-1.5 text-[13px] sm:col-span-2">
            <span>
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Anything worth remembering: budget, timing, who decides, site access…"
              className="min-h-28 w-full rounded-[10px] border border-input bg-card px-3 py-2.5 text-[15px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </Label>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="ghost" size="touch" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="touch" onClick={create} disabled={saving}>
            {saving ? 'Adding…' : 'Add customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LostReasonDialog({
  customer,
  onCancel,
  onConfirm,
}: {
  customer: CustomerProject | null;
  onCancel: () => void;
  onConfirm: (reason: LostReason, note: string) => void;
}) {
  const [reason, setReason] = useState<LostReason | null>(null);
  const [note, setNote] = useState('');
  const close = () => {
    setReason(null);
    setNote('');
    onCancel();
  };
  return (
    <Dialog open={customer !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why was {customer?.clientName ?? 'this customer'} lost?</DialogTitle>
          <DialogDescription>
            The reason is kept with the customer, so you can see later why jobs are lost.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Reason" className="grid grid-cols-2 gap-2">
          {(Object.keys(LOST_REASON_LABELS) as LostReason[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'h-12 rounded-xl border text-[15px] font-semibold transition-colors',
                reason === r ? 'border-2 border-primary bg-accent text-accent-foreground' : 'border-border hover:bg-secondary'
              )}
            >
              {LOST_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
          Note (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. went with a local carpenter" className="h-11 text-[15px]" />
        </Label>
        <DialogFooter>
          <Button variant="ghost" size="touch" onClick={close}>
            Cancel
          </Button>
          <Button
            size="touch"
            variant="destructive"
            disabled={!reason}
            onClick={() => {
              if (!reason) return;
              onConfirm(reason, note);
              setReason(null);
              setNote('');
            }}
          >
            Mark as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InstallDateDialog({
  customer,
  onCancel,
  onSave,
}: {
  customer: CustomerProject | null;
  onCancel: () => void;
  onSave: (date: string | null) => void;
}) {
  // Keyed by the customer so reopening for another customer starts from
  // THAT customer's date.
  return (
    <Dialog open={customer !== null} onOpenChange={(o) => !o && onCancel()}>
      {customer && <InstallDateForm key={customer.id} customer={customer} onCancel={onCancel} onSave={onSave} />}
    </Dialog>
  );
}

function InstallDateForm({
  customer,
  onCancel,
  onSave,
}: {
  customer: CustomerProject;
  onCancel: () => void;
  onSave: (date: string | null) => void;
}) {
  const [date, setDate] = useState(customer.installDate ?? '');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Install date — {customer.clientName}</DialogTitle>
        <DialogDescription>Shown under "Installs coming up" on Home.</DialogDescription>
      </DialogHeader>
      <Label className="flex flex-col items-stretch gap-1.5 text-[13px]">
        Date
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-[15px]" />
      </Label>
      <DialogFooter>
        {customer.installDate && (
          <Button variant="ghost" size="touch" className="mr-auto text-destructive" onClick={() => onSave(null)}>
            Clear date
          </Button>
        )}
        <Button variant="ghost" size="touch" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="touch" disabled={!date} onClick={() => onSave(date)}>
          Save date
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function NotesDialog({
  customer,
  onCancel,
  onSave,
}: {
  customer: CustomerProject | null;
  onCancel: () => void;
  onSave: (notes: string) => void;
}) {
  // Keyed by the customer, like the install date, so reopening for
  // another customer starts from THEIR notes.
  return (
    <Dialog open={customer !== null} onOpenChange={(o) => !o && onCancel()}>
      {customer && <NotesForm key={customer.id} customer={customer} onCancel={onCancel} onSave={onSave} />}
    </Dialog>
  );
}

function NotesForm({ customer, onCancel, onSave }: { customer: CustomerProject; onCancel: () => void; onSave: (notes: string) => void }) {
  const [notes, setNotes] = useState(customer.notes ?? '');
  const changed = notes.trim() !== (customer.notes ?? '').trim();
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Notes — {customer.clientName}</DialogTitle>
        <DialogDescription>Anything about this customer. Only your team sees these; they're never on a quote.</DialogDescription>
      </DialogHeader>
      <textarea
        aria-label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        autoFocus
        placeholder="Budget, timing, who decides, site access…"
        className="min-h-44 w-full rounded-[10px] border border-input bg-card px-3 py-2.5 text-[15px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <DialogFooter>
        <Button variant="ghost" size="touch" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="touch" disabled={!changed} onClick={() => onSave(notes)}>
          Save notes
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
