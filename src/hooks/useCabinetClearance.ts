// src/hooks/useCabinetClearance.ts
//
// Same reasoning as useCollisions.ts: recomputes cabinet-vs-cabinet AND
// cabinet-vs-wall door/drawer reach conflicts (lib/cabinetClearance.ts)
// only when cabinets or the room's own dimensions actually change, so
// the canvas highlight and a warning banner can both read the current,
// correct result with no manual recompute step.

import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { detectCabinetReachConflicts, type CabinetReachResult } from '../lib/cabinetClearance';

const EMPTY_RESULT: CabinetReachResult = { issues: [], blockedCabinetIds: new Set() };

export function useCabinetClearance() {
  const cabinets = useLayoutStore((state) => state.cabinets);
  const currentLayout = useLayoutStore((state) => state.currentLayout);

  return useMemo(() => {
    if (!currentLayout) return EMPTY_RESULT;
    const { widthMm, depthMm } = currentLayout.dimensions;
    return detectCabinetReachConflicts(cabinets, widthMm, depthMm);
  }, [cabinets, currentLayout]);
}
