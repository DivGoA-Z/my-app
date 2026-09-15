// src/store/pickerStore.ts
//
// Transient state for the overlap chooser: which items are under the
// last ambiguous click, and where on screen to draw the list.
//
// DELIBERATELY NOT in layoutStore. That store holds the project — the
// thing that gets saved, quoted and shared — and an open popup is none
// of those. Mixing them would mean a transient UI flicker sitting in
// the same object as the data a save serialises, and every selector on
// the layout store re-running when a menu opens.

import { create } from 'zustand';
import type { HitCandidate } from '../lib/hitTest';

interface PickerState {
  // Null when closed. Non-null means "these items were all under that
  // click; the user hasn't chosen yet".
  open: {
    candidates: HitCandidate[];
    // Viewport coordinates, so the popup can be positioned over the
    // canvas without the canvas needing to know about it.
    screenX: number;
    screenY: number;
  } | null;
  openPicker: (candidates: HitCandidate[], screenX: number, screenY: number) => void;
  closePicker: () => void;
}

export const usePickerStore = create<PickerState>((set) => ({
  open: null,
  openPicker: (candidates, screenX, screenY) =>
    set({ open: { candidates, screenX, screenY } }),
  closePicker: () => set({ open: null }),
}));
