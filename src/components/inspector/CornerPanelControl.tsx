// src/components/inspector/CornerPanelControl.tsx
//
// A blind/magic corner's fixed panel (§116): which end, how wide, or
// none, plus "Fit to corner" to work both out from the meeting run again
// (the cabinet may have moved since it was placed). Only shown for
// blind and magic corners; the carousel has its diagonal door instead.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { useFitCornerPanel } from '../../hooks/useFitCornerPanel';
import { cornerPanelWidthMm, MIN_CORNER_DOOR_MM } from '../../lib/fronts';
import { hasCornerPanel } from '../../lib/cornerPanel';
import { defaultFrontLayout } from '../../types/front';
import type { PlacedCabinetItem } from '../../types/cabinet';
import { Button } from '../ui/button';

type Side = 'none' | 'left' | 'right';

export function CornerPanelControl({ cabinet }: { cabinet: PlacedCabinetItem }) {
  const updateCabinet = useLayoutStore((s) => s.updateCabinet);
  const fit = useFitCornerPanel();
  const side: Side = cabinet.cornerPanel?.side ?? 'none';
  const widthMm = cornerPanelWidthMm(cabinet);
  const [draft, setDraft] = useState(String(widthMm));
  const [lastWidth, setLastWidth] = useState(widthMm);
  if (widthMm !== lastWidth) {
    setLastWidth(widthMm);
    setDraft(String(widthMm));
  }
  if (!hasCornerPanel(cabinet.moduleType)) return null;

  // A single door is re-hinged on the side away from the panel, so it
  // opens into free floor; any other front the designer chose is kept.
  const hingeAway = (s: 'left' | 'right') =>
    cabinet.frontLayout?.kind === 'single-door' ? { frontLayout: { ...cabinet.frontLayout, hinge: s === 'left' ? 'right' as const : 'left' as const } } : {};

  function choose(next: Side) {
    if (next === 'none') {
      updateCabinet(cabinet.id, { cornerPanel: undefined, frontLayout: defaultFrontLayout(cabinet.moduleType, cabinet.widthMm) });
      return;
    }
    const fitted = fit(cabinet);
    const width = cabinet.cornerPanel?.widthMm ?? fitted?.cornerPanel?.widthMm ?? cabinet.depthMm;
    updateCabinet(cabinet.id, {
      cornerPanel: { side: next, widthMm: width },
      ...(cabinet.cornerPanel ? hingeAway(next) : { frontLayout: fitted?.frontLayout }),
    });
  }

  function commitWidth() {
    const n = Math.round(Number(draft));
    if (!cabinet.cornerPanel || !(n > 0)) {
      setDraft(String(widthMm));
      return;
    }
    updateCabinet(cabinet.id, { cornerPanel: { ...cabinet.cornerPanel, widthMm: Math.min(n, cabinet.widthMm - MIN_CORNER_DOOR_MM) } });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-[13px] font-semibold">Fixed corner panel</span>
      <div role="radiogroup" aria-label="Fixed panel side" className="grid grid-cols-3 gap-1.5">
        {(['none', 'left', 'right'] as const).map((s) => (
          <Button
            key={s}
            role="radio"
            aria-checked={side === s}
            variant={side === s ? 'default' : 'outline'}
            size="touch"
            onClick={() => choose(s)}
          >
            {s === 'none' ? 'None' : s === 'left' ? 'Left end' : 'Right end'}
          </Button>
        ))}
      </div>
      {side !== 'none' && (
        <label className="flex items-center justify-between gap-3 text-[13px] font-semibold">
          Panel width (mm)
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitWidth}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Panel width in mm"
            className="h-10 w-28 rounded-[10px] border border-input bg-card px-3 font-mono text-[15px] font-normal"
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {side === 'none'
          ? 'Doors across the whole width. Pick an end to make the part behind the other wall’s cabinets a fixed panel.'
          : `The ${widthMm} mm behind the other wall’s cabinets doesn’t open (no hinges, no handle); doors fill the other ${cabinet.widthMm - widthMm} mm. Sides are as you face the unit.`}
      </p>
      <Button
        variant="outline"
        size="touch"
        onClick={() => {
          const fitted = fit(cabinet);
          if (fitted) updateCabinet(cabinet.id, fitted);
        }}
      >
        Fit to corner
      </Button>
    </div>
  );
}
