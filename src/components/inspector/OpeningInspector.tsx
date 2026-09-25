// src/components/inspector/OpeningInspector.tsx
//
// Edits the selected door or window: which wall, where along it, size,
// sill, swing, what's visible through it, and who supplies it.
//
// Three things here are worth more than they look:
//
//   * SWING. Changing an in-swinging door to sliding or out-swinging
//     frees the floor its arc was reserving. In a small kitchen that's
//     often the difference between a trolley fitting and not, so it's
//     a design decision, not a detail — which is why the panel shows
//     the reserved depth next to it.
//   * SUPPLIED BY YOU. Off (the default) means the opening deducts
//     tile area but adds nothing to the quote, printing as a
//     specification instead. On means it's your scope and priced.
//   * DAYLIGHT COLOUR TEMPERATURE. Not decoration: a cool grey
//     laminate approved under 6500K light looks beige under 3000K. If
//     the client signs off a finish in the render and the kitchen is
//     built under warmer light, the finish looks wrong on site.

import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { useSelectedOpeningId } from '../../hooks/useSelection';
import { ColorPicker } from '../common/ColorPicker';
import { openingsOverlap } from '../../lib/openings';
import {
  DAYLIGHT_MODE_LABELS,
  DOOR_STATE_LABELS,
  DOOR_SWING_LABELS,
  OPENING_KIND_LABELS,
  defaultDaylightFor,
  swingBlocksFloor,
} from '../../types/opening';
import type { DaylightMode, DoorState, DoorSwing, WallOpening } from '../../types/opening';
import type { WallOrientation } from '../../types/layout';

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];
const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
};

const SWINGS: DoorSwing[] = ['in-left', 'in-right', 'out', 'sliding', 'none'];
const DOOR_STATES: DoorState[] = ['closed', 'open', 'doorway'];
const DAYLIGHT_MODES: DaylightMode[] = ['sunlight', 'diffuse', 'artificial'];

// Small starter library of CC-licensed exterior photos, fetched by
// scripts/fetch_backdrops.py (see public/backdrops/CREDITS.md for the
// source and license of each). These are PRESETS on top of the
// free-text field below, not a replacement for it — a business with
// its own site photo still just pastes its URL in, and the picker
// falls back to "Custom" the moment the value doesn't match one of
// these paths.
const BACKDROP_PRESETS: { label: string; url: string }[] = [
  { label: 'Urban skyline (Delhi NCR balcony)', url: '/backdrops/urban-balcony.jpg' },
  { label: 'Green / trees', url: '/backdrops/green-trees.jpg' },
  { label: 'Plain sky', url: '/backdrops/plain-sky.jpg' },
];
const CUSTOM_BACKDROP_VALUE = '__custom__';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

// Starting point when the override is switched on — a neutral off-white
// rather than pure white, which is what most flush doors actually are.
const DEFAULT_LEAF_COLOR = '#e8e4dc';

const inputClass = 'rounded border border-gray-300 px-2 py-1 text-sm';
const selectClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

export function OpeningInspector() {
  const selectedOpeningId = useSelectedOpeningId();
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const finishes = useLayoutStore((state) => state.finishes);
  const handles = useLayoutStore((state) => state.handles);
  const updateOpening = useLayoutStore((state) => state.updateOpening);
  const removeOpening = useLayoutStore((state) => state.removeOpening);

  const opening = currentLayout?.walls
    .flatMap((w) => w.openings ?? [])
    .find((o) => o.id === selectedOpeningId);

  if (!opening || !currentLayout) return null;

  const wall = currentLayout.walls.find((w) => w.orientation === opening.wallId);
  const wallLengthMm = wall?.lengthMm ?? 0;
  const ceilingHeightMm = currentLayout.dimensions.ceilingHeightMm ?? 2700;
  const deductedSqM = (opening.widthMm * opening.heightMm) / 1_000_000;

  // Both of these are real errors that the geometry silently absorbs by
  // clipping, so they're called out rather than left to show up as a
  // smaller opening than was entered.
  const overrunsWall = opening.offsetMm + opening.widthMm > wallLengthMm;
  const overrunsCeiling = opening.sillMm + opening.heightMm > ceilingHeightMm;

  // Openings on this same wall that this one genuinely overlaps, in
  // both axes. Shown on the selected opening as well as in the toolbar,
  // because the toolbar can only say "one of them" — here we know which.
  const clashes = (wall?.openings ?? []).filter(
    (o) => o.id !== opening.id && openingsOverlap(o, opening)
  );

  function set(updates: Partial<WallOpening>) {
    updateOpening(opening!.id, updates);
  }

  return (
    <div className="flex w-56 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">
          {OPENING_KIND_LABELS[opening.kind]}
        </h3>
        <p className="text-[11px] text-gray-500">
          Deducts {deductedSqM.toFixed(2)} m² from {WALL_LABELS[opening.wallId].toLowerCase()}{' '}
          tiling
        </p>
      </div>

      {clashes.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <span className="font-medium">
              Overlaps {clashes.length === 1 ? 'another opening' : `${clashes.length} openings`}{' '}
              on this wall.
            </span>{' '}
            {clashes
              .map((c) => `${OPENING_KIND_LABELS[c.kind]} at ${c.offsetMm}mm`)
              .join(', ')}
            . Move it along the wall, or raise its sill clear of the other.
          </AlertDescription>
        </Alert>
      )}

      {(overrunsWall || overrunsCeiling) && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-800">
            {overrunsWall && <>Extends past the end of the wall. </>}
            {overrunsCeiling && <>Extends above the ceiling. </>}
            It will be trimmed to fit, so the quote will deduct less than the size shown.
          </AlertDescription>
        </Alert>
      )}

      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Wall
        <select
          value={opening.wallId}
          onChange={(e) => {
            const wallId = e.target.value as WallOrientation;
            // Daylight is re-derived on the new wall, because which way
            // a window faces is the whole basis of its default light —
            // moving a window from south to north and keeping hard
            // direct sun would be wrong (see defaultDaylightFor).
            set({ wallId, daylight: defaultDaylightFor(opening.kind, wallId) });
          }}
          className={selectClass}
        >
          {WALL_ORDER.map((w) => (
            <option key={w} value={w}>
              {WALL_LABELS[w]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
        Along wall (mm)
        <input
          type="number"
          min={0}
          step={50}
          value={opening.offsetMm}
          onChange={(e) => set({ offsetMm: Math.max(0, Number(e.target.value)) })}
          className={inputClass + ' w-20'}
        />
      </label>

      <div className="flex gap-1">
        <NumField
          label="Width"
          value={opening.widthMm}
          onChange={(widthMm) => set({ widthMm })}
        />
        <NumField
          label="Height"
          value={opening.heightMm}
          onChange={(heightMm) => set({ heightMm })}
        />
        <NumField
          label="Sill"
          value={opening.sillMm}
          onChange={(sillMm) => set({ sillMm })}
        />
      </div>
      <span className="-mt-1 text-[10px] text-gray-400">
        Sill is the height of the bottom edge off the floor — 0 for a door.
      </span>

      {opening.kind === 'door' && (
        <>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Swing
            <select
              value={opening.swing ?? 'in-right'}
              onChange={(e) => set({ swing: e.target.value as DoorSwing })}
              className={selectClass}
            >
              {SWINGS.map((sw) => (
                <option key={sw} value={sw}>
                  {DOOR_SWING_LABELS[sw]}
                </option>
              ))}
            </select>
          </label>
          <span className="-mt-1 text-[10px] text-gray-400">
            {swingBlocksFloor(opening.swing ?? 'in-right') ? (
              <span className="text-amber-700">
                Reserves {(opening.widthMm / 1000).toFixed(2)}m of floor — nothing can be placed
                in the arc.
              </span>
            ) : (
              'Frees the floor inside the kitchen.'
            )}
          </span>

          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Shown as
            <select
              value={opening.doorState ?? 'closed'}
              onChange={(e) => set({ doorState: e.target.value as DoorState })}
              className={selectClass}
            >
              {DOOR_STATES.map((st) => (
                <option key={st} value={st}>
                  {DOOR_STATE_LABELS[st]}
                </option>
              ))}
            </select>
          </label>

          {(opening.doorState ?? 'closed') === 'closed' && (
            <div className="flex flex-col gap-2 rounded border border-gray-200 p-2">
              <span className="text-xs font-medium text-gray-700">Door leaf</span>

              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Finish
                <select
                  value={opening.leafFinishId ?? ''}
                  onChange={(e) => set({ leafFinishId: e.target.value || undefined })}
                  className={selectClass}
                >
                  <option value="">Plain (unspecified)</option>
                  {finishes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.brand ? `${f.brand} ${f.label}` : f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Handle
                <select
                  value={opening.leafHandleId ?? ''}
                  onChange={(e) => set({ leafHandleId: e.target.value || undefined })}
                  className={selectClass}
                >
                  {/* Same catalogue cabinets use — a door knob and a
                      cabinet knob come from the same supplier, so a
                      parallel list would just be two places to
                      maintain the same hardware. */}
                  <option value="">No handle shown</option>
                  {handles.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Colour override, the same one cabinets carry, and for
                  the same reason: a kitchen door is usually painted to
                  match the passage rather than the kitchen, so it wants
                  a one-off colour instead of its own catalogue row. */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">Colour</span>
                {opening.leafColorOverride ? (
                  <>
                    <ColorPicker
                      value={opening.leafColorOverride}
                      onChange={(leafColorOverride) => set({ leafColorOverride })}
                    />
                    <Button
                      variant="link"
                      size="xs"
                      className="h-auto self-start p-0 text-[10px]"
                      onClick={() => set({ leafColorOverride: undefined })}
                    >
                      Use the finish's own colour
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto self-start p-0 text-[10px]"
                    onClick={() => set({ leafColorOverride: DEFAULT_LEAF_COLOR })}
                  >
                    Override colour
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-col gap-1 border-t border-gray-100 pt-2">
        <span className="text-xs font-medium text-gray-700">Seen through it</span>
        <select
          value={
            BACKDROP_PRESETS.some((p) => p.url === opening.backdropUrl)
              ? opening.backdropUrl
              : CUSTOM_BACKDROP_VALUE
          }
          onChange={(e) => {
            if (e.target.value === CUSTOM_BACKDROP_VALUE) return;
            set({ backdropUrl: e.target.value });
          }}
          className={selectClass}
        >
          {BACKDROP_PRESETS.map((p) => (
            <option key={p.url} value={p.url}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_BACKDROP_VALUE}>Custom URL…</option>
        </select>
        <input
          value={opening.backdropUrl ?? ''}
          onChange={(e) => set({ backdropUrl: e.target.value || undefined })}
          placeholder="/backdrops/urban-balcony.jpg, or a business's own photo URL"
          className={inputClass + ' w-full'}
        />
        <span className="text-[10px] text-gray-400">
          Pick a preset, or paste a business's own site photo URL directly. A photo of the
          actual view, or a generic sky. Empty leaves the opening dark, which reads as a
          rendering fault rather than as a window.
        </span>
      </div>

      <DaylightFields opening={opening} onChange={set} />

      <label className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs text-gray-600">
        Supplied by you
        <input
          type="checkbox"
          checked={opening.suppliedByUs}
          onChange={(e) => set({ suppliedByUs: e.target.checked })}
          className="h-4 w-4"
        />
      </label>
      {opening.suppliedByUs ? (
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          Price
          <input
            type="number"
            min={0}
            value={opening.unitPrice ?? 0}
            onChange={(e) => set({ unitPrice: Math.max(0, Number(e.target.value)) })}
            className={inputClass + ' w-24'}
          />
        </label>
      ) : (
        <span className="-mt-1 text-[10px] text-gray-400">
          Prints on the quote as a specification at {INR.format(0)} — existing, by others.
        </span>
      )}

      <Button variant="destructive" size="xs" onClick={() => removeOpening(opening.id)}>
        Delete
      </Button>
    </div>
  );
}

function DaylightFields({
  opening,
  onChange,
}: {
  opening: WallOpening;
  onChange: (updates: Partial<WallOpening>) => void;
}) {
  const daylight = opening.daylight ?? defaultDaylightFor(opening.kind, opening.wallId);

  return (
    <div className="flex flex-col gap-1 border-t border-gray-100 pt-2">
      <label className="flex items-center justify-between gap-2 text-xs font-medium text-gray-700">
        Light from outside
        <input
          type="checkbox"
          checked={daylight.enabled}
          onChange={(e) => onChange({ daylight: { ...daylight, enabled: e.target.checked } })}
          className="h-4 w-4"
        />
      </label>

      {daylight.enabled && (
        <>
          <select
            value={daylight.mode}
            onChange={(e) =>
              onChange({ daylight: { ...daylight, mode: e.target.value as DaylightMode } })
            }
            className={selectClass}
          >
            {DAYLIGHT_MODES.map((m) => (
              <option key={m} value={m}>
                {DAYLIGHT_MODE_LABELS[m]}
              </option>
            ))}
          </select>

          <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
            Brightness
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={daylight.intensity}
              onChange={(e) =>
                onChange({ daylight: { ...daylight, intensity: Number(e.target.value) } })
              }
              className="w-24"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
            Colour temp
            <input
              type="range"
              min={2200}
              max={7000}
              step={100}
              value={daylight.colorTempK}
              onChange={(e) =>
                onChange({ daylight: { ...daylight, colorTempK: Number(e.target.value) } })
              }
              className="w-24"
            />
          </label>
          <span className="text-[10px] text-gray-400">
            {daylight.colorTempK}K — warmer light shifts how the finishes read, so approve
            colours under the temperature the kitchen will actually have.
          </span>
        </>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex flex-1 flex-col text-[10px] text-gray-500">
      {label}
      <input
        type="number"
        min={0}
        step={50}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
      />
    </label>
  );
}
