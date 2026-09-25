// src/hooks/useCabinetClearance.ts
//
// Same reasoning as useCollisions.ts: recomputes cabinet-vs-cabinet
// door/drawer reach conflicts (lib/cabinetClearance.ts) only when
// cabinets actually change, so the canvas highlight and a warning
// banner can both read the current, correct result with no manual
// recompute step.

import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { detectCabinetReachConflicts } from '../lib/cabinetClearance';

export function useCabinetClearance() {
  const cabinets = useLayoutStore((state) => state.cabinets);
  return useMemo(() => detectCabinetReachConflicts(cabinets), [cabinets]);
}
