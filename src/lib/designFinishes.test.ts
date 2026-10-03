import { describe, expect, it } from 'vitest';
import { dominantFinishId, finishSwatch } from './designFinishes';

describe('design card material', () => {
  it('main finish = the one most cabinets use, counting quantity, ignoring none', () => {
    expect(dominantFinishId([{ finishId: 'oak' }, { finishId: 'walnut', quantity: 3 }, { finishId: 'none', quantity: 9 }])).toBe('walnut');
    expect(dominantFinishId([])).toBeUndefined();
  });
  it('photo first, then generated texture, then flat colour', () => {
    const base = { id: 'f', label: 'F', finishTypeLabel: 'Laminate', patternCategory: 'solid' as const };
    expect(finishSwatch({ ...base, albedoUrl: '/x.jpg', solidColor: '#fff' })?.image).toBe('/x.jpg');
    expect(finishSwatch({ ...base, proceduralKind: 'wood' })?.image).toBe('/textures/wood/color.jpg');
    expect(finishSwatch({ ...base, solidColor: '#123456' })).toEqual({ color: '#123456', label: 'F' });
  });
});
