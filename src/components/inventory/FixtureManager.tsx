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

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useLayoutStore } from '../../store/layoutStore';
import { modelUrlProblem } from '../../lib/modelUrl';
import { FIXTURE_KIND_LABELS, isLinear } from '../../types/fixture';
import type { FixtureCatalogItem, FixtureKind } from '../../types/fixture';
import { kelvinToColor } from '../../lib/lighting3d';
import { FixtureCatalogImportExport } from './FixtureCatalogImportExport';
import { EditPanel, Field, NumberField, TextField } from '../common/EditPanel';
import { Empty, ListRow, NewButton } from './CatalogueKit';
import { useItemEditor } from './useItemEditor';

const KINDS: FixtureKind[] = ['strip', 'spot', 'cove', 'pendant', 'plinth', 'drawer'];

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function blank(): FixtureCatalogItem {
  return {
    id: crypto.randomUUID(),
    label: '',
    kind: 'strip',
    colorTempK: 3000,
    lumens: 900,
    pricingMode: 'per-metre',
    price: 0,
    createdAt: '',
    updatedAt: '',
  };
}

// Light fixtures as a list; tap one to edit it in a side panel (§76).
export function FixtureManager() {
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const upsert = useLayoutStore((s) => s.upsertFixtureCatalogItem);
  const remove = useLayoutStore((s) => s.removeFixtureCatalogItem);
  const ed = useItemEditor<FixtureCatalogItem>(upsert, remove);
  const d = ed.editing?.draft;
  const trigger = 'h-11! w-full rounded-[10px] bg-card text-[15px] font-normal';

  return (
    <div className="flex flex-col gap-4">
      {/* Title and description: the Catalogue page's section frame (§71). */}
      <div className="flex justify-end">
        <NewButton label="New fixture" onClick={() => ed.open(blank(), true)} />
      </div>
      <div className="flex flex-col">
        {fixtureCatalog.map((f) => (
          <ListRow
            key={f.id}
            onClick={() => ed.open(f, false)}
            media={
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sidebar">
                {/* The light's own colour, glowing on dark. */}
                <span className="size-5 rounded-full" style={{ backgroundColor: kelvinToColor(f.colorTempK), boxShadow: `0 0 14px ${kelvinToColor(f.colorTempK)}` }} />
              </div>
            }
            title={f.label}
            sub={`${FIXTURE_KIND_LABELS[f.kind]} · ${f.colorTempK} K · ${f.lumens} lm`}
            end={
              <span className="w-28 shrink-0 text-right text-[15px] font-bold">
                {INR.format(f.price)}
                <span className="text-[13px] font-normal text-muted-foreground"> {f.pricingMode === 'per-metre' ? '/ m' : '/ pc'}</span>
              </span>
            }
          />
        ))}
        {fixtureCatalog.length === 0 && <Empty>No fixtures yet.</Empty>}
      </div>
      <FixtureCatalogImportExport />

      <EditPanel
        open={!!d}
        onOpenChange={(o) => !o && ed.close()}
        title={ed.editing?.isNew ? 'New fixture' : (d?.label ?? '')}
        onSave={ed.commit}
        saveLabel={ed.editing?.isNew ? 'Add fixture' : 'Save'}
        saving={ed.saving}
        canSave={!modelUrlProblem(d?.modelUrl)}
        error={ed.error}
        onDelete={ed.editing?.isNew ? undefined : ed.destroy}
      >
        {d && (
          <>
            <TextField label="Name" value={d.label} onChange={(label) => ed.setDraft({ ...d, label })} placeholder="e.g. LED strip 3000K warm white" />
            <Field label="Kind">
              <Select
                value={d.kind}
                onValueChange={(v) => {
                  const kind = v as FixtureKind;
                  // Preselect how the kind is sold, so the common case is right.
                  ed.setDraft({ ...d, kind, pricingMode: isLinear(kind) ? 'per-metre' : 'per-unit' });
                }}
              >
                <SelectTrigger className={trigger}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {FIXTURE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Colour temperature"
                unit="K"
                min={2000}
                max={7000}
                value={d.colorTempK}
                onChange={(colorTempK) => ed.setDraft({ ...d, colorTempK })}
                hint={<span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-full" style={{ backgroundColor: kelvinToColor(d.colorTempK) }} />3000 warm · 4000 neutral · 6000 cool</span>}
              />
              <NumberField
                label="Brightness"
                unit="lm"
                min={0}
                value={d.lumens}
                onChange={(lumens) => ed.setDraft({ ...d, lumens })}
                hint="Also decides which lights get a real light in 3D."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priced by">
                <Select value={d.pricingMode} onValueChange={(v) => ed.setDraft({ ...d, pricingMode: v as FixtureCatalogItem['pricingMode'] })}>
                  <SelectTrigger className={trigger}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per-metre">Per running metre</SelectItem>
                    <SelectItem value="per-unit">Per piece</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <NumberField label="Price" prefix="₹" min={0} value={d.price} onChange={(price) => ed.setDraft({ ...d, price })} />
            </div>
            <div className="flex flex-col gap-4 rounded-2xl bg-secondary/60 p-4">
              <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">3D model</span>
              <TextField
                label="Model file"
                value={d.modelUrl ?? ''}
                onChange={(v) => ed.setDraft({ ...d, modelUrl: v || undefined })}
                placeholder="/models/lighting/pendant.glb"
                hint={modelUrlProblem(d.modelUrl) ? <span className="text-destructive">{modelUrlProblem(d.modelUrl)}</span> : 'Leave empty to show a simple bar or disc in 3D.'}
              />
              {/* A fixed correction for how the file was exported, applied
                  before fitting; multiples of 90°, as for appliances. */}
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Turn X" unit="°" value={d.modelRotationXDeg ?? 0} onChange={(n) => ed.setDraft({ ...d, modelRotationXDeg: n })} />
                <NumberField label="Turn Y" unit="°" value={d.modelRotationYDeg ?? 0} onChange={(n) => ed.setDraft({ ...d, modelRotationYDeg: n })} />
                <NumberField label="Turn Z" unit="°" value={d.modelRotationZDeg ?? 0} onChange={(n) => ed.setDraft({ ...d, modelRotationZDeg: n })} />
              </div>
            </div>
          </>
        )}
      </EditPanel>
    </div>
  );
}
