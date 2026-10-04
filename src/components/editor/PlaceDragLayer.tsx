// src/components/editor/PlaceDragLayer.tsx
//
// The plan's half of drag-to-place (§91): tells the drag where the plan
// is and how a drop maps to a position (lib/placement.ts), and draws
// the outline of where the unit will land while it's carried. Mounted
// inside the plan only, so dragging works on the Plan view and nowhere
// else (a click on a tile still adds from any view).

import { useEffect } from 'react';
import { computeRoomScale } from '../../lib/canvasScale';
import { currentFootprintRect } from '../../lib/footprint';
import { placeAt, placeCabinetAt, type Placement } from '../../lib/placement';
import { frontDirection, frontThicknessMm } from '../../lib/physicalDepth';
import { cn } from '@/lib/utils';
import { useEffectiveConstruction, usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { useLayoutStore } from '../../store/layoutStore';
import { usePlaceDrag, type DragPayload } from './placeDrag';

// A drop this far outside the room (in room mm) still counts, clamped
// in; farther out it cancels.
const OUTSIDE_SLACK_MM = 400;

// Front direction (room x,y) → which edge of the outline to draw solid.
const FRONT_EDGE: Record<string, string> = {
  '0,1': 'inset-x-0 -bottom-0.5 h-1',
  '0,-1': 'inset-x-0 -top-0.5 h-1',
  '1,0': 'inset-y-0 -right-0.5 w-1',
  '-1,0': 'inset-y-0 -left-0.5 w-1',
};

export function PlaceDragLayer({
  element,
  roomWidthMm,
  roomDepthMm,
  maxWidthPx,
  maxHeightPx,
}: {
  element: HTMLElement | null;
  roomWidthMm: number;
  roomDepthMm: number;
  maxWidthPx: number;
  maxHeightPx: number;
}) {
  const physical = usePhysicalCabinets();
  const depthIncludesFront = useEffectiveConstruction().depthIncludesFront;
  const rateCard = useLayoutStore((s) => s.rateCard);
  const gridSnapMm = useLayoutStore((s) => s.currentLayout?.gridSnapMm ?? 50);
  const setResolver = usePlaceDrag((s) => s.setResolver);
  const payload = usePlaceDrag((s) => s.payload);
  const clientX = usePlaceDrag((s) => s.clientX);
  const clientY = usePlaceDrag((s) => s.clientY);
  const geom = computeRoomScale(roomWidthMm, roomDepthMm, maxWidthPx, maxHeightPx);
  const room = { widthMm: roomWidthMm, depthMm: roomDepthMm };

  function resolve(p: DragPayload, x: number, y: number): Placement | null {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const xMm = (x - r.left - geom.originX) / geom.scale;
    const yMm = (y - r.top - geom.originY) / geom.scale;
    if (xMm < -OUTSIDE_SLACK_MM || yMm < -OUTSIDE_SLACK_MM || xMm > roomWidthMm + OUTSIDE_SLACK_MM || yMm > roomDepthMm + OUTSIDE_SLACK_MM) {
      return null;
    }
    if (p.cabinet) {
      const extra = depthIncludesFront ? 0 : frontThicknessMm(p.cabinet, rateCard);
      return placeCabinetAt(p.cabinet, xMm, yMm, room, physical, extra, gridSnapMm, p.autoTurn);
    }
    return placeAt(p, xMm, yMm, room, p.autoTurn);
  }

  useEffect(() => {
    setResolver(resolve);
    return () => setResolver(null);
  });

  if (!payload) return null;
  const placement = resolve(payload, clientX, clientY);
  const outline = placement ? currentFootprintRect({ widthMm: payload.widthMm, depthMm: payload.depthMm, ...placement }) : null;

  return (
    <>
      {outline && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 flex items-center justify-center rounded-sm border-2 border-dashed border-primary bg-primary/15 text-center text-xs font-semibold text-primary"
          style={{
            left: geom.originX + outline.x * geom.scale,
            top: geom.originY + outline.y * geom.scale,
            width: outline.widthMm * geom.scale,
            height: outline.depthMm * geom.scale,
          }}
        >
          <span className="line-clamp-2 px-1">{payload.label}</span>
          {/* The front edge, solid, so you can see which way it faces
              before letting go (auto-turn). */}
          {placement && (
            <span
              className={cn(
                'absolute bg-primary',
                FRONT_EDGE[`${frontDirection(placement.rotationDeg).x},${frontDirection(placement.rotationDeg).y}`]
              )}
            />
          )}
        </div>
      )}
      {/* The label under the finger, everywhere, so you can see what you
          carry even over the panel; it says when letting go won't add. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-full bg-foreground px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-background shadow-float"
        style={{ left: clientX, top: clientY - 44 }}
      >
        {placement ? (placement.wall ? `${payload.label} · against the ${placement.wall} wall` : payload.label) : 'Drop on the plan to add'}
      </div>
    </>
  );
}
