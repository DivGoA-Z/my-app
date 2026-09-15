// src/components/canvas/CollisionWarningBanner.tsx
//
// Plain HTML (not Konva) — sits next to RoomCanvas rather than inside
// it. Reads the same useCollisions() hook that drives the red highlight
// in CabinetLayer, so the two always agree.

import { useCollisions } from '../../hooks/useCollisions';

export function CollisionWarningBanner() {
  const { collidingCabinetIds, collidingApplianceIds, collisions } = useCollisions();

  if (collidingCabinetIds.size === 0 && collidingApplianceIds.size === 0) {
    return null;
  }

  const parts: string[] = [];
  if (collidingCabinetIds.size > 0) {
    parts.push(`${collidingCabinetIds.size} cabinet${collidingCabinetIds.size === 1 ? '' : 's'}`);
  }
  if (collidingApplianceIds.size > 0) {
    parts.push(
      `${collidingApplianceIds.size} appliance${collidingApplianceIds.size === 1 ? '' : 's'}`
    );
  }

  return (
    <div className="rounded border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
      {parts.join(', ')} overlapping
      {' '}({collisions.length} collision{collisions.length === 1 ? '' : 's'} detected) — drag to resolve.
    </div>
  );
}
