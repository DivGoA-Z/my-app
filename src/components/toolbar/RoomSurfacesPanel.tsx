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

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { useLayoutStore } from '../../store/layoutStore';
import { computeRoomSurfaceAreas } from '../../lib/surfaceAreas';
import type { SurfaceAreaBreakdown } from '../../lib/surfaceAreas';
import { countertopAreaSqM } from '../../lib/cabinetGeometry';
import type { WallOrientation } from '../../types/layout';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];

const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
};

// Radix Select rejects an empty-string item value, so "not specified"
// needs a real sentinel, mapped back to `undefined` in each handler.
const NO_FINISH_VALUE = '__none__';

export function RoomSurfacesPanel() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
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
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-foreground">Room Surfaces</h3>
        <p className="text-[13px] text-muted-foreground">
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

      <CountertopRow
        areaSqM={countertopAreaSqM(cabinets)}
        finishId={currentLayout.countertopFinishId}
        priceCountertop={currentLayout.priceCountertop ?? false}
        onFinishChange={(id) => updateRoomSurfaces({ countertopFinishId: id })}
        onPriceCountertopChange={(priceCountertop) => updateRoomSurfaces({ priceCountertop })}
      />

      <p className="border-t border-border pt-2 text-xs text-muted-foreground">
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
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {area.exposedSqM.toFixed(2)} m² shown
        </span>
      </div>

      <Select
        value={finishId ?? NO_FINISH_VALUE}
        onValueChange={(value) => onFinishChange(value === NO_FINISH_VALUE ? undefined : value)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FINISH_VALUE}>Not specified</SelectItem>
          {finishes.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.brand ? `${f.brand} ${f.label}` : f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {onConcealedChange && area.concealedSqM > 0 && (
        <>
          <Select
            value={concealedFinishId ?? NO_FINISH_VALUE}
            onValueChange={(value) =>
              onConcealedChange(value === NO_FINISH_VALUE ? undefined : value)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FINISH_VALUE}>Behind units: not finished</SelectItem>
              {finishes.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  Behind units: {f.brand ? `${f.brand} ${f.label}` : f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs tabular-nums text-muted-foreground">
            {area.concealedSqM.toFixed(2)} m² hidden behind units
          </span>
        </>
      )}

      {area.occupiedSqM > 0 && (
        <span className="text-xs tabular-nums text-amber-600">
          {area.occupiedSqM.toFixed(2)} m² blocked by structure — not charged
        </span>
      )}

      {/* Kept separate from "blocked by structure" on purpose: they
          answer different questions. Blocked means a pillar is in the
          way; deducted means there is no wall there to tile. Both are
          uncharged, but a client asking why the tiling area is smaller
          than the room deserves the right reason. */}
      {area.voidSqM > 0 && (
        <span className="text-xs tabular-nums text-sky-600">
          {area.voidSqM.toFixed(2)} m² deducted for doors/windows
        </span>
      )}
    </div>
  );
}

interface CountertopRowProps {
  areaSqM: number;
  finishId?: string;
  priceCountertop: boolean;
  onFinishChange: (finishId: string | undefined) => void;
  onPriceCountertopChange: (priceCountertop: boolean) => void;
}

// Deliberately not a SurfaceRow: a countertop has no concealed/occupied/
// void concept (see cabinetGeometry.ts's countertopAreaSqM — it's just
// slab area over base-height units), and it carries its own charge
// toggle, which no other surface does. In Delhi NCR the kitchen
// business usually doesn't supply the slab — the homeowner arranges
// stone separately — so the finish here drives the RENDER regardless,
// and the checkbox decides only whether it also reaches the quote.
function CountertopRow({
  areaSqM,
  finishId,
  priceCountertop,
  onFinishChange,
  onPriceCountertopChange,
}: CountertopRowProps) {
  const finishes = useLayoutStore((state) => state.finishes);

  return (
    <div className="flex flex-col gap-1 border-t border-gray-100 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">Countertop / slab</span>
        <span className="text-xs tabular-nums text-muted-foreground">{areaSqM.toFixed(2)} m²</span>
      </div>

      <Select
        value={finishId ?? NO_FINISH_VALUE}
        onValueChange={(value) => onFinishChange(value === NO_FINISH_VALUE ? undefined : value)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FINISH_VALUE}>Not specified</SelectItem>
          {finishes.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.brand ? `${f.brand} ${f.label}` : f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={priceCountertop}
          onCheckedChange={(checked) => onPriceCountertopChange(checked === true)}
          className="size-3"
        />
        Charge for it on the quote
      </Label>
      {!priceCountertop && (
        <span className="text-xs text-muted-foreground">
          Off — usually arranged by the homeowner. The slab still shows in the design and prints
          on the quote at ₹0.
        </span>
      )}
    </div>
  );
}
