// src/components/canvas/RemainingSpaceLayer.tsx
//
// Shows the leftover space along each wall, in TWO independent bands:
//
//   floor  gaps between floor-touching cabinets/obstacles (the
//          original behaviour) — teal labels, hugging the wall line.
//   wall   gaps between WALL-MOUNTED cabinets — amber labels, offset a
//          little further into the room so the two can never overlap
//          on screen. Only drawn for a wall that actually has at least
//          one wall cabinet on it, so a bare wall doesn't grow a
//          redundant "wall band fully open" label nobody asked for.
//
// The two used to be conflated: a wall cabinet drawn in this same
// top-down view sits at the same x/y as whatever is (or isn't) on the
// floor below it, so a single set of labels could only ever describe
// one of the two runs — and it was silently always the floor one, even
// when the label visually sat right next to a wall cabinet. That's
// what caused "the plan says 18mm, the wall elevation says 7mm for the
// same cabinet" — two different, both-correct numbers for two
// different bands. See the 'wall'-band doc comment on computeWallGaps
// in lib/surfaceAreas.ts for the full account.
//
// Read-only: nothing here is selectable or draggable, it's a
// live-computed readout, same spirit as the dimension labels
// CabinetLayer shows (Principle 5 in docs/PRINCIPLES.md — visible by
// default, not behind a click). Both can get dense on a busy layout,
// so `visible` (passed down from App.tsx) hides this whole layer
// without touching the underlying data.
//
// Deliberately NOT a general "empty space anywhere in the room" solver
// — it only measures along the four walls, where kitchen cabinets
// actually get placed.

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { Layer, Group, Rect, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { computeRoomScale } from '../../lib/canvasScale';
import { computeWallGaps } from '../../lib/surfaceAreas';
import type { WallGap } from '../../lib/surfaceAreas';

export interface RemainingSpaceLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  // Hides the whole layer without discarding anything — App.tsx wires
  // this to a single "Show dimensions" toggle shared with CabinetLayer,
  // since both are the same category of always-on numeric overlay that
  // gets cluttered on a busy layout.
  visible?: boolean;
}

// How far inside the room a gap's label sits, off the wall line —
// enough to read clearly without crowding whatever it's between.
const LABEL_INSET_PX = 16;
// Wall-band labels sit further in, so they never overlap a floor-band
// label that happens to fall at the same position along the wall.
const WALL_BAND_INSET_PX = 34;
const LABEL_WIDTH_PX = 60;
const LABEL_HEIGHT_PX = 16;

// teal (floor) — distinct from the amber clearance warning, the red
// collision highlight, and the blue selection outline already used on
// this canvas. Wall-band labels reuse amber deliberately: it's already
// "a second thing to pay attention to" in this app's palette, and the
// two bands are exactly that relative to each other.
const BAND_COLORS: Record<WallGap['band'], string> = {
  floor: '#0d9488',
  wall: '#b45309',
};
const LABEL_BG_FILL = 'rgba(255, 255, 255, 0.85)';

export function RemainingSpaceLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  visible = true,
}: RemainingSpaceLayerProps) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const obstacles = useLayoutStore((state) => state.obstacles);

  const { scale, originX, originY } = computeRoomScale(widthMm, depthMm, maxWidthPx, maxHeightPx);

  if (!currentLayout || !visible) return null;

  // Obstacles live in their own store slice, not on currentLayout — see
  // the note at the top of layoutStore.ts — so reassemble before
  // measuring, same as RoomSurfacesPanel/ObstacleLayer already do.
  const layoutWithObstacles = { ...currentLayout, obstacles };
  const floorGaps = computeWallGaps(layoutWithObstacles, cabinets, 'floor');

  // Only draw the wall band where it says something real. A wall with
  // no wall-mounted cabinet against it comes back as one gap spanning
  // the entire wall (nothing was there to subtract) — true, but a
  // redundant "fully open" label nobody asked for, so it's dropped
  // rather than rendered.
  const wallLengthFor = (orientation: WallGap['orientation']) =>
    orientation === 'north' || orientation === 'south' ? widthMm : depthMm;
  const wallGaps = computeWallGaps(layoutWithObstacles, cabinets, 'wall').filter(
    (g) => !(g.startMm === 0 && g.lengthMm === wallLengthFor(g.orientation))
  );

  const gaps: WallGap[] = [...floorGaps, ...wallGaps];

  return (
    <Layer listening={false}>
      {gaps.map((gap) => {
        const centerAlongMm = gap.startMm + gap.lengthMm / 2;
        const isHorizontalWall = gap.orientation === 'north' || gap.orientation === 'south';
        const inset = gap.band === 'wall' ? WALL_BAND_INSET_PX : LABEL_INSET_PX;
        const color = BAND_COLORS[gap.band];

        // Center point of the label: along the wall for the axis that
        // varies with the gap, pinned just inside the room for the
        // axis that's fixed by which wall this is.
        const centerXPx = isHorizontalWall
          ? originX + centerAlongMm * scale
          : gap.orientation === 'west'
            ? originX + inset
            : originX + widthMm * scale - inset;
        const centerYPx = isHorizontalWall
          ? gap.orientation === 'north'
            ? originY + inset
            : originY + depthMm * scale - inset
          : originY + centerAlongMm * scale;

        return (
          <Group
            key={`${gap.band}-${gap.orientation}-${gap.startMm}`}
            x={centerXPx - LABEL_WIDTH_PX / 2}
            y={centerYPx - LABEL_HEIGHT_PX / 2}
          >
            <Rect
              width={LABEL_WIDTH_PX}
              height={LABEL_HEIGHT_PX}
              fill={LABEL_BG_FILL}
              stroke={color}
              strokeWidth={1}
              dash={[3, 2]}
              cornerRadius={3}
            />
            <Text
              width={LABEL_WIDTH_PX}
              height={LABEL_HEIGHT_PX}
              align="center"
              verticalAlign="middle"
              text={`${Math.round(gap.lengthMm)}mm${gap.band === 'wall' ? ' (wall)' : ''}`}
              fontSize={9}
              fontStyle="bold"
              fill={color}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
