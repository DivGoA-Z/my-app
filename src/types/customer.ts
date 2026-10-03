// src/types/customer.ts

export type LeadStatus =
  | 'Lead'
  | 'Layout Drafted'
  | 'Quote Sent'
  | 'Approved'
  | 'In Production'
  // §69 — the end of a job, and a customer who said no (with a reason).
  | 'Installed'
  | 'Lost';

// The pipeline's stages in order, for boards and pickers. Lost is last
// and kept off the board (it's a filter), but it's still a stage.
export const LEAD_STATUSES: LeadStatus[] = [
  'Lead',
  'Layout Drafted',
  'Quote Sent',
  'Approved',
  'In Production',
  'Installed',
  'Lost',
];

export type LostReason = 'price' | 'went-elsewhere' | 'postponed' | 'other';

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: 'Price',
  'went-elsewhere': 'Went elsewhere',
  postponed: 'Postponed',
  other: 'Other',
};

export interface CustomerProject {
  id: string;                // UUID
  clientName: string;
  phone: string;
  email?: string;
  address: string;
  locality: string;          // e.g. "Rohini, Delhi" — useful for Delhi NCR site-visit routing
  status: LeadStatus;
  assignedTo?: string;       // sales rep / designer name or ID
  notes?: string;
  // Snapshot of the BOM grand total (see lib/bom.ts) at the point the
  // quote was last sent/approved — not live. A project's BOM is only
  // computed live while its layout is open in the canvas editor; this
  // field is what the pipeline dashboard displays without needing to
  // load every project's full layout just to show a number. Undefined
  // for a lead with no layout/quote yet.
  quoteTotal?: number;
  // §69. Set only through lib/customers.ts's status/install-date updates
  // — never written by the project save (projectToRow), so they can't be
  // overwritten by a stale copy of the project open in the editor.
  lostReason?: LostReason;
  lostNote?: string;
  installDate?: string;      // YYYY-MM-DD
  statusChangedAt?: string;  // ISO 8601; when `status` last changed
  createdAt: string;         // ISO 8601 date string
  updatedAt: string;         // ISO 8601 date string
}

/*
Example JSON:

{
  "id": "proj_001",
  "clientName": "Ananya Sharma",
  "phone": "+91-98765-43210",
  "email": "ananya.sharma@example.com",
  "address": "B-42, Sector 21",
  "locality": "Dwarka, Delhi",
  "status": "Quote Sent",
  "assignedTo": "designer_rahul",
  "notes": "Prefers acrylic finish, wants cylinder trolley near sink.",
  "quoteTotal": 61551,
  "createdAt": "2026-07-10T09:30:00.000Z",
  "updatedAt": "2026-08-20T14:05:00.000Z"
}
*/
