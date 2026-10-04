import { describe, expect, it } from 'vitest';
import { BASE_BAND, WALL_BAND, bandChain, heightLevels } from './elevationDims';
import type { WallElevationItem } from './surfaceAreas';

let n = 0;
const item = (kind: WallElevationItem['kind'], alongMm: number, extentMm: number, bottomMm: number, topMm: number): WallElevationItem => ({
  kind,
  id: `i${++n}`,
  label: kind,
  alongMm,
  extentMm,
  bottomMm,
  topMm,
});

const base = (along: number, w: number) => item('cabinet', along, w, 0, 850);
const wallUnit = (along: number, w: number) => item('cabinet', along, w, 1450, 2170);

describe('bandChain (§92)', () => {
  it('lists items and the gaps between them, covering the whole wall', () => {
    const chain = bandChain([base(0, 600), base(750, 900)], 3000, BASE_BAND);
    expect(chain).toEqual([
      { startMm: 0, endMm: 600, kind: 'item' },
      { startMm: 600, endMm: 750, kind: 'gap' },
      { startMm: 750, endMm: 1650, kind: 'item' },
      { startMm: 1650, endMm: 3000, kind: 'gap' },
    ]);
  });

  it('merges an appliance over its cabinet into one run', () => {
    const chain = bandChain([base(0, 900), item('appliance', 150, 600, 800, 860)], 900, BASE_BAND);
    expect(chain).toEqual([{ startMm: 0, endMm: 900, kind: 'item' }]);
  });

  it('a hob straddling two cabinets keeps both cabinet widths', () => {
    const chain = bandChain([base(0, 600), base(600, 600), item('appliance', 300, 600, 800, 860)], 1200, BASE_BAND);
    expect(chain).toEqual([
      { startMm: 0, endMm: 600, kind: 'item' },
      { startMm: 600, endMm: 1200, kind: 'item' },
    ]);
  });

  it('a free-standing fridge is its own span', () => {
    const chain = bandChain([base(0, 600), item('appliance', 600, 700, 0, 1800)], 1300, BASE_BAND);
    expect(chain).toEqual([
      { startMm: 0, endMm: 600, kind: 'item' },
      { startMm: 600, endMm: 1300, kind: 'item' },
    ]);
  });

  it('treats a sub-2mm sliver as touching, not a gap', () => {
    const chain = bandChain([base(0, 600), base(601, 600)], 1201, BASE_BAND);
    expect(chain.filter((s) => s.kind === 'gap')).toEqual([]);
    expect(chain[chain.length - 1].endMm).toBe(1201);
  });

  it('keeps a door opening as its own span', () => {
    const chain = bandChain([base(0, 600), item('opening', 900, 800, 0, 2100)], 2000, BASE_BAND);
    expect(chain.map((s) => s.kind)).toEqual(['item', 'gap', 'opening', 'gap']);
  });

  it('wall-unit level ignores base units but sees a tall unit', () => {
    const tall = item('cabinet', 0, 600, 0, 2100);
    const chain = bandChain([tall, base(600, 600), wallUnit(1200, 600)], 1800, WALL_BAND);
    expect(chain).toEqual([
      { startMm: 0, endMm: 600, kind: 'item' },
      { startMm: 600, endMm: 1200, kind: 'gap' },
      { startMm: 1200, endMm: 1800, kind: 'item' },
    ]);
  });

  it('is empty when nothing is at that level', () => {
    expect(bandChain([base(0, 600)], 3000, WALL_BAND)).toEqual([]);
  });

  it('clips items that overhang the wall ends', () => {
    expect(bandChain([base(-50, 600)], 3000, BASE_BAND)[0]).toEqual({ startMm: 0, endMm: 550, kind: 'item' });
  });
});

describe('heightLevels (§92)', () => {
  it('floor, counter top, wall-unit underside and top, ceiling', () => {
    expect(heightLevels([base(0, 600), wallUnit(0, 600)], 2700)).toEqual([0, 850, 1450, 2170, 2700]);
  });

  it('only floor and ceiling on a bare wall', () => {
    expect(heightLevels([item('opening', 0, 900, 900, 2100)], 2700)).toEqual([0, 2700]);
  });
});
