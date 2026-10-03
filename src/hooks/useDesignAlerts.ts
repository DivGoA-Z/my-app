// src/hooks/useDesignAlerts.ts
//
// One unified list of every design-time warning the app can raise —
// collisions (lib/collision.ts), cabinet-vs-cabinet/wall door-reach
// conflicts (lib/cabinetClearance.ts), room-door-vs-item swing
// clearance (lib/clearance.ts), and kitchen ergonomics
// (lib/kitchenChecks.ts) — previously four separately-rendered
// banners with no way to see WHY a specific item was flagged beyond
// an aggregate count. Built so DesignAlertsPanel can filter this same
// list down to "just the selected item's alerts" without needing to
// know anything about where each alert actually came from.
//
// Each source already computes its OWN human message (or gets one
// here, for collision.ts, which never needed one before since its
// only consumer was a count). itemIds is deliberately an array, not a
// single id — most conflicts are between two placed items, and an
// alert is relevant to a selection if EITHER one matches.

import { usePhysicalCabinets } from './usePhysicalCabinets';
import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { detectCollisions } from '../lib/collision';
import { detectCabinetReachConflicts } from '../lib/cabinetClearance';
import { detectClearanceIssues, isStructural } from '../lib/clearance';
import { checkKitchenErgonomics } from '../lib/kitchenChecks';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { Obstacle } from '../types/layout';
import type { PlacedApplianceItem } from '../types/appliance';
import { APPLIANCE_TYPE_LABELS } from '../types/appliance';
import { OBSTACLE_TYPE_LABELS } from '../types/layout';

export type DesignAlertCategory = 'collision' | 'cabinet-clearance' | 'opening-clearance' | 'kitchen';

export interface DesignAlert {
  id: string;
  itemIds: string[];
  category: DesignAlertCategory;
  message: string;
}

// collision.ts's Collision only carries ids/types, never a label — the
// other three sources already produce their own message text, so this
// is the one place that needs to turn an id into something readable.
function describeItem(
  id: string,
  cabinets: PlacedCabinetItem[],
  obstacles: Obstacle[],
  appliances: PlacedApplianceItem[]
): string {
  const cabinet = cabinets.find((c) => c.id === id);
  if (cabinet) return cabinet.moduleType;
  const obstacle = obstacles.find((o) => o.id === id);
  if (obstacle) return OBSTACLE_TYPE_LABELS[obstacle.type];
  const appliance = appliances.find((a) => a.id === id);
  if (appliance) return APPLIANCE_TYPE_LABELS[appliance.applianceType];
  return 'item';
}

export function useDesignAlerts(): DesignAlert[] {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const appliances = useLayoutStore((state) => state.appliances);

  return useMemo(() => {
    if (!currentLayout) return [];
    const layout = { ...currentLayout, obstacles };
    const alerts: DesignAlert[] = [];

    const { collisions } = detectCollisions(cabinets, obstacles, appliances);
    for (const c of collisions) {
      alerts.push({
        id: `collision-${c.itemId}-${c.withId}`,
        itemIds: [c.itemId, c.withId],
        category: 'collision',
        message: `${describeItem(c.itemId, cabinets, obstacles, appliances)} overlaps ${describeItem(c.withId, cabinets, obstacles, appliances)} — they occupy the same space.`,
      });
    }

    const { widthMm, depthMm } = currentLayout.dimensions;
    const reach = detectCabinetReachConflicts(cabinets, widthMm, depthMm);
    for (const issue of reach.issues) {
      alerts.push({
        id: `cabinet-clearance-${issue.cabinetId}-${issue.withId}`,
        itemIds: issue.withId === 'wall' ? [issue.cabinetId] : [issue.cabinetId, issue.withId],
        category: 'cabinet-clearance',
        message: issue.message,
      });
    }

    const openingClearance = detectClearanceIssues(layout, cabinets, appliances);
    for (const issue of openingClearance.issues) {
      const structural = isStructural(issue, layout);
      alerts.push({
        id: `opening-clearance-${issue.openingId}-${issue.itemId}`,
        itemIds: [issue.openingId, issue.itemId],
        category: 'opening-clearance',
        message: `The door's swing reaches this ${issue.itemLabel}${structural ? " (can't be moved)" : ''}, blocking about ${Math.round(issue.swingReachMm)}mm.`,
      });
    }

    const kitchenFindings = checkKitchenErgonomics(layout, cabinets, appliances);
    for (const f of kitchenFindings) {
      alerts.push({
        id: `kitchen-${f.id}`,
        itemIds: f.itemIds,
        category: 'kitchen',
        message: f.message,
      });
    }

    return alerts;
  }, [currentLayout, cabinets, obstacles, appliances]);
}
