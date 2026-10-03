// src/components/inspector/FixtureInspector.tsx
//
// Edits the selected light fixture — chiefly WHAT IT'S MOUNTED TO,
// which is the field that makes the rest behave.
//
// Re-mounting is the main action here, not a setting. A strip added
// from the toolbar starts as a free position because the toolbar can't
// know which cabinet you meant; attaching it to a cabinet is what makes
// it follow that cabinet around, take its width, and disappear with it.
// So the mount picker is first and the cabinet list is right under it.

import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useSelectedFixtureId } from '../../hooks/useSelection';
import {
  CABINET_FACE_LABELS,
  MOUNT_KIND_LABELS,
  THROW_HINTS,
  THROW_LABELS,
  defaultThrowFor,
  isLinear,
  isVisibleWhenClosed,
} from '../../types/fixture';
import type { CabinetFace, FixtureMount, ThrowDirection } from '../../types/fixture';
import {
  cabinetDrawerCount,
  fixtureCost,
  fixtureQuantity,
  resolveFixturePlacement,
} from '../../lib/fixtures';
import { kelvinToColor } from '../../lib/lighting3d';
import { hasCountertop } from '../../lib/cabinetGeometry';
import type { WallOrientation } from '../../types/layout';

const MOUNT_KINDS: FixtureMount['kind'][] = ['ceiling', 'wall', 'cabinet', 'free'];
const FACES: CabinetFace[] = ['under', 'top', 'left', 'right', 'plinth', 'drawer'];
const THROWS: ThrowDirection[] = ['down', 'up', 'wash', 'diffuse'];
const WALLS: WallOrientation[] = ['north', 'east', 'south', 'west'];

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inputClass = 'rounded-[10px] border border-input px-2 py-1 text-sm';

// 'base-cabinet' -> 'Base Cabinet'
function moduleLabel(moduleType: string): string {
  return moduleType
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function FixtureInspector() {
  const selectedFixtureId = useSelectedFixtureId();
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const updateFixture = useLayoutStore((s) => s.updateFixture);
  const removeFixture = useLayoutStore((s) => s.removeFixture);

  const fixture = (currentLayout?.fixtures ?? []).find((f) => f.id === selectedFixtureId);
  if (!fixture || !currentLayout) return null;

  const placement = resolveFixturePlacement(fixture, currentLayout, cabinets, fixtureCatalog);
  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = currentLayout.dimensions;
  const ceilingHeightMm = currentLayout.dimensions.ceilingHeightMm ?? 2700;

  function set(updates: Parameters<typeof updateFixture>[1]) {
    updateFixture(fixture!.id, updates);
  }

  // Switching mount kind builds a FRESH mount of that kind rather than
  // merging — a cabinetId means nothing on a ceiling mount, and a
  // half-migrated mount object would resolve to somewhere arbitrary.
  function setMountKind(kind: FixtureMount['kind']) {
    switch (kind) {
      case 'ceiling':
        return set({ mount: { kind: 'ceiling', x: roomWidthMm / 2, y: roomDepthMm / 2 } });
      case 'wall':
        return set({
          mount: { kind: 'wall', wallId: 'north', offsetMm: roomWidthMm / 2, heightMm: 1800 },
        });
      case 'cabinet': {
        const first = cabinets[0];
        if (!first) return; // nothing to mount to; leave as-is
        return set({ mount: { kind: 'cabinet', cabinetId: first.id, face: 'under' } });
      }
      case 'free':
        return set({
          mount: { kind: 'free', x: roomWidthMm / 2, y: roomDepthMm / 2, zMm: 1450 },
        });
    }
  }

  const mount = fixture.mount;
  const linear = placement ? isLinear(placement.item.kind) : false;

  const mountedCabinet =
    mount.kind === 'cabinet' ? cabinets.find((c) => c.id === mount.cabinetId) : undefined;
  const topFaceIsUnderCountertop = mountedCabinet
    ? hasCountertop(mountedCabinet.moduleType)
    : false;

  return (
    <div className="flex w-56 flex-col gap-3 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="text-[19px] font-semibold leading-tight">
          {placement?.item.label ?? 'Fixture'}
        </h3>
        {placement ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span
              // The actual rendered colour, so the warmth is visible
              // here rather than being a number you have to imagine.
              className="inline-block h-3 w-3 rounded-full border border-input"
              style={{ backgroundColor: kelvinToColor(placement.item.colorTempK) }}
            />
            {placement.item.colorTempK}K · {placement.item.lumens} lm
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              Its catalogue item was deleted — not rendered, not priced.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {placement?.hostMissing && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-800">
            The cabinet this was fixed to is gone, so it&apos;s sitting loose in the middle of the
            room. Re-mount it below or delete it.
          </AlertDescription>
        </Alert>
      )}

      {placement && !isVisibleWhenClosed(placement.item.kind) && (
        <div className="rounded-[10px] border border-border bg-secondary px-2 py-1.5 text-xs text-muted-foreground">
          Only visible with the drawer open, so it doesn&apos;t appear in the 3D view. It is
          still quoted.
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        Mounted on
        <Select value={mount.kind} onValueChange={(value) => setMountKind(value as FixtureMount['kind'])}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOUNT_KINDS.map((k) => (
              <SelectItem key={k} value={k} disabled={k === 'cabinet' && cabinets.length === 0}>
                {MOUNT_KIND_LABELS[k]}
                {k === 'cabinet' && cabinets.length === 0 ? ' (no cabinets yet)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mount.kind === 'cabinet' && (
        <>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            Cabinet
            <Select
              value={mount.cabinetId}
              onValueChange={(value) => set({ mount: { ...mount, cabinetId: value } })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Position included on purpose: three identical 600mm
                    base units are indistinguishable by name, and picking
                    the wrong one silently puts the light on the wrong
                    cabinet. */}
                {cabinets.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {moduleLabel(c.moduleType)} {c.widthMm}mm — at {Math.round(c.x)},
                    {Math.round(c.y)}
                    {c.elevationMm > 0 ? ` (${c.elevationMm}mm up)` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            Face
            <Select
              value={mount.face}
              onValueChange={(value) => set({ mount: { ...mount, face: value as CabinetFace } })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FACES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {CABINET_FACE_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="-mt-1 text-xs text-muted-foreground">
            Moves and resizes with the cabinet, and is removed if the cabinet is deleted.
          </span>

          {/* 'Top' on a unit that carries a countertop has nowhere to
              go — the slab is exactly there. It used to render inside
              the stone and look like nothing had happened; now it's
              lifted clear and said out loud, because a cove light
              belongs on top of a WALL unit, not under a worktop. */}
          {mount.face === 'top' && topFaceIsUnderCountertop && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertDescription className="text-amber-800">
                This unit has a countertop, so there is no space on top of it. The fixture is
                shown above the worktop instead — a cove light normally goes on top of a wall
                cabinet.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {mount.kind === 'wall' && (
        <>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            Wall
            <Select
              value={mount.wallId}
              onValueChange={(value) =>
                set({ mount: { ...mount, wallId: value as WallOrientation } })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WALLS.map((w) => (
                  <SelectItem key={w} value={w}>
                    {w.charAt(0).toUpperCase() + w.slice(1)} wall
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1">
            <NumField
              label="Along (mm)"
              value={mount.offsetMm}
              onChange={(offsetMm) => set({ mount: { ...mount, offsetMm } })}
            />
            <NumField
              label="Height (mm)"
              value={mount.heightMm}
              onChange={(heightMm) => set({ mount: { ...mount, heightMm } })}
            />
          </div>
        </>
      )}

      {mount.kind === 'ceiling' && (
        <div className="flex gap-1">
          <NumField
            label="X (mm)"
            value={mount.x}
            onChange={(x) => set({ mount: { ...mount, x } })}
          />
          <NumField
            label="Y (mm)"
            value={mount.y}
            onChange={(y) => set({ mount: { ...mount, y } })}
          />
        </div>
      )}

      {mount.kind === 'free' && (
        <>
          <div className="flex gap-1">
            <NumField
              label="X (mm)"
              value={mount.x}
              onChange={(x) => set({ mount: { ...mount, x } })}
            />
            <NumField
              label="Y (mm)"
              value={mount.y}
              onChange={(y) => set({ mount: { ...mount, y } })}
            />
            <NumField
              label="Height"
              value={mount.zMm}
              onChange={(zMm) => set({ mount: { ...mount, zMm } })}
            />
          </div>
          <span className="-mt-1 text-xs text-muted-foreground">
            Fixed coordinates, attached to nothing — it will not follow a cabinet. Ceiling is at{' '}
            {ceilingHeightMm}mm.
          </span>
        </>
      )}

      {placement && isVisibleWhenClosed(placement.item.kind) && (
        <>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            Throws
            <Select
              value={fixture.throwDirection ?? defaultThrowFor(placement.item.kind)}
              onValueChange={(value) => set({ throwDirection: value as ThrowDirection })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THROWS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {THROW_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="-mt-1 text-xs text-muted-foreground">
            {THROW_HINTS[fixture.throwDirection ?? defaultThrowFor(placement.item.kind)]}
          </span>
        </>
      )}

      {/* Rotation only for mounts with no host to take an axis from. A
          strip under a cabinet runs along that cabinet; turning it
          independently would mean nothing. */}
      {linear && (mount.kind === 'ceiling' || mount.kind === 'free') && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          Run direction
          <Select
            value={String(fixture.runRotationDeg ?? 0)}
            onValueChange={(value) => set({ runRotationDeg: value === '90' ? 90 : 0 })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">East–west</SelectItem>
              <SelectItem value="90">North–south</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {linear ? (
        <>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Run length (mm)
            <input
              type="number"
              min={0}
              step={50}
              value={placement?.runLengthMm ?? 0}
              onChange={(e) => set({ runLengthMm: Math.max(0, Number(e.target.value)) })}
              className={inputClass + ' w-20'}
            />
          </label>
          {mount.kind === 'cabinet' && fixture.runLengthMm !== undefined && (
            <Button
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-xs"
              onClick={() => set({ runLengthMm: undefined })}
            >
              Match the cabinet automatically
            </Button>
          )}
        </>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Quantity
            <input
              type="number"
              min={1}
              value={fixture.quantity}
              onChange={(e) => set({ quantity: Math.max(1, Number(e.target.value)) })}
              className={inputClass + ' w-16'}
            />
          </label>
          {/* A drawer light goes in every drawer, and the cabinet
              already knows how many it has (from its front layout) —
              so offer that number rather than making it be counted by
              hand. "3 sensor lights — drawer unit 600mm" is a schedule
              an electrician can work from; a bare "1" is not. */}
          {placement?.item.kind === 'drawer' && mount.kind === 'cabinet' && (
            <DrawerQuantityHint
              cabinetId={mount.cabinetId}
              current={fixture.quantity}
              onUse={(quantity) => set({ quantity })}
            />
          )}
        </>
      )}

      <Label className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
        Switched on
        <Checkbox checked={fixture.enabled} onCheckedChange={(checked) => set({ enabled: checked === true })} />
      </Label>
      <span className="-mt-1 text-xs text-muted-foreground">
        Affects the render only — it&apos;s still installed, and still quoted.
      </span>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Note for the electrician
        <input
          value={fixture.note ?? ''}
          onChange={(e) => set({ note: e.target.value || undefined })}
          placeholder="Dimmer at the door"
          className={inputClass + ' w-full'}
        />
      </label>

      {placement && (
        <div className="border-t border-gray-100 pt-2 text-xs text-muted-foreground">
          {(() => {
            const { amount, unit } = fixtureQuantity(placement);
            return (
              <>
                {amount.toFixed(unit === 'm' ? 2 : 0)} {unit} ·{' '}
                {currentLayout.priceElectrical
                  ? INR.format(fixtureCost(placement))
                  : `${INR.format(0)} (electrical not charged)`}
              </>
            );
          })()}
        </div>
      )}

      <Button variant="destructive" size="sm" onClick={() => removeFixture(fixture.id)}>
        Delete
      </Button>
    </div>
  );
}

function DrawerQuantityHint({
  cabinetId,
  current,
  onUse,
}: {
  cabinetId: string;
  current: number;
  onUse: (quantity: number) => void;
}) {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const cabinet = cabinets.find((c) => c.id === cabinetId);
  if (!cabinet) return null;

  const drawers = cabinetDrawerCount(cabinet);

  // Zero drawers is a real signal rather than an error state: a sensor
  // light in a door unit lights nothing, and saying so is more useful
  // than offering "0".
  if (drawers === 0) {
    return (
      <span className="-mt-1 text-xs text-amber-700">
        This cabinet has no drawers or pull-outs — a sensor light here won&apos;t light
        anything.
      </span>
    );
  }

  if (drawers === current) {
    return (
      <span className="-mt-1 text-xs text-muted-foreground">
        Matches this cabinet&apos;s {drawers} drawer{drawers > 1 ? 's' : ''}.
      </span>
    );
  }

  return (
    <Button
      variant="link"
      size="sm"
      className="-mt-1 h-auto self-start p-0 text-xs"
      onClick={() => onUse(drawers)}
    >
      This cabinet has {drawers} drawer{drawers > 1 ? 's' : ''} — use {drawers}
    </Button>
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
    <label className="flex flex-1 flex-col text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        step={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-[10px] border border-input px-1 py-0.5 text-xs"
      />
    </label>
  );
}
