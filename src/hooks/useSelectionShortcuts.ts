// src/hooks/useSelectionShortcuts.ts
//
// Keyboard shortcuts for whatever is currently selected on the 2D
// plan — Delete/Backspace to remove it (same as clicking that item's
// own Delete button in its Inspector — no confirm dialog; undo covers
// the "oops" case), Escape to deselect, and arrow keys to nudge a
// cabinet/obstacle/appliance without reaching for the mouse. Global,
// registered once, same shape as useUndoRedoShortcuts — and skipped
// the same way while focus is inside a text input/textarea/select, so
// typing in an Inspector field never doubles as a shortcut.
//
// Arrow-key nudging is scoped to cabinets, obstacles and appliances —
// the three placed types whose position is a plain x/y
// RotatableFootprint (lib/footprint.ts). An opening moves along a wall
// by offsetMm, and a fixture's position depends on its mount kind
// (ceiling/wall/cabinet/free); nudging either the same way would need
// per-kind logic disproportionate to what a keyboard shortcut is for,
// so Delete/Escape still cover them but arrows don't.

import { useEffect } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { nudgeFootprint } from '../lib/footprint';

// Mirrors the fallback used across the toolbars/inspectors — only
// matters before any project/layout has loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

// Plain arrow: a fine, off-grid nudge — the same kind of exact
// adjustment typing a position into an Inspector field already allows
// (see ObstacleInspector's own comment on why that bypasses grid-snap).
// Shift+arrow: a coarse nudge at the room's own grid step, matching
// what dragging on the canvas already snaps to.
const FINE_STEP_MM = 10;

const ARROW_DELTAS: Record<string, [dx: number, dy: number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// `enabled` gates the whole hook rather than just the handler body —
// selection is store state, not view state, so it survives a switch
// away from the 2D canvas (to the dashboard, Manage Inventory, the 3D
// preview). Without this, a stale selection from before the switch
// would let Delete/arrow keys silently act on a cabinet that isn't
// even on screen, which reads as the app losing your work for no
// visible reason. App.tsx passes `view === 'canvas'`.
export function useSelectionShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      const state = useLayoutStore.getState();
      const selection = state.selection;

      if (e.key === 'Escape') {
        if (!selection) return;
        e.preventDefault();
        state.select(null);
        return;
      }

      if (!selection) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        switch (selection.type) {
          case 'cabinet':
            state.removeCabinet(selection.id);
            break;
          case 'obstacle':
            state.removeObstacle(selection.id);
            break;
          case 'appliance':
            state.removeAppliance(selection.id);
            break;
          case 'opening':
            state.removeOpening(selection.id);
            break;
          case 'fixture':
            state.removeFixture(selection.id);
            break;
        }
        return;
      }

      const delta = ARROW_DELTAS[e.key];
      if (!delta) return;
      if (selection.type !== 'cabinet' && selection.type !== 'obstacle' && selection.type !== 'appliance') {
        return;
      }

      e.preventDefault();
      const step = e.shiftKey ? (state.currentLayout?.gridSnapMm ?? 50) : FINE_STEP_MM;
      const [dxUnit, dyUnit] = delta;
      const dxMm = dxUnit * step;
      const dyMm = dyUnit * step;
      const roomWidthMm = state.currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
      const roomDepthMm = state.currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

      if (selection.type === 'cabinet') {
        const item = state.cabinets.find((c) => c.id === selection.id);
        if (!item) return;
        state.updateCabinet(item.id, nudgeFootprint(item, dxMm, dyMm, roomWidthMm, roomDepthMm));
      } else if (selection.type === 'obstacle') {
        const item = state.obstacles.find((o) => o.id === selection.id);
        if (!item) return;
        state.updateObstacle(item.id, nudgeFootprint(item, dxMm, dyMm, roomWidthMm, roomDepthMm));
      } else {
        const item = state.appliances.find((a) => a.id === selection.id);
        if (!item) return;
        state.updateAppliance(item.id, nudgeFootprint(item, dxMm, dyMm, roomWidthMm, roomDepthMm));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
