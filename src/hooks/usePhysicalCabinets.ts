// src/hooks/usePhysicalCabinets.ts
//
// The cabinets as they PHYSICALLY stand (§61) — the stored cabinets with
// the depth convention applied (lib/physicalDepth.ts). Every hook and
// layer that MEASURES geometry — drawing, collision, door-swing
// clearance, kitchen checks, picking, snapping, surface areas, the 3D
// room, the elevation view, cabinet-mounted lights — reads cabinets
// through this, so they all see the same footprint. Anything that EDITS
// a cabinet (inspector, designer, nudging, rotation) keeps the stored
// one; the 2D layer converts a drag back with
// storedPositionFromPhysicalCenter.
//
// Same array back when depth includes the shutter (the default), so the
// default convention costs nothing and re-renders nothing.

import { useMemo } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { effectiveConstruction, frontExtraMm, physicalCabinets } from '../lib/physicalDepth';
import type { ConstructionSettings } from '../types/construction';

export function useEffectiveConstruction(): ConstructionSettings {
  const settings = useLayoutStore((s) => s.constructionSettings);
  const projectChoice = useLayoutStore((s) => s.currentLayout?.depthIncludesFront);
  return useMemo(() => effectiveConstruction(settings, { depthIncludesFront: projectChoice }), [settings, projectChoice]);
}

// Extra mm a cabinet physically reaches beyond its stored depth (0 or
// the shutter thickness) — for the drag write-back.
export function useFrontExtraMm(): number {
  return frontExtraMm(useEffectiveConstruction().depthIncludesFront);
}

export function usePhysicalCabinets() {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const extra = useFrontExtraMm();
  return useMemo(() => physicalCabinets(cabinets, extra), [cabinets, extra]);
}
