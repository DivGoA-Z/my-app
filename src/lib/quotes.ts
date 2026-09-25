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
  grand_total: number;
  frozen_at: string;
  note: string | null;
  created_at: string;
}

function rowToQuote(row: QuoteRow): FrozenQuote {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    summary: row.summary,
    pricingContext: row.pricing_context,
    grandTotal: row.grand_total,
    frozenAt: row.frozen_at,
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
