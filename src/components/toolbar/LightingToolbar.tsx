// src/components/toolbar/LightingToolbar.tsx
//
// Adds light fixtures, switches the lighting mode, and holds the one
// global electrical-pricing toggle.
//
// The MODE SWITCHER is the most useful control on this panel and the
// least obvious, so it sits at the top. Three states, because "turn
// the lights off" is really two different jobs:
//
//   Lit as designed  what the client is buying
//   Fixtures off     daylight only — the light load a phone can carry
//   True colour      flat neutral light, every tint removed, which is
//                    the mode to approve a FINISH in. A cool grey
//                    laminate looks beige under 3000K, so signing a
//                    colour off under warm light is how the wrong
//                    material gets ordered.

import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { useSelectedFixtureId } from '../../hooks/useSelection';
import {
  FIXTURE_KIND_LABELS,
  LIGHTING_MODE_HINTS,
  LIGHTING_MODE_LABELS,
  createFixture,
  isLinear,
  isVisibleWhenClosed,
} from '../../types/fixture';
import { CABINET_FACE_LABELS } from '../../types/fixture';
import type { FixtureKind, LightFixture, LightingMode } from '../../types/fixture';
import {
  LIGHT_QUALITY_HINTS,
  LIGHT_QUALITY_LABELS,
  defaultMountFor,
  fixtureCost,
  fixtureQuantity,
  maxLightsFor,
  resolveAllFixtures,
  selectRealLights,
} from '../../lib/fixtures';
import type { LightQuality } from '../../lib/fixtures';
import { useLightQuality } from '../../hooks/useLightQuality';
import {
  DEFAULT_EXPOSURE,
  MAX_EXPOSURE,
  MIN_EXPOSURE,
  clampExposure,
  exposureToStops,
} from '../../lib/lighting3d';

const MODES: LightingMode[] = ['designed', 'fixtures-off', 'true-colour'];
const QUALITIES: LightQuality[] = ['auto', 'all', 'low'];

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

// Short "where is it" label for the list. Deliberately terse — the
// inspector carries the full detail; this only has to disambiguate one
// row from the next.
function describeMountShort(mount: LightFixture['mount']): string {
  switch (mount.kind) {
    case 'ceiling':
      return `Ceiling ${Math.round(mount.x)},${Math.round(mount.y)}`;
    case 'wall':
      return `${mount.wallId} wall @ ${Math.round(mount.offsetMm)}mm`;
    case 'cabinet':
      return CABINET_FACE_LABELS[mount.face];
    case 'free':
      return `Free ${Math.round(mount.x)},${Math.round(mount.y)}`;
  }
}

export function LightingToolbar() {
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const cabinets = usePhysicalCabinets();
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const isInventoryLoading = useLayoutStore((s) => s.isInventoryLoading);
  const addFixture = useLayoutStore((s) => s.addFixture);
  const removeFixture = useLayoutStore((s) => s.removeFixture);
  const selectFixture = useLayoutStore((s) => s.selectFixture);
  const selectedFixtureId = useSelectedFixtureId();
  const setLightingMode = useLayoutStore((s) => s.setLightingMode);
  const setPriceElectrical = useLayoutStore((s) => s.setPriceElectrical);
  const setExposure = useLayoutStore((s) => s.setExposure);
  const [quality, setQuality] = useLightQuality();

  if (!currentLayout) return null;

  const mode = currentLayout.lightingMode ?? 'designed';
  const exposure = clampExposure(currentLayout.exposure ?? DEFAULT_EXPOSURE);
  // Shown in STOPS rather than as a raw multiplier — each stop is a
  // doubling, which is how brightness is actually talked about, and
  // "+0.5 stops" means more to someone than "1.56".
  const stops = Number(exposureToStops(exposure).toFixed(1));
  const priceElectrical = currentLayout.priceElectrical ?? false;
  const placements = resolveAllFixtures(currentLayout, cabinets, fixtureCatalog);
  const { emissiveOnly } = selectRealLights(placements, maxLightsFor(quality));
  const orphaned = placements.filter((p) => p.hostMissing);
  const fixtures = currentLayout.fixtures ?? [];
  // Fixtures whose catalogue row was deleted resolve to nothing, so
  // they vanish from both render and quote. Counted here so that isn't
  // silent.
  const unresolved = fixtures.length - placements.length;

  const total = placements.reduce((sum, p) => sum + fixtureCost(p), 0);

  // Grouped by kind so the add buttons read as "what am I fitting"
  // rather than as a flat list of twelve product names.
  const byKind = new Map<FixtureKind, typeof fixtureCatalog>();
  for (const item of fixtureCatalog) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  return (
    <div className="flex w-64 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Lighting</h3>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">View</span>
        <div className="flex flex-col gap-0.5">
          {MODES.map((m) => (
            <Button
              key={m}
              variant="outline"
              size="xs"
              className={
                mode === m
                  ? 'h-auto min-h-7 justify-start border-blue-400 bg-blue-50 py-1 text-left font-normal whitespace-normal text-blue-800 hover:bg-blue-50'
                  : 'h-auto min-h-7 justify-start py-1 text-left font-normal whitespace-normal'
              }
              onClick={() => setLightingMode(m)}
            >
              {LIGHTING_MODE_LABELS[m]}
            </Button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">{LIGHTING_MODE_HINTS[mode]}</span>
      </div>

      {/* Viewing brightness.
          Sits here, next to the mode, because it answers the same
          question — "how should this look?" — and emphatically NOT in
          Inventory, where lumens lives. Lumens is spec data that prints
          on the quote and gets read by an electrician; using it to fix
          a dark render would leave the schedule describing a product
          nobody is buying. This changes no design data at all. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-gray-700">Brightness</span>
          <span className="text-[10px] tabular-nums text-gray-400">
            {stops === 0 ? 'default' : `${stops > 0 ? '+' : ''}${stops.toFixed(1)} stops`}
          </span>
        </div>
        <input
          type="range"
          min={MIN_EXPOSURE}
          max={MAX_EXPOSURE}
          step={0.05}
          value={exposure}
          onChange={(e) => setExposure(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-gray-400">
            Affects the picture only — never the quote.
          </span>
          {exposure !== DEFAULT_EXPOSURE && (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 text-[10px]"
              onClick={() => setExposure(DEFAULT_EXPOSURE)}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* A DEVICE setting, not part of the design — so it isn't saved
          with the layout. A kitchen reviewed on a laptop shouldn't open
          on a phone with a setting that makes it unusable, and a shared
          link shouldn't carry someone else's hardware choice. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Light quality</span>
        <div className="flex gap-1">
          {QUALITIES.map((q) => (
            <Button
              key={q}
              variant="outline"
              size="xs"
              className={
                quality === q
                  ? 'h-auto min-h-7 flex-1 py-1 text-center leading-tight whitespace-normal border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-50'
                  : 'h-auto min-h-7 flex-1 py-1 text-center leading-tight whitespace-normal'
              }
              onClick={() => setQuality(q)}
            >
              {LIGHT_QUALITY_LABELS[q]}
            </Button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">{LIGHT_QUALITY_HINTS[quality]}</span>
      </div>

      {isInventoryLoading ? (
        <div className="flex flex-col gap-1.5 border-t border-gray-200 pt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : fixtureCatalog.length === 0 ? (
        <p className="text-xs text-gray-400">No fixtures in your catalogue yet.</p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
          <span className="text-xs font-medium text-gray-700">Add</span>
          {[...byKind.entries()].map(([kind, items]) => (
            <div key={kind} className="flex flex-col gap-1">
              <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                {FIXTURE_KIND_LABELS[kind]}
                {!isVisibleWhenClosed(kind) && (
                  // Said plainly rather than left to be reported as a
                  // rendering bug: an in-drawer light is only visible
                  // with the drawer open, and drawers are modelled shut.
                  <span className="ml-1 font-normal text-gray-400">— not shown in 3D</span>
                )}
              </span>
              <div className="flex flex-col gap-0.5 pl-1">
                {items.map((item) => (
                  <Button
                    key={item.id}
                    variant="outline"
                    size="xs"
                    className="h-auto min-h-7 justify-between py-1 text-left font-normal whitespace-normal"
                    onClick={() =>
                      addFixture(
                        createFixture(
                          currentLayout.id,
                          item.id,
                          defaultMountFor(item.kind, currentLayout)
                        )
                      )
                    }
                  >
                    <span>
                      {item.label}
                      <span className="ml-1 text-gray-400">{item.colorTempK}K</span>
                    </span>
                    <span className="shrink-0 text-gray-400">+</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {emissiveOnly.length > 0 && mode === 'designed' && (
        <div className="rounded border border-sky-300 bg-sky-50 px-2 py-1.5 text-[10px] text-sky-800">
          {/* Not a warning, an explanation. Without it, "I added a
              seventh light and the room didn't get brighter" reads as
              a bug rather than as the deliberate mobile budget. */}
          {emissiveOnly.length} fixture{emissiveOnly.length > 1 ? 's' : ''} glow but don&apos;t
          light the room at this quality setting — the brightest ones win. Switch to{' '}
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-[10px] text-sky-800"
            onClick={() => setQuality('all')}
          >
            All lights
          </Button>{' '}
          on a laptop to light every one. All of them are quoted either way.
        </div>
      )}

      {orphaned.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-800">
            {orphaned.length} fixture{orphaned.length > 1 ? 's' : ''} lost the cabinet
            {orphaned.length > 1 ? 's' : ''} they were fixed to and are sitting loose in the
            middle of the room. Re-mount or delete them.
          </AlertDescription>
        </Alert>
      )}

      {unresolved > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {unresolved} fixture{unresolved > 1 ? 's' : ''} reference a catalogue item that no
            longer exists, so they aren&apos;t rendered or priced. Delete them or re-add the
            catalogue row.
          </AlertDescription>
        </Alert>
      )}

      <Label className="flex items-center justify-between gap-2 border-t border-gray-200 pt-3 text-xs font-normal text-gray-600">
        Charge electrical work
        <Checkbox checked={priceElectrical} onCheckedChange={(checked) => setPriceElectrical(checked === true)} />
      </Label>
      <span className="-mt-1 text-[10px] text-gray-400">
        {priceElectrical
          ? `Lighting adds ${INR.format(total)} to the quote.`
          : `Off — lighting prints as a specification at ${INR.format(
              0
            )}. Would be ${INR.format(total)} if charged.`}
      </span>

      {placements.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
          <h4 className="text-xs font-semibold text-gray-700">In this room</h4>
          <ul className="flex flex-col gap-1">
            {placements.map((p) => {
              const { amount } = fixtureQuantity(p);
              return (
                <li
                  key={p.fixture.id}
                  className={`flex items-center justify-between rounded px-2 py-1 text-[11px] ${
                    p.fixture.id === selectedFixtureId
                      ? 'bg-blue-50 text-blue-800'
                      : 'bg-gray-50 text-gray-600'
                  }`}
                >
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-auto min-w-0 flex-1 flex-col items-start justify-start p-0 text-left font-normal whitespace-normal"
                    onClick={() => selectFixture(p.fixture.id)}
                  >
                    <span>
                      {p.item.label}
                      <span className="ml-1 text-gray-400">
                        {isLinear(p.item.kind) ? `${amount.toFixed(2)}m` : `×${amount}`}
                      </span>
                      {!p.fixture.enabled && <span className="ml-1 text-gray-400">(off)</span>}
                    </span>
                    {/* Where it is, not just what it is — a list of
                        four identical strips is unusable without it. */}
                    <div className="text-[10px] text-gray-400">
                      {describeMountShort(p.fixture.mount)} · {Math.round(p.zMm)}mm
                    </div>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeFixture(p.fixture.id)}
                    aria-label={`Remove ${p.item.label}`}
                    className="text-red-500 hover:text-red-700"
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
