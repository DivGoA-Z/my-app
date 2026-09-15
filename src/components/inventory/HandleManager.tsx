// src/components/inventory/HandleManager.tsx
//
// The business's handle catalogue — add, edit, reprice, remove. Same
// shape as FinishManager, and it exists for the same reason finishes
// stopped being an enum: a fixed list can't say what a business
// actually stocks, and the same gola profile costs different money at
// different suppliers.
//
// The field that matters most and is easiest to get wrong is PRICING
// MODE. A bar handle is bought per piece; a gola or edge profile is cut
// from stock and billed per running metre. Entering a per-metre profile
// as "per piece" prices a 2.4m run as one handle — which on a
// twelve-unit kitchen is a five-figure hole in the quote. So the mode
// is a visible, required choice, and the price label changes with it.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { DEFAULT_HANDLE_ID } from '../../types/front';
import type { HandleKind, HandleSpec } from '../../types/front';

const HANDLE_KINDS: HandleKind[] = ['bar', 'knob', 'edge-profile', 'gola', 'handleless'];

const KIND_LABELS: Record<HandleKind, string> = {
  bar: 'Bar / D handle',
  knob: 'Knob',
  'edge-profile': 'Edge profile',
  gola: 'Gola profile',
  handleless: 'Handleless (push-to-open)',
};

// Which kinds are billed by length. Used to preselect the pricing mode
// when the kind changes, so the common case is right without anyone
// having to know the rule.
const PER_METRE_KINDS: HandleKind[] = ['gola', 'edge-profile'];

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inputClass = 'rounded border border-gray-300 px-2 py-1 text-xs';

export function HandleManager() {
  const handles = useLayoutStore((s) => s.handles);
  const upsertHandle = useLayoutStore((s) => s.upsertHandle);
  const removeHandle = useLayoutStore((s) => s.removeHandle);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Your Handles</h2>
        <p className="text-xs text-gray-500">
          Hardware for cabinet fronts. <span className="font-medium">Priced by</span> is the one
          to get right: bar handles and knobs are per piece, gola and edge profiles are cut to
          length and billed per running metre. Cabinets referencing a handle you delete fall back
          to the default rather than losing their hardware cost.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Kind</th>
              <th className="px-2 py-2 font-medium">Length (mm)</th>
              <th className="px-2 py-2 font-medium">Colour</th>
              <th className="px-2 py-2 font-medium">Priced by</th>
              <th className="px-2 py-2 font-medium">Price</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {handles.map((handle) => (
              <HandleRow
                key={handle.id}
                handle={handle}
                onSave={upsertHandle}
                onDelete={removeHandle}
              />
            ))}
            <NewHandleRow onAdd={upsertHandle} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HandleRow({
  handle,
  onSave,
  onDelete,
}: {
  handle: HandleSpec;
  onSave: (handle: HandleSpec) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HandleSpec>(handle);
  const [isSaving, setIsSaving] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(handle);
  // The seeded default is what resolveHandle falls back to when a
  // cabinet's own handle is missing, so deleting it would leave those
  // cabinets on whatever row happens to be first. Blocked rather than
  // warned about, because the failure is silent.
  const isDefault = handle.id === DEFAULT_HANDLE_ID;

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-gray-100">
      <Fields draft={draft} setDraft={setDraft} />
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {isSaving ? '...' : 'Save'}
          </button>
          <button
            onClick={() => onDelete(handle.id)}
            disabled={isDefault}
            title={isDefault ? 'The default handle cannot be deleted' : undefined}
            className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function blankHandle(): HandleSpec {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: '',
    kind: 'bar',
    lengthMm: 128,
    colorHex: '#b8bcc0',
    metalness: 0.9,
    roughness: 0.35,
    pricingMode: 'per-unit',
    price: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function NewHandleRow({ onAdd }: { onAdd: (handle: HandleSpec) => Promise<void> }) {
  const [draft, setDraft] = useState<HandleSpec>(blankHandle);
  const [isSaving, setIsSaving] = useState(false);

  async function handleAdd() {
    // A nameless handle is indistinguishable from every other nameless
    // handle in the dropdown, so the label is the one required field.
    if (!draft.label.trim()) return;
    setIsSaving(true);
    try {
      await onAdd(draft);
      setDraft(blankHandle());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="bg-gray-50/50">
      <Fields draft={draft} setDraft={setDraft} />
      <td className="px-2 py-1.5">
        <button
          onClick={handleAdd}
          disabled={isSaving || !draft.label.trim()}
          className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {isSaving ? '...' : 'Add'}
        </button>
      </td>
    </tr>
  );
}

// Shared between the edit and add rows so the two can't drift — the
// same reasoning behind putting rotation maths in lib/footprint.ts.
function Fields({
  draft,
  setDraft,
}: {
  draft: HandleSpec;
  setDraft: (next: HandleSpec) => void;
}) {
  const isLengthMeaningful = draft.kind !== 'handleless';

  return (
    <>
      <td className="px-2 py-1.5">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="Bar handle 128mm — steel"
          className={inputClass + ' w-44'}
        />
      </td>

      <td className="px-2 py-1.5">
        <select
          value={draft.kind}
          onChange={(e) => {
            const kind = e.target.value as HandleKind;
            setDraft({
              ...draft,
              kind,
              // Preselect the mode the kind is actually sold in. Still
              // editable — a supplier who sells gola in fixed lengths
              // does exist — but the default is the common case rather
              // than whatever was there before.
              pricingMode: PER_METRE_KINDS.includes(kind) ? 'per-metre' : 'per-unit',
            });
          }}
          className={inputClass + ' w-36'}
        >
          {HANDLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-2 py-1.5">
        <input
          type="number"
          min={0}
          value={draft.lengthMm}
          disabled={!isLengthMeaningful}
          onChange={(e) => setDraft({ ...draft, lengthMm: Number(e.target.value) })}
          className={inputClass + ' w-16 disabled:bg-gray-100'}
        />
        <div className="text-[9px] text-gray-400">
          {/* Length means different things per kind, and a profile's
              length comes from the panel it's cut to rather than from
              this field. */}
          {draft.kind === 'knob'
            ? 'diameter'
            : PER_METRE_KINDS.includes(draft.kind)
              ? 'cut to panel'
              : draft.kind === 'handleless'
                ? 'n/a'
                : 'centres'}
        </div>
      </td>

      <td className="px-2 py-1.5">
        <input
          type="color"
          value={draft.colorHex}
          onChange={(e) => setDraft({ ...draft, colorHex: e.target.value })}
          className="h-7 w-10 rounded border border-gray-300"
        />
      </td>

      <td className="px-2 py-1.5">
        <select
          value={draft.pricingMode}
          onChange={(e) =>
            setDraft({ ...draft, pricingMode: e.target.value as HandleSpec['pricingMode'] })
          }
          className={inputClass + ' w-24'}
        >
          <option value="per-unit">Per piece</option>
          <option value="per-metre">Per metre</option>
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
    </>
  );
}
