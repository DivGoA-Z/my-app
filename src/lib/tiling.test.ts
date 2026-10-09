// Laying floors and walls as tiles (§122).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TILING,
  describeTiling,
  finishForTiling,
  groutCell,
  groutRepeat,
  hasBakedTiles,
  tilingMode,
  type SurfaceTiling,
} from './tiling';

const marble = { finishTypeLabel: 'Marble', albedoUrl: '/m.jpg', swatchWidthMm: 1500, swatchHeightMm: 1500 };
const subway = { finishTypeLabel: 'Wall tile', albedoUrl: '/s.jpg', swatchWidthMm: 1200, swatchHeightMm: 1200, tileWidthMm: 150, tileHeightMm: 75 };
const unknownTilePhoto = { finishTypeLabel: 'Vitrified tile', albedoUrl: '/t.jpg', swatchWidthMm: 2000, swatchHeightMm: 2000 };
const t = (p: Partial<SurfaceTiling> = {}): SurfaceTiling => ({ ...DEFAULT_TILING, ...p });

describe('which way a surface is tiled', () => {
  it('draws grout over seamless materials and plain colours', () => {
    expect(tilingMode(marble, t())).toEqual({ kind: 'overlay' });
    expect(tilingMode({ finishTypeLabel: 'Paint' }, t())).toEqual({ kind: 'overlay' });
    // A tile TYPE without a photo (a placeholder colour) has no baked grout.
    expect(hasBakedTiles({ finishTypeLabel: 'Vitrified tile' })).toBe(false);
  });

  it('rescales a tile photo whose tile size is known', () => {
    expect(tilingMode(subway, t({ tileWidthMm: 300, tileHeightMm: 150 }))).toEqual({ kind: 'rescale', scaleX: 2, scaleY: 2 });
    expect(finishForTiling(subway, t({ tileWidthMm: 300, tileHeightMm: 150 }))).toMatchObject({ swatchWidthMm: 2400, swatchHeightMm: 2400 });
    // Untouched for a seamless finish or with no tiling.
    expect(finishForTiling(marble, t())).toBe(marble);
    expect(finishForTiling(subway, null)).toBe(subway);
  });

  it('can’t resize a tile photo whose tile size isn’t recorded', () => {
    expect(tilingMode(unknownTilePhoto, t())).toEqual({ kind: 'unknown-size' });
  });
});

describe('the drawn grout grid', () => {
  it('is one tile per repeat, two rows when offset', () => {
    expect(groutCell(t({ tileWidthMm: 600, tileHeightMm: 1200 }))).toMatchObject({ widthPx: 512, heightPx: 1024, rows: 1 });
    expect(groutCell(t({ tileWidthMm: 300, tileHeightMm: 150, pattern: 'offset' }))).toMatchObject({ heightPx: 512, rows: 2, joints: [[0], [256]] });
    // A 2mm joint on a big tile still shows.
    expect(groutCell(t({ tileWidthMm: 1200, tileHeightMm: 1200, groutMm: 1 })).groutPx).toBeGreaterThanOrEqual(1.5);
  });

  it('carries on across a wall’s pieces either side of a window', () => {
    const tiles = t({ tileWidthMm: 600, tileHeightMm: 600 });
    // 900mm piece starting at 0, then a piece starting at 2100 after a window.
    const a = groutRepeat(tiles, 900, 2700, 0, 0, false);
    const b = groutRepeat(tiles, 900, 2700, 2100, 0, false);
    expect(a).toEqual({ repeat: [1.5, 4.5], offset: [0, 0] });
    // 2100 / 600 = 3.5 tiles in: the grid continues half a tile along.
    expect(b.offset[0]).toBeCloseTo(0.5);
  });

  it('starts from the room’s corner on walls seen the other way round', () => {
    const tiles = t({ tileWidthMm: 600, tileHeightMm: 600 });
    // A 1500mm wall seen from inside runs right-to-left: its far end is at 1500.
    const r = groutRepeat(tiles, 1500, 600, 0, 0, true);
    // u=0 sits at along=1500 → 2.5 tiles from the corner: offset −2.5 → 0.5.
    expect(r.offset[0]).toBeCloseTo(0.5);
  });
});

it('describes itself for the inspector and the image brief', () => {
  expect(describeTiling(t({ tileWidthMm: 800, tileHeightMm: 1600, groutMm: 2, groutColor: '#8f8d88' }))).toBe(
    '800×1600 mm tiles, 2 mm grey grout'
  );
  expect(describeTiling(t({ pattern: 'offset' }))).toContain('offset rows');
});
