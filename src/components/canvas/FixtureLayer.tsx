// src/components/canvas/FixtureLayer.tsx
//
// Shows placed light fixtures on the floor plan.
//
// Deliberately NOT draggable, unlike every other layer here — and that
// is the point of the mount model rather than a missing feature. Most
// fixtures have no independent position to drag: an under-cabinet strip
// is wherever its cabinet is, a wall light is at a distance along a
// named wall. Letting you drag one would either silently detach it from
// its host or quietly do nothing.
//
// So the plan is a READOUT here: it shows where each fixture ends up,
// tinted by its actual colour temperature, and re-mounting happens in
// the inspector where the host can be named. Ceiling and free mounts do
// have real x/y, and those are draggable.

import type Konva from 'konva';
import { Layer, Group, Circle, Line, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedFixtureId } from '../../hooks/useSelection';
import { computeRoomScale } from '../../lib/canvasScale';
import { resolveAllFixtures, selectRealLights, maxLightsFor } from '../../lib/fixtures';
import { useLightQuality } from '../../hooks/useLightQuality';
import { isLinear, isVisibleWhenClosed } from '../../types/fixture';
import { kelvinToColor } from '../../lib/lighting3d';

export interface FixtureLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number;
}

const SELECTION_STROKE = '#2563eb';
const ORPHAN_STROKE = '#d97706';
const MARKER_RADIUS_PX = 7;

// Grab tolerance for a run. Wide enough to hit comfortably on a
// trackpad or a touchscreen, narrow enough not to swallow clicks meant
// for the cabinet underneath.
const RUN_HIT_WIDTH_PX = 14;

export function FixtureLayer({
  widthMm,
  depthMm,
  maxWidthPx = 800,
  maxHeightPx = 600,
  gridSnapMm = 50,
}: FixtureLayerProps) {
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const updateFixture = useLayoutStore((s) => s.updateFixture);
  const pickAt = usePickAt();
  const selectedFixtureId = useSelectedFixtureId();
  const [quality] = useLightQuality();

  const { scale, originX, originY } = computeRoomScale(widthMm, depthMm, maxWidthPx, maxHeightPx);

  if (!currentLayout) return null;

  const placements = resolveAllFixtures(currentLayout, cabinets, fixtureCatalog);
  if (placements.length === 0) return null;

  const { lit } = selectRealLights(placements, maxLightsFor(quality));
  const litIds = new Set(lit.map((p) => p.fixture.id));

  return (
    <Layer>
      {placements.map((p) => {
        // An in-drawer light has no visual anywhere, including here —
        // showing a marker on the plan for something invisible in 3D
        // would just raise the question twice.
        if (!isVisibleWhenClosed(p.item.kind)) return null;

        const isSelected = p.fixture.id === selectedFixtureId;
        const colour = kelvinToColor(p.item.colorTempK);
        const cx = originX + p.xMm * scale;
        const cy = originY + p.yMm * scale;
        // Only these two mounts have an x/y of their own to move.
        const draggable = p.fixture.mount.kind === 'ceiling' || p.fixture.mount.kind === 'free';

        return (
          <Group
            key={p.fixture.id}
            x={cx}
            y={cy}
            draggable={draggable}
            dragBoundFunc={(pos) => {
              // Clamp so the whole RUN stays inside the room, not just
              // its centre point — a 3m strip centred 400mm from a wall
              // used to hang straight through it.
              const halfRunPx = isLinear(p.item.kind)
                ? ((p.runLengthMm / 2) * scale)
                : 0;
              const halfX = p.runAxis === 'x' ? halfRunPx : 0;
              const halfY = p.runAxis === 'y' ? halfRunPx : 0;
              return {
                x: clamp(pos.x, originX + halfX, originX + widthMm * scale - halfX),
                y: clamp(pos.y, originY + halfY, originY + depthMm * scale - halfY),
              };
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const xMm = snap(clamp((node.x() - originX) / scale, 0, widthMm), gridSnapMm);
              const yMm = snap(clamp((node.y() - originY) / scale, 0, depthMm), gridSnapMm);
              const mount = p.fixture.mount;
              if (mount.kind === 'ceiling' || mount.kind === 'free') {
                updateFixture(p.fixture.id, { mount: { ...mount, x: xMm, y: yMm } });
              }
              node.x(originX + xMm * scale);
              node.y(originY + yMm * scale);
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
            {/* A linear fixture is drawn as its actual RUN, not a dot —
                the length is the thing being priced, so seeing 2.4m of
                strip as 2.4m of line is the useful readout.

                hitStrokeWidth makes the whole BAR grabbable. Without
                it, Konva's hit region for a 4px line is 4px wide, so
                the only way to select or drag a 2.4m strip was the
                small circle at its centre — which felt like the strip
                wasn't interactive at all. */}
            {isLinear(p.item.kind) && p.runAxis !== 'vertical' && (
              <Line
                points={
                  p.runAxis === 'x'
                    ? [(-p.runLengthMm / 2) * scale, 0, (p.runLengthMm / 2) * scale, 0]
                    : [0, (-p.runLengthMm / 2) * scale, 0, (p.runLengthMm / 2) * scale]
                }
                stroke={colour}
                strokeWidth={4}
                hitStrokeWidth={RUN_HIT_WIDTH_PX}
                opacity={p.fixture.enabled ? 0.95 : 0.35}
                lineCap="round"
                shadowColor={colour}
                shadowBlur={p.fixture.enabled ? 8 : 0}
              />
            )}

            <Circle
              radius={MARKER_RADIUS_PX}
              fill={colour}
              opacity={p.fixture.enabled ? 1 : 0.35}
              stroke={
                p.hostMissing
                  ? ORPHAN_STROKE
                  : isSelected
                    ? SELECTION_STROKE
                    : 'rgba(71, 85, 105, 0.7)'
              }
              strokeWidth={p.hostMissing || isSelected ? 2.5 : 1}
              // A ring on the fixtures that actually light the room, so
              // the real-light budget is visible rather than mysterious.
              dash={litIds.has(p.fixture.id) ? undefined : [3, 2]}
            />

            {/* Height, because two fixtures at the same x/y but
                different heights (a ceiling spot over an under-cabinet
                strip) are otherwise indistinguishable in plan. */}
            <Text
              x={MARKER_RADIUS_PX + 3}
              y={-4}
              text={`${Math.round(p.zMm)}`}
              fontSize={8}
              fill="#64748b"
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

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}
