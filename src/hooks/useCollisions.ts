// src/hooks/useCollisions.ts
//
// Recomputes collisions only when cabinets, obstacles, or appliances
// actually change — same useMemo pattern as useBOM. Any component
// (canvas highlight, warning banner, a future "can't send quote until
// resolved" gate) can call this and always gets the current, correct
// result with no manual recompute step.

import { usePhysicalCabinets } from './usePhysicalCabinets';
import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { detectCollisions } from '../lib/collision';

export function useCollisions() {
  const cabinets = usePhysicalCabinets();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const appliances = useLayoutStore((state) => state.appliances);
  return useMemo(
    () => detectCollisions(cabinets, obstacles, appliances),
    [cabinets, obstacles, appliances]
  );
}
