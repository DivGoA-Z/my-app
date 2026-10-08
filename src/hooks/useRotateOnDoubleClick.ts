// src/hooks/useRotateOnDoubleClick.ts
//
// The plan's double-click-to-turn, shared by the cabinet, appliance and
// pillar layers (§115): turns the clicked item, or the SELECTED one when
// the double-click lands inside it (lib/rotateTarget.ts). Each turn is a
// clockwise quarter (anticlockwise with Shift, where the layer passes it),
// with the same clamping as before.

import { useLayoutStore } from '../store/layoutStore';
import { cancelPendingPick } from './usePickAt';
import { usePhysicalCabinets } from './usePhysicalCabinets';
import { rotateTarget } from '../lib/rotateTarget';
import { rotateCabinet } from '../lib/cabinetGeometry';
import { rotateAppliance, applianceFootprint } from '../lib/applianceGeometry';
import { currentFootprintRect, rotateFootprint } from '../lib/footprint';
import type { SelectionRef } from '../types/selection';
import type { FootprintRect } from '../lib/footprint';

export function useRotateOnDoubleClick() {
  // Physical, for the "is it inside" test: the plan draws physical cabinets.
  const physical = usePhysicalCabinets();
  return (clicked: SelectionRef, xMm: number, yMm: number, direction: 1 | -1 = 1) => {
    // The first click of this double-click may have queued the overlap
    // chooser; a double-click means "turn", not "choose".
    cancelPendingPick();
    const s = useLayoutStore.getState();
    if (!s.currentLayout) return;
    const { widthMm, depthMm } = s.currentLayout.dimensions;
    const sel = s.selection;
    let selRect: FootprintRect | null = null;
    if (sel?.type === 'cabinet') {
      const c = physical.find((x) => x.id === sel.id);
      if (c) selRect = currentFootprintRect(c);
    } else if (sel?.type === 'appliance') {
      const a = s.appliances.find((x) => x.id === sel.id);
      if (a) selRect = applianceFootprint(a);
    } else if (sel?.type === 'obstacle') {
      const o = s.obstacles.find((x) => x.id === sel.id);
      if (o) selRect = currentFootprintRect(o);
    }
    const target = rotateTarget(clicked, sel, selRect, xMm, yMm);
    if (target.type === 'cabinet') {
      // Rotate the STORED cabinet (§61): editors write stored geometry.
      const c = s.cabinets.find((x) => x.id === target.id);
      if (c) s.updateCabinet(c.id, rotateCabinet(c, direction, widthMm, depthMm));
    } else if (target.type === 'appliance') {
      const a = s.appliances.find((x) => x.id === target.id);
      if (a) s.updateAppliance(a.id, rotateAppliance(a, direction, widthMm, depthMm));
    } else if (target.type === 'obstacle') {
      const o = s.obstacles.find((x) => x.id === target.id);
      if (o) s.updateObstacle(o.id, rotateFootprint(o, direction, widthMm, depthMm));
    }
  };
}
