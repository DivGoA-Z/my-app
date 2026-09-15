// src/components/canvas/RoomCanvas.tsx
//
// Base layer: renders a scaled top-down room grid with dimension labels.
// Additional layers (CabinetLayer, an obstacle layer later) are passed
// in as children so everything shares one <Stage> and one scale — see
// src/lib/canvasScale.ts.
//
// Install: npm install konva react-konva
//
// Owns one small piece of interactivity despite otherwise being purely
// presentational: the Stage's onClick/onTap clears BOTH the cabinet and
// obstacle selection. Konva events bubble child -> Stage, so clicking a
// cabinet in CabinetLayer or an obstacle in ObstacleLayer (both call
// e.cancelBubble = true after selecting) never reaches here, while
// clicking the room background, the grid, or the padding around the
// room all do — giving a single "click anything unselectable to
// deselect everything" behavior for free.

import type { ReactNode } from 'react';
import { Stage, Layer, Rect, Line, Text } from 'react-konva';
import { computeRoomScale } from '../../lib/canvasScale';
import { useLayoutStore } from '../../store/layoutStore';

export interface RoomCanvasProps {
  widthMm: number;
  depthMm: number;
  gridSpacingMm?: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  children?: ReactNode; // extra <Layer> elements, e.g. <CabinetLayer />
}

const DEFAULTS = {
  gridSpacingMm: 500,
  maxWidthPx: 800,
  maxHeightPx: 600,
};

export function RoomCanvas({
  widthMm,
  depthMm,
  gridSpacingMm = DEFAULTS.gridSpacingMm,
  maxWidthPx = DEFAULTS.maxWidthPx,
  maxHeightPx = DEFAULTS.maxHeightPx,
  children,
}: RoomCanvasProps) {
  const selectCabinet = useLayoutStore((state) => state.selectCabinet);
  const selectObstacle = useLayoutStore((state) => state.selectObstacle);

  const { scale, roomWidthPx, roomHeightPx, originX, originY } = computeRoomScale(
    widthMm,
    depthMm,
    maxWidthPx,
    maxHeightPx
  );

  const verticalLinesMm = rangeSteps(widthMm, gridSpacingMm);
  const horizontalLinesMm = rangeSteps(depthMm, gridSpacingMm);

  return (
    <Stage
      width={maxWidthPx}
      height={maxHeightPx}
      onClick={() => {
        selectCabinet(null);
        selectObstacle(null);
      }}
      onTap={() => {
        selectCabinet(null);
        selectObstacle(null);
      }}
    >
      <Layer>
        {/* Room boundary */}
        <Rect
          x={originX}
          y={originY}
          width={roomWidthPx}
          height={roomHeightPx}
          fill="#fafaf9"
          stroke="#1f2937"
          strokeWidth={2}
        />

        {/* Grid — vertical lines */}
        {verticalLinesMm.map((xMm) => (
          <Line
            key={`v-${xMm}`}
            points={[
              originX + xMm * scale,
              originY,
              originX + xMm * scale,
              originY + roomHeightPx,
            ]}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* Grid — horizontal lines */}
        {horizontalLinesMm.map((yMm) => (
          <Line
            key={`h-${yMm}`}
            points={[
              originX,
              originY + yMm * scale,
              originX + roomWidthPx,
              originY + yMm * scale,
            ]}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* Width dimension (top) */}
        <Line
          points={[originX, originY - 15, originX + roomWidthPx, originY - 15]}
          stroke="#374151"
          strokeWidth={1}
        />
        <Text
          x={originX}
          y={originY - 35}
          width={roomWidthPx}
          align="center"
          text={`${widthMm} mm`}
          fontSize={14}
          fill="#374151"
        />

        {/* Depth dimension (left, rotated) */}
        <Line
          points={[originX - 15, originY, originX - 15, originY + roomHeightPx]}
          stroke="#374151"
          strokeWidth={1}
        />
        <Text
          x={originX - 55}
          y={originY + roomHeightPx / 2}
          width={roomHeightPx}
          offsetX={roomHeightPx / 2}
          align="center"
          text={`${depthMm} mm`}
          fontSize={14}
          fill="#374151"
          rotation={-90}
        />
      </Layer>

      {children}
    </Stage>
  );
}

// Returns [0, step, 2*step, ..., total] — always includes the far edge
// even if it doesn't land on an exact multiple of step.
function rangeSteps(total: number, step: number): number[] {
  const steps: number[] = [];
  for (let v = 0; v <= total; v += step) {
    steps.push(v);
  }
  if (steps[steps.length - 1] !== total) {
    steps.push(total);
  }
  return steps;
}

/*
Usage (grid only, as before):

<RoomCanvas widthMm={3000} depthMm={4000} />

Usage with the cabinet layer composed in:

<RoomCanvas widthMm={3000} depthMm={4000}>
  <CabinetLayer widthMm={3000} depthMm={4000} />
</RoomCanvas>
*/
