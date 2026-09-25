// src/components/canvas/ApplianceLayer.tsx
//
// Renders placed appliances (sink, stove, chimney, oven, OTG, toaster —
// types/appliance.ts) on the same mm-to-px scale as RoomCanvas/
// CabinetLayer/ObstacleLayer: draggable, grid-snapped, and — as of the
// GLTF-model work — rotatable in quarter turns.
//
// Rotation is double-click (or double-tap) for +90°, the same gesture
// CabinetLayer uses, and goes through rotateAppliance so the stored
// x/y is re-clamped into the room exactly the way a rotated cabinet's
// is. Shift-double-click turns the other way, which matters far more
// here than it does for a box: getting a sink's tap or a hob's control
// edge to face the right way is often one turn counter-clockwise, and
// three clockwise clicks to reach it is a bad way to spend a client
// meeting.
//
// Collision: an appliance overlapping a cabinet, obstacle, or another
// appliance gets the same semi-transparent red overlay CabinetLayer
// uses, computed LIVE during a drag the same way (local dragState + a
// direct detectCollisions() call) so the highlight tracks the cursor
// instead of the last dropped position. A stove sitting flush on the
// countertop below it, or a chimney mounted above it, are NOT flagged —
// see elevationMm on PlacedApplianceItem and lib/collision.ts.

import { useState } from 'react';
import type Konva from 'konva';
import { Layer, Group, Rect, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedApplianceId } from '../../hooks/useSelection';
import { computeRoomScale } from '../../lib/canvasScale';
import { useCollisions } from '../../hooks/useCollisions';
import { detectCollisions } from '../../lib/collision';
import { rotateAppliance } from '../../lib/applianceGeometry';
import { getFootprint } from '../../lib/footprint';
import type { ApplianceType } from '../../types/appliance';

export interface ApplianceLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number; // should match the active RoomLayout.gridSnapMm
  // Global master for the red overlap highlight — same session-only
  // toggle CabinetLayer takes, off means no highlight regardless of
  // any item's own ignoreOverlap (which still applies underneath;
  // this only ever hides MORE). See CabinetLayerProps' own comment.
  showOverlapWarnings?: boolean;
}

// Distinct from MODULE_COLORS (CabinetLayer) and OBSTACLE_STYLES
// (ObstacleLayer) so all three item types stay visually distinguishable
// when they overlap on screen (a stove sitting on a base cabinet, a
// chimney over a wall cabinet run). Translucent for the same reason
// CabinetLayer's colors are — appliances routinely share an X/Y
// footprint with a cabinet at a different elevation.
const APPLIANCE_COLORS: Record<ApplianceType, string> = {
  sink: 'rgba(120, 170, 190, 0.55)',
  stove: 'rgba(248, 113, 113, 0.65)',
  chimney: 'rgba(148, 163, 184, 0.65)',
  oven: 'rgba(251, 146, 60, 0.65)',
  otg: 'rgba(250, 204, 21, 0.65)',
  toaster: 'rgba(74, 222, 128, 0.65)',
};

const COLLISION_OVERLAY_FILL = 'rgba(220, 38, 38, 0.45)'; // red-600 @ 45% — matches CabinetLayer
const COLLISION_STROKE = '#dc2626';

// Thickness of the front-edge marker. Fixed px rather than mm-scaled
// so it stays legible on a small room drawn at a large scale factor.
const FRONT_MARKER_PX = 3;

// Matches CabinetLayer's selection stroke so a selected item reads the
// same whatever type it is.
const SELECTION_STROKE = '#2563eb';

interface DragState {
  applianceId: string;
  xMm: number;
  yMm: number;
}

export function ApplianceLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
  showOverlapWarnings = true,
}: ApplianceLayerProps) {
  const appliances = useLayoutStore((state) => state.appliances);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const obstacles = useLayoutStore((state) => state.obstacles);
  const updateAppliance = useLayoutStore((state) => state.updateAppliance);
  const pickAt = usePickAt();
  const selectedApplianceId = useSelectedApplianceId();

  const { collidingApplianceIds: committedCollidingIds } = useCollisions();

  const [dragState, setDragState] = useState<DragState | null>(null);

  const collidingApplianceIds = dragState
    ? detectCollisions(
        cabinets,
        obstacles,
        appliances.map((a) =>
          a.id === dragState.applianceId ? { ...a, x: dragState.xMm, y: dragState.yMm } : a
        )
      ).collidingApplianceIds
    : committedCollidingIds;

  const { scale, originX, originY } = computeRoomScale(widthMm, depthMm, maxWidthPx, maxHeightPx);

  return (
    <Layer>
      {appliances.map((item) => {
        const widthPx = item.widthMm * scale;
        const depthPx = item.depthMm * scale;
        const centerX = originX + item.x * scale + widthPx / 2;
        const centerY = originY + item.y * scale + depthPx / 2;
        const isColliding = showOverlapWarnings && collidingApplianceIds.has(item.id);
        const isSelected = item.id === selectedApplianceId;

        // Effective on-canvas footprint for the CURRENT rotation. The
        // drag bounds must use this, not widthPx/depthPx, or a turned
        // appliance clamps against its unrotated extent and can be
        // dragged partly outside the room.
        const { footprintWidthMm, footprintHeightMm } = getFootprint(
          item.widthMm,
          item.depthMm,
          item.rotationDeg
        );
        const footprintWidthPx = footprintWidthMm * scale;
        const footprintDepthPx = footprintHeightMm * scale;

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
              // pos is the Group's CENTER (because of the offset
              // above), so the room-edge limits are half the rotated
              // footprint in from each wall.
              const minX = originX + footprintWidthPx / 2;
              const maxX = originX + widthMm * scale - footprintWidthPx / 2;
              const minY = originY + footprintDepthPx / 2;
              const maxY = originY + depthMm * scale - footprintDepthPx / 2;
              return {
                x: clamp(pos.x, minX, maxX),
                y: clamp(pos.y, minY, maxY),
              };
            }}
            onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const xMm = (node.x() - widthPx / 2 - originX) / scale;
              const yMm = (node.y() - depthPx / 2 - originY) / scale;
              setDragState({ applianceId: item.id, xMm, yMm });
            }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const xMm = (node.x() - widthPx / 2 - originX) / scale;
              const yMm = (node.y() - depthPx / 2 - originY) / scale;
              setDragState({ applianceId: item.id, xMm, yMm });
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;

              // Snap the ROTATED FOOTPRINT's edge to the grid, not the
              // stored x/y. On a quarter-turned appliance those differ
              // by (widthMm - depthMm)/2, so grid-snapping x directly
              // would leave the visible edge sitting a half-difference
              // off the grid — and off the cabinet run it's meant to
              // line up with.
              const centerXMm = (node.x() - originX) / scale;
              const centerYMm = (node.y() - originY) / scale;

              const snappedLeftMm = clamp(
                snapTo(centerXMm - footprintWidthMm / 2, gridSnapMm),
                0,
                widthMm - footprintWidthMm
              );
              const snappedTopMm = clamp(
                snapTo(centerYMm - footprintHeightMm / 2, gridSnapMm),
                0,
                depthMm - footprintHeightMm
              );

              // Back to the stored UNROTATED top-left convention via
              // the center, which is the value that's invariant under
              // rotation (see lib/footprint.ts).
              const snappedCenterXMm = snappedLeftMm + footprintWidthMm / 2;
              const snappedCenterYMm = snappedTopMm + footprintHeightMm / 2;
              const xMm = snappedCenterXMm - item.widthMm / 2;
              const yMm = snappedCenterYMm - item.depthMm / 2;

              updateAppliance(item.id, { x: xMm, y: yMm });
              setDragState(null);

              node.x(originX + snappedCenterXMm * scale);
              node.y(originY + snappedCenterYMm * scale);
            }}
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              // cancelBubble still stops the Stage's deselect handler,
              // but the SELECTION is decided by the hit test rather
              // than by this layer — see usePickAt. Whichever layer
              // happens to catch the click, the same items come back.
              e.cancelBubble = true;
              pickAt(
                (e.target.getStage()!.getPointerPosition()!.x - originX) / scale,
                (e.target.getStage()!.getPointerPosition()!.y - originY) / scale,
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
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              updateAppliance(
                item.id,
                rotateAppliance(item, e.evt.shiftKey ? -1 : 1, widthMm, depthMm)
              );
            }}
            onDblTap={() => {
              // No modifier keys on touch — clockwise only. Four taps
              // returns to where it started.
              updateAppliance(item.id, rotateAppliance(item, 1, widthMm, depthMm));
            }}
          >
            {/* Drawn at local (0,0), NOT (-widthPx/2, -depthPx/2) —
                the Group's offsetX/offsetY already centre it, and the
                child's local (offsetX, offsetY) is what stays anchored
                under rotation. Drawing from a negative origin
                double-applies the offset and moves the pivot to a
                corner. Same trap documented at length in
                CabinetLayer.tsx. */}
            <Rect
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              fill={APPLIANCE_COLORS[item.applianceType]}
              // Collision outranks selection: an invalid layout is more
              // urgent to see than which item happens to be open in the
              // inspector.
              stroke={isColliding ? COLLISION_STROKE : isSelected ? SELECTION_STROKE : '#374151'}
              strokeWidth={isColliding || isSelected ? 2.5 : 1}
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

            {/* FRONT-EDGE MARKER. In plan view a rotated rectangle
                looks identical at 0° and 180°, so without this there
                is no way to tell a sink facing into the room from one
                facing the wall — which is exactly the mistake rotation
                was added to fix. The marker runs along the +y edge,
                which is the front at 0° (a unit against the north wall
                faces south, into the room). */}
            <Rect
              x={0}
              y={depthPx - FRONT_MARKER_PX}
              width={widthPx}
              height={FRONT_MARKER_PX}
              fill={isColliding ? COLLISION_STROKE : '#1f2937'}
              opacity={0.75}
              listening={false}
            />

            <Text
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              align="center"
              verticalAlign="middle"
              text={item.applianceType.toUpperCase()}
              fontSize={9}
              fontStyle="bold"
              fill="#1f2937"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
