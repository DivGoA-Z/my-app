// src/components/editor/placeDrag.ts
//
// Drag a unit from a tool panel straight onto the plan (§91). Clicking
// a tile still adds it in the middle of the room; pressing and moving
// carries it instead, with an outline on the plan showing where it'll
// land (lib/placement.ts decides: under the pointer, turned to face the
// room against a wall, snapped to neighbours).
//
// Why window listeners and not pointer capture on the tile: on a phone
// the tool sheet hides while you drag so you can see the plan, and a
// hidden element can't be relied on to keep receiving captured events.
//
// Touch is the delicate part. The tiles scroll vertically, so a drag
// can't start on any movement or scrolling the panel would pick
// cabinets up. It starts on a short press-and-hold (HOLD_MS), or on a
// clearly sideways move; an early vertical move is a scroll and ends
// the gesture. Once dragging, touchmove's default (scrolling) is
// cancelled so the page doesn't pan under the finger.

import type React from 'react';
import { create } from 'zustand';
import type { PlacedCabinetItem } from '../../types/cabinet';
import type { Placement } from '../../lib/placement';

export interface DragPayload {
  label: string;
  widthMm: number;
  depthMm: number;
  // Turn to face the room when dropped against a wall (not pillars).
  autoTurn: boolean;
  // Cabinets only: the unit as it will be added, for neighbour snapping.
  cabinet?: PlacedCabinetItem;
  commit: (placement: Placement) => void;
}

type Resolver = (payload: DragPayload, clientX: number, clientY: number) => Placement | null;

interface PlaceDragState {
  payload: DragPayload | null;
  clientX: number;
  clientY: number;
  // Set by the editor while the plan is on screen; without one (3D or
  // elevation view), tiles don't start a drag and a click still adds.
  resolver: Resolver | null;
  setResolver: (resolver: Resolver | null) => void;
}

export const usePlaceDrag = create<PlaceDragState>((set) => ({
  payload: null,
  clientX: 0,
  clientY: 0,
  resolver: null,
  setResolver: (resolver) => set({ resolver }),
}));

export const HOLD_MS = 250;
const MOUSE_START_PX = 6;
const TOUCH_SIDEWAYS_PX = 10;
const TOUCH_SCROLL_PX = 8;

// Attach as a tile's onPointerDown. `makePayload` runs when the drag
// actually starts, so a plain click builds nothing.
export function startPlaceGesture(e: React.PointerEvent, makePayload: () => DragPayload) {
  if (e.button !== 0 || !usePlaceDrag.getState().resolver) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const isTouch = e.pointerType === 'touch';
  const pointerId = e.pointerId;
  let held = false;
  let payload: DragPayload | null = null;
  const holdTimer = isTouch ? window.setTimeout(() => (held = true), HOLD_MS) : 0;

  const preventScroll = (ev: TouchEvent) => ev.preventDefault();

  function begin(x: number, y: number) {
    payload = makePayload();
    usePlaceDrag.setState({ payload, clientX: x, clientY: y });
    window.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.style.userSelect = 'none';
  }

  function cleanup() {
    window.clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('touchmove', preventScroll);
    document.body.style.userSelect = '';
    usePlaceDrag.setState({ payload: null });
  }

  // The tile's own click would otherwise fire after a drop back onto
  // it and add a second unit in the middle of the room.
  function swallowNextClick() {
    const stop = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400);
  }

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    if (payload) {
      usePlaceDrag.setState({ clientX: ev.clientX, clientY: ev.clientY });
      return;
    }
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!isTouch) {
      if (Math.hypot(dx, dy) > MOUSE_START_PX) begin(ev.clientX, ev.clientY);
    } else if (held) {
      begin(ev.clientX, ev.clientY);
    } else if (Math.abs(dx) > TOUCH_SIDEWAYS_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      begin(ev.clientX, ev.clientY);
    } else if (Math.abs(dy) > TOUCH_SCROLL_PX) {
      cleanup(); // a scroll, not a drag
    }
  }

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    if (payload) {
      const placement = usePlaceDrag.getState().resolver?.(payload, ev.clientX, ev.clientY) ?? null;
      if (placement) payload.commit(placement);
      swallowNextClick();
    }
    cleanup();
  }

  function onCancel(ev: PointerEvent) {
    if (ev.pointerId === pointerId) cleanup();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && payload) {
      swallowNextClick();
      cleanup();
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
