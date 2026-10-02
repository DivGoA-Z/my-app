// src/hooks/useBOM.ts
//
// Recomputes the BOM only when the cabinets, appliances or finishes
// array actually changes (useMemo compares references; the store creates
// a new array on every add/update/remove, so this stays correct and
// cheap).
//
// `finishes` is a real dependency, not just a pass-through: finish cost
// is priced per square metre off the finish row (see calculateBOM), so
// leaving it out would show ₹0 finish cost in the sidebar while
// saveProject — which does pass it — wrote a higher total to the
// project record. The displayed quote and the saved quote would
// silently disagree.

import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { calculateBOM } from '../lib/bom';

export function useBOM() {
  const cabinets = useLayoutStore((state) => state.cabinets);
  const appliances = useLayoutStore((state) => state.appliances);
  const finishes = useLayoutStore((state) => state.finishes);
  // Also a real dependency, not a pass-through: hardware cost is
  // priced off the handle row, so editing a handle's price must
  // recompute the quote.
  const handles = useLayoutStore((state) => state.handles);
  // Same reasoning as handles: fixture rates come from the catalogue,
  // so repricing a strip must recompute the quote.
  const fixtureCatalog = useLayoutStore((state) => state.fixtureCatalog);
  // Same again: labour per sqft and the four hardware rates come from
  // the rate card, so editing a rate must recompute the quote.
  const rates = useLayoutStore((state) => state.rateCard);
  // Since §42, board is priced on the cutting list's real part sizes,
  // which construction settings shape — so a construction edit must
  // reprice too, same as a rate edit.
  const construction = useLayoutStore((state) => state.constructionSettings);
  // currentLayout carries the room's floor/ceiling/wall finish
  // assignments and its dimensions, both of which the surface line
  // items are computed from.
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  return useMemo(
    () =>
      calculateBOM(cabinets, appliances, {
        finishes,
        handles,
        fixtureCatalog,
        rates,
        construction,
        layout: currentLayout ?? undefined,
      }),
    [cabinets, appliances, finishes, handles, fixtureCatalog, rates, construction, currentLayout]
  );
}

/*
Usage in a component:

function QuotePanel() {
  const bom = useBOM();

  return (
    <div>
      <p>Material: ₹{bom.materialSubtotal.toLocaleString('en-IN')}</p>
      <p>Hardware: ₹{bom.hardwareSubtotal.toLocaleString('en-IN')}</p>
      <p>Other: ₹{bom.othersSubtotal.toLocaleString('en-IN')}</p>
      <p className="font-bold">
        Grand Total: ₹{bom.grandTotal.toLocaleString('en-IN')}
      </p>
    </div>
  );
}

No manual "recalculate" button needed — any addCabinet/updateCabinet/
removeCabinet call re-renders this panel with fresh totals automatically.
*/
