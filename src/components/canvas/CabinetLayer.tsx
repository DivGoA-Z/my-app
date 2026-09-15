// src/components/canvas/CabinetLayer.tsx
//
// Renders every PlacedCabinetItem from the Zustand layout store as a
// draggable, rotatable, selectable rectangle, using the same mm-to-px
// scale as RoomCanvas (via computeRoomScale) so it lines up on the
// same grid.
//
// - Drag: clamped to stay inside the room (accounting for the cabinet's
//   CURRENT rotated footprint), then "magnet" snapped — live, during the
//   drag, not just at drop — flush against a nearby cabinet's edge or a
//   wall (see lib/cabinetSnapping.ts) so building a row of cabinets
//   doesn't require pixel-perfect manual alignment. Falls back to plain
//   grid-snapping on an axis when nothing nearby qualifies.
// - Rotate: double-click/double-tap cycles 0 -> 90 -> 180 -> 270 via
//   lib/cabinetGeometry's rotateCabinet(), which also re-clamps position
//   so the newly-rotated footprint can't spill outside the room. The
//   Inspector panel's -90/+90 buttons call the exact same helper, so
//   the two rotation entry points can never drift apart.
// - Select: click/tap selects the cabinet (selectedCabinetId in the
//   store), drawing a dashed blue outline and opening it in
//   CabinetInspector. Clicking anywhere else on the Stage (see
//   RoomCanvas.tsx) deselects — the click stops propagating here via
//   e.cancelBubble so a select-click doesn't also trigger that deselect.
// - Collision: cabinets overlapping another cabinet, an obstacle, or a
//   placed appliance get a semi-transparent red overlay. Collision is
//   recomputed LIVE during
//   a drag (via local dragState + a direct detectCollisions() call),
//   not just after the drop — otherwise the highlight reflects the
//   pre-drag position for the entire drag gesture, which looks like
//   "far apart pieces shown colliding" and "collision only clears once
//   moved far away" (it was really just stale until the next commit).
//
// Every write here (updateCabinet) goes through the same store action
// QuoteSidebar/useBOM and useCollisions already subscribe to, so the
// live price total and the collision highlight both pick up rotation,
// resize, duplicate, and delete from CabinetInspector immediately —
// there's no separate "recheck" step to wire up.

import { useState } from 'react';
import type Konva from 'konva';
import { Layer, Group, Rect, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedCabinetId } from '../../hooks/useSelection';
import { computeRoomScale } from '../../lib/canvasScale';
import { useCollisions } from '../../hooks/useCollisions';
import { detectCollisions } from '../../lib/collision';
import { rotateCabinet, getFootprint } from '../../lib/cabinetGeometry';
import { snapCabinetFootprint } from '../../lib/cabinetSnapping';
import type { ModuleType } from '../../types/cabinet';

export interface CabinetLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number; // should match the active RoomLayout.gridSnapMm
}

// Translucent (not solid) on purpose — a wall cabinet placed over a
// base cabinet (see PlacedCabinetItem.elevationMm) is completely normal
// and, in the 2D top-down view, both share the same X/Y footprint. A
// solid fill would let whichever one is drawn last completely hide the
// other and its label; translucency lets both colors AND both name
// labels show through when cabinets overlap on the grid.
const MODULE_COLORS: Record<ModuleType, string> = {
  'base-cabinet': 'rgba(199, 210, 254, 0.65)',
  'wall-cabinet': 'rgba(187, 247, 208, 0.65)',
  'tall-unit': 'rgba(253, 230, 138, 0.65)',
  'sink-unit': 'rgba(165, 243, 252, 0.65)',
  'cylinder-trolley': 'rgba(251, 207, 232, 0.65)',
  'corner-unit': 'rgba(254, 202, 202, 0.65)',
  'drawer-unit': 'rgba(221, 214, 254, 0.65)',
};

const COLLISION_OVERLAY_FILL = 'rgba(220, 38, 38, 0.45)'; // red-600 @ 45%
const COLLISION_STROKE = '#dc2626';
const SELECTION_STROKE = '#2563eb'; // blue-600

interface DragState {
  cabinetId: string;
  xMm: number;
  yMm: number;
}

export function CabinetLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
}: CabinetLayerProps) {
  const cabinets = useLayoutStore((state) => state.cabinets);
  const pickAt = usePickAt();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const appliances = useLayoutStore((state) => state.appliances);
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const selectedCabinetId = useSelectedCabinetId();

  // Committed collision result (from the store) — used whenever nothing
  // is actively being dragged.
  const { collidingCabinetIds: committedCollidingIds } = useCollisions();

  // While a cabinet is mid-drag, its live (unsnapped) position hasn't
  // been written to the store yet. Substitute it in locally and
  // recompute collisions against that, so the highlight tracks the
  // cursor in real time instead of the last dropped position.
  const [dragState, setDragState] = useState<DragState | null>(null);

  const collidingCabinetIds = dragState
    ? detectCollisions(
        cabinets.map((c) =>
          c.id === dragState.cabinetId ? { ...c, x: dragState.xMm, y: dragState.yMm } : c
        ),
        obstacles,
        appliances
      ).collidingCabinetIds
    : committedCollidingIds;

  const { scale, originX, originY } = computeRoomScale(
    widthMm,
    depthMm,
    maxWidthPx,
    maxHeightPx
  );

  return (
    <Layer>
      {cabinets.map((item) => {
        const widthPx = item.widthMm * scale;
        const depthPx = item.depthMm * scale;
        const centerX = originX + item.x * scale + widthPx / 2;
        const centerY = originY + item.y * scale + depthPx / 2;
        const isColliding = collidingCabinetIds.has(item.id);
        const isSelected = item.id === selectedCabinetId;

        // Effective on-canvas footprint for the CURRENT rotation — used
        // for boundary clamping so a rotated cabinet's true extent is
        // respected, not its unrotated width/depth.
        const { footprintWidthMm, footprintHeightMm } = getFootprint(
          item.widthMm,
          item.depthMm,
          item.rotationDeg
        );

        return (
          <Group
            key={item.id}
            x={centerX}
            y={centerY}
            offsetX={widthPx / 2}
            offsetY={depthPx / 2}
            rotation={item.rotationDeg}
            draggable
            dragBoundFunc={(pos) => {
              // Group position is its center (because of the offset
              // above). Convert to mm, clamp the ROTATED footprint to
              // stay inside the room, then run magnet edge-snapping
              // against every other cabinet + the walls (falls back to
              // grid-snapping when nothing nearby qualifies) — live, on
              // every drag frame, not just at drop.
              const proposedCenterXMm = (pos.x - originX) / scale;
              const proposedCenterYMm = (pos.y - originY) / scale;
              const proposedFootprintLeftMm = proposedCenterXMm - footprintWidthMm / 2;
              const proposedFootprintTopMm = proposedCenterYMm - footprintHeightMm / 2;

              const clampedFootprintLeftMm = clamp(proposedFootprintLeftMm, 0, widthMm - footprintWidthMm);
              const clampedFootprintTopMm = clamp(proposedFootprintTopMm, 0, depthMm - footprintHeightMm);

              const snapped = snapCabinetFootprint(
                item.id,
                clampedFootprintLeftMm,
                clampedFootprintTopMm,
                footprintWidthMm,
                footprintHeightMm,
                cabinets,
                widthMm,
                depthMm,
                gridSnapMm
              );

              const snappedCenterXMm = snapped.footprintLeftMm + footprintWidthMm / 2;
              const snappedCenterYMm = snapped.footprintTopMm + footprintHeightMm / 2;

              return {
                x: originX + snappedCenterXMm * scale,
                y: originY + snappedCenterYMm * scale,
              };
            }}
            onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const xMm = (node.x() - widthPx / 2 - originX) / scale;
              const yMm = (node.y() - depthPx / 2 - originY) / scale;
              setDragState({ cabinetId: item.id, xMm, yMm });
            }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const xMm = (node.x() - widthPx / 2 - originX) / scale;
              const yMm = (node.y() - depthPx / 2 - originY) / scale;
              setDragState({ cabinetId: item.id, xMm, yMm });
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              // node.x()/y() already reflect the fully-snapped position
              // dragBoundFunc computed live on every drag frame (magnet
              // edge-snap against a neighbor/wall, or the grid
              // fallback) — just convert that center back to item.x/y's
              // UNROTATED-top-left convention and commit. Re-snapping
              // here would risk nudging a perfectly flush edge-snap off
              // by the grid step.
              const node = e.target;
              const xMm = (node.x() - widthPx / 2 - originX) / scale;
              const yMm = (node.y() - depthPx / 2 - originY) / scale;

              updateCabinet(item.id, { x: xMm, y: yMm });
              setDragState(null);
            }}
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              // cancelBubble still stops the Stage's deselect handler,
              // but the SELECTION is decided by the hit test rather
              // than by this layer — see usePickAt. Whichever layer
              // catches the click, the same items come back.
              e.cancelBubble = true;
              const pos = e.target.getStage()!.getPointerPosition()!;
              pickAt(
                (pos.x - originX) / scale,
                (pos.y - originY) / scale,
                e.evt.clientX,
                e.evt.clientY
              );
            }}
            onTap={(e: Konva.KonvaEventObject<Event>) => {
              e.cancelBubble = true;
              const pos = e.target.getStage()!.getPointerPosition()!;
              // Touch has no clientX on the Konva event, so the stage
              // position doubles as the popup anchor — close enough,
              // since a finger is bigger than the offset anyway.
              pickAt((pos.x - originX) / scale, (pos.y - originY) / scale, pos.x, pos.y);
            }}
            onDblClick={() => updateCabinet(item.id, rotateCabinet(item, 1, widthMm, depthMm))}
            onDblTap={() => updateCabinet(item.id, rotateCabinet(item, 1, widthMm, depthMm))}
          >
            {/*
              IMPORTANT: these children are drawn at local (0,0), NOT
              (-widthPx/2, -depthPx/2). The Group's offsetX/offsetY
              above already do the centering — a child's local point
              (offsetX, offsetY) is what stays anchored at the Group's
              (x,y) under rotation. That point equals (widthPx/2,
              depthPx/2), which is this Rect's true center ONLY when
              it's drawn from (0,0) to (widthPx,depthPx). Drawing it
              at (-widthPx/2,-depthPx/2) instead double-applies the
              offset, moving the real rotation pivot to a corner —
              which is what caused rotated cabinets to visually swing
              to the wrong spot (and out of sync with the stored,
              correctly-clamped x/y).
            */}
            <Rect
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              fill={MODULE_COLORS[item.moduleType]}
              stroke={isColliding ? COLLISION_STROKE : '#374151'}
              strokeWidth={isColliding ? 2.5 : 1}
              dash={isColliding ? [5, 3] : undefined}
              cornerRadius={2}
            />

            {isColliding && (
              <Rect
                x={0}
                y={0}
                width={widthPx}
                height={depthPx}
                fill={COLLISION_OVERLAY_FILL}
                listening={false}
              />
            )}

            <Text
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              align="center"
              verticalAlign="middle"
              text={item.moduleType}
              fontSize={10}
              fill="#1f2937"
              listening={false}
            />

            {isSelected && (
              // Drawn slightly outside the cabinet's own rect (rather
              // than sharing its stroke) so selection stays visible even
              // while a collision is also highlighting the same cabinet
              // red. listening={false} so this overlay never steals the
              // click/drag hit target from the Rect above.
              <Rect
                x={-4}
                y={-4}
                width={widthPx + 8}
                height={depthPx + 8}
                stroke={SELECTION_STROKE}
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Layer>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2; // cabinet bigger than room — center it rather than invert the range
  return Math.min(Math.max(value, min), max);
}
