// src/hooks/usePickAt.ts
//
// The one place a click on the floor plan turns into a selection.
//
// Every layer's own onClick now routes here instead of calling
// selectCabinet / selectAppliance / selectFixture directly. That single
// change is what fixes the ambiguity: it no longer matters WHICH layer
// received the click, because this re-derives everything under that
// point from the hit test and decides properly.
//
//   one item under the point   -> select it, no ceremony
//   several                    -> open the chooser and let the user say
//
// The rule the chooser follows is exactly "only when genuinely
// ambiguous". Click where only the wall cabinet's footprint covers and
// it selects immediately; click where the wall cabinet and the toaster
// both cover and you get a list.
//
// Note the honest consequence: a base cabinet with a wall cabinet above
// it IS an overlap in plan, so those points open the chooser too — and
// in a real kitchen that's most of the run. A top-down click has no
// height to disambiguate with, so there is no way around it. If it ever
// reads as noisy, requiring a modifier here is a one-line change.

import { useCallback } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { usePickerStore } from '../store/pickerStore';
import { hitTestAt } from '../lib/hitTest';
import type { HitCandidate } from '../lib/hitTest';

export function usePickAt() {
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const appliances = useLayoutStore((s) => s.appliances);
  const obstacles = useLayoutStore((s) => s.obstacles);
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const select = useLayoutStore((s) => s.select);
  const openPicker = usePickerStore((s) => s.openPicker);
  const closePicker = usePickerStore((s) => s.closePicker);

  return useCallback(
    (xMm: number, yMm: number, screenX: number, screenY: number) => {
      if (!currentLayout) return;

      // Obstacles live in their own store slice rather than on
      // currentLayout — the same reassembly RoomSurfacesPanel and
      // OpeningLayer do before measuring.
      const candidates: HitCandidate[] = hitTestAt(xMm, yMm, {
        layout: { ...currentLayout, obstacles },
        cabinets,
        appliances,
        fixtureCatalog,
      });

      if (candidates.length === 0) {
        select(null);
        closePicker();
        return;
      }

      if (candidates.length === 1) {
        select({ type: candidates[0].type, id: candidates[0].id });
        closePicker();
        return;
      }

      openPicker(candidates, screenX, screenY);
    },
    [currentLayout, cabinets, appliances, obstacles, fixtureCatalog, select, openPicker, closePicker]
  );
}
