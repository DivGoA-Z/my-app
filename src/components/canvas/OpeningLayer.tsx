// src/components/canvas/OpeningLayer.tsx
//
// Draws doors, windows and pass-throughs on the floor plan, and the
// floor each in-swinging door sweeps.
//
// Openings are constrained differently from every other item on this
// canvas: they don't move in x AND y, they slide ALONG one wall. So the
// drag is one-dimensional — the wall it belongs to is chosen in the
// inspector, and dragging only changes offsetMm. That's not a
// simplification, it's what an opening is.
//
// The SWING ARC is the reason this layer earns its place. Drawing it
// before anything is placed is worth more than warning about it
// afterwards: in a small kitchen the arc is often the only spot a
// cylinder trolley fits, and seeing the quarter-circle makes that
// obvious at a glance. The clearance check itself uses the arc's
// bounding square (deliberately conservative — see doorSwingZone), but
// the arc is what's DRAWN, because a square would overstate the
// conflict to the eye.

import type Konva from 'konva';
import { Layer, Group, Rect, Arc, Line, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedOpeningId } from '../../hooks/useSelection';
import { computeRoomScale } from '../../lib/canvasScale';
import { detectClearanceIssues } from '../../lib/clearance';
import type { WallOpening } from '../../types/opening';
import type { WallOrientation } from '../../types/layout';

export interface OpeningLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number;
}

// Openings read as gaps in the wall, so they're drawn light rather than
// as another coloured block competing with cabinets and obstacles.
const OPENING_FILL: Record<WallOpening['kind'], string> = {
  door: 'rgba(255, 255, 255, 0.95)',
  window: 'rgba(191, 219, 254, 0.9)', // blue-200 — reads as glass
  'pass-through': 'rgba(254, 243, 199, 0.9)', // amber-100
};

const OPENING_STROKE = '#475569';
const SELECTION_STROKE = '#2563eb';
const SWING_FILL = 'rgba(37, 99, 235, 0.08)';
const SWING_STROKE = 'rgba(37, 99, 235, 0.45)';
const CONFLICT_FILL = 'rgba(220, 38, 38, 0.16)';
const CONFLICT_STROKE = '#dc2626';

// Drawn thickness of the wall band an opening sits in. Purely visual —
// the room's walls have no modelled thickness in 2D.
const WALL_BAND_MM = 100;

export function OpeningLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
}: OpeningLayerProps) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const appliances = useLayoutStore((state) => state.appliances);
  const obstacles = useLayoutStore((state) => state.obstacles);
  const updateOpening = useLayoutStore((state) => state.updateOpening);
  const selectedOpeningId = useSelectedOpeningId();
  const pickAt = usePickAt();

  const { scale, originX, originY } = computeRoomScale(widthMm, depthMm, maxWidthPx, maxHeightPx);

  if (!currentLayout) return null;

  const openings = currentLayout.walls.flatMap((w) => w.openings ?? []);
  if (openings.length === 0) return null;

  // Obstacles live in their own slice, not on currentLayout — same
  // reassembly RoomSurfacesPanel does.
  const clearance = detectClearanceIssues(
    { ...currentLayout, obstacles },
    cabinets,
    appliances
  );
  const conflictedOpeningIds = new Set(clearance.issues.map((i) => i.openingId));

  return (
    <Layer>
      {/* Swing zones first, so openings and their labels draw on top. */}
      {clearance.swingZones.map(({ openingId }) => {
        const opening = openings.find((o) => o.id === openingId);
        if (!opening) return null;
        const conflicted = conflictedOpeningIds.has(openingId);

        // The arc's centre is the HINGE, and which end of the opening
        // that is depends on both the wall and the hinge side — so the
        // sweep start angle is derived rather than tabulated.
        const { pivotXMm, pivotYMm, startAngleDeg } = swingGeometry(opening, widthMm, depthMm);

        return (
          <Group key={`swing-${openingId}`} listening={false}>
            <Arc
              x={originX + pivotXMm * scale}
              y={originY + pivotYMm * scale}
              innerRadius={0}
              outerRadius={opening.widthMm * scale}
              angle={90}
              rotation={startAngleDeg}
              fill={conflicted ? CONFLICT_FILL : SWING_FILL}
              stroke={conflicted ? CONFLICT_STROKE : SWING_STROKE}
              strokeWidth={1}
              dash={[4, 3]}
            />
            {/* The door leaf itself at 90° open, so the arc reads as a
                door rather than as an abstract highlight. */}
            <Line
              points={[
                originX + pivotXMm * scale,
                originY + pivotYMm * scale,
                originX + (pivotXMm + Math.cos((startAngleDeg * Math.PI) / 180) * opening.widthMm) * scale,
                originY + (pivotYMm + Math.sin((startAngleDeg * Math.PI) / 180) * opening.widthMm) * scale,
              ]}
              stroke={conflicted ? CONFLICT_STROKE : SWING_STROKE}
              strokeWidth={1.5}
            />
            {/* The clearance CHECK uses the arc's bounding square
                (doorSwingZone) because rectangle overlap against a
                cabinet footprint is exact and cheap. It isn't drawn:
                the square is deliberately larger than the real sweep,
                so showing it would make the door look like it blocks
                more floor than it does. Conservative for the warning,
                truthful for the eye. */}
          </Group>
        );
      })}

      {openings.map((opening) => {
        const rect = openingPlanRect(opening, widthMm, depthMm);
        const isSelected = opening.id === selectedOpeningId;
        const conflicted = conflictedOpeningIds.has(opening.id);
        const alongAxis = isHorizontalWall(opening.wallId) ? 'x' : 'y';
        const maxOffsetMm =
          (alongAxis === 'x' ? widthMm : depthMm) - opening.widthMm;

        return (
          <Group
            key={opening.id}
            x={originX + rect.x * scale}
            y={originY + rect.y * scale}
            draggable
            dragBoundFunc={(pos) => {
              // ONE-DIMENSIONAL drag: the cross-wall coordinate is
              // pinned to the wall, and only the along-wall one moves.
              // Letting an opening leave its wall would make it
              // meaningless — it isn't an object in the room, it's a
              // hole in a specific surface.
              const pinnedX = originX + rect.x * scale;
              const pinnedY = originY + rect.y * scale;

              if (alongAxis === 'x') {
                const proposedMm = (pos.x - originX) / scale;
                const clamped = clamp(proposedMm, 0, Math.max(0, maxOffsetMm));
                return { x: originX + clamped * scale, y: pinnedY };
              }
              const proposedMm = (pos.y - originY) / scale;
              const clamped = clamp(proposedMm, 0, Math.max(0, maxOffsetMm));
              return { x: pinnedX, y: originY + clamped * scale };
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const rawMm =
                alongAxis === 'x'
                  ? (node.x() - originX) / scale
                  : (node.y() - originY) / scale;
              const snapped = clamp(
                Math.round(rawMm / gridSnapMm) * gridSnapMm,
                0,
                Math.max(0, maxOffsetMm)
              );
              updateOpening(opening.id, { offsetMm: snapped });

              // Re-seat the node on the committed value, so a snap
              // that moved it doesn't leave the shape and the data
              // disagreeing until the next render.
              const seated = openingPlanRect(
                { ...opening, offsetMm: snapped },
                widthMm,
                depthMm
              );
              node.x(originX + seated.x * scale);
              node.y(originY + seated.y * scale);
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
          >
            <Rect
              x={0}
              y={0}
              width={rect.widthMm * scale}
              height={rect.depthMm * scale}
              fill={OPENING_FILL[opening.kind]}
              stroke={
                conflicted ? CONFLICT_STROKE : isSelected ? SELECTION_STROKE : OPENING_STROKE
              }
              strokeWidth={conflicted || isSelected ? 2.5 : 1.5}
            />
            <Text
              x={0}
              y={0}
              width={rect.widthMm * scale}
              height={rect.depthMm * scale}
              align="center"
              verticalAlign="middle"
              text={opening.kind === 'window' ? 'WIN' : opening.kind === 'door' ? 'DOOR' : 'PASS'}
              fontSize={8}
              fontStyle="bold"
              fill="#334155"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}

function isHorizontalWall(wallId: WallOrientation): boolean {
  return wallId === 'north' || wallId === 'south';
}

// The opening drawn as a band lying IN its wall. Mirrors
// openingToRoomRect in lib/openings.ts but with a visual band width —
// kept local because this thickness is a drawing choice, not geometry
// anything else should depend on.
function openingPlanRect(opening: WallOpening, roomWidthMm: number, roomDepthMm: number) {
  const t = WALL_BAND_MM;
  switch (opening.wallId) {
    case 'north':
      return { x: opening.offsetMm, y: 0, widthMm: opening.widthMm, depthMm: t };
    case 'south':
      return {
        x: opening.offsetMm,
        y: roomDepthMm - t,
        widthMm: opening.widthMm,
        depthMm: t,
      };
    case 'west':
      return { x: 0, y: opening.offsetMm, widthMm: t, depthMm: opening.widthMm };
    case 'east':
      return {
        x: roomWidthMm - t,
        y: opening.offsetMm,
        widthMm: t,
        depthMm: opening.widthMm,
      };
  }
}

// Hinge position and the angle the leaf starts at, in Konva's
// screen-space convention (0° = +x, angles increase clockwise because
// +y points down).
//
// The hinge is at one END of the opening; which end depends on the
// hinge side AND on which way the wall's "along" axis runs, which is
// why this is computed rather than looked up.
function swingGeometry(opening: WallOpening, roomWidthMm: number, roomDepthMm: number) {
  const hingeAtStart = opening.swing === 'in-left';
  const along = opening.offsetMm + (hingeAtStart ? 0 : opening.widthMm);

  switch (opening.wallId) {
    case 'north':
      // Swings into the room, i.e. toward +y (downward on screen).
      return {
        pivotXMm: along,
        pivotYMm: 0,
        startAngleDeg: hingeAtStart ? 0 : 90,
      };
    case 'south':
      // Into the room means toward -y (up the screen).
      return {
        pivotXMm: along,
        pivotYMm: roomDepthMm,
        startAngleDeg: hingeAtStart ? 270 : 180,
      };
    case 'west':
      // Into the room means toward +x.
      return {
        pivotXMm: 0,
        pivotYMm: along,
        startAngleDeg: hingeAtStart ? 0 : 270,
      };
    case 'east':
      return {
        pivotXMm: roomWidthMm,
        pivotYMm: along,
        startAngleDeg: hingeAtStart ? 90 : 180,
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}
