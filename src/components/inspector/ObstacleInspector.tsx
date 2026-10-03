// src/components/inspector/ObstacleInspector.tsx
//
// Contextual editing panel for whichever obstacle is currently
// selected — the obstacle counterpart to CabinetInspector. Click an
// obstacle on the canvas to select it (ObstacleLayer's Group onClick);
// click anywhere else to deselect (RoomCanvas's Stage onClick). Renders
// nothing when selectedObstacleId is null OR when a cabinet is selected
// instead (the two selections are mutually exclusive — see
// layoutStore.ts — and CabinetInspector's own placeholder covers the
// "nothing at all selected" case, so this only needs to render when it
// specifically has something to show).
//
// Deliberately NOT like CabinetInspector in scope: no material/finish
// (obstacles don't have them) and no duplicate button — just rotation,
// exact position (dragging only grid-snaps, so this is the only way to
// land exactly flush against a neighbor whose edge isn't a multiple of
// the grid step), dimensions, height, elevation (how far off the floor
// it starts — same idea as a wall cabinet), and floor-to-ceiling toggle
// the user asked for, plus delete. Every edit goes through the same
// updateObstacle/removeObstacle store actions ObstacleLayer/
// ObstacleToolbar already use, so collision detection and the 3D
// preview pick up a move, resize, or turn immediately.

import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useSelectedObstacleId } from '../../hooks/useSelection';
import { OBSTACLE_TYPE_LABELS } from '../../types/layout';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from '../../lib/collision';
import { rotateFootprint } from '../../lib/footprint';

const inputClass = 'w-20 shrink-0 rounded-[10px] border border-input px-2 py-1 text-xs';

// Same fallback as CabinetInspector, for the same reason — a sane room
// size to clamp a rotated footprint against before any layout has
// loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

export function ObstacleInspector() {
  const selectedObstacleId = useSelectedObstacleId();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const updateObstacle = useLayoutStore((state) => state.updateObstacle);
  const removeObstacle = useLayoutStore((state) => state.removeObstacle);
  const selectObstacle = useLayoutStore((state) => state.selectObstacle);

  const found = obstacles.find((o) => o.id === selectedObstacleId);

  if (!found) {
    return null;
  }

  // Narrowing an early-returned `const` doesn't survive into a nested
  // function declaration defined further down the same body — same
  // gotcha documented in lib/fixtures.ts's defaultDrawerLightQuantity.
  // Re-binding it here is what lets handleRotate below use it without
  // TypeScript re-widening it back to `Obstacle | undefined`.
  const obstacle = found;

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  function handleRotate(direction: 1 | -1) {
    updateObstacle(obstacle.id, rotateFootprint(obstacle, direction, roomWidthMm, roomDepthMm));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[19px] font-semibold leading-tight">{OBSTACLE_TYPE_LABELS[obstacle.type]}</h3>
        <Button variant="ghost" size="icon-sm" onClick={() => selectObstacle(null)} aria-label="Deselect">
          ×
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Rotation: {obstacle.rotationDeg}°</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-auto min-h-10 flex-1 py-1 whitespace-normal" onClick={() => handleRotate(-1)}>
            −90°
          </Button>
          <Button variant="outline" size="sm" className="h-auto min-h-10 flex-1 py-1 whitespace-normal" onClick={() => handleRotate(1)}>
            +90°
          </Button>
        </div>
      </div>

      {/* Dragging only grid-snaps to gridSnapMm (50mm by default), so an
          obstacle can't be dragged flush against a neighbor whose edge
          sits at a non-multiple of the grid — e.g. a cabinet ending at
          305mm. The nearest reachable drag position (300 or 350) then
          either genuinely overlaps the cabinet by a few mm or leaves a
          gap, and the overlap warning that follows is correct given
          where the obstacle actually is — it just couldn't be dragged
          to where it was meant to be. Typing the exact position here
          bypasses grid-snap entirely, same as every other numeric field
          on this panel. */}
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          X (mm)
          <input
            type="number"
            value={obstacle.x}
            onChange={(e) => updateObstacle(obstacle.id, { x: Number(e.target.value) })}
            className="w-full rounded-[10px] border border-input px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Y (mm)
          <input
            type="number"
            value={obstacle.y}
            onChange={(e) => updateObstacle(obstacle.id, { y: Number(e.target.value) })}
            className="w-full rounded-[10px] border border-input px-2 py-1 text-xs"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Width (mm)</span>
        <input
          type="number"
          min={50}
          value={obstacle.widthMm}
          onChange={(e) => updateObstacle(obstacle.id, { widthMm: Number(e.target.value) })}
          className={inputClass}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Depth (mm)</span>
        <input
          type="number"
          min={50}
          value={obstacle.depthMm}
          onChange={(e) => updateObstacle(obstacle.id, { depthMm: Number(e.target.value) })}
          className={inputClass}
        />
      </div>

      <Label className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
        <span>
          Floor to ceiling
          <br />
          <span className="text-xs text-muted-foreground">blocks every height, like a structural column</span>
        </span>
        <Checkbox
          checked={obstacle.floorToCeiling ?? false}
          onCheckedChange={(checked) => {
            const floorToCeiling = checked === true;
            // Give height a sane starting value the first time this
            // becomes a partial-height obstacle, rather than leaving
            // whatever stale number was there (or 0) — mirrors
            // getDefaultElevationMm's role for cabinets. Turning
            // floor-to-ceiling BACK on resets elevation to 0 — a
            // floor-to-ceiling obstacle always starts at the floor by
            // definition, so a leftover mid-wall elevation would be
            // silently ignored (see getObstacleBounds) otherwise,
            // which is more confusing than just resetting it.
            updateObstacle(obstacle.id, {
              floorToCeiling,
              heightMm: floorToCeiling ? obstacle.heightMm : (obstacle.heightMm ?? PARTIAL_OBSTACLE_HEIGHT_MM),
              elevationMm: floorToCeiling ? 0 : obstacle.elevationMm,
            });
          }}
        />
      </Label>

      {!obstacle.floorToCeiling && (
        <>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Height (mm)</span>
            <input
              type="number"
              min={50}
              value={obstacle.heightMm}
              onChange={(e) => updateObstacle(obstacle.id, { heightMm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Height off floor (mm)
              <br />
              <span className="text-xs text-muted-foreground">
                0 = touches the floor; e.g. a mid-wall electrical fixture doesn't
              </span>
            </span>
            <input
              type="number"
              min={0}
              value={obstacle.elevationMm}
              onChange={(e) => updateObstacle(obstacle.id, { elevationMm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
        </>
      )}

      <Label className="flex items-start gap-2 text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={obstacle.ignoreOverlap ?? false}
          onCheckedChange={(checked) =>
            updateObstacle(obstacle.id, { ignoreOverlap: checked === true })
          }
          className="mt-0.5"
        />
        <span>
          Ignore overlap alerts for this item
          <br />
          <span className="text-xs text-muted-foreground">
            e.g. a chimney duct that's meant to run through this obstacle
          </span>
        </span>
      </Label>

      <div className="flex border-t border-border pt-3">
        <Button variant="destructive" size="sm" className="flex-1" onClick={() => removeObstacle(obstacle.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
