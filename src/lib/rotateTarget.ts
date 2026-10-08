// src/lib/rotateTarget.ts
//
// Which item a double-click on the plan should turn (§115).
//
// A double-click lands on whatever is drawn on top. Where one item sits
// on another — a sink in its sink unit, a hob on a drawer unit — that's
// the appliance, so the cabinet underneath could never be turned by
// double-click: you'd select the sink unit (via the overlap picker) and
// the sink would turn instead. So: if something ELSE is selected and the
// double-click is inside it, turn the selection; otherwise turn what was
// clicked, as before.

import type { SelectionRef } from '../types/selection';
import type { FootprintRect } from './footprint';

export function rotateTarget(
  clicked: SelectionRef,
  selection: SelectionRef | null,
  selectionRect: FootprintRect | null,
  xMm: number,
  yMm: number
): SelectionRef {
  if (!selection || !selectionRect) return clicked;
  if (selection.type === clicked.type && selection.id === clicked.id) return clicked;
  const r = selectionRect;
  const inside = xMm >= r.x && xMm <= r.x + r.widthMm && yMm >= r.y && yMm <= r.y + r.depthMm;
  return inside ? selection : clicked;
}
