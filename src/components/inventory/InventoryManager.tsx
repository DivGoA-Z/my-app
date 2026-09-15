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

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { FinishManager } from './FinishManager';
import { HandleManager } from './HandleManager';
import { FixtureManager } from './FixtureManager';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../../types/Catalog';
import type { ModuleType, MaterialType } from '../../types/cabinet';
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
];

const MODULE_TYPES: ModuleType[] = [
  'base-cabinet',
  'wall-cabinet',
  'tall-unit',
  'sink-unit',
  'cylinder-trolley',
  'corner-unit',
  'drawer-unit',
];
const MATERIALS: MaterialType[] = ['HDMR', 'Plywood', 'MDF', 'Particle Board'];
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

const inputClass = 'rounded border border-gray-300 px-2 py-1 text-xs';

export function InventoryManager() {
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const obstaclePresets = useLayoutStore((s) => s.obstaclePresets);
  const applianceCatalog = useLayoutStore((s) => s.applianceCatalog);
  const isInventoryLoading = useLayoutStore((s) => s.isInventoryLoading);
  const inventoryError = useLayoutStore((s) => s.inventoryError);
  const upsertCabinetCatalogItem = useLayoutStore((s) => s.upsertCabinetCatalogItem);
  const removeCabinetCatalogItem = useLayoutStore((s) => s.removeCabinetCatalogItem);
  const upsertObstaclePreset = useLayoutStore((s) => s.upsertObstaclePreset);
  const removeObstaclePreset = useLayoutStore((s) => s.removeObstaclePreset);
  const upsertApplianceCatalogItem = useLayoutStore((s) => s.upsertApplianceCatalogItem);
  const removeApplianceCatalogItem = useLayoutStore((s) => s.removeApplianceCatalogItem);

  const categories = Array.from(new Set(cabinetCatalog.map((c) => c.category)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Your Cabinet Pieces</h2>
        <p className="text-xs text-gray-500">
          These show up as "add" buttons in the cabinet toolbar. Name, resize, reprice, or remove
          them any time — changes apply to every layout you create from now on.
        </p>
      </div>

      {inventoryError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {inventoryError}
        </p>
      )}

      {isInventoryLoading ? (
        <p className="text-sm text-gray-500">Loading inventory...</p>
      ) : (
        <>
          {/* Finishes first: cabinet rows below reference them, so this
              is the order the data actually depends in. */}
          <FinishManager />

          {/* Handles before cabinets for the same reason finishes are:
              a cabinet row references a handle, so this is the order
              the data actually depends in. */}
          <HandleManager />

          <FixtureManager />

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">W×D×H (mm)</th>
                  <th className="px-2 py-2 font-medium">Material</th>
                  <th className="px-2 py-2 font-medium">Finish</th>
                  <th className="px-2 py-2 font-medium">Default front</th>
                  <th className="px-2 py-2 font-medium">Price</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {cabinetCatalog.map((item) => (
                  <CabinetCatalogRow
                    key={item.id}
                    item={item}
                    categorySuggestions={categories}
                    onSave={upsertCabinetCatalogItem}
                    onDelete={removeCabinetCatalogItem}
                  />
                ))}
                <NewCabinetItemRow categorySuggestions={categories} onAdd={upsertCabinetCatalogItem} />
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700">Your Obstacle Presets</h2>
            <p className="text-xs text-gray-500">
              Quick-add buttons in the obstacle toolbar, for the structural elements you run into
              over and over (a standard column size, a common duct, etc). Height and "off floor"
              only apply when floor-to-ceiling is off — otherwise the obstacle's real height
              tracks the room's own ceiling height, and it always starts at the floor. "Off floor"
              is what lets a preset like a mid-wall electrical fixture start above the floor with
              nothing below it.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">W×D (mm)</th>
                  <th className="px-2 py-2 font-medium">Floor-to-ceiling</th>
                  <th className="px-2 py-2 font-medium">Height (mm)</th>
                  <th className="px-2 py-2 font-medium">Off floor (mm)</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
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

          <div>
            <h2 className="text-sm font-semibold text-gray-700">Your Appliances</h2>
            <p className="text-xs text-gray-500">
              These show up as "add" buttons in the appliance toolbar. defaultElevationMm is how
              high off the floor the appliance's bottom face sits when placed (e.g. 850mm for
              something resting on a countertop, higher for a chimney mounted above a hob).
            </p>
            <p className="mt-1 text-xs text-gray-500">
              <span className="font-medium">Model orientation</span> corrects a .glb that was
              exported the wrong way up or facing the wrong way — set it once here and every
              appliance placed from this row comes out right. It is not how you aim an appliance
              in a particular kitchen: for that, double-click the appliance on the floor plan to
              turn it 90° (shift-double-click turns it back).
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">W×D×H (mm)</th>
                  <th className="px-2 py-2 font-medium">Elevation (mm)</th>
                  <th className="px-2 py-2 font-medium">3D Model</th>
                  <th className="px-2 py-2 font-medium">Model orientation</th>
                  <th className="px-2 py-2 font-medium">Price</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
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
}

function CabinetCatalogRow({ item, categorySuggestions, onSave, onDelete }: CabinetCatalogRowProps) {
  const finishes = useLayoutStore((state) => state.finishes);
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
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.moduleType}
          onChange={(e) => setDraft({ ...draft, moduleType: e.target.value as ModuleType })}
          className={inputClass}
        >
          {MODULE_TYPES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <select
          value={draft.material}
          onChange={(e) => setDraft({ ...draft, material: e.target.value as MaterialType })}
          className={inputClass}
        >
          {MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.finishId}
          onChange={(e) => setDraft({ ...draft, finishId: e.target.value })}
          className={inputClass}
        >
          {finishes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.brand ? `${f.brand} ${f.label}` : f.label} ({f.finishTypeLabel})
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <CatalogFrontFields
          moduleType={draft.moduleType}
          widthMm={draft.widthMm}
          frontLayout={draft.frontLayout}
          handleId={draft.handleId}
          onChange={(frontLayout, handleId) => setDraft({ ...draft, frontLayout, handleId })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
        <div className="mt-0.5 text-[10px] text-gray-400">{INR_FORMATTER.format(draft.unitPrice)}</div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            disabled={isSaving}
            className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
    <tr className="bg-gray-50 align-top">
      <td className="px-2 py-1.5">
        <input
          list="catalog-categories"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          className={inputClass + ' w-24'}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          placeholder="New piece name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-36'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.moduleType}
          onChange={(e) => setDraft({ ...draft, moduleType: e.target.value as ModuleType })}
          className={inputClass}
        >
          {MODULE_TYPES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <select
          value={draft.material}
          onChange={(e) => setDraft({ ...draft, material: e.target.value as MaterialType })}
          className={inputClass}
        >
          {MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.finishId}
          onChange={(e) => setDraft({ ...draft, finishId: e.target.value })}
          className={inputClass}
        >
          {finishes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.brand ? `${f.brand} ${f.label}` : f.label} ({f.finishTypeLabel})
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <CatalogFrontFields
          moduleType={draft.moduleType}
          widthMm={draft.widthMm}
          frontLayout={draft.frontLayout}
          handleId={draft.handleId}
          onChange={(frontLayout, handleId) => setDraft({ ...draft, frontLayout, handleId })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
      </td>
      <td className="px-2 py-1.5">
        <button
          onClick={handleAdd}
          disabled={isSaving}
          className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
        >
          + Add
        </button>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(preset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="px-2 py-1.5">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as ObstacleType })}
          className={inputClass}
        >
          {OBSTACLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          checked={draft.floorToCeiling}
          onChange={(e) => setDraft({ ...draft, floorToCeiling: e.target.checked })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={50}
          value={draft.heightMm}
          onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.elevationMm}
          onChange={(e) => setDraft({ ...draft, elevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            disabled={isSaving}
            className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
    <tr className="bg-gray-50 align-top">
      <td className="px-2 py-1.5">
        <input
          placeholder="New preset name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as ObstacleType })}
          className={inputClass}
        >
          {OBSTACLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          checked={draft.floorToCeiling}
          onChange={(e) => setDraft({ ...draft, floorToCeiling: e.target.checked })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={50}
          value={draft.heightMm}
          onChange={(e) => setDraft({ ...draft, heightMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.elevationMm}
          onChange={(e) => setDraft({ ...draft, elevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
        <button
          onClick={handleAdd}
          disabled={isSaving}
          className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
        >
          + Add
        </button>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="px-2 py-1.5">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.applianceType}
          onChange={(e) => setDraft({ ...draft, applianceType: e.target.value as ApplianceType })}
          className={inputClass}
        >
          {APPLIANCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.defaultElevationMm}
          onChange={(e) => setDraft({ ...draft, defaultElevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <ModelOrientationFields
          xDeg={draft.modelRotationXDeg ?? 0}
          yDeg={draft.modelRotationYDeg ?? 0}
          onChange={(xDeg, yDeg) =>
            setDraft({ ...draft, modelRotationXDeg: xDeg, modelRotationYDeg: yDeg })
          }
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
        <div className="mt-0.5 text-[10px] text-gray-400">{INR_FORMATTER.format(draft.unitPrice)}</div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            disabled={isSaving}
            className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
    <tr className="bg-gray-50 align-top">
      <td className="px-2 py-1.5">
        <input
          placeholder="New appliance name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className={inputClass + ' w-32'}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.applianceType}
          onChange={(e) => setDraft({ ...draft, applianceType: e.target.value as ApplianceType })}
          className={inputClass}
        >
          {APPLIANCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.defaultElevationMm}
          onChange={(e) => setDraft({ ...draft, defaultElevationMm: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>
      <td className="px-2 py-1.5">
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
      <td className="px-2 py-1.5">
        <ModelOrientationFields
          xDeg={draft.modelRotationXDeg ?? 0}
          yDeg={draft.modelRotationYDeg ?? 0}
          onChange={(xDeg, yDeg) =>
            setDraft({ ...draft, modelRotationXDeg: xDeg, modelRotationYDeg: yDeg })
          }
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.unitPrice}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
      </td>
      <td className="px-2 py-1.5">
        <button
          onClick={handleAdd}
          disabled={isSaving}
          className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-50"
        >
          + Add
        </button>
        {error && <p className="mt-1 w-24 text-[10px] text-red-600">{error}</p>}
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
      <select
        value={xDeg}
        onChange={(e) => onChange(Number(e.target.value), yDeg)}
        className={inputClass + ' w-40'}
        aria-label="Model up axis"
      >
        {UP_AXIS_OPTIONS.map((o) => (
          <option key={o.xDeg} value={o.xDeg}>
            {o.label}
          </option>
        ))}
        {!upAxisKnown && <option value={xDeg}>{`Custom (${xDeg}°)`}</option>}
      </select>

      <select
        value={yDeg}
        onChange={(e) => onChange(xDeg, Number(e.target.value))}
        className={inputClass + ' w-40'}
        aria-label="Model facing direction"
      >
        {FACING_OPTIONS.map((o) => (
          <option key={o.yDeg} value={o.yDeg}>
            {`Faces ${o.label.toLowerCase()}`}
          </option>
        ))}
        {!facingKnown && <option value={yDeg}>{`Custom (${yDeg}°)`}</option>}
      </select>
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
      <select
        value={frontLayout?.kind ?? ''}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { kind: e.target.value as FrontKind, count: auto.count ?? 3 }
              : undefined,
            handleId
          )
        }
        className={inputClass + ' w-44'}
        aria-label="Default front configuration"
      >
        <option value="">Automatic ({FRONT_KIND_LABELS[auto.kind]})</option>
        {FRONT_KINDS.map((k) => (
          <option key={k} value={k}>
            {FRONT_KIND_LABELS[k]}
          </option>
        ))}
      </select>

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

      <select
        value={handleId ?? ''}
        onChange={(e) => onChange(frontLayout, e.target.value || undefined)}
        className={inputClass + ' w-44'}
        aria-label="Default handle"
      >
        <option value="">Default handle</option>
        {handles.map((h) => (
          <option key={h.id} value={h.id}>
            {h.label}
          </option>
        ))}
      </select>
    </div>
  );
}
