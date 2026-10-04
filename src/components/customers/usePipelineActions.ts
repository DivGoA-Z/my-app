// src/components/customers/usePipelineActions.ts
//
// Stage changes and install dates, applied optimistically to the page's
// own list and rolled back if Supabase refuses — the same shape the old
// dashboard used, shared by Home and Customers.

import { toast } from 'sonner';
import { setInstallDate, updateCustomerStatus, type StatusChange, updateCustomerNotes } from '../../lib/customers';
import type { CustomerProject } from '../../types/customer';
import { STAGE_META } from '../../lib/pipeline';

type SetList = React.Dispatch<React.SetStateAction<CustomerProject[]>>;

export function usePipelineActions(customers: CustomerProject[], setCustomers: SetList) {
  const patch = (id: string, p: Partial<CustomerProject>) =>
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));

  async function changeStage(customer: CustomerProject, change: StatusChange) {
    if (customer.status === change.status) return;
    const previous = customers;
    patch(customer.id, {
      status: change.status,
      lostReason: change.status === 'Lost' ? change.reason : undefined,
      lostNote: change.status === 'Lost' ? change.note : undefined,
      statusChangedAt: new Date().toISOString(),
    });
    try {
      const at = await updateCustomerStatus(customer.id, change);
      patch(customer.id, { statusChangedAt: at });
      toast.success(`${customer.clientName} → ${STAGE_META[change.status].label}`);
    } catch (err) {
      setCustomers(previous);
      toast.error("Couldn't change the stage", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function saveInstallDate(customer: CustomerProject, date: string | null) {
    const previous = customers;
    patch(customer.id, { installDate: date ?? undefined });
    try {
      await setInstallDate(customer.id, date);
      toast.success(date ? 'Install date saved' : 'Install date cleared');
    } catch (err) {
      setCustomers(previous);
      toast.error("Couldn't save the install date", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function saveNotes(customer: CustomerProject, notes: string) {
    const previous = customers;
    patch(customer.id, { notes: notes.trim() || undefined });
    try {
      await updateCustomerNotes(customer.id, notes);
      toast.success('Notes saved');
    } catch (err) {
      setCustomers(previous);
      toast.error("Couldn't save the notes", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return { changeStage, saveInstallDate, saveNotes };
}
