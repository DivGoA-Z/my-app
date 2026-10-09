// Countertop slab materials (§119): told apart by finish type; surface
// stored as the finish's own gloss values and read back.
import { describe, expect, it } from 'vitest';
import { isSlabMaterial, SLAB_SURFACE_PRESET, slabSurfaceOf, FINISH_TYPE_OPTICAL_PRESET } from '../types/finish';

describe('slab materials', () => {
  it('are finishes of a stone/slab type, in any case', () => {
    expect(isSlabMaterial({ finishTypeLabel: 'Granite' })).toBe(true);
    expect(isSlabMaterial({ finishTypeLabel: ' quartz ' })).toBe(true);
    expect(isSlabMaterial({ finishTypeLabel: 'Sintered stone' })).toBe(true);
    expect(isSlabMaterial({ finishTypeLabel: 'Laminate' })).toBe(false);
  });

  it('read back the surface each preset sets', () => {
    for (const s of ['polished', 'honed', 'leather'] as const) {
      expect(slabSurfaceOf(SLAB_SURFACE_PRESET[s])).toBe(s);
    }
  });

  it('start polished when the type is chosen', () => {
    expect(slabSurfaceOf(FINISH_TYPE_OPTICAL_PRESET.Granite)).toBe('polished');
  });
});
