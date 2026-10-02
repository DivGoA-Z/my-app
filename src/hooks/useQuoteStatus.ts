// src/hooks/useQuoteStatus.ts
//
// Answers the one question the quote sidebar needs once quotes can be
// frozen: is what I am looking at the same as what the customer was
// sent?
//
// Three states, and the middle one is the whole reason this exists:
//
//   'unquoted' — nothing has been frozen for this project yet. The
//                sidebar shows live figures, which is correct.
//   'current'  — a quote exists and the design has not moved since.
//   'stale'    — a quote exists and something priced HAS moved.
//
// 'stale' is not an error. It is the normal consequence of carrying on
// designing after sending a quote, and the right response is usually
// "freeze v2", not "undo". The sidebar says so rather than warning.

import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { fingerprintPricedInputs } from '../lib/quotes';
import { isQuoteStale, type FrozenQuote } from '../types/quote';
import type { RoomLayout } from '../types/layout';

export type QuoteStatus = 'unquoted' | 'current' | 'stale';

export interface QuoteStatusResult {
  status: QuoteStatus;
  // The most recent frozen version, or null when never quoted.
  latest: FrozenQuote | null;
  // Convenience for the common `status === 'stale'` check.
  isStale: boolean;
}

export function useQuoteStatus(): QuoteStatusResult {
  const quotes = useLayoutStore((s) => s.quotes);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const appliances = useLayoutStore((s) => s.appliances);
  const obstacles = useLayoutStore((s) => s.obstacles);
  const cameras = useLayoutStore((s) => s.cameras);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const finishes = useLayoutStore((s) => s.finishes);
  const handles = useLayoutStore((s) => s.handles);
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const rateCard = useLayoutStore((s) => s.rateCard);
  const constructionSettings = useLayoutStore((s) => s.constructionSettings);

  // quotes is kept newest-first by both fetchQuotes (ordered by version
  // descending) and freezeCurrentQuote (which unshifts), so [0] is the
  // latest without re-sorting here.
  const latest = quotes.length > 0 ? quotes[0] : null;

  return useMemo(() => {
    if (!latest || !currentLayout) {
      return { status: 'unquoted' as const, latest, isStale: false };
    }

    // Reassembled exactly as freezeCurrentQuote does. If these two ever
    // diverge, every quote reads stale the instant it is frozen — which
    // is why both go through fingerprintPricedInputs rather than
    // building the hash input themselves.
    const layoutForQuote: RoomLayout = { ...currentLayout, obstacles, cameras };
    const fingerprint = fingerprintPricedInputs(cabinets, appliances, {
      finishes,
      handles,
      fixtureCatalog,
      rates: rateCard,
      construction: constructionSettings,
      layout: layoutForQuote,
    });

    const stale = isQuoteStale(latest, fingerprint);
    return { status: stale ? ('stale' as const) : ('current' as const), latest, isStale: stale };
  }, [
    latest,
    currentLayout,
    obstacles,
    cameras,
    cabinets,
    appliances,
    finishes,
    handles,
    fixtureCatalog,
    rateCard,
    constructionSettings,
  ]);
}
