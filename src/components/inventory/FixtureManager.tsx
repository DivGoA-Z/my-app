// src/components/inventory/FixtureManager.tsx
//
// The business's light fixture catalogue. Third instance of this shape,
// after FinishManager and HandleManager, and for the third time the
// field that matters most is PRICING MODE: strip, cove and plinth runs
// are sold by the running metre, spots and pendants by the piece. A
// 2.4m run charged as one unit is a quote short by most of a strip.
//
// COLOUR TEMPERATURE is fixed per row, not adjustable per placement,
// because that is how it's bought — 3000K and 6500K strip are separate
// products at separate rates. The swatch next to it shows the actual
// rendered colour, so the number doesn't have to be imagined.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { confirmDialog } from '../../store/confirmDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import { FIXTURE_KIND_LABELS, isLinear } from '../../types/fixture';
import type { FixtureCatalogItem, FixtureKind } from '../../types/fixture';
import { kelvinToColor } from '../../lib/lighting3d';
import { FixtureCatalogImportExport } from './FixtureCatalogImportExport';

const KINDS: FixtureKind[] = ['strip', 'spot', 'cove', 'pendant', 'plinth', 'drawer'];

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inputClass = 'rounded border border-gray-300 px-2 py-1 text-xs';

export function FixtureManager() {
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const upsert = useLayoutStore((s) => s.upsertFixtureCatalogItem);
  const remove = useLayoutStore((s) => s.removeFixtureCatalogItem);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Your Light Fixtures</h2>
        <p className="text-xs text-gray-500">
          Strips, spots, cove and plinth runs.{' '}
          <span className="font-medium">Priced by</span> follows the kind: runs are per metre,
          spots and pendants per piece. <span className="font-medium">Lumens</span> does double
          duty — it sets how bright the fixture renders, and decides which fixtures get a real
          light when a kitchen has more than the 3D view can afford to draw.
        </p>
      </div>

      <FixtureCatalogImportExport />

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Kind</th>
              <th className="px-2 py-2 font-medium">Colour temp</th>
              <th className="px-2 py-2 font-medium">Lumens</th>
              <th className="px-2 py-2 font-medium">Priced by</th>
              <th className="px-2 py-2 font-medium">Price</th>
              <th className="px-2 py-2 font-medium">3D model</th>
              <th className="px-2 py-2 font-medium">Model rotation</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {fixtureCatalog.map((item) => (
              <Row key={item.id} item={item} onSave={upsert} onDelete={remove} />
            ))}
            <NewRow onAdd={upsert} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  item,
  onSave,
  onDelete,
}: {
  item: FixtureCatalogItem;
  onSave: (item: FixtureCatalogItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<FixtureCatalogItem>(item);
  const [isSaving, setIsSaving] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(item);

  async function handleDelete() {
    if (!(await confirmDialog({ title: `Delete "${item.label}"?`, description: "This can't be undone." })))
      return;
    try {
      await onDelete(item.id);
      toast.success(`Deleted "${item.label}"`);
    } catch (err) {
      toast.error('Failed to delete', {
        description: err instanceof Error ? err.message : 'Failed to delete.',
      });
    }
  }

  return (
    <tr className="border-b border-gray-100">
      <Fields draft={draft} setDraft={setDraft} />
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <Button
            size="xs"
            onClick={async () => {
              setIsSaving(true);
              try {
                await onSave(draft);
              } finally {
                setIsSaving(false);
              }
            }}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? '...' : 'Save'}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={handleDelete}
            title="Fixtures already placed from this row stop rendering and stop being priced"
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function blank(): FixtureCatalogItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: '',
    kind: 'strip',
    colorTempK: 3000,
    lumens: 900,
    pricingMode: 'per-metre',
    price: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function NewRow({ onAdd }: { onAdd: (item: FixtureCatalogItem) => Promise<void> }) {
  const [draft, setDraft] = useState<FixtureCatalogItem>(blank);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <tr className="bg-gray-50/50">
      <Fields draft={draft} setDraft={setDraft} />
      <td className="px-2 py-1.5">
        <Button
          size="xs"
          onClick={async () => {
            if (!draft.label.trim()) return;
            setIsSaving(true);
            try {
              await onAdd(draft);
              setDraft(blank());
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={isSaving || !draft.label.trim()}
        >
          {isSaving ? '...' : 'Add'}
        </Button>
      </td>
    </tr>
  );
}

// Shared by both rows so the edit and add forms can't drift apart.
function Fields({
  draft,
  setDraft,
}: {
  draft: FixtureCatalogItem;
  setDraft: (next: FixtureCatalogItem) => void;
}) {
  return (
    <>
      <td className="px-2 py-1.5">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="LED strip 3000K warm white"
          className={inputClass + ' w-48'}
        />
      </td>

      <td className="px-2 py-1.5">
        <select
          value={draft.kind}
          onChange={(e) => {
            const kind = e.target.value as FixtureKind;
            // Preselect the mode the kind is actually sold in, so the
            // common case is right without anyone knowing the rule.
            setDraft({
              ...draft,
              kind,
              pricingMode: isLinear(kind) ? 'per-metre' : 'per-unit',
            });
          }}
          className={inputClass + ' w-36'}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {FIXTURE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-full border border-gray-300"
            style={{ backgroundColor: kelvinToColor(draft.colorTempK) }}
          />
          <input
            type="number"
            min={2000}
            max={7000}
            step={100}
            value={draft.colorTempK}
            onChange={(e) => setDraft({ ...draft, colorTempK: Number(e.target.value) })}
            className={inputClass + ' w-16'}
          />
        </div>
      </td>

      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          step={50}
          value={draft.lumens}
          onChange={(e) => setDraft({ ...draft, lumens: Number(e.target.value) })}
          className={inputClass + ' w-16'}
        />
      </td>

      <td className="px-2 py-1.5">
        <select
          value={draft.pricingMode}
          onChange={(e) =>
            setDraft({
              ...draft,
              pricingMode: e.target.value as FixtureCatalogItem['pricingMode'],
            })
          }
          className={inputClass + ' w-24'}
        >
          <option value="per-metre">Per metre</option>
          <option value="per-unit">Per piece</option>
        </select>
      </td>

      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
          className={inputClass + ' w-20'}
        />
        <div className="mt-0.5 text-[9px] text-gray-400">
          {INR.format(draft.price)} {draft.pricingMode === 'per-metre' ? '/ m' : '/ pc'}
        </div>
      </td>

      <td className="px-2 py-1.5">
        {/* A path under public/, e.g. /models/lighting/pendant.glb. Left
            empty the fixture keeps rendering as a primitive bar/disc —
            see components/canvas3d/Room3DCanvas.tsx (FixtureInScene). */}
        <input
          value={draft.modelUrl ?? ''}
          onChange={(e) => setDraft({ ...draft, modelUrl: e.target.value || undefined })}
          placeholder="/models/....glb"
          className={inputClass + ' w-36'}
        />
      </td>

      <td className="px-2 py-1.5">
        {/* Fixed correction for how the file was exported — applied
            before fitting/measurement. Only ever multiples of 90°, same
            convention as the appliance catalogue's model rotation. */}
        <div className="flex gap-1">
          <input
            type="number"
            step={90}
            value={draft.modelRotationXDeg ?? 0}
            onChange={(e) => setDraft({ ...draft, modelRotationXDeg: Number(e.target.value) })}
            className={inputClass + ' w-14'}
            title="X rotation (deg)"
          />
          <input
            type="number"
            step={90}
            value={draft.modelRotationYDeg ?? 0}
            onChange={(e) => setDraft({ ...draft, modelRotationYDeg: Number(e.target.value) })}
            className={inputClass + ' w-14'}
            title="Y rotation (deg)"
          />
          <input
            type="number"
            step={90}
            value={draft.modelRotationZDeg ?? 0}
            onChange={(e) => setDraft({ ...draft, modelRotationZDeg: Number(e.target.value) })}
            className={inputClass + ' w-14'}
            title="Z rotation (deg)"
          />
        </div>
      </td>
    </>
  );
}
