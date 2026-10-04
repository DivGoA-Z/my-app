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
// §92 revisited both choices above after real use: a wall of identical
// outlines with every number behind a click did not work for its one
// job, checking sizes and the space between items. Now the numbers sit
// OUTSIDE the drawing as running dimension chains (lib/elevationDims.ts),
// which is how architectural elevations avoid the clutter argued above:
// base run along the bottom, wall-unit run along the top, key heights on
// the left, overall length, gaps in amber; a size too wide for its span
// steps out to a second row. Items get a light fill by kind and their
// name and width inside when they fit. Click-to-measure stays, for the
// pockets the chains don't cover.
//
// Read-only otherwise, deliberately: this is a reference drawing, not
// a second place to edit a layout from. Click-to-SELECT-and-edit can
// come later if it turns out to be wanted.

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { Fragment, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Rect, Text, Line, Arrow } from 'react-konva';
import { Button } from '../ui/button';
import { useLayoutStore } from '../../store/layoutStore';
import { BASE_BAND, WALL_BAND, bandChain, heightLevels, type ChainSegment } from '../../lib/elevationDims';
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

// Space around the wall for the dimension chains (§92).
const MARGIN = { left: 92, right: 28, top: 70, bottom: 104 };

// Light fills by kind (§92). The drawing began outline-only on the
// argument that colour isn't needed to read structure; in use, a dense
// wall of identical outlines didn't read at all. Cabinets warm, appliances
// cool, pillars hatched grey, openings left white.
const ITEM_FILL: Record<WallElevationItemKind, string> = {
  cabinet: '#f1ebe1',
  appliance: '#e2e8ee',
  obstacle: '#dcd8d0',
  opening: '#ffffff',
};
const INK = '#2f2d29';
const GAP_INK = '#b45309';
const DIM_INK = '#57534b';

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
  maxHeightPx,
}: {
  onClose?: () => void;
  embedded?: boolean;
  orientation?: WallOrientation;
  onOrientationChange?: (o: WallOrientation) => void;
  maxWidthPx?: number;
  maxHeightPx?: number;
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
  // Embedded: the whole width the editor gives (the click panel sits
  // under the drawing since §92), and the height left after the legend
  // and that panel.
  const drawingWidthPx = maxWidthPx ? Math.max(360, Math.min(1600, maxWidthPx)) : MAX_WIDTH_PX;
  const drawingHeightPx = maxHeightPx ? Math.max(340, maxHeightPx - 100) : MAX_HEIGHT_PX;

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

  // Own margins rather than computeRoomScale's even padding: the
  // dimension chains (§92) need room below (base run + overall length),
  // above (wall-unit run) and left (heights).
  const scale = Math.min(
    (drawingWidthPx - MARGIN.left - MARGIN.right) / wallLengthMm,
    (drawingHeightPx - MARGIN.top - MARGIN.bottom) / wallHeightMm
  );
  const originX = MARGIN.left + Math.max(0, (drawingWidthPx - MARGIN.left - MARGIN.right - wallLengthMm * scale) / 2);
  const originY = MARGIN.top;
  const baseChain = bandChain(items, wallLengthMm, BASE_BAND);
  const wallChain = bandChain(items, wallLengthMm, WALL_BAND);
  const levels = heightLevels(items, wallHeightMm);
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

      <p className="text-[13px] text-muted-foreground">
        Running sizes: base level along the bottom, wall units along the top, heights on the left,{' '}
        <span className="font-semibold text-[#b45309]">gaps in amber</span>. Tap anything, an item or empty space, for its exact size.
      </p>

      <div className="flex flex-col gap-3">
        <Stage
          width={drawingWidthPx}
          height={wallHeightPx + MARGIN.top + MARGIN.bottom}
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

            {/* Openings first so units drawn over a window still read. */}
            {[...items].sort((a, b) => (a.kind === 'opening' ? -1 : 0) - (b.kind === 'opening' ? -1 : 0)).map((item) => {
              // Mirrored walls flip which edge is the screen-left one,
              // so the smaller screen-x has to be picked explicitly
              // rather than assumed to be alongMmToX(item.alongMm).
              const xNear = alongMmToX(item.alongMm);
              const xFar = alongMmToX(item.alongMm + item.extentMm);
              const x = Math.min(xNear, xFar);
              const w = Math.abs(xFar - xNear);
              const y = heightMmToY(item.topMm);
              const h = (item.topMm - item.bottomMm) * scale;
              // Name and width inside the box when they fit; the chains
              // carry the numbers either way.
              const fits = w >= 44 && h >= 30;
              return (
                <Fragment key={`${item.kind}-${item.id}`}>
                  <Rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={ITEM_FILL[item.kind]}
                    stroke={INK}
                    strokeWidth={1.1}
                    dash={ITEM_DASH[item.kind]}
                    listening={false}
                  />
                  {fits && (
                    <Text
                      x={x + 3}
                      y={y + 3}
                      width={w - 6}
                      height={h - 6}
                      align="center"
                      verticalAlign="middle"
                      text={`${itemLabel(item)}\n${Math.round(item.extentMm)}`}
                      fontSize={11}
                      lineHeight={1.25}
                      fill={DIM_INK}
                      ellipsis
                      listening={false}
                    />
                  )}
                </Fragment>
              );
            })}

            {/* ---- Running dimensions (§92) ---- */}
            <DimChain segments={wallChain} y={originY - 26} toX={alongMmToX} outward={-1} />
            <DimChain segments={baseChain} y={originY + wallHeightPx + 24} toX={alongMmToX} />
            <DimChain
              segments={[{ startMm: 0, endMm: wallLengthMm, kind: 'item' }]}
              y={originY + wallHeightPx + 74}
              toX={alongMmToX}
              bold
            />
            <HeightChain levels={levels} x={originX - 26} toY={heightMmToY} />

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

        <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
          {clickInfo ? (
            <>
              <span className="font-semibold">{clickInfo.title}</span>
              {clickInfo.lines.map((line) => (
                <span key={line} className="text-muted-foreground">
                  {line}
                </span>
              ))}
            </>
          ) : (
            <span className="text-muted-foreground">Tap an item or an empty space on the drawing to see its exact size.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// A run of dimensions along the wall at one height: tick at every
// boundary, the size centred over each span, gaps in amber (§92). A size
// too wide for its span (a 150mm filler) moves out to a second row with
// a short leader, rather than disappearing — that filler is exactly the
// number someone checking the wall needs.
function DimChain({
  segments,
  y,
  toX,
  bold,
  outward = 1,
}: {
  segments: ChainSegment[];
  y: number;
  toX: (alongMm: number) => number;
  bold?: boolean;
  // Which side a squeezed label moves to: 1 below the line, -1 above.
  outward?: 1 | -1;
}) {
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) => {
        const a = toX(seg.startMm);
        const b = toX(seg.endMm);
        const x0 = Math.min(a, b);
        const x1 = Math.max(a, b);
        const color = seg.kind === 'gap' ? GAP_INK : DIM_INK;
        const text = `${Math.round(seg.endMm - seg.startMm)}`;
        const fits = x1 - x0 >= text.length * 6.5 + 6;
        return (
          <Fragment key={i}>
            <Line points={[x0, y, x1, y]} stroke={color} strokeWidth={bold ? 1.4 : 1} listening={false} />
            <Line points={[x0, y - 5, x0, y + 5]} stroke={DIM_INK} strokeWidth={1} listening={false} />
            <Line points={[x1, y - 5, x1, y + 5]} stroke={DIM_INK} strokeWidth={1} listening={false} />
            {fits ? (
              <Text
                x={x0}
                y={y - 15}
                width={x1 - x0}
                align="center"
                text={text}
                fontSize={11}
                fontStyle={bold || seg.kind === 'gap' ? 'bold' : 'normal'}
                fill={color}
                listening={false}
              />
            ) : (
              <>
                <Line points={[(x0 + x1) / 2, y, (x0 + x1) / 2, y + outward * 14]} stroke={color} strokeWidth={0.8} listening={false} />
                <Text
                  x={(x0 + x1) / 2 - 24}
                  y={outward > 0 ? y + 15 : y - 30}
                  width={48}
                  align="center"
                  text={text}
                  fontSize={11}
                  fontStyle={seg.kind === 'gap' ? 'bold' : 'normal'}
                  fill={color}
                  listening={false}
                />
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// Key heights up the left side: each step's size, plus the level
// itself at each tick (floor 0, worktop 850, …).
function HeightChain({ levels, x, toY }: { levels: number[]; x: number; toY: (heightMm: number) => number }) {
  return (
    <>
      {levels.slice(1).map((top, i) => {
        const bottom = levels[i];
        const yTop = toY(top);
        const yBottom = toY(bottom);
        const fits = yBottom - yTop >= 16;
        return (
          <Fragment key={top}>
            <Line points={[x, yTop, x, yBottom]} stroke={DIM_INK} strokeWidth={1} listening={false} />
            {fits && (
              <Text
                x={x - 46}
                y={yTop}
                width={40}
                height={yBottom - yTop}
                align="right"
                verticalAlign="middle"
                text={`${top - bottom}`}
                fontSize={11}
                fill={DIM_INK}
                listening={false}
              />
            )}
          </Fragment>
        );
      })}
      {levels.map((level) => (
        <Line key={`t${level}`} points={[x - 5, toY(level), x + 5, toY(level)]} stroke={DIM_INK} strokeWidth={1} listening={false} />
      ))}
    </>
  );
}
