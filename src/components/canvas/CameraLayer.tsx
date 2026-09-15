// src/components/canvas/CameraLayer.tsx
//
// Renders every CameraNode from the layout store as a draggable icon
// with a rotatable view-direction arrow — the Phase 2 bridge (see
// types/camera.ts). Each node stores x/y (floor position),
// viewAngleDeg (look direction), and heightMm (eye height); nothing
// here generates a panorama, it just captures where future panorama
// nodes should go and which way they should face.
//
// - Drag the camera body: repositions x/y, clamped inside the room and
//   snapped to the grid — same pattern as CabinetLayer/ObstacleLayer.
// - Drag the small circular handle at the end of the arrow: sets
//   viewAngleDeg. Its dragBoundFunc clamps it onto a fixed-radius
//   circle around the camera center (pos is parent-relative, i.e.
//   already camera-local, since the handle is nested inside the
//   camera's Group), so it always orbits at a constant distance no
//   matter where the pointer actually is.
// - Angle convention: 0° points "up" (north on the grid), increasing
//   CLOCKWISE — a compass bearing, chosen because it reads naturally
//   on a top-down floor plan. See handleOffsetForAngle/
//   angleFromHandleOffset for the shared conversion.
// - Every commit goes through updateCamera/addCamera in the store, so
//   CameraToolbar's list and (eventually) Phase 2's panorama generator
//   read the exact same data with no separate sync step.

import { useState } from 'react';
import type Konva from 'konva';
import { Layer, Group, Circle, Line, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { computeRoomScale } from '../../lib/canvasScale';

export interface CameraLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number;
}

const ICON_RADIUS_PX = 9;
const HANDLE_RADIUS_PX = 24; // distance from camera center to the direction handle
const HANDLE_HIT_RADIUS_PX = 6;
const CAMERA_FILL = '#0f766e'; // teal-700, distinct from cabinet/obstacle palettes
const CAMERA_STROKE = '#134e4a';

interface RotateState {
  cameraId: string;
  angleDeg: number;
}

// angleDeg 0 = pointing up/north, increasing clockwise (compass-style).
function handleOffsetForAngle(angleDeg: number, radiusPx: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { dx: radiusPx * Math.sin(rad), dy: -radiusPx * Math.cos(rad) };
}

function angleFromHandleOffset(dx: number, dy: number): number {
  const rad = Math.atan2(dx, -dy);
  return ((rad * 180) / Math.PI + 360) % 360;
}

export function CameraLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
}: CameraLayerProps) {
  const cameras = useLayoutStore((state) => state.cameras);
  const updateCamera = useLayoutStore((state) => state.updateCamera);

  // Live angle while a handle is mid-drag, so the arrow tracks the
  // cursor in real time without spamming the store on every pixel of
  // movement — committed via updateCamera only on drag end (same
  // pattern as CabinetLayer's live-drag collision preview).
  const [rotateState, setRotateState] = useState<RotateState | null>(null);

  const { scale, originX, originY } = computeRoomScale(widthMm, depthMm, maxWidthPx, maxHeightPx);

  return (
    <Layer>
      {cameras.map((camera) => {
        const centerX = originX + camera.x * scale;
        const centerY = originY + camera.y * scale;
        const isRotatingThisCamera = rotateState?.cameraId === camera.id;
        const liveAngleDeg = isRotatingThisCamera ? rotateState.angleDeg : camera.viewAngleDeg;
        // Used for the Line/Text below, which aren't draggable — safe to
        // follow the live angle for real-time feedback while dragging.
        const liveHandleOffset = handleOffsetForAngle(liveAngleDeg, HANDLE_RADIUS_PX);
        // Used for the draggable Circle's OWN x/y props below — this one
        // must stay pinned to the COMMITTED angle, not the live one. If
        // it also followed liveAngleDeg, every onDragMove-triggered
        // re-render would push new x/y props onto the exact node Konva
        // is actively dragging, fighting Konva's own internal drag
        // position — that fight is what made the handle jump/vanish.
        // Konva's dragBoundFunc return value is the only thing allowed
        // to move this node while a drag is in progress.
        const committedHandleOffset = handleOffsetForAngle(camera.viewAngleDeg, HANDLE_RADIUS_PX);

        return (
          <Group
            key={camera.id}
            x={centerX}
            y={centerY}
            draggable
            dragBoundFunc={(pos) => {
              const minX = originX + ICON_RADIUS_PX;
              const maxX = originX + widthMm * scale - ICON_RADIUS_PX;
              const minY = originY + ICON_RADIUS_PX;
              const maxY = originY + depthMm * scale - ICON_RADIUS_PX;
              return {
                x: clamp(pos.x, minX, maxX),
                y: clamp(pos.y, minY, maxY),
              };
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const snappedX = snapTo((node.x() - originX) / scale, gridSnapMm);
              const snappedY = snapTo((node.y() - originY) / scale, gridSnapMm);
              updateCamera(camera.id, { x: snappedX, y: snappedY });
              node.x(originX + snappedX * scale);
              node.y(originY + snappedY * scale);
            }}
          >
            {/* View direction line, from center out to the handle */}
            <Line
              points={[0, 0, liveHandleOffset.dx, liveHandleOffset.dy]}
              stroke={CAMERA_FILL}
              strokeWidth={2}
              listening={false}
            />

            {/* Camera body */}
            <Circle radius={ICON_RADIUS_PX} fill={CAMERA_FILL} stroke={CAMERA_STROKE} strokeWidth={1.5} />
            <Circle radius={3} fill="#f0fdfa" listening={false} />

            <Text
              x={-40}
              y={ICON_RADIUS_PX + 4}
              width={80}
              align="center"
              text={isRotatingThisCamera ? `${camera.label} (${Math.round(liveAngleDeg)}°)` : camera.label}
              fontSize={10}
              fill="#134e4a"
              listening={false}
            />

            {/* Direction handle — drag to set viewAngleDeg. x/y here are
                intentionally NOT liveHandleOffset — see the comment on
                committedHandleOffset above. */}
            <Circle
              x={committedHandleOffset.dx}
              y={committedHandleOffset.dy}
              radius={HANDLE_HIT_RADIUS_PX}
              fill="#f0fdfa"
              stroke={CAMERA_FILL}
              strokeWidth={1.5}
              draggable
              dragBoundFunc={(pos) => {
                // IMPORTANT: Konva's dragBoundFunc always receives (and
                // must return) ABSOLUTE stage coordinates, regardless of
                // nesting — NOT coordinates relative to the parent Group.
                // (node.x()/node.y() in onDragMove/onDragEnd below are a
                // different Konva API and ARE parent-relative, which is
                // why only this function needed the extra conversion.)
                // Convert to camera-center-relative before the angle
                // math, then back to absolute before returning — get
                // this backwards and the handle snaps to a position near
                // the Stage's top-left corner instead of the camera,
                // which looks like it vanished mid-drag.
                const localDx = pos.x - centerX;
                const localDy = pos.y - centerY;
                const angle = angleFromHandleOffset(localDx, localDy);
                const snapped = handleOffsetForAngle(angle, HANDLE_RADIUS_PX);
                return { x: centerX + snapped.dx, y: centerY + snapped.dy };
              }}
              onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
                // Konva drag events bubble by default (like click/tap —
                // see the cancelBubble usage in CabinetLayer). Without
                // stopping it here, this dragmove/dragend would also
                // fire the parent Group's OWN onDragEnd below, but with
                // e.target still pointing at this handle — so that
                // handler would misread the handle's tiny camera-local
                // offset (±~24px) as an absolute canvas position and
                // write a bogus x/y back onto the camera. That's what
                // caused the camera to "jump to the top-left" right
                // after a rotation drag.
                e.cancelBubble = true;
                const node = e.target;
                const angle = angleFromHandleOffset(node.x(), node.y());
                setRotateState({ cameraId: camera.id, angleDeg: angle });
              }}
              onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                e.cancelBubble = true; // see onDragMove above
                const node = e.target;
                const angle = angleFromHandleOffset(node.x(), node.y());
                updateCamera(camera.id, { viewAngleDeg: Math.round(angle) });
                setRotateState(null);
              }}
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
