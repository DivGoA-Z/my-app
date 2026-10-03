// src/components/toolbar/OpeningToolbar.tsx
//
// Adds doors, windows and pass-throughs, and lists what the room has.
//
// No inventory behind this one, unlike cabinets/obstacles/appliances —
// an opening isn't a product a business stocks, it's a feature of the
// client's flat that gets measured on site. So the buttons create
// straight from the standard sizes in types/opening.ts rather than from
// a catalogue.
//
// The warning banner is the part that matters. Two things get flagged:
// openings that overlap along a wall (silently clipped by the geometry,
// so worth surfacing before the clipped area reaches a quote), and
// in-swinging doors whose arc lands on a cabinet.

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { useSelectedOpeningId } from '../../hooks/useSelection';
import { createOpening, OPENING_KIND_LABELS } from '../../types/opening';
import type { OpeningKind } from '../../types/opening';
import { overlappingOpeningPairs, openingsForWall } from '../../lib/openings';
import { detectClearanceIssues, isStructural } from '../../lib/clearance';
import type { WallOrientation } from '../../types/layout';

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];

const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
};

const KINDS: OpeningKind[] = ['door', 'window', 'pass-through'];

export function OpeningToolbar() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const appliances = useLayoutStore((state) => state.appliances);
  const obstacles = useLayoutStore((state) => state.obstacles);
  const addOpening = useLayoutStore((state) => state.addOpening);
  const removeOpening = useLayoutStore((state) => state.removeOpening);
  const selectOpening = useLayoutStore((state) => state.selectOpening);
  const selectedOpeningId = useSelectedOpeningId();

  if (!currentLayout) return null;

  const openings = currentLayout.walls.flatMap((w) => w.openings ?? []);
  const overlaps = overlappingOpeningPairs(openings);
  const layoutWithObstacles = { ...currentLayout, obstacles };
  const clearance = detectClearanceIssues(layoutWithObstacles, cabinets, appliances);
  const structuralCount = clearance.issues.filter((i) =>
    isStructural(i, layoutWithObstacles)
  ).length;

  function handleAdd(kind: OpeningKind, wallId: WallOrientation) {
    const wall = currentLayout!.walls.find((w) => w.orientation === wallId);
    const wallLengthMm = wall?.lengthMm ?? 0;
    const existing = openingsForWall(openings, wallId);

    // Start it just past whatever is already on the wall rather than
    // always at the middle — adding a second door to a wall shouldn't
    // land it on top of the first and get silently clipped.
    const lastEnd = existing.reduce(
      (max, o) => Math.max(max, o.offsetMm + o.widthMm),
      0
    );
    const size = kind === 'door' ? 900 : kind === 'window' ? 1200 : 900;
    const offset = Math.max(0, Math.min(lastEnd + 100, wallLengthMm - size));

    addOpening(createOpening(kind, wallId, offset));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-foreground">Doors &amp; Windows</h3>
        <p className="text-[13px] text-muted-foreground">
          Openings deduct their area from the wall tiling, and an in-swinging door reserves the
          floor it sweeps. Usually already in place, so nothing is charged unless you mark it as
          supplied by you.
        </p>
      </div>

      {KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-1">
          <span className="rounded bg-secondary px-2 py-1.5 text-xs font-medium text-foreground">
            {OPENING_KIND_LABELS[kind]}
          </span>
          <div className="flex gap-1 pl-1">
            {WALL_ORDER.map((wallId) => (
              <Button
                key={wallId}
                variant="outline"
                size="sm"
                className="h-auto min-h-6 flex-1 py-1 whitespace-normal font-normal"
                onClick={() => handleAdd(kind, wallId)}
              >
                {WALL_LABELS[wallId]}
              </Button>
            ))}
          </div>
        </div>
      ))}

      {overlaps.length > 0 && (
        // A red error, not an amber note. Two openings occupying the
        // same piece of wall is unbuildable — you cannot cut a window
        // through a door — so it belongs with collisions rather than
        // with advisories.
        //
        // A window stacked ABOVE a door is no longer flagged: the
        // check compares both axes now, so a transom is correctly
        // legal.
        <Alert variant="destructive">
          <AlertDescription>
            <span className="font-medium">
              {overlaps.length} opening{overlaps.length > 1 ? 's' : ''} overlap
              {overlaps.length > 1 ? '' : 's'} another on the same wall.
            </span>{' '}
            Two openings can&apos;t occupy the same piece of wall — move one apart, or stack it
            clear above the other.
          </AlertDescription>
        </Alert>
      )}

      {clearance.issues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            A door swing lands on{' '}
            {clearance.issues.length === 1 ? '1 item' : `${clearance.issues.length} items`}. The
            door won&apos;t open fully — check the highlighted arc on the plan.
            {/* Structural conflicts get their own sentence because the
                remedy is different: a cabinet can be slid along the run,
                a concrete pillar cannot. The only fixes there are moving
                the door or changing its swing. */}
            {structuralCount > 0 && (
              <div className="mt-1 font-medium">
                {structuralCount === 1 ? 'One of them is' : `${structuralCount} of them are`}{' '}
                structural (a pillar or shaft) and cannot be moved — change the door&apos;s swing
                or its position instead.
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {openings.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-foreground">In this room</h4>
          <ul className="flex flex-col gap-1">
            {openings.map((o) => (
              <li
                key={o.id}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                  o.id === selectedOpeningId
                    ? 'bg-blue-50 text-blue-800'
                    : 'bg-secondary text-muted-foreground'
                }`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto flex-1 justify-start p-0 font-normal"
                  onClick={() => selectOpening(o.id)}
                >
                  {WALL_LABELS[o.wallId]} — {OPENING_KIND_LABELS[o.kind]} {o.widthMm}×
                  {o.heightMm}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeOpening(o.id)}
                  aria-label={`Remove ${OPENING_KIND_LABELS[o.kind]}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
