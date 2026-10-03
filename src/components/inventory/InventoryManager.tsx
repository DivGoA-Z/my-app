// src/components/inventory/InventoryManager.tsx
//
// Where a business builds and maintains its OWN set of favorite
// pieces — cabinet catalog items (what shows up as "add" buttons in
// CabinetToolbar), obstacle presets (quick-add buttons in
// ObstacleToolbar), and appliance catalog items (add buttons in
// ApplianceToolbar) — instead of being stuck with one fixed, shared
// catalog. Every save/delete here goes straight to Supabase via the
// layoutStore's upsert/remove actions (lib/Inventory.ts underneath),
// and all three toolbars read the SAME store state, so a change made
// here shows up next time any toolbar renders — no separate refresh
// step.
//
// Not tied to any one client/project — this is business-level data, so
// it's reachable from the dashboard as well as from inside a layout
// (see App.tsx).

import { CatalogueSection } from './CatalogueSection';
import { catalogueSectionElementId, type CatalogueSectionId } from './catalogueSections';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { confirmDialog } from '../../store/confirmDialogStore';
import { BoardSelect } from '../common/BoardSelect';
import { describePanels } from '../../lib/panels';
import { useLayoutStore } from '../../store/layoutStore';
import { FinishManager } from './FinishManager';
import { HandleManager } from './HandleManager';
import { FixtureManager } from './FixtureManager';
import { CabinetCatalogImportExport } from './CabinetCatalogImportExport';
import { ObstaclePresetImportExport } from './ObstaclePresetImportExport';
import { ApplianceCatalogImportExport } from './ApplianceCatalogImportExport';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../../types/Catalog';
import type { ModuleType } from '../../types/cabinet';
import { FALLBACK_FINISH_ID } from '../../types/finish';
import type { ObstacleType } from '../../types/layout';
import type { ApplianceType } from '../../types/appliance';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from '../../lib/collision';
import {
  FRONT_KIND_LABELS,
  MAX_FRONT_COUNT,
  MIN_FRONT_COUNT,
  clampCount,
  defaultFrontLayout,
} from '../../types/front';
import type { FrontKind, FrontLayout } from '../../types/front';

const FRONT_KINDS: FrontKind[] = [
  'single-door',
  'double-door',
  'drawers',
  'trolley',
  'open-shelf',
  'false-front',
  'appliance-housing',
  'tambour',
];

const MODULE_TYPES: ModuleType[] = [
  'base-cabinet',
  'wall-cabinet',
  'tall-unit',
  'sink-unit',
  'cylinder-trolley',
  'drawer-unit',
  'corner-blind',
  'corner-magic',
  'corner-carousel',
  'pantry-unit',
];
const OBSTACLE_TYPES: ObstacleType[] = ['pillar', 'shaft', 'exposed-pipe', 'electrical-panel'];
// 'sink' was missing here after the sink moved out of the cabinet
// module types and became an appliance — the union and the DB check
// constraint both allowed it, but there was no way to pick it in the
// UI, so no sink catalogue row could be created and the .glb couldn't
// be used at all.
const APPLIANCE_TYPES: ApplianceType[] = [
  'sink',
  'stove',
  'chimney',
  'oven',
  'otg',
  'toaster',
  'fridge',
  'microwave',
  'dishwasher',
  'water-purifier',
];

// The two axes a wrongly-exported .glb actually needs fixing on, named
// in terms of what the user SEES rather than as Euler angles. Typing
// "-90" into an X-rotation box requires knowing that glTF is Y-up and
// Blender is Z-up; picking "Lying on its side" does not.
//
// Z rotation (roll) is deliberately not exposed. It exists in the data
// model for completeness but no real appliance export needs it, and a
// third dropdown would make the common case harder to find.
const UP_AXIS_OPTIONS: { label: string; xDeg: number }[] = [
  { label: 'Upright', xDeg: 0 },
  { label: 'Lying on its side (Z-up export)', xDeg: -90 },
  { label: 'Upside down', xDeg: 180 },
];

const FACING_OPTIONS: { label: string; yDeg: number }[] = [
  { label: 'Front', yDeg: 0 },
  { label: 'Right', yDeg: 90 },
  { label: 'Back', yDeg: 180 },
  { label: 'Left', yDeg: 270 },
];

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inputClass = 'rounded border border-input px-2 py-1 text-xs';

// Radix Select rejects an empty-string item value, so "no override,
// fall through to the automatic default" / "no handle chosen" need
// real sentinels, mapped back to `undefined` in CatalogFrontFields'
// own handlers.
const AUTO_FRONT_VALUE = '__auto__';
const DEFAULT_HANDLE_VALUE = '__default__';

// Which toolbar's "Manage" button was clicked — used only to scroll to
// that section on open. This is a single scrolling page (see the note
// at the top of this file), so without this every "Manage" click landed
// on the same generic top of the page regardless of which catalog you
// meant, and you had to scroll to find it yourself.
export type InventorySection = CatalogueSectionId;

export function InventoryManager({
  initialSection,
  onOpenDesigner,
}: {
  initialSection?: InventorySection;
  // Opens the Cabinet Designer on a catalogue row (App.tsx owns views).
  onOpenDesigner?: (itemId: string) => void;
} = {}) {
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const obstaclePresets = useLayoutStore((s) => s.obstaclePresets);
  const applianceCatalog = useLayoutStore((s) => s.applianceCatalog);
  const finishCount = useLayoutStore((s) => s.finishes.length);
  const handleCount = useLayoutStore((s) => s.handles.length);
  const fixtureCount = useLayoutStore((s) => s.fixtureCatalog.length);
  const isInventoryLoading = useLayoutStore((s) => s.isInventoryLoading);
  const inventoryError = useLayoutStore((s) => s.inventoryError);
  const upsertCabinetCatalogItem = useLayoutStore((s) => s.upsertCabinetCatalogItem);
  const removeCabinetCatalogItem = useLayoutStore((s) => s.removeCabinetCatalogItem);
  const upsertObstaclePreset = useLayoutStore((s) => s.upsertObstaclePreset);
  const removeObstaclePreset = useLayoutStore((s) => s.removeObstaclePreset);
  const upsertApplianceCatalogItem = useLayoutStore((s) => s.upsertApplianceCatalogItem);
  const removeApplianceCatalogItem = useLayoutStore((s) => s.removeApplianceCatalogItem);

  const categories = Array.from(new Set(cabinetCatalog.map((c) => c.category)));

  // Re-runs once loading finishes too, in case initialSection's element
  // wasn't in the DOM yet on the first render (it's inside the
  // isInventoryLoading ternary below).
  useEffect(() => {
    if (!initialSection) return;
    document.getElementById(catalogueSectionElementId(initialSection))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [initialSection, isInventoryLoading]);

  return (
    <div className="flex flex-col gap-6">
      {inventoryError && (
        <Alert variant="destructive">
          <AlertDescription>{inventoryError}</AlertDescription>
        </Alert>
      )}

      {/* The rate card moved to Settings → Rate card (§70): this page is
          what you pick from when designing; Settings is how the business
          prices and builds. Its placeholder banner went with it, and Home
          shows the same warning until the rates are replaced, so the
          disclosure is still the first thing a business sees.

          Section order changed in §71 from "dependency order" (finishes
          and handles before the cabinets that reference them) to "most
          used first": cabinets are what a designer opens this page for,
          and nothing breaks if a finish is added after a cabinet. */}
      {isInventoryLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <CatalogueSection
            id="cabinets"
            count={cabinetCatalog.length}
            description="Your modules, as they appear in the design editor. Changes apply to designs started from now on."
            help={
              <p>
                Each row is one module you sell. "Panels & boards" opens the Cabinet Designer for the
                row's default panels, which every cabinet added from it starts with. Bulk-edit the
                whole list in Excel with the panel below.
              </p>
            }
          >
            <CabinetCatalogImportExport />
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary text-[13px] text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">W×D×H (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">Board</th>
                    <th className="px-3 py-2.5 font-semibold">Finish</th>
                    <th className="px-3 py-2.5 font-semibold">Default front</th>
                    <th className="px-3 py-2.5 font-semibold">Price</th>
                    <th className="px-3 py-2.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {cabinetCatalog.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                        No cabinet pieces yet — add your first one below.
                      </td>
                    </tr>
                  )}
                  {cabinetCatalog.map((item) => (
                    <CabinetCatalogRow
                      key={item.id}
                      item={item}
                      categorySuggestions={categories}
                      onSave={upsertCabinetCatalogItem}
                      onDelete={removeCabinetCatalogItem}
                      onOpenDesigner={onOpenDesigner}
                    />
                  ))}
                  <NewCabinetItemRow categorySuggestions={categories} onAdd={upsertCabinetCatalogItem} />
                </tbody>
              </table>
            </div>

          </CatalogueSection>

          <CatalogueSection
            id="appliances"
            count={applianceCatalog.length}
            description="Hobs, chimneys, sinks, fridges. Usually customer-supplied; their size drives the cabinets around them."
            help={
              <>
                <p>
                  <strong className="text-foreground">Elevation</strong> is how high off the floor the
                  appliance's bottom sits when placed: about 850mm for something on the counter, higher
                  for a chimney above a hob.
                </p>
                <p>
                  <strong className="text-foreground">Model orientation</strong> corrects a 3D model that
                  was exported the wrong way up or facing the wrong way. Set it once here. To turn an
                  appliance in one kitchen, rotate it on the plan instead.
                </p>
                <p>
                  <strong className="text-foreground">Sink cutout</strong> is the hole cut into the
                  countertop for a sink, a little smaller than the sink by its rim. Leave both at 0 for
                  a sink that sits on an uncut slab. Shown for sinks only.
                </p>
              </>
            }
          >
            <ApplianceCatalogImportExport />

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary text-[13px] text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">W×D×H (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">Elevation (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">Sink cutout W×D (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">3D Model</th>
                    <th className="px-3 py-2.5 font-semibold">Model orientation</th>
                    <th className="px-3 py-2.5 font-semibold">Price</th>
                    <th className="px-3 py-2.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {applianceCatalog.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                        No appliances yet — add your first one below.
                      </td>
                    </tr>
                  )}
                  {applianceCatalog.map((item) => (
                    <ApplianceCatalogRow
                      key={item.id}
                      item={item}
                      onSave={upsertApplianceCatalogItem}
                      onDelete={removeApplianceCatalogItem}
                    />
                  ))}
                  <NewApplianceCatalogRow onAdd={upsertApplianceCatalogItem} />
                </tbody>
              </table>
            </div>
          </CatalogueSection>

          <CatalogueSection
            id="finishes"
            count={finishCount}
            description="The shutter and laminate materials you stock. Each one's price per m² feeds the quote."
          >
            <FinishManager />
          </CatalogueSection>

          <CatalogueSection
            id="handles"
            count={handleCount}
            description="Hardware for cabinet fronts, priced per piece or per running metre."
            help={
              <p>
                <strong className="text-foreground">Priced by</strong> is the one to get right: bar
                handles and knobs are per piece; gola and edge profiles are cut to length and billed per
                running metre. Cabinets using a handle you delete fall back to the default, so they keep
                a hardware cost.
              </p>
            }
          >
            <HandleManager />
          </CatalogueSection>

          <CatalogueSection
            id="fixtures"
            count={fixtureCount}
            description="Strips, spots, cove and plinth runs for the lighting design."
            help={
              <p>
                Runs are priced per metre, spots and pendants per piece.{' '}
                <strong className="text-foreground">Lumens</strong> sets how bright a fixture looks in 3D,
                and decides which fixtures get a real light when a kitchen has more than the 3D view can
                draw.
              </p>
            }
          >
            <FixtureManager />
          </CatalogueSection>

          <CatalogueSection
            id="obstacles"
            count={obstaclePresets.length}
            description="Quick-add sizes for the columns, ducts and shafts you meet on site."
            help={
              <p>
                Height and "off floor" only apply when floor-to-ceiling is off; otherwise the obstacle runs
                the room's full height from the floor. "Off floor" lets a preset, such as a mid-wall
                electrical box, start above the floor.
              </p>
            }
          >
            <ObstaclePresetImportExport />

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary text-[13px] text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">W×D (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">Floor-to-ceiling</th>
                    <th className="px-3 py-2.5 font-semibold">Height (mm)</th>
                    <th className="px-3 py-2.5 font-semibold">Off floor (mm)</th>
                    <th className="px-3 py-2.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {obstaclePresets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No obstacle presets yet — add your first one below.
                      </td>
                    </tr>
                  )}
                  {obstaclePresets.map((preset) => (
                    <ObstaclePresetRow
                      key={preset.id}
                      preset={preset}
                      onSave={upsertObstaclePreset}
                      onDelete={removeObstaclePreset}
                    />
                  ))}
                  <NewObstaclePresetRow onAdd={upsertObstaclePreset} />
                </tbody>
              </table>
            </div>

          </CatalogueSection>
        </>
      )}
    </div>
  );
}

// ---- Cabinet catalog rows ----

interface CabinetCatalogRowProps {
  item: CatalogItem;
  categorySuggestions: string[];
  onSave: (item: CatalogItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDesigner?: (itemId: string) => void;
}

function CabinetCatalogRow({ item, categorySuggestions, onSave, onDelete, onOpenDesigner }: CabinetCatalogRowProps) {
  const finishes = useLayoutStore((state) => state.finishes);
  const [draft, setDraft] = useState(item);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      // `panels` always comes from the CURRENT saved row, never this
      // row's draft: panels are edited only in the Cabinet Designer, and
      // this draft was copied once when the row first rendered. Saving
      // the draft's copy would silently undo whatever the Designer saved
      // since (§45).
      await onSave({ ...draft, panels: item.panels });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirmDialog({ title: `Delete "${item.label}"?`, description: "This can't be undone." })))
      return;
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(item.id);
      toast.success(`Deleted "${item.label}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.';
      setError(message);
      toast.error('Failed to delete', { description: message });
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-border/70 align-top last:border-b-0">
      <td className="px-3 py-2">
        <input
          list="catalog-categories"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          className={inputClass + ' w-24'}
        />
        <datalist id="catalog-categories">
          {categorySuggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </td>
      <td className="px-3 py-2">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-3 py-2">
        <Select
          value={draft.moduleType}
          onValueChange={(value) => setDraft({ ...draft, moduleType: value as ModuleType })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULE_TYPES.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.heightMm}
            onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <BoardSelect
          material={draft.material}
          carcassBoardId={draft.carcassBoardId}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
        />
        {/* The panels this product starts with, in one line, and the way
            to change them — the Cabinet Designer (§45). */}
        <div className="mt-0.5 text-xs text-muted-foreground">{describePanels(item.panels)}</div>
        {onOpenDesigner && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-[13px]"
            onClick={() => onOpenDesigner(item.id)}
          >
            Panels & boards…
          </Button>
        )}
      </td>
      <td className="px-3 py-2">
        <Select value={draft.finishId} onValueChange={(value) => setDraft({ ...draft, finishId: value })}>
          <SelectTrigger size="sm">
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
      </td>
      <td className="px-3 py-2">
        <CatalogFrontFields
          moduleType={draft.moduleType}
          widthMm={draft.widthMm}
          frontLayout={draft.frontLayout}
          handleId={draft.handleId}
          onChange={(frontLayout, handleId) => setDraft({ ...draft, frontLayout, handleId })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
        <div className="mt-0.5 text-xs text-muted-foreground">{INR_FORMATTER.format(draft.unitPrice)}</div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <Button size="xs" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>
          <Button size="xs" variant="destructive" onClick={handleDelete} disabled={isSaving}>
            Delete
          </Button>
        </div>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

function NewCabinetItemRow({
  categorySuggestions,
  onAdd,
}: {
  categorySuggestions: string[];
  onAdd: (item: CatalogItem) => Promise<void>;
}) {
  const blank = (): Omit<CatalogItem, 'id' | 'createdAt' | 'updatedAt'> => ({
    category: categorySuggestions[0] ?? 'Base',
    label: '',
    moduleType: 'base-cabinet',
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
    material: 'HDMR',
    finishId: FALLBACK_FINISH_ID,
    unitPrice: 10000,
  });

  const finishes = useLayoutStore((state) => state.finishes);
  const [draft, setDraft] = useState(blank());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!draft.label.trim()) {
      setError('Name it first.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      await onAdd({ ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
      setDraft(blank());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="bg-secondary align-top">
      <td className="px-3 py-2">
        <input
          list="catalog-categories"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          className={inputClass + ' w-24'}
        />
      </td>
      <td className="px-3 py-2">
        <input
          placeholder="New piece name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-3 py-2">
        <Select
          value={draft.moduleType}
          onValueChange={(value) => setDraft({ ...draft, moduleType: value as ModuleType })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULE_TYPES.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.heightMm}
            onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <BoardSelect
          material={draft.material}
          carcassBoardId={draft.carcassBoardId}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
        />
      </td>
      <td className="px-3 py-2">
        <Select value={draft.finishId} onValueChange={(value) => setDraft({ ...draft, finishId: value })}>
          <SelectTrigger size="sm">
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
      </td>
      <td className="px-3 py-2">
        <CatalogFrontFields
          moduleType={draft.moduleType}
          widthMm={draft.widthMm}
          frontLayout={draft.frontLayout}
          handleId={draft.handleId}
          onChange={(frontLayout, handleId) => setDraft({ ...draft, frontLayout, handleId })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
      </td>
      <td className="px-3 py-2">
        <Button size="xs" onClick={handleAdd} disabled={isSaving}>
          + Add
        </Button>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

// ---- Obstacle preset rows ----

interface ObstaclePresetRowProps {
  preset: ObstaclePreset;
  onSave: (preset: ObstaclePreset) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function ObstaclePresetRow({ preset, onSave, onDelete }: ObstaclePresetRowProps) {
  const [draft, setDraft] = useState(preset);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (
      !(await confirmDialog({ title: `Delete "${preset.label}"?`, description: "This can't be undone." }))
    )
      return;
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(preset.id);
      toast.success(`Deleted "${preset.label}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.';
      setError(message);
      toast.error('Failed to delete', { description: message });
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-border/70 align-top last:border-b-0">
      <td className="px-3 py-2">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-3 py-2">
        <Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value as ObstacleType })}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OBSTACLE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-16'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-16'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <Checkbox
          checked={draft.floorToCeiling}
          onCheckedChange={(checked) => setDraft({ ...draft, floorToCeiling: checked === true })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={50}
          value={draft.heightMm}
          onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.elevationMm}
          onChange={(e) => setDraft({ ...draft, elevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <Button size="xs" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>
          <Button size="xs" variant="destructive" onClick={handleDelete} disabled={isSaving}>
            Delete
          </Button>
        </div>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

function NewObstaclePresetRow({ onAdd }: { onAdd: (preset: ObstaclePreset) => Promise<void> }) {
  const blank = (): Omit<ObstaclePreset, 'id' | 'createdAt' | 'updatedAt'> => ({
    label: '',
    type: 'pillar',
    widthMm: 300,
    depthMm: 300,
    floorToCeiling: true,
    heightMm: PARTIAL_OBSTACLE_HEIGHT_MM,
    elevationMm: 0,
  });

  const [draft, setDraft] = useState(blank());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!draft.label.trim()) {
      setError('Name it first.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      await onAdd({ ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
      setDraft(blank());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="bg-secondary align-top">
      <td className="px-3 py-2">
        <input
          placeholder="New preset name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-3 py-2">
        <Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value as ObstacleType })}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OBSTACLE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-16'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-16'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <Checkbox
          checked={draft.floorToCeiling}
          onCheckedChange={(checked) => setDraft({ ...draft, floorToCeiling: checked === true })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={50}
          value={draft.heightMm}
          onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.elevationMm}
          onChange={(e) => setDraft({ ...draft, elevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        <Button size="xs" onClick={handleAdd} disabled={isSaving}>
          + Add
        </Button>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

// ---- Appliance catalog rows ----

interface ApplianceCatalogRowProps {
  item: ApplianceCatalogItem;
  onSave: (item: ApplianceCatalogItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function ApplianceCatalogRow({ item, onSave, onDelete }: ApplianceCatalogRowProps) {
  const [draft, setDraft] = useState(item);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirmDialog({ title: `Delete "${item.label}"?`, description: "This can't be undone." })))
      return;
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(item.id);
      toast.success(`Deleted "${item.label}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.';
      setError(message);
      toast.error('Failed to delete', { description: message });
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-border/70 align-top last:border-b-0">
      <td className="px-3 py-2">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-3 py-2">
        <Select
          value={draft.applianceType}
          onValueChange={(value) => setDraft({ ...draft, applianceType: value as ApplianceType })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLIANCE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={10}
            value={draft.heightMm}
            onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.defaultElevationMm}
          onChange={(e) => setDraft({ ...draft, defaultElevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        {draft.applianceType === 'sink' && (
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={draft.sinkCutoutWidthMm ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, sinkCutoutWidthMm: Number(e.target.value) || undefined })
              }
              className={inputClass + ' w-14'}
            />
            <input
              type="number"
              min={0}
              value={draft.sinkCutoutDepthMm ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, sinkCutoutDepthMm: Number(e.target.value) || undefined })
              }
              className={inputClass + ' w-14'}
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {/* A path under public/, e.g. /models/hob-600.glb. Left empty the
            appliance keeps rendering as a plain box — see
            components/canvas3d/ApplianceModel.tsx. */}
        <input
          value={draft.modelUrl ?? ''}
          onChange={(e) => setDraft({ ...draft, modelUrl: e.target.value || undefined })}
          placeholder="/models/....glb"
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-3 py-2">
        <ModelOrientationFields
          xDeg={draft.modelRotationXDeg ?? 0}
          yDeg={draft.modelRotationYDeg ?? 0}
          onChange={(xDeg, yDeg) =>
            setDraft({ ...draft, modelRotationXDeg: xDeg, modelRotationYDeg: yDeg })
          }
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
        <div className="mt-0.5 text-xs text-muted-foreground">{INR_FORMATTER.format(draft.unitPrice)}</div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <Button size="xs" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>
          <Button size="xs" variant="destructive" onClick={handleDelete} disabled={isSaving}>
            Delete
          </Button>
        </div>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

function NewApplianceCatalogRow({
  onAdd,
}: {
  onAdd: (item: ApplianceCatalogItem) => Promise<void>;
}) {
  const blank = (): Omit<ApplianceCatalogItem, 'id' | 'createdAt' | 'updatedAt'> => ({
    label: '',
    applianceType: 'stove',
    widthMm: 600,
    depthMm: 550,
    heightMm: 100,
    defaultElevationMm: 850,
    modelUrl: undefined,
    unitPrice: 30000,
  });

  const [draft, setDraft] = useState(blank());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!draft.label.trim()) {
      setError('Name it first.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      await onAdd({ ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
      setDraft(blank());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="bg-secondary align-top">
      <td className="px-3 py-2">
        <input
          placeholder="New appliance name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-3 py-2">
        <Select
          value={draft.applianceType}
          onValueChange={(value) => setDraft({ ...draft, applianceType: value as ApplianceType })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLIANCE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="number"
            min={50}
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={50}
            value={draft.depthMm}
            onChange={(e) => setDraft({ ...draft, depthMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
          <input
            type="number"
            min={10}
            value={draft.heightMm}
            onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
            className={inputClass + ' w-14'}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.defaultElevationMm}
          onChange={(e) => setDraft({ ...draft, defaultElevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-3 py-2">
        {draft.applianceType === 'sink' && (
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={draft.sinkCutoutWidthMm ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, sinkCutoutWidthMm: Number(e.target.value) || undefined })
              }
              className={inputClass + ' w-14'}
            />
            <input
              type="number"
              min={0}
              value={draft.sinkCutoutDepthMm ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, sinkCutoutDepthMm: Number(e.target.value) || undefined })
              }
              className={inputClass + ' w-14'}
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {/* A path under public/, e.g. /models/hob-600.glb. Left empty the
            appliance keeps rendering as a plain box — see
            components/canvas3d/ApplianceModel.tsx. */}
        <input
          value={draft.modelUrl ?? ''}
          onChange={(e) => setDraft({ ...draft, modelUrl: e.target.value || undefined })}
          placeholder="/models/....glb"
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-3 py-2">
        <ModelOrientationFields
          xDeg={draft.modelRotationXDeg ?? 0}
          yDeg={draft.modelRotationYDeg ?? 0}
          onChange={(xDeg, yDeg) =>
            setDraft({ ...draft, modelRotationXDeg: xDeg, modelRotationYDeg: yDeg })
          }
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
      </td>
      <td className="px-3 py-2">
        <Button size="xs" onClick={handleAdd} disabled={isSaving}>
          + Add
        </Button>
        {error && <p className="mt-1 w-24 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

// Orientation correction for a .glb that was exported facing the wrong
// way, as two plain-language dropdowns instead of raw Euler angles.
//
// This fixes the FILE, once, for every appliance ever placed from this
// catalogue row — it is not the same thing as turning an appliance on
// the plan, which the designer does per placement by double-clicking it
// (see ApplianceLayer). Keeping the two clearly separate matters: a
// model that comes out sideways is a bad export to be corrected here,
// while a hob that needs to face the other way in one particular
// kitchen is a placement decision. Fixing an export by rotating every
// placement would have to be redone in every layout.
function ModelOrientationFields({
  xDeg,
  yDeg,
  onChange,
}: {
  xDeg: number;
  yDeg: number;
  onChange: (xDeg: number, yDeg: number) => void;
}) {
  // Anything not matching a preset (hand-edited in the DB, or a future
  // arbitrary angle) shows as its own option rather than silently
  // snapping to the nearest preset and discarding the stored value.
  const upAxisKnown = UP_AXIS_OPTIONS.some((o) => o.xDeg === xDeg);
  const facingKnown = FACING_OPTIONS.some((o) => o.yDeg === yDeg);

  return (
    <div className="flex flex-col gap-1">
      <Select value={String(xDeg)} onValueChange={(value) => onChange(Number(value), yDeg)}>
        <SelectTrigger size="sm" className="w-40" aria-label="Model up axis">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UP_AXIS_OPTIONS.map((o) => (
            <SelectItem key={o.xDeg} value={String(o.xDeg)}>
              {o.label}
            </SelectItem>
          ))}
          {!upAxisKnown && <SelectItem value={String(xDeg)}>{`Custom (${xDeg}°)`}</SelectItem>}
        </SelectContent>
      </Select>

      <Select value={String(yDeg)} onValueChange={(value) => onChange(xDeg, Number(value))}>
        <SelectTrigger size="sm" className="w-40" aria-label="Model facing direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FACING_OPTIONS.map((o) => (
            <SelectItem key={o.yDeg} value={String(o.yDeg)}>
              {`Faces ${o.label.toLowerCase()}`}
            </SelectItem>
          ))}
          {!facingKnown && <SelectItem value={String(yDeg)}>{`Custom (${yDeg}°)`}</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  );
}

// Default front configuration for a cabinet catalogue row, plus its
// handle. Both optional: left as "Automatic", the row stores nothing
// and cabinets fall through to defaultFrontLayout(moduleType, widthMm)
// at read time.
//
// That fallback is deliberately a READ-TIME default rather than a
// value written into the row. Storing it would freeze today's guess:
// every catalogue row would carry an explicit layout, and improving
// the default rule later would change nothing. Leaving it absent means
// the rule keeps applying.
function CatalogFrontFields({
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
  // What a cabinet from this row would get with nothing set — shown as
  // the "Automatic" option's own label, so the person choosing can see
  // what automatic actually means instead of having to guess.
  const handles = useLayoutStore((s) => s.handles);
  const auto = defaultFrontLayout(moduleType, widthMm);
  const countLabel =
    frontLayout && (frontLayout.kind === 'drawers' || frontLayout.kind === 'open-shelf' || frontLayout.kind === 'trolley');

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={frontLayout?.kind ?? AUTO_FRONT_VALUE}
        onValueChange={(value) =>
          onChange(
            value === AUTO_FRONT_VALUE
              ? undefined
              : { kind: value as FrontKind, count: auto.count ?? 3 },
            handleId
          )
        }
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Default front configuration">
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

      {countLabel && (
        <input
          type="number"
          min={MIN_FRONT_COUNT}
          max={MAX_FRONT_COUNT}
          value={clampCount(frontLayout!.count)}
          onChange={(e) =>
            onChange(
              { ...frontLayout!, count: clampCount(Number(e.target.value)), heightRatios: undefined },
              handleId
            )
          }
          className={inputClass + ' w-16'}
          aria-label="How many"
        />
      )}

      <Select
        value={handleId ?? DEFAULT_HANDLE_VALUE}
        onValueChange={(value) =>
          onChange(frontLayout, value === DEFAULT_HANDLE_VALUE ? undefined : value)
        }
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Default handle">
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
    </div>
  );
}
