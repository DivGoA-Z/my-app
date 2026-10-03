// src/hooks/useKitchenChecks.ts
//
// Same reasoning as useCollisions.ts/useCabinetClearance.ts:
// recomputes the trade-specific ergonomics checks (lib/kitchenChecks.ts
// — aisle width, sink-hob distance, sink/hob-fridge distance,
// hob-under-window, counter-beside-hob, chimney-centred-on-hob) only
// when the layout/cabinets/appliances actually change, so a warning
// banner always reads the current result with no manual recompute
// step.

import { usePhysicalCabinets } from './usePhysicalCabinets';
import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { checkKitchenErgonomics } from '../lib/kitchenChecks';

export function useKitchenChecks() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const appliances = useLayoutStore((state) => state.appliances);

  return useMemo(() => {
    if (!currentLayout) return [];
    // Obstacles live in their own store slice, not on currentLayout —
    // reassemble before measuring, same as RoomSurfacesPanel/
    // RemainingSpaceLayer already do.
    const layoutWithObstacles = { ...currentLayout, obstacles };
    return checkKitchenErgonomics(layoutWithObstacles, cabinets, appliances);
  }, [currentLayout, cabinets, obstacles, appliances]);
}
