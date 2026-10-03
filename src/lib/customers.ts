// src/lib/customers.ts
//
// Dashboard-level operations on the `projects` table — listing,
// creating a lead, and updating pipeline status. Separate from
// persistence.ts's saveProjectBundle/loadProjectBundle, which handle
// the full project+layout+cabinets bundle for the canvas editor; these
// three only ever touch the `projects` row, reusing its row<->type
// mappers so there's one source of truth for that mapping.

import { supabase } from './Supabaseclient';
import { projectToRow, rowToProject, type ProjectRow } from './Persistence';
import type { CustomerProject, LeadStatus, LostReason } from '../types/customer';

export async function fetchCustomers(): Promise<CustomerProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }

  return (data as ProjectRow[]).map(rowToProject);
}

export interface NewLeadInput {
  clientName: string;
  phone: string;
  email?: string;
  address: string;
  locality: string;
  assignedTo?: string;
  notes?: string;
}

// Every new customer starts life as a 'Lead' — that's the entry point
// of the pipeline (Lead -> Layout Drafted -> Quote Sent -> Approved ->
// In Production -> Installed, or Lost), not something the caller chooses.
//
// `businessId` required, no default — see projectToRow's own comment.
export async function createCustomer(
  input: NewLeadInput,
  businessId: string
): Promise<CustomerProject> {
  const now = new Date().toISOString();
  const newProject: CustomerProject = {
    id: crypto.randomUUID(),
    clientName: input.clientName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    locality: input.locality,
    status: 'Lead',
    statusChangedAt: now,
    assignedTo: input.assignedTo,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await supabase.from('projects').insert(projectToRow(newProject, businessId));
  if (error) {
    throw new Error(`Failed to create customer: ${error.message}`);
  }

  return newProject;
}

// A stage change. Moving to Lost REQUIRES a reason — it's in the type, so
// a screen can't forget to ask (§69, your rule). Leaving Lost clears the
// reason, so a won-back customer doesn't carry a stale "price".
export type StatusChange =
  | { status: Exclude<LeadStatus, 'Lost'> }
  | { status: 'Lost'; reason: LostReason; note?: string };

export function statusChangeRow(change: StatusChange, now: string) {
  return {
    status: change.status,
    status_changed_at: now,
    updated_at: now,
    lost_reason: change.status === 'Lost' ? change.reason : null,
    lost_note: change.status === 'Lost' ? (change.note?.trim() || null) : null,
  };
}

// Returns the time it recorded, so the caller can update its own copy.
export async function updateCustomerStatus(id: string, change: StatusChange): Promise<string> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('projects').update(statusChangeRow(change, now)).eq('id', id);

  if (error) {
    throw new Error(`Failed to update status for ${id}: ${error.message}`);
  }
  return now;
}

// The install date of a job in production (§69) — drives "Installs
// coming up" on Home. null clears it.
export async function setInstallDate(id: string, installDate: string | null): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ install_date: installDate, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to set install date for ${id}: ${error.message}`);
  }
}
