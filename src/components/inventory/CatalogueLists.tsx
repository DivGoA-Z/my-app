// src/components/inventory/CatalogueLists.tsx
//
// The Catalogue's cabinets, appliances and pillars & shafts as clean,
// read-only lists; tap a row (or "+ New") to edit it in an EditPanel
// (§76). These replace table rows that were permanently open forms of
// tiny inputs — 70+ cabinet rows of them — with clipped names and tables
// wider than their box.
//
// Saving behaves exactly as the old rows did (same store actions, same
// confirm-before-delete). One rule carried over verbatim in spirit:
// a cabinet's `panels` are edited only in the Cabinet Designer, so a save
// from here always takes panels from the CURRENT stored row, never from
// the copy taken when the panel opened (§45) — otherwise saving a price
// would silently undo a Designer change made meanwhile.

import { useState } from 'react';
import { Box, Columns3, CookingPot, Droplets, Flame, Microwave, Refrigerator, Wind } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useLayoutStore } from '../../store/layoutStore';
import { BoardSelect } from '../common/BoardSelect';
import { EditPanel, Field, NumberField, TextField } from '../common/EditPanel';
import { describePanels, resolveCarcassBoard } from '../../lib/panels';
import { boardLabel } from '../../types/rates';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../../types/Catalog';
import type { ModuleType } from '../../types/cabinet';
import { FALLBACK_FINISH_ID } from '../../types/finish';
import { OBSTACLE_TYPE_LABELS, type ObstacleType } from '../../types/layout';
import { APPLIANCE_TYPE_LABELS, type ApplianceType } from '../../types/appliance';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from '../../lib/collision';
import {
  FRONT_KIND_LABELS,
  MAX_FRONT_COUNT,
  MIN_FRONT_COUNT,
  clampCount,
  defaultFrontLayout,
  type FrontKind,
  type FrontLayout,
} from '../../types/front';
import { useItemEditor } from './useItemEditor';
import { Chips, Empty, IconTile, ListRow, NewButton, SearchBox, SwatchTile } from './CatalogueKit';

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  'base-cabinet': 'Base unit',
  'wall-cabinet': 'Wall cabinet',
  'tall-unit': 'Tall unit',
  'sink-unit': 'Sink unit',
  'cylinder-trolley': 'Cylinder trolley',
  'drawer-unit': 'Drawer unit',
  'corner-blind': 'Corner (blind)',
  'corner-magic': 'Corner (magic)',
  'corner-carousel': 'Corner (carousel)',
  'pantry-unit': 'Pantry unit',
};
const MODULE_TYPES = Object.keys(MODULE_TYPE_LABELS) as ModuleType[];
const OBSTACLE_TYPES: ObstacleType[] = ['pillar', 'shaft', 'exposed-pipe', 'electrical-panel'];
// 'sink' must stay listed: after the sink became an appliance it was
// missing here once, and no sink row could be created at all.
const APPLIANCE_TYPES: ApplianceType[] = [
  'sink', 'stove', 'chimney', 'oven', 'otg', 'toaster', 'fridge', 'microwave', 'dishwasher', 'water-purifier',
];
const FRONT_KINDS: FrontKind[] = [
  'single-door', 'double-door', 'drawers', 'trolley', 'open-shelf', 'false-front', 'appliance-housing', 'tambour',
];
const AUTO_FRONT_VALUE = '__auto__';
const DEFAULT_HANDLE_VALUE = '__default__';

const APPLIANCE_ICONS: Partial<Record<ApplianceType, typeof Box>> = {
  sink: Droplets,
  stove: Flame,
  chimney: Wind,
  fridge: Refrigerator,
  microwave: Microwave,
  oven: CookingPot,
  otg: CookingPot,
};

const mm = (...n: number[]) => n.join(' × ');

// ---- Cabinets ----

export function CabinetList({ onOpenDesigner }: { onOpenDesigner?: (itemId: string) => void }) {
  const items = useLayoutStore((s) => s.cabinetCatalog);
  const finishes = useLayoutStore((s) => s.finishes);
  const rateCard = useLayoutStore((s) => s.rateCard);
  const upsert = useLayoutStore((s) => s.upsertCabinetCatalogItem);
  const remove = useLayoutStore((s) => s.removeCabinetCatalogItem);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = Array.from(new Set(items.map((c) => c.category).filter(Boolean)));
  const ed = useItemEditor<CatalogItem>(upsert, remove, (draft) => ({
    ...draft,
    panels: items.find((c) => c.id === draft.id)?.panels ?? draft.panels,
  }));

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (c) =>
      (category === 'All' || c.category === category) &&
      (!q || [c.label, c.category, MODULE_TYPE_LABELS[c.moduleType]].some((f) => f?.toLowerCase().includes(q)))
  );

  const blank = (): CatalogItem => ({
    id: crypto.randomUUID(),
    category: category !== 'All' ? category : (categories[0] ?? 'Base'),
    label: '',
    moduleType: 'base-cabinet',
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
    material: 'HDMR',
    finishId: FALLBACK_FINISH_ID,
    unitPrice: 10000,
    createdAt: '',
    updatedAt: '',
  });

  const d = ed.editing?.draft;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Search cabinets" />
        <NewButton label="New cabinet" onClick={() => ed.open(blank(), true)} />
      </div>
      {categories.length > 1 && <Chips options={['All', ...categories]} value={category} onChange={setCategory} />}
      <div className="flex flex-col">
        {shown.map((c) => {
          const board = resolveCarcassBoard(rateCard.boards, c);
          const finish = finishes.find((f) => f.id === c.finishId);
          return (
            <ListRow
              key={c.id}
              onClick={() => ed.open(c, false)}
              media={<SwatchTile finishId={c.finishId} />}
              title={c.label}
              sub={`${MODULE_TYPE_LABELS[c.moduleType]} · ${c.category} · ${mm(c.widthMm, c.depthMm, c.heightMm)}`}
              facts={
                <>
                  <span className="w-40 truncate">{board ? boardLabel(board) : 'No board'}</span>
                  <span className="w-40 truncate">{finish?.label ?? '—'}</span>
                </>
              }
              end={<span className="w-24 shrink-0 text-right text-[15px] font-bold">{INR.format(c.unitPrice)}</span>}
            />
          );
        })}
        {shown.length === 0 && <Empty>{items.length === 0 ? 'No cabinets yet. Add your first one.' : 'Nothing matches.'}</Empty>}
      </div>

      <datalist id="catalog-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <EditPanel
        open={!!d}
        onOpenChange={(o) => !o && ed.close()}
        title={ed.editing?.isNew ? 'New cabinet' : (d?.label ?? '')}
        subtitle="Catalogue default: cabinets added from now on start with these."
        onSave={ed.commit}
        saveLabel={ed.editing?.isNew ? 'Add cabinet' : 'Save'}
        saving={ed.saving}
        error={ed.error}
        onDelete={ed.editing?.isNew ? undefined : ed.destroy}
      >
        {d && (
          <>
            <TextField label="Name" value={d.label} onChange={(label) => ed.setDraft({ ...d, label })} placeholder="e.g. Base 600" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="Category" value={d.category} list="catalog-categories" onChange={(category) => ed.setDraft({ ...d, category })} />
              <Field label="Type">
                <Select value={d.moduleType} onValueChange={(v) => ed.setDraft({ ...d, moduleType: v as ModuleType })}>
                  <SelectTrigger className="h-11! w-full rounded-[10px] bg-card text-[15px] font-normal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_TYPES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODULE_TYPE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Width" unit="mm" min={50} value={d.widthMm} onChange={(widthMm) => ed.setDraft({ ...d, widthMm })} />
              <NumberField label="Depth" unit="mm" min={50} value={d.depthMm} onChange={(depthMm) => ed.setDraft({ ...d, depthMm })} />
              <NumberField label="Height" unit="mm" min={50} value={d.heightMm} onChange={(heightMm) => ed.setDraft({ ...d, heightMm })} />
            </div>
            <Field
              label="Carcass board"
              hint={
                ed.editing?.isNew ? undefined : (
                  <span className="flex flex-wrap items-center gap-x-2">
                    {describePanels(items.find((c) => c.id === d.id)?.panels)}
                    {onOpenDesigner && (
                      <Button type="button" variant="link" className="h-auto p-0 text-[13px] font-semibold" onClick={() => onOpenDesigner(d.id)}>
                        Panels &amp; boards…
                      </Button>
                    )}
                  </span>
                )
              }
            >
              <BoardSelect
                material={d.material}
                carcassBoardId={d.carcassBoardId}
                onChange={(patch) => ed.setDraft({ ...d, ...patch })}
                triggerClassName="h-11! w-full rounded-[10px] bg-card text-[15px] font-normal"
              />
            </Field>
            <Field label="Finish">
              <Select value={d.finishId} onValueChange={(finishId) => ed.setDraft({ ...d, finishId })}>
                <SelectTrigger className="h-11! w-full rounded-[10px] bg-card text-[15px] font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {finishes.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.brand ? `${f.brand} ${f.label}` : f.label} ({f.finishTypeLabel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <FrontFields
              moduleType={d.moduleType}
              widthMm={d.widthMm}
              frontLayout={d.frontLayout}
              handleId={d.handleId}
              onChange={(frontLayout, handleId) => ed.setDraft({ ...d, frontLayout, handleId })}
            />
            <NumberField label="Price" prefix="₹" min={0} value={d.unitPrice} onChange={(unitPrice) => ed.setDraft({ ...d, unitPrice })} />
          </>
        )}
      </EditPanel>
    </>
  );
}

// Default front and handle for a catalogue row. Both optional: left on
// "Automatic", the row stores nothing and cabinets fall through to
// defaultFrontLayout(moduleType, widthMm) at READ time, so improving
// that rule later still reaches every row (freezing today's guess into
// each row would stop it).
function FrontFields({
  moduleType,
  widthMm,
  frontLayout,
  handleId,
  onChange,
}: {
  moduleType: ModuleType;
  widthMm: number;
  frontLayout: FrontLayout | undefined;
  handleId: string | undefined;
  onChange: (frontLayout: FrontLayout | undefined, handleId: string | undefined) => void;
}) {
  const handles = useLayoutStore((s) => s.handles);
  const auto = defaultFrontLayout(moduleType, widthMm);
  const counted =
    frontLayout && (frontLayout.kind === 'drawers' || frontLayout.kind === 'open-shelf' || frontLayout.kind === 'trolley');
  const trigger = 'h-11! w-full rounded-[10px] bg-card text-[15px] font-normal';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Front">
        <Select
          value={frontLayout?.kind ?? AUTO_FRONT_VALUE}
          onValueChange={(v) =>
            onChange(v === AUTO_FRONT_VALUE ? undefined : { kind: v as FrontKind, count: auto.count ?? 3 }, handleId)
          }
        >
          <SelectTrigger className={trigger} aria-label="Default front configuration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_FRONT_VALUE}>Automatic ({FRONT_KIND_LABELS[auto.kind]})</SelectItem>
            {FRONT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {FRONT_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Handle">
        <Select value={handleId ?? DEFAULT_HANDLE_VALUE} onValueChange={(v) => onChange(frontLayout, v === DEFAULT_HANDLE_VALUE ? undefined : v)}>
          <SelectTrigger className={trigger} aria-label="Default handle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_HANDLE_VALUE}>Default handle</SelectItem>
            {handles.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {counted && (
        <NumberField
          label="How many"
          min={MIN_FRONT_COUNT}
          max={MAX_FRONT_COUNT}
          value={clampCount(frontLayout!.count)}
          onChange={(n) => onChange({ ...frontLayout!, count: clampCount(n), heightRatios: undefined }, handleId)}
        />
      )}
    </div>
  );
}

// ---- Appliances ----

// The two axes a wrongly exported .glb needs fixing on, named by what
// you SEE rather than as Euler angles. Roll (Z) is deliberately not
// offered: no real appliance export needs it.
const UP_AXIS_OPTIONS = [
  { label: 'Upright', xDeg: 0 },
  { label: 'Lying on its side (Z-up export)', xDeg: -90 },
  { label: 'Upside down', xDeg: 180 },
];
const FACING_OPTIONS = [
  { label: 'Faces front', yDeg: 0 },
  { label: 'Faces right', yDeg: 90 },
  { label: 'Faces back', yDeg: 180 },
  { label: 'Faces left', yDeg: 270 },
];

export function ApplianceList() {
  const items = useLayoutStore((s) => s.applianceCatalog);
  const upsert = useLayoutStore((s) => s.upsertApplianceCatalogItem);
  const remove = useLayoutStore((s) => s.removeApplianceCatalogItem);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All');
  const ed = useItemEditor<ApplianceCatalogItem>(upsert, remove);
  const present = APPLIANCE_TYPES.filter((t) => items.some((i) => i.applianceType === t));

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (type === 'All' || APPLIANCE_TYPE_LABELS[i.applianceType] === type) &&
      (!q || [i.label, APPLIANCE_TYPE_LABELS[i.applianceType]].some((f) => f.toLowerCase().includes(q)))
  );
  const blank = (): ApplianceCatalogItem => ({
    id: crypto.randomUUID(),
    label: '',
    applianceType: 'stove',
    widthMm: 600,
    depthMm: 550,
    heightMm: 100,
    defaultElevationMm: 850,
    modelUrl: undefined,
    unitPrice: 30000,
    createdAt: '',
    updatedAt: '',
  });
  const d = ed.editing?.draft;
  const upKnown = d ? UP_AXIS_OPTIONS.some((o) => o.xDeg === (d.modelRotationXDeg ?? 0)) : true;
  const faceKnown = d ? FACING_OPTIONS.some((o) => o.yDeg === (d.modelRotationYDeg ?? 0)) : true;
  const trigger = 'h-11! w-full rounded-[10px] bg-card text-[15px] font-normal';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Search appliances" />
        <NewButton label="New appliance" onClick={() => ed.open(blank(), true)} />
      </div>
      {present.length > 1 && (
        <Chips options={['All', ...present.map((t) => APPLIANCE_TYPE_LABELS[t])]} value={type} onChange={setType} />
      )}
      <div className="flex flex-col">
        {shown.map((i) => (
          <ListRow
            key={i.id}
            onClick={() => ed.open(i, false)}
            media={<IconTile Icon={APPLIANCE_ICONS[i.applianceType] ?? Box} />}
            title={i.label}
            sub={`${APPLIANCE_TYPE_LABELS[i.applianceType]} · ${mm(i.widthMm, i.depthMm, i.heightMm)}`}
            facts={<span className="w-36 truncate">{i.defaultElevationMm} mm off the floor</span>}
            end={<span className="w-24 shrink-0 text-right text-[15px] font-bold">{INR.format(i.unitPrice)}</span>}
          />
        ))}
        {shown.length === 0 && <Empty>{items.length === 0 ? 'No appliances yet.' : 'Nothing matches.'}</Empty>}
      </div>

      <EditPanel
        open={!!d}
        onOpenChange={(o) => !o && ed.close()}
        title={ed.editing?.isNew ? 'New appliance' : (d?.label ?? '')}
        onSave={ed.commit}
        saveLabel={ed.editing?.isNew ? 'Add appliance' : 'Save'}
        saving={ed.saving}
        error={ed.error}
        onDelete={ed.editing?.isNew ? undefined : ed.destroy}
      >
        {d && (
          <>
            <TextField label="Name" value={d.label} onChange={(label) => ed.setDraft({ ...d, label })} />
            <Field label="Type">
              <Select value={d.applianceType} onValueChange={(v) => ed.setDraft({ ...d, applianceType: v as ApplianceType })}>
                <SelectTrigger className={trigger}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPLIANCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {APPLIANCE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Width" unit="mm" min={50} value={d.widthMm} onChange={(widthMm) => ed.setDraft({ ...d, widthMm })} />
              <NumberField label="Depth" unit="mm" min={50} value={d.depthMm} onChange={(depthMm) => ed.setDraft({ ...d, depthMm })} />
              <NumberField label="Height" unit="mm" min={10} value={d.heightMm} onChange={(heightMm) => ed.setDraft({ ...d, heightMm })} />
            </div>
            <NumberField
              label="Height off the floor"
              unit="mm"
              min={0}
              value={d.defaultElevationMm}
              onChange={(defaultElevationMm) => ed.setDraft({ ...d, defaultElevationMm })}
              hint="Where its bottom sits when placed: about 850 on a counter, higher for a chimney."
            />
            {d.applianceType === 'sink' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Countertop cutout width"
                  unit="mm"
                  min={0}
                  value={d.sinkCutoutWidthMm ?? 0}
                  onChange={(n) => ed.setDraft({ ...d, sinkCutoutWidthMm: n || undefined })}
                />
                <NumberField
                  label="Cutout depth"
                  unit="mm"
                  min={0}
                  value={d.sinkCutoutDepthMm ?? 0}
                  onChange={(n) => ed.setDraft({ ...d, sinkCutoutDepthMm: n || undefined })}
                />
              </div>
            )}
            <NumberField label="Price" prefix="₹" min={0} value={d.unitPrice} onChange={(unitPrice) => ed.setDraft({ ...d, unitPrice })} />
            <div className="flex flex-col gap-4 rounded-2xl bg-secondary/60 p-4">
              <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">3D model</span>
              <TextField
                label="Model file"
                value={d.modelUrl ?? ''}
                onChange={(v) => ed.setDraft({ ...d, modelUrl: v || undefined })}
                placeholder="/models/hob-600.glb"
                hint="Leave empty to show a plain box in 3D."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Orientation">
                  <Select value={String(d.modelRotationXDeg ?? 0)} onValueChange={(v) => ed.setDraft({ ...d, modelRotationXDeg: Number(v) })}>
                    <SelectTrigger className={trigger} aria-label="Model up axis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UP_AXIS_OPTIONS.map((o) => (
                        <SelectItem key={o.xDeg} value={String(o.xDeg)}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {!upKnown && <SelectItem value={String(d.modelRotationXDeg)}>{`Custom (${d.modelRotationXDeg}°)`}</SelectItem>}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Facing">
                  <Select value={String(d.modelRotationYDeg ?? 0)} onValueChange={(v) => ed.setDraft({ ...d, modelRotationYDeg: Number(v) })}>
                    <SelectTrigger className={trigger} aria-label="Model facing direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FACING_OPTIONS.map((o) => (
                        <SelectItem key={o.yDeg} value={String(o.yDeg)}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {!faceKnown && <SelectItem value={String(d.modelRotationYDeg)}>{`Custom (${d.modelRotationYDeg}°)`}</SelectItem>}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </>
        )}
      </EditPanel>
    </>
  );
}

// ---- Pillars & shafts ----

export function ObstacleList() {
  const items = useLayoutStore((s) => s.obstaclePresets);
  const upsert = useLayoutStore((s) => s.upsertObstaclePreset);
  const remove = useLayoutStore((s) => s.removeObstaclePreset);
  const ed = useItemEditor<ObstaclePreset>(upsert, remove);
  const blank = (): ObstaclePreset => ({
    id: crypto.randomUUID(),
    label: '',
    type: 'pillar',
    widthMm: 300,
    depthMm: 300,
    floorToCeiling: true,
    heightMm: PARTIAL_OBSTACLE_HEIGHT_MM,
    elevationMm: 0,
    createdAt: '',
    updatedAt: '',
  });
  const d = ed.editing?.draft;
  return (
    <>
      <div className="flex justify-end">
        <NewButton label="New preset" onClick={() => ed.open(blank(), true)} />
      </div>
      <div className="flex flex-col">
        {items.map((p) => (
          <ListRow
            key={p.id}
            onClick={() => ed.open(p, false)}
            media={<IconTile Icon={Columns3} />}
            title={p.label}
            sub={`${OBSTACLE_TYPE_LABELS[p.type]} · ${mm(p.widthMm, p.depthMm)}${p.floorToCeiling ? ' · floor to ceiling' : ` · ${p.heightMm} high`}`}
          />
        ))}
        {items.length === 0 && <Empty>No presets yet.</Empty>}
      </div>
      <EditPanel
        open={!!d}
        onOpenChange={(o) => !o && ed.close()}
        title={ed.editing?.isNew ? 'New preset' : (d?.label ?? '')}
        onSave={ed.commit}
        saveLabel={ed.editing?.isNew ? 'Add preset' : 'Save'}
        saving={ed.saving}
        error={ed.error}
        onDelete={ed.editing?.isNew ? undefined : ed.destroy}
      >
        {d && (
          <>
            <TextField label="Name" value={d.label} onChange={(label) => ed.setDraft({ ...d, label })} placeholder="e.g. Standard column 300" />
            <Field label="Type">
              <Select value={d.type} onValueChange={(v) => ed.setDraft({ ...d, type: v as ObstacleType })}>
                <SelectTrigger className="h-11! w-full rounded-[10px] bg-card text-[15px] font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBSTACLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {OBSTACLE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Width" unit="mm" min={50} value={d.widthMm} onChange={(widthMm) => ed.setDraft({ ...d, widthMm })} />
              <NumberField label="Depth" unit="mm" min={50} value={d.depthMm} onChange={(depthMm) => ed.setDraft({ ...d, depthMm })} />
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-input bg-card px-4 py-3 text-[15px] font-semibold">
              <Checkbox checked={d.floorToCeiling} onCheckedChange={(c) => ed.setDraft({ ...d, floorToCeiling: c === true })} />
              Floor to ceiling
            </label>
            {!d.floorToCeiling && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Height" unit="mm" min={50} value={d.heightMm} onChange={(heightMm) => ed.setDraft({ ...d, heightMm })} />
                <NumberField
                  label="Off the floor"
                  unit="mm"
                  min={0}
                  value={d.elevationMm}
                  onChange={(elevationMm) => ed.setDraft({ ...d, elevationMm })}
                  hint="e.g. a mid-wall electrical box"
                />
              </div>
            )}
          </>
        )}
      </EditPanel>
    </>
  );
}
