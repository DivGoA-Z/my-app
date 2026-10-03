// src/lib/quotes.ts
//
// Reading and freezing quotes (`quotes` table — see supabase/schema.sql).
//
// Same shape as the other lib/* catalogue modules: row interface,
// mappers, async functions, no caching. Two departures, both forced by
// what a frozen quote IS:
//
//   - There is no update. A quote is written once. Revising means
//     freezing a new version, which is why freezeQuote takes the next
//     version number rather than an id to overwrite.
//   - There is no delete. Deleting the record of what you quoted a
//     customer is not a feature. If a quote was frozen in error, freeze
//     the corrected one as the next version — the history is the point.

import type { FrozenCutList } from './cutList';
import { supabase } from './Supabaseclient';
import type { FrozenQuote, FrozenPricingContext } from '../types/quote';
import { computeQuoteFingerprint } from '../types/quote';
import type { BOMSummary, PricingContext } from './bom';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';

// The ONE place the fingerprint input is assembled.
//
// Freezing a quote and checking whether one has gone stale must hash
// exactly the same things, or every quote reads stale the moment it is
// created. Two call sites building that object independently is how
// that goes wrong, so neither of them does — they both call this.
//
// `ctx` already carries the layout, so it is not passed separately;
// including it twice would change the hash without changing meaning.
export function fingerprintPricedInputs(
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[],
  ctx: PricingContext
): string {
  return computeQuoteFingerprint({ cabinets, appliances, ctx });
}

interface QuoteRow {
  id: string;
  project_id: string;
  version: number;
  summary: BOMSummary;
  pricing_context: FrozenPricingContext;
  // §60 — the cutting list frozen with this version. NULL before §60.
  cut_list: FrozenCutList | null;
  grand_total: number;
  frozen_at: string;
  note: string | null;
  created_at: string;
  sent_at: string | null;
}

function rowToQuote(row: QuoteRow): FrozenQuote {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    summary: row.summary,
    pricingContext: row.pricing_context,
    cutList: row.cut_list ?? undefined,
    grandTotal: row.grand_total,
    frozenAt: row.frozen_at,
    sentAt: row.sent_at ?? undefined,
    note: row.note ?? undefined,
  };
}

export async function fetchQuotes(projectId: string): Promise<FrozenQuote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false });

  if (error) throw new Error(`Failed to load quotes: ${error.message}`);
  return (data as QuoteRow[]).map(rowToQuote);
}

// Records that a quote was actually shared on WhatsApp — called from
// QuoteFreezePanel's shareOnWhatsApp, never from the PDF download path
// (downloading is the designer grabbing a copy, not evidence the
// customer received anything — see sent_at's own comment in
// supabase/schema.sql). `is('sent_at', null)` guards against a second
// share re-stamping the timestamp — the FIRST time it was actually
// sent is the fact worth keeping, same "a frozen quote never changes"
// spirit as the row it lives on, even though sent_at itself isn't
// part of the frozen pricing content.
export async function markQuoteSent(quoteId: string): Promise<string> {
  const sentAt = new Date().toISOString();
  const { error } = await supabase
    .from('quotes')
    .update({ sent_at: sentAt })
    .eq('id', quoteId)
    .is('sent_at', null);

  if (error) throw new Error(`Failed to record quote as sent: ${error.message}`);
  return sentAt;
}

// Just enough per quote to list a project's SENT-quote history — id,
// version, total, when it was actually sent. Deliberately NOT the
// full FrozenQuote: the dashboard's per-row dropdown
// (CustomerDashboard.tsx) needs this for every project at once, and
// pulling every quote's full summary/pricing_context JSONB (the
// catalogue snapshot, potentially large) for a list that only ever
// shows a date and an amount would be real wasted weight, the same
// "don't load more than the screen needs" discipline this app already
// applies to lazy texture loading.
export interface QuoteHistoryEntry {
  id: string;
  version: number;
  grandTotal: number;
  sentAt: string;
}

// Same "bulk-fetch across every project, group client-side by
// project_id" shape as fetchCapturedPanoramasByProject
// (lib/Persistence.ts) — one query for the whole dashboard rather
// than one per row. Filtered to sent_at IS NOT NULL — a quote that
// was frozen but never actually shared on WhatsApp has no business
// appearing in a "what has this customer been sent" list; see
// sent_at's own comment in supabase/schema.sql. Newest-first per
// project, same ordering fetchQuotes already uses.
export async function fetchAllQuoteHistoriesByProject(): Promise<Record<string, QuoteHistoryEntry[]>> {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, project_id, version, grand_total, sent_at')
    .not('sent_at', 'is', null)
    .order('version', { ascending: false });

  if (error) throw new Error(`Failed to load quote histories: ${error.message}`);

  const byProject: Record<string, QuoteHistoryEntry[]> = {};
  for (const row of data as {
    id: string;
    project_id: string;
    version: number;
    grand_total: number;
    sent_at: string;
  }[]) {
    (byProject[row.project_id] ??= []).push({
      id: row.id,
      version: row.version,
      grandTotal: row.grand_total,
      sentAt: row.sent_at,
    });
  }
  return byProject;
}

export async function fetchLatestQuote(projectId: string): Promise<FrozenQuote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load quote: ${error.message}`);
  return data ? rowToQuote(data as QuoteRow) : null;
}

export interface FreezeQuoteInput {
  projectId: string;
  businessId: string;
  summary: BOMSummary;
  pricingContext: FrozenPricingContext;
  cutList: FrozenCutList;
  note?: string;
}

// Freezes the current quote as the next version for this project.
//
// The next version number is read immediately before the insert, which
// is a race in principle: two freezes in the same instant could both
// read v2 and both try to write v3. That race is LEFT UNHANDLED HERE
// on purpose, and caught by the database instead — quotes_project_
// version_idx is a unique index on (project_id, version), so the second
// insert fails loudly rather than silently creating a duplicate
// version. Callers surface that as "try again".
//
// Handling it in application code would mean a transaction or a
// sequence per project, which is real machinery for a scenario that
// needs one person to double-click a button in a single-business app.
// The index makes the bad outcome impossible; that is enough.
export async function freezeQuote(input: FreezeQuoteInput): Promise<FrozenQuote> {
  const latest = await fetchLatestQuote(input.projectId);
  const version = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      // Generated here rather than by the database: ids in this schema
      // are text and client-made (see lib/customers.ts, Persistence.ts),
      // so there is no server-side default to fall back on.
      id: crypto.randomUUID(),
      project_id: input.projectId,
      business_id: input.businessId,
      version,
      summary: input.summary,
      pricing_context: input.pricingContext,
      cut_list: input.cutList,
      // Derived from the summary, never passed in separately — see the
      // note on FrozenQuote.grandTotal.
      grand_total: input.summary.grandTotal,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) {
    // The unique index firing means someone else (or another tab) froze
    // a version while this one was being assembled. Say so plainly
    // rather than reporting a constraint name.
    if (error.code === '23505') {
      throw new Error('Another quote version was created just now. Reload and try again.');
    }
    throw new Error(`Failed to freeze quote: ${error.message}`);
  }

  return rowToQuote(data as QuoteRow);
}
