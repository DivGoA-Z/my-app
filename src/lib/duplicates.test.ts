// Tests for duplicate detection and reference rewriting (§80).

import { describe, expect, it } from 'vitest';
import { countDesignRefs, groupDuplicates, normalizeLabel, rewriteColumn, type LayoutRefs } from './duplicates';

describe('normalizeLabel', () => {
  it('ignores case, spacing and dash style', () => {
    expect(normalizeLabel('Bar Handle 128mm — Brushed Steel')).toBe(normalizeLabel('bar handle 128mm - brushed steel'));
    expect(normalizeLabel('  LED  Strip 3000K–Warm ')).toBe('led strip 3000k - warm');
  });
  it('keeps genuinely different names apart', () => {
    expect(normalizeLabel('Bar handle 128mm')).not.toBe(normalizeLabel('Bar handle 192mm'));
  });
});

describe('groupDuplicates', () => {
  it('groups by key, only groups of 2+, largest first', () => {
    const items = ['a', 'A', 'b', 'c', 'C', 'c '].map((label, i) => ({ id: String(i), label }));
    const groups = groupDuplicates(items, (x) => normalizeLabel(x.label));
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([['c', 3], ['a', 2]]);
  });
});

describe('design references', () => {
  const layouts: LayoutRefs[] = [
    { id: 'L1', cabinets: [{ handleId: 'h2' }, { handleId: 'h2' }, { handleId: 'h1' }], appliances: [], fixtures: [{ catalogItemId: 'f9' }] },
    { id: 'L2', cabinets: [{ handleId: 'h2' }], appliances: [], fixtures: [] },
  ];
  it('counts items and designs per id', () => {
    const refs = countDesignRefs('handles', layouts);
    expect(refs.get('h2')).toEqual({ items: 3, designs: 2 });
    expect(refs.get('h1')).toEqual({ items: 1, designs: 1 });
    expect(countDesignRefs('fixtures', layouts).get('f9')).toEqual({ items: 1, designs: 1 });
  });
  it('rewrites only removed ids, and reports no change as null', () => {
    const cabs = [{ handleId: 'h2', x: 1 }, { handleId: 'h1', x: 2 }, { x: 3 }];
    expect(rewriteColumn('handles', cabs, new Set(['h2']), 'h1')).toEqual([{ handleId: 'h1', x: 1 }, { handleId: 'h1', x: 2 }, { x: 3 }]);
    expect(rewriteColumn('handles', cabs, new Set(['zz']), 'h1')).toBeNull();
    expect(rewriteColumn('fixtures', [{ catalogItemId: 'f2' }], new Set(['f2']), 'f1')).toEqual([{ catalogItemId: 'f1' }]);
  });
});
