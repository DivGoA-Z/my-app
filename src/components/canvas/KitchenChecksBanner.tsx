// src/components/canvas/KitchenChecksBanner.tsx
//
// The trade-ergonomics counterpart to CollisionWarningBanner/
// CabinetClearanceWarningBanner — amber, same as clearance, since
// every one of these (lib/kitchenChecks.ts) is a "this doesn't work
// like a kitchen" advisory, never an invalid layout (Principle 6:
// warn, never block — a genuinely tiny room has no choice about aisle
// width). Reads the same useKitchenChecks() hook a future canvas
// highlight could also read, so the two would always agree.
//
// Listed one per line rather than as an aggregate count the way the
// collision/clearance banners are — each message here is already
// specific about WHAT and WHERE, so collapsing five different concerns
// into "5 issues found" would lose the one thing that makes this
// useful at a glance.

import { Alert, AlertDescription } from '../ui/alert';
import { useKitchenChecks } from '../../hooks/useKitchenChecks';

export function KitchenChecksBanner() {
  const findings = useKitchenChecks();

  if (findings.length === 0) return null;

  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertDescription className="text-amber-800">
        <ul className="flex flex-col gap-1">
          {findings.map((finding) => (
            <li key={finding.id}>{finding.message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
