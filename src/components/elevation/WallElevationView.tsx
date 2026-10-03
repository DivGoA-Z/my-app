// src/components/elevation/WallElevationView.tsx
//
// A straight-on, outline-only view of one wall — length along the
// bottom, floor-to-ceiling height, everything on that wall drawn as a
// rectangle at its real position and height. Deliberately no 3D, no
// colour, no texture: this exists so a designer can SEE whether
// something collides vertically (a tall unit against a wall cabinet
// mounted too low) rather than infer it from two separate numbers,
// which is exactly what the top-down "remaining space" labels
// (RemainingSpaceLayer.tsx) structurally can't express — they have no
// way to say "this gap is only clear if nothing above it is in the
// way." See computeWallElevationItems in lib/surfaceAreas.ts for the
// geometry.
//
// Click-to-measure rather than always-on labels for everything: a
// small item's own text would either be unreadable at its rendered
// size or overlap its neighbours. Clicking anywhere — an item OR empty
// space — draws a real dimension arrow (width + height) on the
// drawing itself AND reports full numbers (plus depth into the room,
// which has no arrow since this is a 2D front view) in a fixed side
// panel — which is how you check "would a taller cabinet actually
// clear that wall cabinet" without me guessing at a universal rule
// for it. The arrows read off the exact same span the text panel
// does (ClickInfo.span), so the two can't disagree.
//
// This measuring behaviour is deliberately NOT duplicated on the 2D
// plan — it was tried there too and looked cluttered next to the
// cabinet dimension labels and remaining-space gaps already on
// screen, so it lives only here now.
//
// Read-only otherwise, deliberately: this is a reference drawing, not
// a second place to edit a layout from. Click-to-SELECT-and-edit can
// come later if it turns out to be wanted.

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Rect, Text, Line, Arrow } from 'react-konva';
import { Button } from '../ui/button';
import { useLayoutStore } from '../../store/layoutStore';
import { computeRoomScale } from '../../lib/canvasScale';
import { computeWallElevationItems } from '../../lib/surfaceAreas';
import type { WallElevationItem, WallElevationItemKind } from '../../lib/surfaceAreas';
import { OBSTACLE_TYPE_LABELS } from '../../types/layout';
import type { WallOrientation } from '../../types/layout';
import { APPLIANCE_TYPE_LABELS } from '../../types/appliance';
import { OPENING_KIND_LABELS } from '../../types/opening';

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];
const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
};

// Which walls need their along-axis MIRRORED. offsetMm/alongMm is
// always measured the same room-coordinate way (x for north/south, y
// for east/west — see WallOpening.offsetMm's comment), but that's the
// direction you'd see facing the wall from OUTSIDE the room, above it,
// looking down. Standing INSIDE the room facing north or east, that
// direction reads left-to-right, same as the plan. Facing south or
// west is a 180° turn from that, so the same room-coordinate direction
// reads right-to-left — without this flip, those two walls drew as a
// mirror image of what you'd actually see standing in the kitchen.
function isMirrored(orientation: WallOrientation): boolean {
  return orientation === 'south' || orientation === 'west';
}

// One line style per kind rather than colour — "outlines only, no
// colour/texture" was explicit. Cabinets solid, everything else
// distinguished by dash pattern so they're still tellable apart at a
// glance without colour coding.
const ITEM_DASH: Record<WallElevationItemKind, number[] | undefined> = {
  cabinet: undefined,
  appliance: [2, 2],
  obstacle: [6, 3],
  opening: [1, 3],
};

// 'base-cabinet' -> 'Base Cabinet'. Cabinets have no fixed label set
// (module types are open-ended per business catalogue), so this is the
// same humanising fallback used elsewhere (hitTest.ts, FixtureInspector).
function moduleLabel(value: string): string {
  return value
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const OTHER_LABELS: Record<Exclude<WallElevationItemKind, 'cabinet'>, Record<string, string>> = {
  appliance: APPLIANCE_TYPE_LABELS,
  obstacle: OBSTACLE_TYPE_LABELS,
  opening: OPENING_KIND_LABELS,
};

function itemLabel(item: WallElevationItem): string {
  if (item.kind === 'cabinet') return moduleLabel(item.label);
  return OTHER_LABELS[item.kind][item.label] ?? item.label;
}

const MAX_WIDTH_PX = 900;
const MAX_HEIGHT_PX = 500;

const DEFAULT_CEILING_HEIGHT_MM = 2700;

// Same teal RemainingSpaceLayer's gap labels use on the plan — the
// "measurement, not design" family of markings.
const ARROW_COLOR = '#0d9488';
const ARROW_OFFSET_PX = 10;

interface ClickInfo {
  title: string;
  lines: string[];
  // The measured region in real wall-mm, so the arrows can be drawn
  // from the same numbers the text panel reports — never two sources
  // that could disagree.
  span: { alongMm: number; extentMm: number; bottomMm: number; topMm: number };
}

// Everything a click at (alongMm, heightMm) landed on. Checks items
// first; falls back to measuring the empty pocket around the point —
// how far it is to the nearest occupied edge in each direction, using
// only items that actually constrain that direction (their extent on
// the OTHER axis overlaps the click point). Not a true maximal-empty-
// rectangle solve — just "how much room is right here," which is what
// "will a taller cabinet clear that wall unit" actually needs.
function describeClick(
  items: WallElevationItem[],
  wallLengthMm: number,
  wallHeightMm: number,
  alongMm: number,
  heightMm: number
): ClickInfo {
  for (const item of items) {
    if (
      alongMm >= item.alongMm &&
      alongMm <= item.alongMm + item.extentMm &&
      heightMm >= item.bottomMm &&
      heightMm <= item.topMm
    ) {
      const lines = [
        `${Math.round(item.extentMm)}mm wide × ${Math.round(item.topMm - item.bottomMm)}mm high`,
        `${Math.round(item.bottomMm)}mm off the floor`,
      ];
      if (item.depthMm !== undefined) {
        lines.splice(1, 0, `${Math.round(item.depthMm)}mm deep into the room`);
      }
      return {
        title: itemLabel(item),
        lines,
        span: {
          alongMm: item.alongMm,
          extentMm: item.extentMm,
          bottomMm: item.bottomMm,
          topMm: item.topMm,
        },
      };
    }
  }

  let left = 0;
  let right = wallLengthMm;
  let bottom = 0;
  let top = wallHeightMm;

  for (const item of items) {
    const verticalOverlap = heightMm >= item.bottomMm && heightMm <= item.topMm;
    const horizontalOverlap = alongMm >= item.alongMm && alongMm <= item.alongMm + item.extentMm;

    if (verticalOverlap) {
      const itemRight = item.alongMm + item.extentMm;
      if (itemRight <= alongMm) left = Math.max(left, itemRight);
      if (item.alongMm >= alongMm) right = Math.min(right, item.alongMm);
    }
    if (horizontalOverlap) {
      if (item.topMm <= heightMm) bottom = Math.max(bottom, item.topMm);
      if (item.bottomMm >= heightMm) top = Math.min(top, item.bottomMm);
    }
  }

  return {
    title: 'Empty space',
    lines: [
      `${Math.round(right - left)}mm wide × ${Math.round(top - bottom)}mm high`,
      `${Math.round(bottom)}–${Math.round(top)}mm off the floor`,
    ],
    span: { alongMm: left, extentMm: right - left, bottomMm: bottom, topMm: top },
  };
}

// `embedded` (§82): inside the design editor, which supplies the wall
// picker (shared with its 3D wall view), the available width, and no
// "Back to 2D" (Plan is a tab there). Standalone use is unchanged.
export function WallElevationView({
  onClose,
  embedded,
  orientation: controlledOrientation,
  onOrientationChange,
  maxWidthPx,
}: {
  onClose?: () => void;
  embedded?: boolean;
  orientation?: WallOrientation;
  onOrientationChange?: (o: WallOrientation) => void;
  maxWidthPx?: number;
}) {
  const [ownOrientation, setOwnOrientation] = useState<WallOrientation>('north');
  const orientation = controlledOrientation ?? ownOrientation;
  const setOrientation = (o: WallOrientation) => {
    setOwnOrientation(o);
    onOrientationChange?.(o);
  };
  const [clickInfo, setClickInfo] = useState<ClickInfo | null>(null);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const appliances = useLayoutStore((state) => state.appliances);
  const obstacles = useLayoutStore((state) => state.obstacles);

  if (!currentLayout) return null;
  // Embedded: as wide as the editor allows, minus the 224px info panel
  // and its gap beside the drawing.
  const drawingWidthPx = maxWidthPx ? Math.max(360, Math.min(1400, maxWidthPx - 240)) : MAX_WIDTH_PX;

  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = currentLayout.dimensions;
  const wallHeightMm = currentLayout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
  const wallLengthMm = orientation === 'north' || orientation === 'south' ? roomWidthMm : roomDepthMm;
  const mirrored = isMirrored(orientation);

  // Obstacles live in their own store slice, not on currentLayout — see
  // the note at the top of layoutStore.ts — so reassemble before
  // measuring, same as every other layer that needs them.
  const items = computeWallElevationItems(
    orientation,
    { ...currentLayout, obstacles },
    cabinets,
    appliances
  );

  const { scale, originX, originY } = computeRoomScale(
    wallLengthMm,
    wallHeightMm,
    drawingWidthPx,
    MAX_HEIGHT_PX
  );
  const wallWidthPx = wallLengthMm * scale;
  const wallHeightPx = wallHeightMm * scale;

  function goToWall(direction: 1 | -1) {
    const idx = WALL_ORDER.indexOf(orientation);
    setOrientation(WALL_ORDER[(idx + direction + WALL_ORDER.length) % WALL_ORDER.length]);
    setClickInfo(null);
  }

  // Real wall-mm -> screen px, along the wall's run axis. Mirrored
  // walls flip which end is "left" on screen (see isMirrored above);
  // the vertical axis never flips, since up is always up.
  const alongMmToX = (alongMm: number) =>
    originX + (mirrored ? wallLengthMm - alongMm : alongMm) * scale;
  const heightMmToY = (heightMm: number) => originY + (wallHeightMm - heightMm) * scale;

  // Inverse of the two functions above, for turning a click position
  // back into real wall-mm.
  function screenToWallMm(stageX: number, stageY: number): { alongMm: number; heightMm: number } {
    const rawAlong = (stageX - originX) / scale;
    const alongMm = mirrored ? wallLengthMm - rawAlong : rawAlong;
    const heightMm = wallHeightMm - (stageY - originY) / scale;
    return { alongMm, heightMm };
  }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const { alongMm, heightMm } = screenToWallMm(pos.x, pos.y);
    if (alongMm < 0 || alongMm > wallLengthMm || heightMm < 0 || heightMm > wallHeightMm) {
      setClickInfo(null);
      return;
    }
    setClickInfo(describeClick(items, wallLengthMm, wallHeightMm, alongMm, heightMm));
  }

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-8'}>
      {!embedded && (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          ← Back to 2D
        </Button>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => goToWall(-1)} aria-label="Previous wall">
            ‹
          </Button>
          {WALL_ORDER.map((w) => (
            <Button
              key={w}
              variant={w === orientation ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setOrientation(w);
                setClickInfo(null);
              }}
            >
              {WALL_LABELS[w]}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => goToWall(1)} aria-label="Next wall">
            ›
          </Button>
        </div>

        <span className="text-xs text-gray-500">
          {wallLengthMm}mm long × {wallHeightMm}mm high
        </span>
      </div>
      )}

      <p className="text-xs text-gray-500">
        Outline reference only — read-only, no material or colour. Cabinets solid, appliances
        short-dashed, obstacles long-dashed, openings dotted. Click anything — an item or empty
        space — for its exact dimensions.
      </p>

      <div className="flex flex-wrap gap-4">
        <Stage
          width={wallWidthPx + originX * 2}
          height={wallHeightPx + originY * 2}
          onClick={handleStageClick}
          onTap={handleStageClick}
        >
          <Layer>
            {/* The wall itself — its own rect edges double as the
                ceiling and side lines, so only the floor needs a
                second, bolder line to read as the ground rather than
                just the wall's own bottom edge. */}
            <Rect
              x={originX}
              y={originY}
              width={wallWidthPx}
              height={wallHeightPx}
              stroke="#1f2937"
              strokeWidth={2}
            />
            <Line
              points={[
                originX,
                originY + wallHeightPx,
                originX + wallWidthPx,
                originY + wallHeightPx,
              ]}
              stroke="#1f2937"
              strokeWidth={3}
              listening={false}
            />

            {items.map((item) => {
              // Mirrored walls flip which edge is the screen-left one,
              // so the smaller screen-x has to be picked explicitly
              // rather than assumed to be alongMmToX(item.alongMm).
              const xNear = alongMmToX(item.alongMm);
              const xFar = alongMmToX(item.alongMm + item.extentMm);
              return (
                <Rect
                  key={`${item.kind}-${item.id}`}
                  x={Math.min(xNear, xFar)}
                  y={heightMmToY(item.topMm)}
                  width={Math.abs(xFar - xNear)}
                  height={(item.topMm - item.bottomMm) * scale}
                  stroke="#1f2937"
                  strokeWidth={1.25}
                  dash={ITEM_DASH[item.kind]}
                  listening={false}
                />
              );
            })}

            {clickInfo && (
              <>
                {(() => {
                  const { span } = clickInfo;
                  const xNear = alongMmToX(span.alongMm);
                  const xFar = alongMmToX(span.alongMm + span.extentMm);
                  const xLeft = Math.min(xNear, xFar);
                  const xRight = Math.max(xNear, xFar);
                  const yTop = heightMmToY(span.topMm);
                  const yBottom = heightMmToY(span.bottomMm);
                  const midX = (xLeft + xRight) / 2;
                  const midY = (yTop + yBottom) / 2;

                  return (
                    <>
                      {/* Width — a horizontal double-headed arrow just
                          above the measured span's vertical center. */}
                      <Arrow
                        points={[xLeft, midY - ARROW_OFFSET_PX, xRight, midY - ARROW_OFFSET_PX]}
                        pointerAtBeginning
                        pointerAtEnding
                        pointerLength={6}
                        pointerWidth={6}
                        stroke={ARROW_COLOR}
                        fill={ARROW_COLOR}
                        strokeWidth={1.5}
                        listening={false}
                      />
                      <Text
                        x={xLeft}
                        y={midY - ARROW_OFFSET_PX - 16}
                        width={xRight - xLeft}
                        align="center"
                        text={`${Math.round(span.extentMm)}mm`}
                        fontSize={10}
                        fontStyle="bold"
                        fill={ARROW_COLOR}
                        listening={false}
                      />

                      {/* Height — a vertical double-headed arrow just
                          left of the measured span's horizontal
                          center. */}
                      <Arrow
                        points={[midX - ARROW_OFFSET_PX, yTop, midX - ARROW_OFFSET_PX, yBottom]}
                        pointerAtBeginning
                        pointerAtEnding
                        pointerLength={6}
                        pointerWidth={6}
                        stroke={ARROW_COLOR}
                        fill={ARROW_COLOR}
                        strokeWidth={1.5}
                        listening={false}
                      />
                      <Text
                        x={midX - ARROW_OFFSET_PX - 60}
                        y={yTop}
                        width={56}
                        height={yBottom - yTop}
                        align="right"
                        verticalAlign="middle"
                        text={`${Math.round(span.topMm - span.bottomMm)}mm`}
                        fontSize={10}
                        fontStyle="bold"
                        fill={ARROW_COLOR}
                        listening={false}
                      />
                    </>
                  );
                })()}
              </>
            )}
          </Layer>
        </Stage>

        <div className="w-56 shrink-0 rounded-lg border border-gray-200 bg-white p-3 text-xs">
          {clickInfo ? (
            <>
              <h4 className="mb-1 font-semibold text-gray-700">{clickInfo.title}</h4>
              <div className="flex flex-col gap-0.5 text-gray-600">
                {clickInfo.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            </>
          ) : (
            <span className="text-gray-400">
              Click anything on the drawing — an item or empty space — to see its dimensions.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
