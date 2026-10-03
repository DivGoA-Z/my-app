// src/components/inventory/DuplicatesReview.tsx
//
// "Possible duplicates" on the Catalogue page (§80): a banner when any
// catalogue items look like copies of each other, and a review panel
// where each group is shown with what uses each copy, one copy is picked
// to keep, and Merge moves everything onto it and removes the rest. The
// rules (what points at what, move-then-delete, frozen quotes untouched)
// are in lib/duplicates.ts.

import { useEffect, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { toast } from 'sonner';
import { CopyCheck, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { useLayoutStore } from '../../store/layoutStore';
import { confirmDialog } from '../../store/confirmDialogStore';
import {
  countDesignRefs,
  fetchLayoutRefs,
  groupDuplicates,
  normalizeLabel,
  repointDesigns,
  rewriteColumn,
  type DuplicateKind,
  type LayoutRefs,
} from '../../lib/duplicates';
import { DEFAULT_HANDLE_ID } from '../../types/front';
import { cn } from '@/lib/utils';

interface Entry {
  id: string;
  label: string;
  detail: string;
  createdAt?: string;
}

interface Group {
  kind: DuplicateKind;
  key: string;
  entries: Entry[];
}

const KIND_TITLES: Record<DuplicateKind, string> = {
  cabinets: 'Cabinets',
  appliances: 'Appliances',
  handles: 'Handles',
  fixtures: 'Light fixtures',
  obstacles: 'Pillars & shafts',
};

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const mm = (...n: number[]) => n.join(' × ');

// Every duplicate group across the catalogue, from the store. The key
// includes what makes two items genuinely different (a handle's kind, a
// cabinet's type and size), so only same-name-same-thing items group.
function useDuplicateGroups(): Group[] {
  const handles = useLayoutStore((s) => s.handles);
  const fixtures = useLayoutStore((s) => s.fixtureCatalog);
  const appliances = useLayoutStore((s) => s.applianceCatalog);
  const cabinets = useLayoutStore((s) => s.cabinetCatalog);
  const presets = useLayoutStore((s) => s.obstaclePresets);
  const wrap = <T,>(kind: DuplicateKind, items: T[], key: (t: T) => string, entry: (t: T) => Entry): Group[] =>
    groupDuplicates(items, key).map((g) => ({ kind, key: g.key, entries: g.items.map(entry) }));
  return [
    ...wrap('cabinets', cabinets, (c) => `${c.moduleType}|${mm(c.widthMm, c.depthMm, c.heightMm)}|${normalizeLabel(c.label)}`, (c) => ({
      id: c.id, label: c.label, createdAt: c.createdAt, detail: `${c.category} · ${mm(c.widthMm, c.depthMm, c.heightMm)} · ${INR.format(c.unitPrice)}`,
    })),
    ...wrap('appliances', appliances, (a) => `${a.applianceType}|${normalizeLabel(a.label)}`, (a) => ({
      id: a.id, label: a.label, createdAt: a.createdAt, detail: `${mm(a.widthMm, a.depthMm, a.heightMm)} · ${INR.format(a.unitPrice)}${a.modelUrl ? ' · 3D model' : ''}`,
    })),
    ...wrap('handles', handles, (h) => `${h.kind}|${normalizeLabel(h.label)}`, (h) => ({
      id: h.id, label: h.label, createdAt: h.createdAt, detail: `${INR.format(h.price)} ${h.pricingMode === 'per-metre' ? '/ m' : '/ pc'}${h.id === DEFAULT_HANDLE_ID ? ' · the default handle' : ''}`,
    })),
    ...wrap('fixtures', fixtures, (f) => `${f.kind}|${normalizeLabel(f.label)}`, (f) => ({
      id: f.id, label: f.label, createdAt: f.createdAt, detail: `${f.colorTempK} K · ${f.lumens} lm · ${INR.format(f.price)} ${f.pricingMode === 'per-metre' ? '/ m' : '/ pc'}`,
    })),
    ...wrap('obstacles', presets, (p) => `${p.type}|${mm(p.widthMm, p.depthMm)}|${normalizeLabel(p.label)}`, (p) => ({
      id: p.id, label: p.label, createdAt: p.createdAt, detail: mm(p.widthMm, p.depthMm),
    })),
  ];
}

export function DuplicatesBanner() {
  const groups = useDuplicateGroups();
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  const extra = groups.reduce((n, g) => n + g.entries.length - 1, 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-card md:px-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning-foreground">
          <CopyCheck className="size-[22px]" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Possible duplicates</p>
          <p className="text-[13px] text-muted-foreground">
            {groups.length} {groups.length === 1 ? 'item appears' : 'items appear'} more than once ({extra} extra{' '}
            {extra === 1 ? 'copy' : 'copies'}). Merging keeps one and moves everything onto it.
          </p>
        </div>
        <Button size="touch" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>
      {open && <ReviewPanel groups={groups} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewPanel({ groups, onClose }: { groups: Group[]; onClose: () => void }) {
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const [layouts, setLayouts] = useState<LayoutRefs[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped after a merge, to read usage again.
  const [reload, setReload] = useState(0);

  // Read the saved designs, to show what uses each copy.
  useEffect(() => {
    let cancelled = false;
    fetchLayoutRefs()
      .then((l) => !cancelled && setLayouts(l))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Failed to read designs.'));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const usage = (g: Group, id: string) => {
    const d = layouts ? countDesignRefs(g.kind, layouts).get(id) : undefined;
    const rows = g.kind === 'handles' ? cabinetCatalog.filter((c) => c.handleId === id).length : 0;
    return { items: d?.items ?? 0, designs: d?.designs ?? 0, rows };
  };
  // The suggested copy to keep: the default handle if it's in the group
  // (it can't be deleted), else the most used, else the oldest.
  const suggested = (g: Group) => {
    if (g.entries.some((e) => e.id === DEFAULT_HANDLE_ID)) return DEFAULT_HANDLE_ID;
    return [...g.entries].sort((a, b) => {
      const ua = usage(g, a.id);
      const ub = usage(g, b.id);
      return ub.items + ub.rows - (ua.items + ua.rows) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    })[0].id;
  };
  const keepOf = (g: Group) => picked[`${g.kind}|${g.key}`] ?? suggested(g);

  async function mergeGroup(g: Group): Promise<void> {
    const keep = keepOf(g);
    const removed = g.entries.map((e) => e.id).filter((id) => id !== keep);
    const s = useLayoutStore.getState();
    // 1. Move references: saved designs, then the open design in memory
    //    (so autosave can't write the old ids back), then catalogue rows.
    await repointDesigns(g.kind, removed, keep);
    const gone = new Set(removed);
    if (g.kind === 'handles') {
      const next = rewriteColumn('handles', s.cabinets as unknown as Record<string, unknown>[], gone, keep);
      if (next) useLayoutStore.setState({ cabinets: next as unknown as typeof s.cabinets });
      for (const row of s.cabinetCatalog.filter((c) => c.handleId && gone.has(c.handleId))) {
        await s.upsertCabinetCatalogItem({ ...row, handleId: keep });
      }
    } else if (g.kind === 'appliances') {
      const next = rewriteColumn('appliances', s.appliances as unknown as Record<string, unknown>[], gone, keep);
      if (next) useLayoutStore.setState({ appliances: next as unknown as typeof s.appliances });
    } else if (g.kind === 'fixtures' && s.currentLayout?.fixtures) {
      const next = rewriteColumn('fixtures', s.currentLayout.fixtures as unknown as Record<string, unknown>[], gone, keep);
      if (next) useLayoutStore.setState({ currentLayout: { ...s.currentLayout, fixtures: next as unknown as typeof s.currentLayout.fixtures } });
    }
    // 2. Only then remove the copies.
    for (const id of removed) {
      if (g.kind === 'handles') await s.removeHandle(id);
      else if (g.kind === 'fixtures') await s.removeFixtureCatalogItem(id);
      else if (g.kind === 'appliances') await s.removeApplianceCatalogItem(id);
      else if (g.kind === 'cabinets') await s.removeCabinetCatalogItem(id);
      else await s.removeObstaclePreset(id);
    }
  }

  async function runMerge(list: Group[], label: string) {
    const copies = list.reduce((n, g) => n + g.entries.length - 1, 0);
    const differing = list.filter((g) => new Set(g.entries.map((e) => e.detail.replace(' · the default handle', ''))).size > 1).length;
    const ok = await confirmDialog({
      title: label,
      description: `${copies} ${copies === 1 ? 'copy' : 'copies'} will be removed. Cabinets, designs and catalogue rows using them switch to the copy you keep. Frozen quotes don't change. This can't be undone.${
        differing ? ` ${differing} ${differing === 1 ? 'group has' : 'groups have'} copies with different prices or sizes: check the kept one in ${differing === 1 ? 'it' : 'each'} first.` : ''
      }`,
      confirmLabel: 'Merge',
      destructive: false,
    });
    if (!ok) return;
    setBusy(list.length === 1 ? `${list[0].kind}|${list[0].key}` : 'all');
    try {
      for (const g of list) await mergeGroup(g);
      toast.success(list.length === 1 ? 'Merged' : `Merged ${list.length} groups`);
      setLayouts(null);
      setReload((n) => n + 1); // re-read usage
      if (list.length === groups.length) onClose();
    } catch (err) {
      toast.error('Merge stopped part-way', {
        description: `${err instanceof Error ? err.message : 'Unknown error'}. Nothing was left pointing at a removed item; try again.`,
      });
    } finally {
      setBusy(null);
    }
  }

  const kinds = (Object.keys(KIND_TITLES) as DuplicateKind[]).filter((k) => groups.some((g) => g.kind === k));

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background shadow-float outline-none sm:max-w-[680px] sm:rounded-l-3xl">
          <header className="flex items-start gap-3 border-b border-border bg-card px-5 py-4 sm:rounded-tl-3xl sm:px-6 sm:py-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-xl font-extrabold tracking-[-0.02em]">Possible duplicates</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                Same name and same kind, ignoring capitals and spacing. Pick the copy to keep in each group.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-touch" aria-label="Close" disabled={!!busy}>
                <X />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-6">
            {loadError && <p className="text-sm text-destructive">{loadError}</p>}
            {kinds.map((kind) => (
              <section key={kind} className="flex flex-col gap-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{KIND_TITLES[kind]}</h3>
                {groups
                  .filter((g) => g.kind === kind)
                  .map((g) => {
                    const gid = `${g.kind}|${g.key}`;
                    const keep = keepOf(g);
                    return (
                      <article key={gid} className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold">
                            {g.entries[0].label} <span className="font-normal text-muted-foreground">× {g.entries.length}</span>
                            {/* Same name doesn't mean same item: flag copies
                                whose price or size differ, so a merge never
                                quietly picks the wrong price. */}
                            {new Set(g.entries.map((e) => e.detail.replace(' · the default handle', ''))).size > 1 && (
                              <span className="inline-flex h-6 items-center rounded-full bg-warning-soft px-2.5 text-xs font-semibold text-warning-foreground">
                                Copies differ, check the one kept
                              </span>
                            )}
                          </span>
                          <Button
                            size="touch"
                            onClick={() => runMerge([g], `Merge ${g.entries.length} copies of "${g.entries[0].label}"?`)}
                            disabled={!!busy || !layouts}
                          >
                            {busy === gid ? 'Merging…' : 'Merge'}
                          </Button>
                        </div>
                        <div role="radiogroup" aria-label={`Keep which copy of ${g.entries[0].label}`} className="flex flex-col gap-1.5">
                          {g.entries.map((e) => {
                            const u = usage(g, e.id);
                            const used = [
                              u.items ? `${u.items} in ${u.designs} ${u.designs === 1 ? 'design' : 'designs'}` : null,
                              u.rows ? `${u.rows} catalogue ${u.rows === 1 ? 'cabinet' : 'cabinets'}` : null,
                            ].filter(Boolean);
                            const locked = g.entries.some((x) => x.id === DEFAULT_HANDLE_ID);
                            return (
                              <button
                                key={e.id}
                                type="button"
                                role="radio"
                                aria-checked={keep === e.id}
                                disabled={!!busy || (locked && e.id !== DEFAULT_HANDLE_ID)}
                                onClick={() => setPicked((p) => ({ ...p, [gid]: e.id }))}
                                className={cn(
                                  'flex items-start gap-3 rounded-xl px-3 py-2.5 text-left',
                                  keep === e.id ? 'border-2 border-primary bg-accent' : 'border border-border hover:bg-secondary',
                                  'disabled:cursor-not-allowed'
                                )}
                              >
                                <span className={cn('mt-1 size-4 shrink-0 rounded-full border-2', keep === e.id ? 'border-primary bg-primary' : 'border-input')} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">{e.label}</span>
                                  <span className="block text-[13px] text-muted-foreground">{e.detail}</span>
                                  <span className="block text-[13px] text-muted-foreground">
                                    {!layouts ? (
                                      <Skeleton className="mt-1 h-3 w-32" />
                                    ) : used.length ? (
                                      `Used: ${used.join(' · ')}`
                                    ) : (
                                      'Not used anywhere'
                                    )}
                                  </span>
                                </span>
                                {keep === e.id && <span className="shrink-0 text-xs font-bold text-primary">KEEP</span>}
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
              </section>
            ))}
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-4 sm:rounded-bl-3xl sm:px-6">
            <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
              Suggested picks: the default handle, else the most used copy, else the oldest.
            </span>
            <Button
              size="touch"
              onClick={() => runMerge(groups, `Merge all ${groups.length} groups with the picks shown?`)}
              disabled={!!busy || !layouts}
            >
              {busy === 'all' ? 'Merging…' : `Merge all ${groups.length}`}
            </Button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
