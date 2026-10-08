// src/hooks/useFitCornerPanel.ts
//
// Fits a blind/magic corner's fixed panel against the kitchen as it is
// now (§116, lib/cornerPanel.ts): used when a corner unit is placed, and
// by the inspector's "Fit to corner". Works on PHYSICAL cabinets (§61) —
// the meeting run's shutter is what the panel has to cover — and returns
// what to write onto the STORED cabinet: the panel, and doors for the
// width left beside it. Null for anything that has no fixed panel.

import { useLayoutStore } from '../store/layoutStore';
import { useFrontExtraFor, usePhysicalCabinets } from './usePhysicalCabinets';
import { physicalCabinet } from '../lib/physicalDepth';
import { doorsBesidePanel, fitCornerPanelDetail, hasCornerPanel } from '../lib/cornerPanel';
import type { PlacedCabinetItem } from '../types/cabinet';

export function useFitCornerPanel() {
  const physical = usePhysicalCabinets();
  const frontExtraFor = useFrontExtraFor();
  // onlyWhereRunMeets: placing an ordinary WALL cabinet only gets a panel
  // when another wall run really hangs in front of its end (§118).
  return (
    stored: PlacedCabinetItem,
    { onlyWhereRunMeets = false }: { onlyWhereRunMeets?: boolean } = {}
  ): Pick<PlacedCabinetItem, 'cornerPanel' | 'frontLayout'> | null => {
    if (!hasCornerPanel(stored.moduleType)) return null;
    const room = useLayoutStore.getState().currentLayout?.dimensions;
    if (!room) return null;
    // storedDepthMm lets the fallback width add this unit's own shutter.
    const self = { ...physicalCabinet(stored, frontExtraFor(stored)), storedDepthMm: stored.depthMm };
    const { panel: cornerPanel, metRun } = fitCornerPanelDetail(self, room, physical.filter((c) => c.id !== stored.id));
    if (onlyWhereRunMeets && !metRun) return null;
    return { cornerPanel, frontLayout: doorsBesidePanel(stored, cornerPanel) };
  };
}
