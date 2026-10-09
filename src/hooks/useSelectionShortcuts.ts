// src/hooks/useSelectionShortcuts.ts
//
// Keyboard shortcuts for whatever is currently selected on the 2D
// plan — Delete/Backspace to remove it (same as clicking that item's
// own Delete button in its Inspector — no confirm dialog; undo covers
// the "oops" case), Escape to deselect, arrow keys to nudge a
// cabinet/obstacle/appliance without reaching for the mouse, and
// Cmd/Ctrl+C + Cmd/Ctrl+V to duplicate one. Global, registered once,
// same shape as useUndoRedoShortcuts — and skipped the same way while
// focus is inside a text input/textarea/select, so typing in an
// Inspector field never doubles as a shortcut.
//
// Arrow-key nudging AND copy/paste are both scoped to cabinets,
// obstacles and appliances — the three placed types whose position is
// a plain x/y RotatableFootprint (lib/footprint.ts). An opening moves
// along a wall by offsetMm, and a fixture's position depends on its
// mount kind (ceiling/wall/cabinet/free); duplicating either the same
// way would need per-kind logic disproportionate to what a keyboard
// shortcut is for, same reasoning §22's arrow-nudge scoping already
// used — so Delete/Escape still cover them but copy/paste doesn't.

import { useEffect } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { nudgeFootprint } from '../lib/footprint';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { Obstacle } from '../types/layout';
import type { PlacedApplianceItem } from '../types/appliance';

// Module-level, not store state: a copied item never renders anywhere
// and nothing needs to react to it changing, so it doesn't belong in
// Zustand — same "session-only, not a property of the design" reasoning
// showDimensions/showOverlapWarnings already use for their own local
// state, just as a plain variable here since this hook has no return
// value for a component to read. Resets on a full page reload, which
// is the right default for a clipboard nobody asked to have persisted.
type Clipboard =
  | { type: 'cabinet'; item: PlacedCabinetItem }
  | { type: 'obstacle'; item: Obstacle }
  | { type: 'appliance'; item: PlacedApplianceItem };
let clipboard: Clipboard | null = null;

// Offset so a pasted copy doesn't land exactly on top of the original
// (which would collide-warn and be hard to grab) — the room's own
// default grid step, same value Shift+arrow nudges by, so a pasted
// copy lands on-grid like a dragged item would.
const PASTE_OFFSET_MM = 50;

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

function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
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
      // Keys pressed inside an open window or menu are for it (§125):
      // Escape there closes the finish library, and must not ALSO
      // deselect the cabinet behind it; Delete/arrows mustn't act on the
      // cabinet either. Also skipped if the window already handled it.
      if (e.defaultPrevented || insideOverlay(e.target)) return;

      const state = useLayoutStore.getState();
      const selection = state.selection;

      if (e.key === 'Escape') {
        if (!selection) return;
        e.preventDefault();
        state.select(null);
        return;
      }

      const isCopy = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c';
      const isPaste = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v';

      // Paste checked before the `!selection` gate below — pasting a
      // copied item doesn't require anything currently selected (you
      // can Escape to deselect, then paste).
      if (isPaste) {
        if (!clipboard) return;
        e.preventDefault();
        const roomWidthMm = state.currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
        const roomDepthMm = state.currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
        // Reuses the same clamp-to-room logic a dragged/nudged item
        // gets, rather than a fresh bounds check — one function decides
        // "is this position in the room" everywhere (lib/footprint.ts).
        const { x, y } = nudgeFootprint(
          clipboard.item,
          PASTE_OFFSET_MM,
          PASTE_OFFSET_MM,
          roomWidthMm,
          roomDepthMm
        );
        const newId = crypto.randomUUID();

        if (clipboard.type === 'cabinet') {
          state.addCabinet({ ...clipboard.item, id: newId, x, y });
          state.select({ type: 'cabinet', id: newId });
        } else if (clipboard.type === 'obstacle') {
          state.addObstacle({ ...clipboard.item, id: newId, x, y });
          state.select({ type: 'obstacle', id: newId });
        } else {
          state.addAppliance({ ...clipboard.item, id: newId, x, y });
          state.select({ type: 'appliance', id: newId });
        }
        return;
      }

      if (isCopy) {
        if (!selection) return;
        if (selection.type !== 'cabinet' && selection.type !== 'obstacle' && selection.type !== 'appliance') {
          return;
        }
        e.preventDefault();
        if (selection.type === 'cabinet') {
          const item = state.cabinets.find((c) => c.id === selection.id);
          if (item) clipboard = { type: 'cabinet', item };
        } else if (selection.type === 'obstacle') {
          const item = state.obstacles.find((o) => o.id === selection.id);
          if (item) clipboard = { type: 'obstacle', item };
        } else {
          const item = state.appliances.find((a) => a.id === selection.id);
          if (item) clipboard = { type: 'appliance', item };
        }
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
