// src/types/quote.ts
//
// A frozen quote: what was actually sent to a customer, preserved
// exactly as it was sent.
//
// WHY THIS EXISTS
// Everything else in this app is live. Change a rate, edit a finish,
// drag a cabinet, and the sidebar total moves — which is right while a
// design is being worked on, and wrong the moment a number has been
// given to someone. If labour goes from ₹150 to ₹180 next month, a
// quote approved last month must still read ₹150. Otherwise the figure
// both parties agreed on changes behind their backs, which is not a
// rounding problem but a trust problem.
//
// So freezing copies the computed BOMSummary AND the catalogues it was
// computed from. That denormalisation is the point, not an oversight:
// the catalogue is mutable and this must not be. A frozen quote is
// readable years later even if every finish it referenced has since
// been repriced or deleted.
//
// A revision is a NEW ROW at version + 1, never an edit. Nothing in
// this app should ever update a quotes row's summary.

import type { BOMSummary } from '../lib/bom';
import type { RateCard } from './rates';
import type { SurfaceFinish } from './finish';
import type { HandleSpec } from './front';
import type { FixtureCatalogItem } from './fixture';

// The catalogues a quote was priced against, copied in full.
//
// This mirrors PricingContext in lib/bom.ts, minus `layout` — the
// layout is not stored here because the layout is already persisted in
// its own table and a quote references it by id. What IS stored is the
// fingerprint below, which is what lets the UI say "the design has
// changed since this was sent".
export interface FrozenPricingContext {
  rates: RateCard;
  finishes: SurfaceFinish[];
  handles: HandleSpec[];
  fixtureCatalog: FixtureCatalogItem[];
  layoutId: string | null;
  // See computeQuoteFingerprint. Not a timestamp — layouts.updated_at
  // is both too sensitive and not sensitive enough.
  fingerprint: string;
}

export interface FrozenQuote {
  id: string;
  projectId: string;
  // 1, 2, 3... per project.
  version: number;
  summary: BOMSummary;
  pricingContext: FrozenPricingContext;
  // Copied out of summary so a list of quotes can be rendered without
  // parsing every snapshot. DERIVED — never write it independently of
  // summary.grandTotal.
  grandTotal: number;
  frozenAt: string;
  // When this quote was actually shared via WhatsApp — undefined means
  // frozen but never sent, a real and distinct state from "frozen".
  // See sent_at's own comment in supabase/schema.sql for what this
  // does and doesn't prove.
  sentAt?: string;
  note?: string;
}

// Has the design or its pricing moved since this quote was frozen?
//
// WHY A FINGERPRINT AND NOT A TIMESTAMP
// The obvious implementation is to compare layouts.updated_at. It
// fails in both directions.
//
// Too sensitive: cabinets and appliances are JSONB arrays ON the
// layouts row (see the header of supabase/schema.sql), so that
// timestamp bumps on every single save — renaming the layout, nudging
// a camera, dragging the exposure slider. None of those change a
// price, and all of them would mark the quote stale, which trains
// people to ignore the warning.
//
// Not sensitive enough, and this is the dangerous half: the rate card,
// finishes, handles and the fixture catalogue are their OWN tables.
// Repricing a handle or changing labour per sq ft moves every open
// quote's total and touches layouts.updated_at not at all. A quote
// would read "current" while the numbers underneath it had moved.
//
// (An earlier version of this comment claimed cabinets were a separate
// table. They are not — it was wrong about the mechanism while landing
// on the right design. Corrected here rather than quietly deleted,
// because the wrong reason was load-bearing in a handoff document.)
//
// So the fingerprint is over the priced INPUTS themselves. It hashes
// everything rather than an explicit list of priced fields, which is a
// deliberate choice of failure direction: hashing everything can report
// stale when something cosmetic changed, while an explicit field list
// can report current when something priced changed and was left off the
// list. A needless revision is a wasted click; a missed one is a wrong
// price in front of a customer.
//
// Timestamps are excluded because they move on every save without
// meaning anything changed, which would make every quote instantly
// stale and train people to ignore the warning.
export function computeQuoteFingerprint(input: unknown): string {
  return fnv1a(canonicalize(input));
}

export function isQuoteStale(quote: FrozenQuote, currentFingerprint: string): boolean {
  return quote.pricingContext.fingerprint !== currentFingerprint;
}

// Deterministic JSON: object keys sorted, so two structurally equal
// objects always produce the same string regardless of the order their
// properties happen to have been assigned in.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // See the note above: these move on every save and mean nothing.
    .filter(([key]) => key !== 'updatedAt' && key !== 'createdAt')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

// FNV-1a, 32-bit, hex. Not cryptographic and does not need to be —
// this detects accidental change, not adversarial forgery. Chosen over
// a crypto hash because SubtleCrypto is async, and making staleness
// async would put a promise in a render path for no benefit.
//
// A 32-bit hash collides at roughly one in four billion per comparison,
// and the consequence of a collision here is one missed "design has
// changed" hint on one quote — not a wrong price, since the frozen
// summary is what gets shown either way.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit value; Math.imul does the
    // multiply in 32-bit space rather than drifting into float
    // territory, which is what makes this reproducible across engines.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const QUOTE_STALE_MESSAGE =
  'The design or rates have changed since this quote was sent.';
