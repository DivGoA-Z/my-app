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
// (obstacles don't have them) and no duplicate button — just the
// dimensions, height, elevation (how far off the floor it starts —
// same idea as a wall cabinet), and floor-to-ceiling toggle the user
// asked for, plus delete. Every edit goes through the same
// updateObstacle/removeObstacle store actions ObstacleLayer/
// ObstacleToolbar already use, so collision detection and the 3D
// preview pick up a resize immediately.

import { useLayoutStore } from '../../store/layoutStore';
import { useSelectedObstacleId } from '../../hooks/useSelection';
import { OBSTACLE_TYPE_LABELS } from '../../types/layout';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from '../../lib/collision';

const inputClass = 'w-20 shrink-0 rounded border border-gray-300 px-2 py-1 text-xs';

export function ObstacleInspector() {
  const selectedObstacleId = useSelectedObstacleId();
  const obstacles = useLayoutStore((state) => state.obstacles);
  const updateObstacle = useLayoutStore((state) => state.updateObstacle);
  const removeObstacle = useLayoutStore((state) => state.removeObstacle);
  const selectObstacle = useLayoutStore((state) => state.selectObstacle);

  const obstacle = obstacles.find((o) => o.id === selectedObstacleId);

  if (!obstacle) {
    return null;
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{OBSTACLE_TYPE_LABELS[obstacle.type]}</h3>
        <button
          onClick={() => selectObstacle(null)}
          aria-label="Deselect"
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
        <span>Width (mm)</span>
        <input
          type="number"
          min={50}
          value={obstacle.widthMm}
          onChange={(e) => updateObstacle(obstacle.id, { widthMm: Number(e.target.value) })}
          className={inputClass}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
        <span>Depth (mm)</span>
        <input
          type="number"
          min={50}
          value={obstacle.depthMm}
          onChange={(e) => updateObstacle(obstacle.id, { depthMm: Number(e.target.value) })}
          className={inputClass}
        />
      </div>

      <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
        <span>
          Floor to ceiling
          <br />
          <span className="text-[10px] text-gray-400">blocks every height, like a structural column</span>
        </span>
        <input
          type="checkbox"
          checked={obstacle.floorToCeiling ?? false}
          onChange={(e) => {
            const floorToCeiling = e.target.checked;
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
      </label>

      {!obstacle.floorToCeiling && (
        <>
          <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span>Height (mm)</span>
            <input
              type="number"
              min={50}
              value={obstacle.heightMm}
              onChange={(e) => updateObstacle(obstacle.id, { heightMm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span>
              Height off floor (mm)
              <br />
              <span className="text-[10px] text-gray-400">
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

      <div className="flex border-t border-gray-200 pt-3">
        <button
          onClick={() => removeObstacle(obstacle.id)}
          className="flex-1 rounded border border-red-300 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
