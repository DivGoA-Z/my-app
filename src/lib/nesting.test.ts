// Tests for sheet nesting (lib/nesting.ts, docs/DECISIONS.md §49-§53).
// The packer is a heuristic, so these don't pin exact layouts — they pin
// what must ALWAYS hold (every piece once, inside the trimmed sheet,
// kerf-separated, grain respected, sizes unchanged) plus the size-choice
// rules and the sheet counts measured on the test kitchen (§55).

import { describe, expect, it } from 'vitest';
import { nestParts, type NestResult } from './nesting';
import { computeCutList, type CutPart } from './cutList';
import { defaultRateCard } from '../types/rates';
import { construction, lShapedKitchen } from '../test/fixtures';

const cut = { kerfMm: 4, trimMm: 10 };
const groups = computeCutList(lShapedKitchen(), construction(), [], defaultRateCard(), []).groups;
const carcass = groups.find((g) => g.label.startsWith('HDMR 18mm — carcass'))!.parts;

function assertValid(r: NestResult, parts: CutPart[], sizes: { lengthMm: number; widthMm: number }[]) {
  const expected = parts.reduce((t, p) => t + p.quantity, 0);
  expect(r.sheets.reduce((t, sh) => t + sh.pieces.length, 0) + r.unplaced.length).toBe(expected);
  for (const sh of r.sheets) {
    expect(sizes.some((z) => z.lengthMm === sh.lengthMm && z.widthMm === sh.widthMm)).toBe(true);
    sh.pieces.forEach((a, i) => {
      expect(a.x).toBeGreaterThanOrEqual(cut.trimMm - 1e-6);
      expect(a.y).toBeGreaterThanOrEqual(cut.trimMm - 1e-6);
      expect(a.x + a.w).toBeLessThanOrEqual(sh.lengthMm - cut.trimMm + 1e-6);
      expect(a.y + a.h).toBeLessThanOrEqual(sh.widthMm - cut.trimMm + 1e-6);
      if (a.part.grainFixed) expect(a.rotated).toBe(false);
      expect([a.w, a.h]).toEqual(a.rotated ? [a.part.widthMm, a.part.lengthMm] : [a.part.lengthMm, a.part.widthMm]);
      for (const b of sh.pieces.slice(i + 1)) {
        const apartX = a.x + a.w + cut.kerfMm <= b.x + 1e-6 || b.x + b.w + cut.kerfMm <= a.x + 1e-6;
        const apartY = a.y + a.h + cut.kerfMm <= b.y + 1e-6 || b.y + b.h + cut.kerfMm <= a.y + 1e-6;
        expect(apartX || apartY).toBe(true);
      }
    });
  }
}

describe('nesting on 8×4 sheets', () => {
  const sizes = [{ lengthMm: 2440, widthMm: 1220 }];

  it('every board group of the test kitchen lays out validly', () => {
    for (const g of groups) assertValid(nestParts(g.parts, sizes, cut), g.parts, sizes);
  });
  it('the test kitchen needs 13 sheets in all (7 carcass, 3 backs, 3 fronts)', () => {
    const counts = groups.map((g) => nestParts(g.parts, sizes, cut).sheets.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(13);
  });
  it('a part too big for the sheet is reported, never dropped', () => {
    const big = { ...carcass[0], lengthMm: 2500, widthMm: 300, quantity: 1 };
    const r = nestParts([big], sizes, cut);
    expect(r.unplaced).toHaveLength(1);
    expect(r.sheets).toHaveLength(0);
  });
  it('waste counts every sheet in full (§51)', () => {
    const r = nestParts(carcass, sizes, cut);
    expect(r.wastePercent).toBeCloseTo((1 - r.partsAreaSqM / r.sheetsAreaSqM) * 100, 6);
  });
});

describe('several sheet sizes for one board (§52)', () => {
  it('finishes on a smaller size when one holds the last sheet', () => {
    const sizes = [{ lengthMm: 2440, widthMm: 1220 }, { lengthMm: 1830, widthMm: 1220 }];
    const r = nestParts(carcass, sizes, cut);
    assertValid(r, carcass, sizes);
    expect(r.unplaced).toHaveLength(0);
    expect(r.sheets.some((sh) => sh.lengthMm === 1830)).toBe(true);
    expect(r.sheetsAreaSqM).toBeLessThan(7 * 2.44 * 1.22);
  });
  it('long parts go on a size they fit; only-too-short sizes report them', () => {
    const shortOnly = [{ lengthMm: 1830, widthMm: 1220 }];
    const r = nestParts(carcass, shortOnly, cut);
    expect(r.unplaced.map((p) => p.lengthMm)).toEqual([2100, 2100]);
    const both = [{ lengthMm: 1830, widthMm: 1220 }, { lengthMm: 2440, widthMm: 1220 }];
    expect(nestParts(carcass, both, cut).unplaced).toHaveLength(0);
  });
});

describe('cache (§53)', () => {
  it('same parts give the identical result object; different labels recompute', () => {
    const sizes = [{ lengthMm: 2440, widthMm: 1220 }];
    const first = nestParts(carcass, sizes, cut);
    expect(nestParts(carcass, sizes, cut)).toBe(first);
    const relabelled = carcass.map((p) => ({ ...p, cabinetRef: p.cabinetRef + 'x' }));
    const again = nestParts(relabelled, sizes, cut);
    expect(again).not.toBe(first);
    expect(again.sheets.length).toBe(first.sheets.length);
  });
});
