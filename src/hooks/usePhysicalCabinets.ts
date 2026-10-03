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
import type { PlacedCabinetItem } from '../types/cabinet';

export function useEffectiveConstruction(): ConstructionSettings {
  const settings = useLayoutStore((s) => s.constructionSettings);
  const projectChoice = useLayoutStore((s) => s.currentLayout?.depthIncludesFront);
  return useMemo(() => effectiveConstruction(settings, { depthIncludesFront: projectChoice }), [settings, projectChoice]);
}

// How far a given cabinet physically reaches beyond its stored depth (0,
// or its own shutter board's thickness) — for the 2D drag write-back.
export function useFrontExtraFor(): (item: PlacedCabinetItem) => number {
  const includes = useEffectiveConstruction().depthIncludesFront;
  const rateCard = useLayoutStore((s) => s.rateCard);
  return (item) => frontExtraMm(includes, item, rateCard);
}

export function usePhysicalCabinets() {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const includes = useEffectiveConstruction().depthIncludesFront;
  const rateCard = useLayoutStore((s) => s.rateCard);
  return useMemo(() => physicalCabinets(cabinets, includes, rateCard), [cabinets, includes, rateCard]);
}
