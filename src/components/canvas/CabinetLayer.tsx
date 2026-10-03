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

import { useFrontExtraFor, usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { storedPositionFromPhysicalCenter } from '../../lib/physicalDepth';
import { Fragment, useState } from 'react';
import type Konva from 'konva';
import { Layer, Group, Rect, Line, Arc, Text } from 'react-konva';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickAt } from '../../hooks/usePickAt';
import { useSelectedCabinetId } from '../../hooks/useSelection';
import { computeRoomScale } from '../../lib/canvasScale';
import { useCollisions } from '../../hooks/useCollisions';
import { useCabinetClearance } from '../../hooks/useCabinetClearance';
import { detectCollisions } from '../../lib/collision';
import {
  detectCabinetReachConflicts,
  winningReachRow,
  carouselDoorArc,
} from '../../lib/cabinetClearance';
import { touchesFloor } from '../../lib/surfaceAreas';
import { currentFootprintRect } from '../../lib/footprint';
import { defaultFrontLayout } from '../../types/front';
import { rotateCabinet, getFootprint } from '../../lib/cabinetGeometry';
import { snapCabinetFootprint } from '../../lib/cabinetSnapping';
import type { ModuleType } from '../../types/cabinet';

export interface CabinetLayerProps {
  widthMm: number;
  depthMm: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  gridSnapMm?: number; // should match the active RoomLayout.gridSnapMm
  // Hides the width×depth×height text (module type label stays either
  // way, same as ObstacleLayer/ApplianceLayer always show their own
  // type label) — a busy layout with several cabinets in a row gets
  // dense fast. Shared with RemainingSpaceLayer's own toggle in
  // App.tsx: both are the same category of always-on numeric overlay.
  showDimensions?: boolean;
  // Global masters, same session-only shape as showDimensions — OFF
  // means the same thing here it does for a per-item ignoreOverlap/
  // ignoreClearance (lib/collision.ts, lib/cabinetClearance.ts): no
  // red/amber highlight, and for clearance, no zone/arc drawn either,
  // not just an un-highlighted one. Detection itself keeps running
  // either way (collidingCabinetIds/blockedCabinetIds are still
  // correct) — only the display is gated, same as every other
  // "warn, never block" surface in this app. Each individual item's
  // own ignoreOverlap/ignoreClearance still applies underneath this;
  // the global toggle only ever hides MORE, never overrides a mute
  // back into showing something the item itself asked to suppress.
  showOverlapWarnings?: boolean;
  showClearanceWarnings?: boolean;
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
  'drawer-unit': 'rgba(221, 214, 254, 0.65)',
  // Three distinct reds/pinks rather than one shared 'corner-unit'
  // shade — they're genuinely different cabinets now, not variations
  // on a theme.
  'corner-blind': 'rgba(254, 202, 202, 0.65)',
  'corner-magic': 'rgba(253, 164, 175, 0.65)',
  'corner-carousel': 'rgba(252, 165, 165, 0.65)',
  'pantry-unit': 'rgba(94, 234, 212, 0.65)',
};

const COLLISION_OVERLAY_FILL = 'rgba(220, 38, 38, 0.45)'; // red-600 @ 45%
const COLLISION_STROKE = '#dc2626';
const SELECTION_STROKE = '#2563eb'; // blue-600
// amber-600 — same colour ObstacleLayer already uses for "blocks a
// door's swing", so the two "warning, not error" clearance concepts
// read as one visual language rather than two.
const CLEARANCE_STROKE = '#d97706';
const CLEARANCE_ZONE_FILL = 'rgba(217, 119, 6, 0.18)';

// Only the CAROUSEL corner unit gets the diagonal cut — a magic
// corner and a blind corner are both built as a plain rectangular
// carcass with an ordinary door (the mechanism/shelves are inside),
// same as any other cabinet, and need no special shape at all. The
// carousel's rotating lazy-susan tray is what actually wants diagonal
// access. FOOTPRINT stays a plain rotatable square either way —
// collision, magnet-snapping and hit-testing all keep working
// unchanged, since the corner it occupies is real floor space either
// way (this is how the physical unit is actually built too: a big
// square carcass with a diagonal DOOR replacing what would otherwise
// be two perpendicular front faces meeting in a point). Only the
// on-screen SHAPE changes, cutting the local bottom-right corner —
// by convention, the same corner rotationDeg's existing ±90° buttons
// already spin to face whichever wall corner the cabinet actually sits
// in, so no new field is needed.
const CORNER_CAROUSEL_CUT_FRACTION = 0.4;

function cornerCarouselPoints(widthPx: number, depthPx: number): number[] {
  const cutW = widthPx * CORNER_CAROUSEL_CUT_FRACTION;
  const cutD = depthPx * CORNER_CAROUSEL_CUT_FRACTION;
  return [
    0, 0,
    widthPx, 0,
    widthPx, depthPx - cutD,
    widthPx - cutW, depthPx,
    0, depthPx,
  ];
}

// Door swing zones used to be drawn as their own bounding rectangle —
// reported as looking wrong twice over (once for sitting on the wrong
// side, once for floating off the cabinet after that got fixed),
// because a straight-edged box was never going to read as "a door".
// OpeningLayer.tsx already solved exactly this for room doors: keep
// the rectangle for the actual clearance CHECK (cheap, exact, and
// deliberately a bit larger than the true sweep — see
// lib/cabinetClearance.ts), but draw a real quarter-circle arc plus
// the leaf itself for what the eye sees. This mirrors that pattern for
// cabinet doors, including the carousel's diagonal one — the
// rectangle itself is never drawn for a swinging door; a straight
// pull-out (drawers/trolley) has no arc to draw and keeps the
// rectangle, since a rectangle IS the honest shape of a pull-out.
interface DoorArc {
  pivotXPx: number;
  pivotYPx: number;
  radiusPx: number;
  rotationDeg: number;
}

// LOCAL frame (before the Group's own rotation prop reorients it) —
// mirrors OpeningLayer.tsx's swingGeometry exactly, just pivoting off
// the cabinet's own front edge (local y = depthPx) instead of a room
// wall. Both leaves always open toward local +Y (into the room), same
// as a room door's leaf always opens into the room regardless of
// which side it's hinged.
function localDoorArcs(
  kind: 'single-door' | 'double-door',
  hinge: 'left' | 'right' | undefined,
  widthPx: number,
  depthPx: number
): DoorArc[] {
  if (kind === 'single-door') {
    const hingedLeft = hinge !== 'right';
    return [
      {
        pivotXPx: hingedLeft ? 0 : widthPx,
        pivotYPx: depthPx,
        radiusPx: widthPx,
        rotationDeg: hingedLeft ? 0 : 90,
      },
    ];
  }
  return [
    { pivotXPx: 0, pivotYPx: depthPx, radiusPx: widthPx / 2, rotationDeg: 0 },
    { pivotXPx: widthPx, pivotYPx: depthPx, radiusPx: widthPx / 2, rotationDeg: 90 },
  ];
}

// carouselDoorArc (the room-space diagonal-door pivot/radius) now
// lives in lib/cabinetClearance.ts — relocated there so the clearance
// CHECK and this on-screen arc read from the exact same geometry
// instead of two independently-maintained copies of it. Imported
// above.

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
  showDimensions = true,
  showOverlapWarnings = true,
  showClearanceWarnings = true,
}: CabinetLayerProps) {
  // Drawn, snapped and collision-checked as they PHYSICALLY stand (§61);
  // edits go to the STORED cabinet (storedById), and a finished drag is
  // converted back with storedPositionFromPhysicalCenter — otherwise each
  // drag under "carcass only" would creep the cabinet forward.
  const cabinets = usePhysicalCabinets();
  const storedCabinets = useLayoutStore((state) => state.cabinets);
  const storedById = new Map(storedCabinets.map((c) => [c.id, c]));
  const frontExtraFor = useFrontExtraFor();
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

  // Same live-during-drag treatment as collision above, for the
  // softer door/drawer-reach warning (lib/cabinetClearance.ts).
  const { blockedCabinetIds: committedBlockedCabinetIds } = useCabinetClearance();
  const blockedCabinetIds = dragState
    ? detectCabinetReachConflicts(
        cabinets.map((c) =>
          c.id === dragState.cabinetId ? { ...c, x: dragState.xMm, y: dragState.yMm } : c
        ),
        widthMm,
        depthMm
      ).blockedCabinetIds
    : committedBlockedCabinetIds;

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
        // Global masters gate DISPLAY only — collidingCabinetIds/
        // blockedCabinetIds themselves are unaffected, same "detection
        // always runs, only the warning can be hidden" split every
        // per-item ignoreOverlap/ignoreClearance already uses.
        const isColliding = showOverlapWarnings && collidingCabinetIds.has(item.id);
        // A physical overlap is the more urgent problem, so it wins
        // the highlight when both are true for the same cabinet.
        const isClearanceBlocked =
          !isColliding && showClearanceWarnings && blockedCabinetIds.has(item.id);
        const isSelected = item.id === selectedCabinetId;
        const strokeColor = isColliding
          ? COLLISION_STROKE
          : isClearanceBlocked
            ? CLEARANCE_STROKE
            : '#374151';

        // How far this cabinet's door/drawer reaches into the room —
        // see lib/cabinetClearance.ts. Wall-mounted cabinets never get
        // one — a door swinging at ~1450mm up doesn't block the
        // floor-level space this check protects, same reasoning
        // detectCabinetReachConflicts filters them out for. Gated on
        // showClearanceWarnings too: off means no zone/arc drawn at
        // all, not just an un-highlighted one — same as an item that
        // muted itself with ignoreClearance.
        const itemFrontLayout = item.frontLayout ?? defaultFrontLayout(item.moduleType, item.widthMm);
        const onFloor = showClearanceWarnings && touchesFloor(item.elevationMm);

        // Which row governs this cabinet's reach — the same question
        // lib/cabinetClearance.ts's detection asks (winningReachRow),
        // so rendering and detection can't disagree about which row
        // wins for a 'mixed' front. A swinging door — whether the
        // WHOLE front is single-door/double-door, or that's just the
        // winning row inside a 'mixed' front — gets a real arc below;
        // a straight pull-out (drawers/trolley) gets the plain
        // rectangle a pull-out is honestly shaped like. Previously a
        // 'mixed' front always fell back to the rectangle even when
        // its winning row was a door, "kept simple rather than picking
        // a row's hinge to arc" — fixed now that winningReachRow is
        // shared rather than re-derived per file.
        const winningRow =
          onFloor && item.moduleType !== 'corner-carousel'
            ? winningReachRow(item, itemFrontLayout)
            : null;
        const winningRowIsDoor =
          winningRow?.kind === 'single-door' || winningRow?.kind === 'double-door';

        const reachMm = winningRow && !winningRowIsDoor ? winningRow.reachMm : 0;
        const reachPx = reachMm * scale;

        const localArcs =
          winningRow && (winningRow.kind === 'single-door' || winningRow.kind === 'double-door')
            ? localDoorArcs(winningRow.kind, winningRow.hinge, widthPx, depthPx)
            : [];

        // ROOM-SPACE (not local — see carouselDoorArc's own comment):
        // drawn as a sibling of this item's Group rather than a child
        // of it, since it must NOT inherit the Group's rotation.
        const carouselArc =
          item.moduleType === 'corner-carousel' && onFloor
            ? carouselDoorArc(currentFootprintRect(item), item.rotationDeg)
            : null;

        // Effective on-canvas footprint for the CURRENT rotation — used
        // for boundary clamping so a rotated cabinet's true extent is
        // respected, not its unrotated width/depth.
        const { footprintWidthMm, footprintHeightMm } = getFootprint(
          item.widthMm,
          item.depthMm,
          item.rotationDeg
        );

        return (
          <Fragment key={item.id}>
          <Group
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
              const stored = storedById.get(item.id) ?? item;
              updateCabinet(
                item.id,
                storedPositionFromPhysicalCenter(
                  stored,
                  (node.x() - originX) / scale,
                  (node.y() - originY) / scale,
                  frontExtraFor(stored)
                )
              );
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
            onDblClick={() => updateCabinet(item.id, rotateCabinet(storedById.get(item.id) ?? item, 1, widthMm, depthMm))}
            onDblTap={() => updateCabinet(item.id, rotateCabinet(storedById.get(item.id) ?? item, 1, widthMm, depthMm))}
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
            {item.moduleType === 'corner-carousel' ? (
              <>
                <Line
                  points={cornerCarouselPoints(widthPx, depthPx)}
                  closed
                  fill={MODULE_COLORS[item.moduleType]}
                  stroke={strokeColor}
                  strokeWidth={isColliding || isClearanceBlocked ? 2.5 : 1}
                  dash={isColliding || isClearanceBlocked ? [5, 3] : undefined}
                />
                {isColliding && (
                  <Line
                    points={cornerCarouselPoints(widthPx, depthPx)}
                    closed
                    fill={COLLISION_OVERLAY_FILL}
                    listening={false}
                  />
                )}
              </>
            ) : (
              <>
                <Rect
                  x={0}
                  y={0}
                  width={widthPx}
                  height={depthPx}
                  fill={MODULE_COLORS[item.moduleType]}
                  stroke={strokeColor}
                  strokeWidth={isColliding || isClearanceBlocked ? 2.5 : 1}
                  dash={isColliding || isClearanceBlocked ? [5, 3] : undefined}
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
              </>
            )}

            {/* Reach zone for a straight PULL-OUT (drawers/trolley) —
                a rectangle is the honest shape of that, unlike a
                swinging door. Always drawn when it opens into the
                room at all, same "see the arc before it's a problem"
                choice OpeningLayer already makes for a room door's
                swing zone — light and easy to ignore normally,
                switching to the stronger amber the moment it's
                actually crossing another cabinet's own zone or box.
                listening=false so it never steals the cabinet's own
                drag/click target. */}
            {reachPx > 0 && (
              <Rect
                x={0}
                y={depthPx}
                width={widthPx}
                height={reachPx}
                fill={isClearanceBlocked ? CLEARANCE_ZONE_FILL : 'rgba(107, 114, 128, 0.08)'}
                stroke={isClearanceBlocked ? CLEARANCE_STROKE : 'rgba(107, 114, 128, 0.3)'}
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            )}

            {/* A swinging door instead gets a real quarter-circle arc
                plus the leaf itself at 90° open — same treatment
                OpeningLayer.tsx already gives a room door's swing,
                for the same reason: a rectangle never reads as "a
                door". The CHECK still uses the wider rectangle
                internally (lib/cabinetClearance.ts) — this is
                deliberately a bit smaller than that, same "truthful
                for the eye" trade-off. */}
            {localArcs.map((arc, arcIndex) => (
              <Group key={arcIndex} listening={false}>
                <Arc
                  x={arc.pivotXPx}
                  y={arc.pivotYPx}
                  innerRadius={0}
                  outerRadius={arc.radiusPx}
                  angle={90}
                  rotation={arc.rotationDeg}
                  fill={isClearanceBlocked ? CLEARANCE_ZONE_FILL : 'rgba(107, 114, 128, 0.08)'}
                  stroke={isClearanceBlocked ? CLEARANCE_STROKE : 'rgba(107, 114, 128, 0.3)'}
                  strokeWidth={1}
                  dash={[4, 3]}
                />
                <Line
                  points={[arc.pivotXPx, arc.pivotYPx, arc.pivotXPx, arc.pivotYPx + arc.radiusPx]}
                  stroke={isClearanceBlocked ? CLEARANCE_STROKE : 'rgba(107, 114, 128, 0.45)'}
                  strokeWidth={1.5}
                />
              </Group>
            ))}

            {/* Dimensions on their own line, always visible rather than
                on hover/click — Principle 5 in docs/PRINCIPLES.md: a
                designer sitting beside a customer needs to read the
                kitchen off the screen, not go hunting for a number.
                showDimensions=false still shows the module type (same
                as ObstacleLayer/ApplianceLayer always show their own
                type label) — only the width×depth×height line is
                what's cluttering a dense layout. */}
            <Text
              x={0}
              y={0}
              width={widthPx}
              height={depthPx}
              align="center"
              verticalAlign="middle"
              text={
                showDimensions
                  ? `${item.moduleType}\n${item.widthMm}×${item.depthMm}×${item.heightMm}mm`
                  : item.moduleType
              }
              fontSize={9}
              lineHeight={1.3}
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

          {/* Carousel door swing: NOT nested in the Group above — its
              coordinates are already absolute room-space (see
              carouselDoorArc's own comment), so it must not inherit
              that Group's rotation. Same arc-plus-leaf treatment
              every other swinging door gets, just anchored to the
              diagonal edge instead of a straight one. */}
          {carouselArc && (
            <Group listening={false}>
              <Arc
                x={originX + carouselArc.pivotXMm * scale}
                y={originY + carouselArc.pivotYMm * scale}
                innerRadius={0}
                outerRadius={carouselArc.radiusMm * scale}
                angle={90}
                rotation={carouselArc.rotationDeg}
                fill={isClearanceBlocked ? CLEARANCE_ZONE_FILL : 'rgba(107, 114, 128, 0.08)'}
                stroke={isClearanceBlocked ? CLEARANCE_STROKE : 'rgba(107, 114, 128, 0.3)'}
                strokeWidth={1}
                dash={[4, 3]}
              />
              <Line
                points={[
                  originX + carouselArc.pivotXMm * scale,
                  originY + carouselArc.pivotYMm * scale,
                  originX + carouselArc.leafEndXMm * scale,
                  originY + carouselArc.leafEndYMm * scale,
                ]}
                stroke={isClearanceBlocked ? CLEARANCE_STROKE : 'rgba(107, 114, 128, 0.45)'}
                strokeWidth={1.5}
              />
            </Group>
          )}
          </Fragment>
        );
      })}
    </Layer>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2; // cabinet bigger than room — center it rather than invert the range
  return Math.min(Math.max(value, min), max);
}
