// src/lib/pipeline.ts
//
// What Home and Customers show about the pipeline, worked out from the
// customer list alone (no layouts loaded). Pure functions, so the rules
// are testable and Home and Customers can't disagree (§70).
//
// The rules, as agreed on the Home mockup (docs/UX_PLAN.md):
//   - Quotes out: every customer at Quote Sent, with its total.
//   - Approved jobs (open): every job Approved or In Production — not
//     "this month" — split into not started / in production.
//   - Installs coming up: In Production with an install date today or
//     later.
//   - Follow up: a customer stuck in a stage longer than FOLLOW_UP_DAYS
//     (Lead, Layout Drafted, Quote Sent), or Approved/In Production with
//     something missing (no install date yet).
//   - Continue designing: not yet approved, edited in the last 7 days.

import type { CustomerProject, LeadStatus } from '../types/customer';

export const FOLLOW_UP_DAYS = 3;
export const CONTINUE_DESIGNING_DAYS = 7;
export const INSTALLED_BOARD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// When the customer entered its current stage. Older rows (before §69's
// status_changed_at) fall back to their last update.
export function stageSince(c: CustomerProject): string {
  return c.statusChangedAt ?? c.updatedAt;
}

export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

function sum(cs: CustomerProject[]): number {
  return cs.reduce((t, c) => t + (c.quoteTotal ?? 0), 0);
}

// The local calendar date as YYYY-MM-DD, to compare with install dates.
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface HomeStats {
  quotesOut: { count: number; value: number };
  approvedOpen: { count: number; value: number; notStarted: number; inProduction: number };
  installs: { count: number; next?: { date: string; name: string } };
  followUpCount: number;
}

export function homeStats(customers: CustomerProject[], now: Date): HomeStats {
  const at = (s: LeadStatus) => customers.filter((c) => c.status === s);
  const sent = at('Quote Sent');
  const approved = at('Approved');
  const production = at('In Production');
  const today = localDate(now);
  const upcoming = production
    .filter((c) => c.installDate && c.installDate >= today)
    .sort((a, b) => a.installDate!.localeCompare(b.installDate!));
  return {
    quotesOut: { count: sent.length, value: sum(sent) },
    approvedOpen: {
      count: approved.length + production.length,
      value: sum(approved) + sum(production),
      notStarted: approved.length,
      inProduction: production.length,
    },
    installs: {
      count: upcoming.length,
      next: upcoming[0] ? { date: upcoming[0].installDate!, name: upcoming[0].clientName } : undefined,
    },
    followUpCount: followUps(customers, now).length,
  };
}

export type FollowUpAction = 'whatsapp' | 'start-design' | 'open-design' | 'set-install-date';

export interface FollowUp {
  customer: CustomerProject;
  why: string;
  action: FollowUpAction;
  // For ordering: most overdue first.
  days: number;
}

export function followUps(customers: CustomerProject[], now: Date): FollowUp[] {
  const out: FollowUp[] = [];
  for (const c of customers) {
    const days = daysSince(stageSince(c), now);
    const ago = days === 1 ? '1 day' : `${days} days`;
    if (c.status === 'Quote Sent' && days >= FOLLOW_UP_DAYS) {
      out.push({ customer: c, days, action: 'whatsapp', why: `Quote sent ${ago} ago · no change since` });
    } else if (c.status === 'Lead' && days >= FOLLOW_UP_DAYS) {
      out.push({ customer: c, days, action: 'start-design', why: `Lead for ${ago} · design not started` });
    } else if (c.status === 'Layout Drafted' && days >= FOLLOW_UP_DAYS) {
      out.push({ customer: c, days, action: 'open-design', why: `Design drafted ${ago} ago · quote not sent` });
    } else if (c.status === 'In Production' && !c.installDate) {
      out.push({ customer: c, days, action: 'set-install-date', why: 'In production · no install date yet' });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}

export function continueDesigning(customers: CustomerProject[], now: Date): CustomerProject[] {
  const designing: LeadStatus[] = ['Lead', 'Layout Drafted', 'Quote Sent'];
  return customers
    .filter((c) => designing.includes(c.status) && daysSince(c.updatedAt, now) <= CONTINUE_DESIGNING_DAYS)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// The Customers board's columns. Installed shows only recent jobs, so
// the board doesn't fill with finished work; Lost is a filter, not a
// column.
export const BOARD_STAGES: Exclude<LeadStatus, 'Lost'>[] = [
  'Lead',
  'Layout Drafted',
  'Quote Sent',
  'Approved',
  'In Production',
  'Installed',
];

export function onBoard(c: CustomerProject, now: Date): boolean {
  if (c.status === 'Lost') return false;
  if (c.status === 'Installed') return daysSince(stageSince(c), now) <= INSTALLED_BOARD_DAYS;
  return true;
}

// Display names and colours per stage — design-system tokens only.
export const STAGE_META: Record<LeadStatus, { label: string; pill: string; dot: string }> = {
  Lead: { label: 'Lead', pill: 'bg-secondary text-muted-foreground', dot: 'bg-muted-foreground' },
  'Layout Drafted': { label: 'Layout drafted', pill: 'bg-info/10 text-info', dot: 'bg-info' },
  'Quote Sent': { label: 'Quote sent', pill: 'bg-warning-soft text-warning-foreground', dot: 'bg-warning' },
  Approved: { label: 'Approved', pill: 'bg-accent text-accent-foreground', dot: 'bg-primary' },
  'In Production': { label: 'In production', pill: 'bg-primary text-primary-foreground', dot: 'bg-primary' },
  Installed: { label: 'Installed', pill: 'bg-secondary text-foreground', dot: 'bg-foreground' },
  Lost: { label: 'Lost', pill: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};
