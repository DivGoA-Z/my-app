// src/components/toolbar/RoomSurfacesPanel.tsx
//
// Assigns finishes to the room's own surfaces — floor, ceiling, and each
// of the four walls — from the same catalogue cabinets draw from.
//
// Each surface takes TWO finishes:
//   Exposed    what you see. Charged at that finish's rate.
//   Concealed  what goes behind the cabinets. Cheaper material, charged
//              at its own rate, and left unset means that area isn't
//              charged at all (also common — plenty of jobs don't tile
//              behind units).
//
// The live area figures next to each surface come from
// lib/surfaceAreas.ts, and the third number is the one worth reading:
// area OCCUPIED by structure. A pillar isn't concealed wall, it's
// missing wall — there's nothing behind it to finish — so it's excluded
// from both rates rather than billed at the cheap one.

import { useLayoutStore } from '../../store/layoutStore';
import { computeRoomSurfaceAreas } from '../../lib/surfaceAreas';
import type { SurfaceAreaBreakdown } from '../../lib/surfaceAreas';
import type { WallOrientation } from '../../types/layout';

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];

const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
};

const selectClass = 'w-full rounded border border-gray-300 px-2 py-1 text-xs';

export function RoomSurfacesPanel() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const appliances = useLayoutStore((state) => state.appliances);
  const obstacles = useLayoutStore((state) => state.obstacles);
  const updateRoomSurfaces = useLayoutStore((state) => state.updateRoomSurfaces);
  const updateWallFinish = useLayoutStore((state) => state.updateWallFinish);

  if (!currentLayout) return null;

  // obstacles live in their own store slice, not on currentLayout (see
  // the note at the top of layoutStore) — so reassemble before
  // measuring, or pillars wouldn't be excluded.
  const areas = computeRoomSurfaceAreas({ ...currentLayout, obstacles }, cabinets, appliances);

  return (
    <div className="flex w-64 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Room Surfaces</h3>
        <p className="text-[11px] text-gray-500">
          Floor, ceiling and each wall, finished from your materials catalogue.
        </p>
      </div>

      <SurfaceRow
        label="Floor"
        area={areas.floor}
        finishId={currentLayout.floorFinishId}
        concealedFinishId={currentLayout.floorConcealedFinishId}
        onFinishChange={(id) => updateRoomSurfaces({ floorFinishId: id })}
        onConcealedChange={(id) => updateRoomSurfaces({ floorConcealedFinishId: id })}
      />

      <SurfaceRow
        label="Ceiling"
        area={areas.ceiling}
        finishId={currentLayout.ceilingFinishId}
        onFinishChange={(id) => updateRoomSurfaces({ ceilingFinishId: id })}
        // No concealed rate: nothing in a kitchen hides ceiling except a
        // full-height unit, and that occupies the area rather than
        // concealing it.
      />

      {WALL_ORDER.map((orientation) => {
        const wall = currentLayout.walls.find((w) => w.orientation === orientation);
        return (
          <SurfaceRow
            key={orientation}
            label={WALL_LABELS[orientation]}
            area={areas.walls[orientation]}
            finishId={wall?.finishId}
            concealedFinishId={wall?.concealedFinishId}
            onFinishChange={(id) => updateWallFinish(orientation, { finishId: id })}
            onConcealedChange={(id) => updateWallFinish(orientation, { concealedFinishId: id })}
          />
        );
      })}

      <p className="border-t border-gray-200 pt-2 text-[10px] text-gray-400">
        Areas update as you move cabinets. "Blocked" is area taken up by pillars and shafts —
        there's no surface behind them, so it's never charged.
      </p>
    </div>
  );
}

interface SurfaceRowProps {
  label: string;
  area: SurfaceAreaBreakdown;
  finishId?: string;
  concealedFinishId?: string;
  onFinishChange: (finishId: string | undefined) => void;
  onConcealedChange?: (finishId: string | undefined) => void;
}

function SurfaceRow({
  label,
  area,
  finishId,
  concealedFinishId,
  onFinishChange,
  onConcealedChange,
}: SurfaceRowProps) {
  const finishes = useLayoutStore((state) => state.finishes);

  return (
    <div className="flex flex-col gap-1 border-t border-gray-100 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-[10px] tabular-nums text-gray-400">
          {area.exposedSqM.toFixed(2)} m² shown
        </span>
      </div>

      <select
        value={finishId ?? ''}
        onChange={(e) => onFinishChange(e.target.value || undefined)}
        className={selectClass}
      >
        <option value="">Not specified</option>
        {finishes.map((f) => (
          <option key={f.id} value={f.id}>
            {f.brand ? `${f.brand} ${f.label}` : f.label}
          </option>
        ))}
      </select>

      {onConcealedChange && area.concealedSqM > 0 && (
        <>
          <select
            value={concealedFinishId ?? ''}
            onChange={(e) => onConcealedChange(e.target.value || undefined)}
            className={selectClass}
          >
            <option value="">Behind units: not finished</option>
            {finishes.map((f) => (
              <option key={f.id} value={f.id}>
                Behind units: {f.brand ? `${f.brand} ${f.label}` : f.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] tabular-nums text-gray-400">
            {area.concealedSqM.toFixed(2)} m² hidden behind units
          </span>
        </>
      )}

      {area.occupiedSqM > 0 && (
        <span className="text-[10px] tabular-nums text-amber-600">
          {area.occupiedSqM.toFixed(2)} m² blocked by structure — not charged
        </span>
      )}

      {/* Kept separate from "blocked by structure" on purpose: they
          answer different questions. Blocked means a pillar is in the
          way; deducted means there is no wall there to tile. Both are
          uncharged, but a client asking why the tiling area is smaller
          than the room deserves the right reason. */}
      {area.voidSqM > 0 && (
        <span className="text-[10px] tabular-nums text-sky-600">
          {area.voidSqM.toFixed(2)} m² deducted for doors/windows
        </span>
      )}
    </div>
  );
}
