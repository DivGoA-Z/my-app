// src/components/canvas/ObstacleLayer.tsx
//
// Renders structural obstacles (pillars, shafts, exposed pipes,
// electrical panels) from the layout store, on the same mm-to-px scale
// as RoomCanvas and CabinetLayer — see src/lib/canvasScale.ts.
//
// Draggable, and rotatable in quarter turns (double-click/tap), same
// gesture as CabinetLayer — a rectangular duct or shaft against a wall
// often needs its long side turned to match the wall it's against.
//
// Select: click/tap selects the obstacle (selectedObstacleId in the
// store, mutually exclusive with cabinet selection — see
// layoutStore.ts), drawing a dashed blue outline and opening it in
// ObstacleInspector, same pattern as CabinetLayer. Clicking anywhere
// else on the Stage (see RoomCanvas.tsx) deselects.

import { Layer, Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedObstacleId } from '../../hooks/useSelection';
import { detectClearanceIssues } from '../../lib/clearance';
import { computeRoomScale } from '../../lib/canvasScale';
import { getFootprint, rotateFootprint } from '../../lib/footprint';
import type { ObstacleType } from '../../types/layout';

// Amber rather than the collision red: a pillar in a door's swing is a
// real problem but a different KIND of problem from two solids
// overlapping, and showing them identically would make an unbuildable
// layout and an awkward one look the same.
const CLEARANCE_STROKE = '#d97706';

const SELECTION_STROKE = '#2563eb'; // blue-600 — matches CabinetLayer's selection outline

export interface ObstacleLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number; // should match the active RoomLayout.gridSnapMm
}

const OBSTACLE_STYLES: Record<
  ObstacleType,
  { fill: string; stroke: string; label: string }
> = {
  pillar: { fill: '#9ca3af', stroke: '#374151', label: 'PILLAR' },
  shaft: { fill: '#93c5fd', stroke: '#1d4ed8', label: 'SHAFT' },
  'exposed-pipe': { fill: '#fdba74', stroke: '#c2410c', label: 'PIPE' },
  'electrical-panel': { fill: '#fde047', stroke: '#a16207', label: 'ELEC' },
};

export function ObstacleLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
}: ObstacleLayerProps) {
  const obstacles = useLayoutStore((state) => state.obstacles);
  const pickAt = usePickAt();
  const updateObstacle = useLayoutStore((state) => state.updateObstacle);
  const selectedObstacleId = useSelectedObstacleId();
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const appliances = useLayoutStore((state) => state.appliances);

  // Obstacles live in their own store slice rather than on
  // currentLayout, so they're reassembled before the check — the same
  // step RoomSurfacesPanel and OpeningLayer do.
  const blockedObstacleIds = currentLayout
    ? detectClearanceIssues({ ...currentLayout, obstacles }, cabinets, appliances)
        .blockedObstacleIds
    : new Set<string>();

  const { scale, originX, originY } = computeRoomScale(
    widthMm,
    depthMm,
    maxWidthPx,
    maxHeightPx
  );

  return (
    <Layer>
      {obstacles.map((obstacle) => {
        const widthPx = obstacle.widthMm * scale;
        const depthPx = obstacle.depthMm * scale;
        const centerX = originX + obstacle.x * scale + widthPx / 2;
        const centerY = originY + obstacle.y * scale + depthPx / 2;
        const style = OBSTACLE_STYLES[obstacle.type];
        // Obstacles have no collision highlight of their own (they
        // don't move, so a cabinet overlapping one is flagged on the
        // CABINET). A door swing is different: the obstacle is the
        // thing in the way, and for a pillar it's the thing that can't
        // be moved — so it's marked here.
        const blocksDoor = blockedObstacleIds.has(obstacle.id);
        const isSelected = obstacle.id === selectedObstacleId;

        // Effective on-canvas footprint for the CURRENT rotation — used
        // for boundary clamping so a rotated obstacle's true extent is
        // respected, not its unrotated width/depth. Same split as
        // CabinetLayer: the Rect below is still drawn at the UNROTATED
        // widthPx/depthPx, because Konva's rotation prop turns it around
        // its own center (offsetX/offsetY) for free — only the drag
        // clamp needs the rotated footprint.
        const { footprintWidthMm, footprintHeightMm } = getFootprint(
          obstacle.widthMm,
          obstacle.depthMm,
          obstacle.rotationDeg
        );
        const footprintWidthPx = footprintWidthMm * scale;
        const footprintHeightPx = footprintHeightMm * scale;

        return (
          <Group
            key={obstacle.id}
            x={centerX}
            y={centerY}
            offsetX={widthPx / 2}
            offsetY={depthPx / 2}
            rotation={obstacle.rotationDeg}
            draggable
            dragBoundFunc={(pos) => {
              const minX = originX + footprintWidthPx / 2;
              const maxX = originX + widthMm * scale - footprintWidthPx / 2;
              const minY = originY + footprintHeightPx / 2;
              const maxY = originY + depthMm * scale - footprintHeightPx / 2;
              return {
                x: clamp(pos.x, minX, maxX),
                y: clamp(pos.y, minY, maxY),
              };
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const topLeftPxX = node.x() - widthPx / 2;
              const topLeftPxY = node.y() - depthPx / 2;
              const snappedX = snapTo((topLeftPxX - originX) / scale, gridSnapMm);
              const snappedY = snapTo((topLeftPxY - originY) / scale, gridSnapMm);

              updateObstacle(obstacle.id, { x: snappedX, y: snappedY });

              node.x(originX + snappedX * scale + widthPx / 2);
              node.y(originY + snappedY * scale + depthPx / 2);
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
            onDblClick={() => updateObstacle(obstacle.id, rotateFootprint(obstacle, 1, widthMm, depthMm))}
            onDblTap={() => updateObstacle(obstacle.id, rotateFootprint(obstacle, 1, widthMm, depthMm))}
          >
            {/*
              Drawn at local (0,0), not (-widthPx/2,-depthPx/2) — see the
              same note in CabinetLayer.tsx. The Group's offsetX/offsetY
              above already center it, so a child drawn from (0,0) to
              (widthPx,depthPx) rotates cleanly around its own center;
              drawing it pre-offset would double-apply the offset and
              swing the rotation pivot to a corner.
            */}
            <Rect
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              fill={style.fill}
              stroke={blocksDoor ? CLEARANCE_STROKE : style.stroke}
              strokeWidth={1.5}
              // Dashed border marks a partial-height obstacle (e.g. a
              // knee-height duct) vs. a solid floor-to-ceiling one.
              dash={obstacle.floorToCeiling ? undefined : [4, 3]}
            />
            <Text
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              align="center"
              verticalAlign="middle"
              text={style.label}
              fontSize={9}
              fontStyle="bold"
              fill="#1f2937"
              listening={false}
            />

            {isSelected && (
              // Drawn slightly outside the obstacle's own rect, same as
              // CabinetLayer's selection outline — listening={false} so
              // it never steals the click/drag hit target from the Rect
              // above.
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
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
