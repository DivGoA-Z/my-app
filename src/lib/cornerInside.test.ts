import { describe, expect, it } from 'vitest';
import { cornerInsideChange, cornerInsideOf } from './cornerInside';
import { cabinet, pricing } from '../test/fixtures';
import { calculateBOM } from './bom';

describe('what is inside a corner unit (§148)', () => {
  it('reads it from the module type and, for the cylinder, the pull-out front', () => {
    expect(cornerInsideOf({ moduleType: 'corner-blind' })).toBe('shelves');
    expect(cornerInsideOf({ moduleType: 'corner-blind', frontLayout: { kind: 'trolley', count: 1 } })).toBe('cylinder');
    expect(cornerInsideOf({ moduleType: 'corner-carousel' })).toBe('carousel');
    expect(cornerInsideOf({ moduleType: 'base-cabinet' })).toBeNull();
  });

  it('switching keeps a chosen front, except the cylinder pull-out', () => {
    const drawers = { kind: 'drawers' as const, count: 2 };
    expect(cornerInsideChange({ moduleType: 'corner-blind', frontLayout: drawers }, 'magic')).toEqual({ moduleType: 'corner-magic', frontLayout: drawers });
    expect(cornerInsideChange({ moduleType: 'corner-blind', frontLayout: { kind: 'trolley', count: 1 } }, 'carousel')).toEqual({ moduleType: 'corner-carousel', frontLayout: undefined });
    expect(cornerInsideChange({ moduleType: 'corner-magic' }, 'cylinder')).toEqual({ moduleType: 'corner-blind', frontLayout: { kind: 'trolley', count: 1 } });
  });

  it('a corner cylinder trolley is charged a channel and a basket, and no corner mechanism', () => {
    const lines = (c: ReturnType<typeof cabinet>) => calculateBOM([c], [], pricing()).lineItems[0];
    const corner = cabinet('corner-magic', 900, 900, 720);
    const asCylinder = lines({ ...corner, ...cornerInsideChange(corner, 'cylinder') });
    const asMagic = lines(corner);
    const labels = (l: typeof asMagic) => l.hardwareDetail.map((h) => h.label);
    expect(labels(asCylinder)).toEqual(expect.arrayContaining(['Drawer channels (pairs)', 'Wire baskets']));
    expect(labels(asCylinder)).not.toContain('Magic corner mechanism');
    expect(labels(asMagic)).toContain('Magic corner mechanism');
  });
});
