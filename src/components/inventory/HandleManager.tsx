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

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useLayoutStore } from '../../store/layoutStore';
import { DEFAULT_HANDLE_ID } from '../../types/front';
import type { HandleKind, HandleSpec } from '../../types/front';
import { HandleImportExport } from './HandleImportExport';
import { EditPanel, Field, NumberField, TextField } from '../common/EditPanel';
import { Empty, ListRow, NewButton } from './CatalogueKit';
import { useItemEditor } from './useItemEditor';

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

// What "length" means depends on the kind, and a profile's length comes
// from the panel it's cut to, not from this field.
function lengthMeaning(kind: HandleKind): string {
  return kind === 'knob' ? 'Diameter' : PER_METRE_KINDS.includes(kind) ? 'Profile height' : 'Hole centres';
}

function blankHandle(): HandleSpec {
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
    createdAt: '',
    updatedAt: '',
  };
}

// Handles as a list; tap one to edit it in a side panel (§76).
export function HandleManager() {
  const handles = useLayoutStore((s) => s.handles);
  const upsertHandle = useLayoutStore((s) => s.upsertHandle);
  const removeHandle = useLayoutStore((s) => s.removeHandle);
  const ed = useItemEditor<HandleSpec>(upsertHandle, removeHandle);
  const d = ed.editing?.draft;
  // The seeded default is what resolveHandle falls back to when a
  // cabinet's own handle is missing, so deleting it would leave those
  // cabinets on whatever row happens to be first. Blocked rather than
  // warned about, because the failure is silent.
  const isDefault = d?.id === DEFAULT_HANDLE_ID;
  const trigger = 'h-11! w-full rounded-[10px] bg-card text-[15px] font-normal';

  return (
    <div className="flex flex-col gap-4">
      {/* Title and description: the Catalogue page's section frame (§71). */}
      <div className="flex justify-end">
        <NewButton label="New handle" onClick={() => ed.open(blankHandle(), true)} />
      </div>
      <div className="flex flex-col">
        {handles.map((h) => (
          <ListRow
            key={h.id}
            onClick={() => ed.open(h, false)}
            media={
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary">
                <span className="size-6 rounded-full ring-1 ring-black/10" style={{ backgroundColor: h.colorHex }} />
              </div>
            }
            title={h.label}
            sub={`${KIND_LABELS[h.kind]}${(h.kind === 'bar' || h.kind === 'knob') && h.lengthMm > 0 ? ` · ${h.lengthMm} mm` : ''}${h.id === DEFAULT_HANDLE_ID ? ' · default' : ''}`}
            end={
              <span className="w-28 shrink-0 text-right text-[15px] font-bold">
                {INR.format(h.price)}
                <span className="text-[13px] font-normal text-muted-foreground"> {h.pricingMode === 'per-metre' ? '/ m' : '/ pc'}</span>
              </span>
            }
          />
        ))}
        {handles.length === 0 && <Empty>No handles yet.</Empty>}
      </div>
      <HandleImportExport />

      <EditPanel
        open={!!d}
        onOpenChange={(o) => !o && ed.close()}
        title={ed.editing?.isNew ? 'New handle' : (d?.label ?? '')}
        subtitle={isDefault ? 'The default handle: cabinets without one use it, so it can\'t be deleted.' : undefined}
        onSave={ed.commit}
        saveLabel={ed.editing?.isNew ? 'Add handle' : 'Save'}
        saving={ed.saving}
        error={ed.error}
        onDelete={ed.editing?.isNew || isDefault ? undefined : ed.destroy}
      >
        {d && (
          <>
            <TextField label="Name" value={d.label} onChange={(label) => ed.setDraft({ ...d, label })} placeholder="e.g. Bar handle 128mm, steel" />
            <Field label="Kind">
              <Select
                value={d.kind}
                onValueChange={(v) => {
                  const kind = v as HandleKind;
                  // Preselect how the kind is actually sold; still editable.
                  ed.setDraft({ ...d, kind, pricingMode: PER_METRE_KINDS.includes(kind) ? 'per-metre' : 'per-unit' });
                }}
              >
                <SelectTrigger className={trigger}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HANDLE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {d.kind !== 'handleless' && (
              <NumberField
                label={lengthMeaning(d.kind)}
                unit="mm"
                min={0}
                value={d.lengthMm}
                onChange={(lengthMm) => ed.setDraft({ ...d, lengthMm })}
                hint={PER_METRE_KINDS.includes(d.kind) ? 'Its running length comes from each panel it is cut to.' : undefined}
              />
            )}
            <Field label="Colour (for the 3D view)">
              <span className="flex h-11 items-center gap-3 rounded-[10px] border border-input bg-card px-3">
                <input
                  type="color"
                  value={d.colorHex}
                  onChange={(e) => ed.setDraft({ ...d, colorHex: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent"
                  aria-label="Colour"
                />
                <span className="font-mono text-sm font-normal text-muted-foreground">{d.colorHex}</span>
              </span>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priced by">
                <Select value={d.pricingMode} onValueChange={(v) => ed.setDraft({ ...d, pricingMode: v as HandleSpec['pricingMode'] })}>
                  <SelectTrigger className={trigger}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per-unit">Per piece</SelectItem>
                    <SelectItem value="per-metre">Per running metre</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <NumberField label="Price" prefix="₹" min={0} value={d.price} onChange={(price) => ed.setDraft({ ...d, price })} />
            </div>
          </>
        )}
      </EditPanel>
    </div>
  );
}
