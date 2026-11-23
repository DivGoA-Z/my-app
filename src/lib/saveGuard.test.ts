// §153: a design is saved only over the version this screen loaded.
import { describe, expect, it, vi, beforeEach } from 'vitest';

// A tiny fake of the Supabase query builder: one `layouts` row in memory.
const db = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, writes: [] as string[] }));
vi.mock('./Supabaseclient', () => {
  const builder = (table: string) => {
    let op = 'select';
    let payload: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === 'projects') {
        db.writes.push('projects');
        return { data: null, error: null };
      }
      const matches = db.row && Object.entries(filters).every(([k, v]) => db.row![k] === v);
      if (op === 'update') {
        if (!matches) return { data: [], error: null };
        db.row = { ...db.row, ...payload };
        db.writes.push('layouts');
        return { data: [{ updated_at: db.row!.updated_at }], error: null };
      }
      if (op === 'upsert' || op === 'insert') {
        db.row = { ...payload };
        db.writes.push('layouts');
        return { data: { updated_at: db.row.updated_at }, error: null };
      }
      return { data: matches ? { updated_at: db.row!.updated_at } : null, error: null };
    };
    const b = {
      update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), b),
      upsert: (p: Record<string, unknown>) => ((op = 'upsert'), (payload = p), b),
      insert: (p: Record<string, unknown>) => ((op = 'insert'), (payload = p), b),
      select: () => b,
      eq: (k: string, v: unknown) => ((filters[k] = v), b),
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (res: (r: unknown) => void) => res(result()),
    };
    return b;
  };
  return { supabase: { from: builder } };
});

import { DesignChangedElsewhereError, saveProjectBundle } from './Persistence';
import { layout } from '../test/fixtures';

const bundle = () =>
  ({ project: { id: 'p1', clientName: 'Ananya Sharma' }, layout: layout({ id: 'L1', projectId: 'p1' }), cabinets: [], appliances: [] }) as never;

describe('saving only over the version this screen loaded (§153)', () => {
  beforeEach(() => {
    db.row = { id: 'L1', updated_at: '2026-11-23T10:00:00.000Z' };
    db.writes = [];
  });

  it('saves when the database still holds the loaded version, and returns the new one', async () => {
    const v = await saveProjectBundle(bundle(), 'biz', '2026-11-23T10:00:00.000Z');
    expect(db.writes).toEqual(['layouts', 'projects']);
    expect(v).not.toBe('2026-11-23T10:00:00.000Z');
  });

  it('refuses, and writes nothing, when someone else saved in between', async () => {
    db.row = { id: 'L1', updated_at: '2026-11-23T10:05:00.000Z' };
    await expect(saveProjectBundle(bundle(), 'biz', '2026-11-23T10:00:00.000Z')).rejects.toBeInstanceOf(DesignChangedElsewhereError);
    expect(db.writes).toEqual([]);
    expect(db.row.updated_at).toBe('2026-11-23T10:05:00.000Z');
  });

  it('a design never saved before is simply written', async () => {
    db.row = null;
    await saveProjectBundle(bundle(), 'biz', null);
    expect(db.writes).toEqual(['layouts', 'projects']);
  });
});
