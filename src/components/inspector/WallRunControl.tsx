// src/components/inspector/WallRunControl.tsx
//
// "Add wall cabinets above this run" (§150), on a base unit: asks the
// bottom height (1,500 mm offered), then places a wall cabinet over each
// base unit on that wall through the normal placement path (the
// kitchen's wall-unit style, the corner panel fit). What it adds and
// what it skips, and why, is said in one message. lib/wallRunFromBase.ts
// holds the rules.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useLayoutStore } from '../../store/layoutStore';
import { useFitCornerPanel } from '../../hooks/useFitCornerPanel';
import { effectiveStyleDefaults, withStyleDefaults } from '../../lib/styleDefaults';
import { sizeGroup } from '../../lib/standardSizes';
import { touchesFloor } from '../../lib/surfaceAreas';
import { DEFAULT_WALL_RUN_BOTTOM_MM, SKIP_REASON_WORDS, wallCabinetsAbove, type SkipReason } from '../../lib/wallRunFromBase';
import type { PlacedCabinetItem } from '../../types/cabinet';

export function WallRunControl({ cabinet }: { cabinet: PlacedCabinetItem }) {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const appliances = useLayoutStore((s) => s.appliances);
  const obstacles = useLayoutStore((s) => s.obstacles);
  const layout = useLayoutStore((s) => s.currentLayout);
  const standard = useLayoutStore((s) => s.standardSizes);
  const addCabinet = useLayoutStore((s) => s.addCabinet);
  const styleDefaults = useLayoutStore((s) => effectiveStyleDefaults(s.businessStyleDefaults ?? undefined, s.projectStyleDefaults ?? undefined));
  const fitCornerPanel = useFitCornerPanel();
  const [open, setOpen] = useState(false);
  const [bottomMm, setBottomMm] = useState(DEFAULT_WALL_RUN_BOTTOM_MM);

  if (!layout || sizeGroup(cabinet.moduleType) !== 'base' || !touchesFloor(cabinet.elevationMm)) return null;
  // The stored cabinet (the inspector may hold the physical one, §61).
  const from = cabinets.find((c) => c.id === cabinet.id) ?? cabinet;

  function add() {
    const r = wallCabinetsAbove({ from, cabinets, appliances, obstacles, layout: layout!, standard, bottomMm });
    if (!r.wall) {
      toast.error('This unit isn’t against a wall, so there’s nowhere to hang wall cabinets above it.');
      return;
    }
    for (const unit of r.created) {
      const styled = withStyleDefaults(unit, styleDefaults);
      addCabinet({ ...styled, ...fitCornerPanel(styled, { onlyWhereRunMeets: true }) });
    }
    const counts = new Map<SkipReason, number>();
    for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
    const skipped = [...counts].map(([reason, n]) => `${n} ${SKIP_REASON_WORDS[reason]}`).join('; ');
    const added = `Added ${r.created.length} wall cabinet${r.created.length === 1 ? '' : 's'} on the ${r.wall} wall at ${bottomMm} mm.`;
    (r.created.length ? toast.success : toast.info)(skipped ? `${added} Skipped: ${skipped}.` : added, { duration: 8000 });
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Add wall cabinets above this run
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-[13px]">
          <label className="flex flex-col gap-1 font-semibold">
            Bottom of the wall cabinets (mm from the floor)
            <input
              type="number"
              min={1000}
              step={10}
              value={bottomMm}
              onChange={(e) => setBottomMm(Number(e.target.value))}
              className="h-10 rounded-lg border border-input bg-card px-3 font-normal"
            />
          </label>
          <span className="text-muted-foreground">
            One wall cabinet over each base unit on this wall, same width, standard depth and height. Leaves the space over the hob, windows and anything already there.
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={!(bottomMm > 0)}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
