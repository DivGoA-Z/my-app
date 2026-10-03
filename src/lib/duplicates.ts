// src/lib/duplicates.ts
//
// Finding and merging duplicate catalogue items (§80). Found in real
// data: most handles 3–4 times, often differing only in capitals ("Bar
// handle 128mm — brushed steel" / "Bar Handle 128mm — Brushed Steel"),
// plus repeated cabinets and fixtures — seed rows plus Excel imports run
// more than once.
//
// A merge keeps ONE item of a group and removes the rest. What points at
// a catalogue item decides what must move first:
//   - handles      ← catalogue cabinet rows' handleId, and every placed
//                    cabinet's handleId in every saved design
//   - fixtures     ← every placed fixture's catalogItemId
//   - appliances   ← every placed appliance's catalogItemId
//   - cabinets, pillar presets ← nothing (a placed cabinet COPIES its
//                    catalogue row's values), so copies just go
// Order matters: references are moved first and copies deleted last, so
// a failure half-way leaves an extra row, never a dangling reference.
// Frozen quotes are never touched — they're snapshots by design.
// Finishes are left out for now: referenced from cabinets, walls, floor
// and countertop, and none were duplicated.

import { supabase } from './Supabaseclient';

export type DuplicateKind = 'handles' | 'fixtures' | 'appliances' | 'cabinets' | 'obstacles';

// "Bar Handle 128mm — Brushed Steel" and "bar handle 128mm - brushed
// steel" are the same name: case, spacing and dash style don't count.
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[‒-―−-]+/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DuplicateGroup<T> {
  key: string;
  items: T[];
}

// Items sharing a key, in groups of two or more, largest first.
export function groupDuplicates<T>(items: T[], keyOf: (item: T) => string): DuplicateGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
}

// The saved designs, as far as references go.
export interface LayoutRefs {
  id: string;
  cabinets: { handleId?: string }[];
  appliances: { catalogItemId?: string }[];
  fixtures: { catalogItemId?: string }[];
}

// How many placed items in saved designs point at each id, and in how
// many designs.
export function countDesignRefs(kind: DuplicateKind, layouts: LayoutRefs[]): Map<string, { items: number; designs: number }> {
  const out = new Map<string, { items: number; designs: number }>();
  for (const l of layouts) {
    const ids =
      kind === 'handles'
        ? l.cabinets.map((c) => c.handleId)
        : kind === 'fixtures'
          ? l.fixtures.map((f) => f.catalogItemId)
          : kind === 'appliances'
            ? l.appliances.map((a) => a.catalogItemId)
            : [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id) continue;
      const cur = out.get(id) ?? { items: 0, designs: 0 };
      cur.items += 1;
      if (!seen.has(id)) {
        cur.designs += 1;
        seen.add(id);
      }
      out.set(id, cur);
    }
  }
  return out;
}

// The JSONB column a kind's design references live in.
export function layoutColumn(kind: DuplicateKind): 'cabinets' | 'appliances' | 'fixtures' | null {
  return kind === 'handles' ? 'cabinets' : kind === 'fixtures' ? 'fixtures' : kind === 'appliances' ? 'appliances' : null;
}

// One design's column with every reference to a removed id pointed at
// the kept one; null when nothing in it changes (so it isn't rewritten).
export function rewriteColumn<T extends Record<string, unknown>>(
  kind: DuplicateKind,
  items: T[],
  removed: Set<string>,
  keepId: string
): T[] | null {
  const field = kind === 'handles' ? 'handleId' : 'catalogItemId';
  let changed = false;
  const next = items.map((it) => {
    const id = it[field];
    if (typeof id === 'string' && removed.has(id)) {
      changed = true;
      return { ...it, [field]: keepId };
    }
    return it;
  });
  return changed ? next : null;
}

// ---- Supabase ----

export async function fetchLayoutRefs(): Promise<LayoutRefs[]> {
  const { data, error } = await supabase.from('layouts').select('id, cabinets, appliances, fixtures');
  if (error) throw new Error(`Failed to read designs: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    cabinets: (r.cabinets as LayoutRefs['cabinets']) ?? [],
    appliances: (r.appliances as LayoutRefs['appliances']) ?? [],
    fixtures: (r.fixtures as LayoutRefs['fixtures']) ?? [],
  }));
}

// Points every saved design's references from `removed` to `keepId`.
// Returns how many designs were changed. Reads the designs fresh, so it
// never writes back a stale copy.
export async function repointDesigns(kind: DuplicateKind, removed: string[], keepId: string): Promise<number> {
  const column = layoutColumn(kind);
  if (!column || removed.length === 0) return 0;
  const { data, error } = await supabase.from('layouts').select(`id, ${column}`);
  if (error) throw new Error(`Failed to read designs: ${error.message}`);
  const gone = new Set(removed);
  let changed = 0;
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const next = rewriteColumn(kind, (row[column] as Record<string, unknown>[]) ?? [], gone, keepId);
    if (!next) continue;
    const { error: e } = await supabase.from('layouts').update({ [column]: next }).eq('id', row.id as string);
    if (e) throw new Error(`Failed to update a design: ${e.message}`);
    changed += 1;
  }
  return changed;
}
