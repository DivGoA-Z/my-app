// src/components/canvas/CabinetClearanceWarningBanner.tsx
//
// The cabinet-vs-cabinet counterpart to CollisionWarningBanner — amber
// rather than red, since this is a "buildable but unusable" warning
// (lib/cabinetClearance.ts), never an invalid layout. Reads the same
// useCabinetClearance() hook that drives CabinetLayer's amber
// highlight and reach-zone tint, so the two always agree.

import { useCabinetClearance } from '../../hooks/useCabinetClearance';

export function CabinetClearanceWarningBanner() {
  const { blockedCabinetIds, issues } = useCabinetClearance();

  if (blockedCabinetIds.size === 0) return null;

  return (
    <div className="rounded border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2">
      {blockedCabinetIds.size} cabinet{blockedCabinetIds.size === 1 ? '' : 's'} with a blocked
      door/drawer
      {' '}({issues.length} conflict{issues.length === 1 ? '' : 's'} detected) — an L-corner is the
      usual cause; drag one further from the corner, or mute it in the Inspector if you've
      already checked the fit in practice.
    </div>
  );
}
