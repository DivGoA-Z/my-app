// src/components/inventory/StandardSizesCard.tsx
//
// Catalogue → Cabinets (§147): the business's standard depth × height
// for base, wall and tall units, and every catalogue cabinet that
// differs, each with "Use standard" or "Keep as exception". A standard,
// not a lock: nothing is resized without a click.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { NumberField } from '../common/EditPanel';
import { useLayoutStore } from '../../store/layoutStore';
import {
  SIZE_GROUP_LABELS,
  nonStandardItems,
  sizeDeviation,
  withStandardSize,
  type SizeGroup,
  type StandardSizes,
} from '../../lib/standardSizes';
import type { CatalogItem } from '../../types/Catalog';

const GROUPS: SizeGroup[] = ['base', 'wall', 'tall'];

export function StandardSizesCard({ items }: { items: CatalogItem[] }) {
  const standard = useLayoutStore((s) => s.standardSizes);
  const saveStandardSizes = useLayoutStore((s) => s.saveStandardSizes);
  const upsert = useLayoutStore((s) => s.upsertCabinetCatalogItem);
  // Edits are a draft until Save; null = showing the saved standard.
  const [draft, setDraft] = useState<StandardSizes | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? standard;
  const off = nonStandardItems(items, standard);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await saveStandardSizes(draft);
      setDraft(null);
      toast.success('Standard sizes saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save the standard sizes.');
    } finally {
      setBusy(false);
    }
  }

  async function apply(list: CatalogItem[], change: (c: CatalogItem) => CatalogItem) {
    setBusy(true);
    try {
      for (const c of list) await upsert(change(c));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t update the cabinet.');
    } finally {
      setBusy(false);
    }
  }

  const describe = (c: CatalogItem) => {
    const dev = sizeDeviation(c, standard)!;
    const parts = [
      dev.depthMm !== undefined ? `depth ${c.depthMm} (standard ${dev.depthMm})` : '',
      dev.heightMm !== undefined ? `height ${c.heightMm} (standard ${dev.heightMm})` : '',
    ].filter(Boolean);
    return parts.join(', ');
  };

  return (
    <section aria-label="Standard sizes" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-bold">Standard sizes</span>
        <span className="text-[13px] text-muted-foreground">
          One depth × height for each kind of unit; only the width varies. Corner units follow the base height; their depth is the corner&rsquo;s.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">{SIZE_GROUP_LABELS[g]}</span>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Depth"
                unit="mm"
                min={100}
                value={shown[g].depthMm}
                onChange={(depthMm) => setDraft({ ...shown, [g]: { ...shown[g], depthMm } })}
              />
              <NumberField
                label="Height"
                unit="mm"
                min={100}
                value={shown[g].heightMm}
                onChange={(heightMm) => setDraft({ ...shown, [g]: { ...shown[g], heightMm } })}
              />
            </div>
          </div>
        ))}
      </div>
      {draft && (
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy}>
            Save standard sizes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}

      {off.length > 0 && !draft && (
        <div role="status" className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 font-semibold">
              {off.length} {off.length === 1 ? 'cabinet differs' : 'cabinets differ'} from the standard
            </span>
            {off.length > 1 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(off, (c) => withStandardSize(c, standard))}>
                Use standard for all
              </Button>
            )}
          </div>
          {off.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.label}</span>: {describe(c)}
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => apply([c], (x) => withStandardSize(x, standard))}>
                Use standard
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply([c], (x) => ({ ...x, sizeException: true }))}>
                Keep as exception
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
