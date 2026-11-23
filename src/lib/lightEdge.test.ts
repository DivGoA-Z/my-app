import { describe, expect, it } from 'vitest';
import { fixtureQuantity, resolveFixturePlacement } from './fixtures';
import { lightPlacement } from './renderBrief';
import { cabinet, layout } from '../test/fixtures';
import type { FixtureCatalogItem, LightFixture } from '../types/fixture';

const strip = { id: 'strip', label: 'Strip', kind: 'strip', colorTempK: 3000, lumens: 800, pricingMode: 'per-metre', price: 500 } as FixtureCatalogItem;
const room = layout({ dimensions: { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 } });
const fx = (cabinetId: string, extra: Partial<LightFixture> = {}): LightFixture =>
  ({ id: 'f', layoutId: 'layout-1', catalogItemId: 'strip', mount: { kind: 'cabinet', cabinetId, face: 'under' }, quantity: 1, enabled: true, ...extra }) as LightFixture;

describe('cabinet lights: near you or near the wall, and a corner L (§151)', () => {
  // A wall cabinet on the north wall, 350 deep, front facing south.
  const upper = cabinet('wall-cabinet', 800, 350, 700, { id: 'u', x: 1000, y: 0, elevationMm: 1500 });

  it('front edge by default, back edge near the wall when asked', () => {
    const front = resolveFixturePlacement(fx('u'), room, [upper], [strip])!;
    const back = resolveFixturePlacement(fx('u', { edge: 'back' }), room, [upper], [strip])!;
    expect(front.yMm).toBeGreaterThan(300);
    expect(back.yMm).toBeLessThan(50);
    expect(back.runLengthMm).toBe(800);
    expect(front.secondRun).toBeUndefined();
  });

  it('under a corner unit in the north-west corner: a second leg down its open (east) side, priced too', () => {
    const corner = cabinet('corner-blind', 900, 900, 850, { id: 'c', x: 0, y: 0, elevationMm: 0 });
    const p = resolveFixturePlacement(fx('c'), room, [corner], [strip])!;
    expect(p.secondRun).toMatchObject({ runAxis: 'y', runLengthMm: 900 });
    expect(p.secondRun!.xMm).toBeGreaterThan(850);
    expect(fixtureQuantity(p)).toEqual({ amount: 1.8, unit: 'm' });
    // Near the wall: a single run along the back, no L.
    expect(resolveFixturePlacement(fx('c', { edge: 'back' }), room, [corner], [strip])!.secondRun).toBeUndefined();
  });

  it('the image brief says where', () => {
    const m = { kind: 'cabinet', cabinetId: 'u', face: 'under' } as const;
    expect(lightPlacement('strip', m, 'the wall cabinet', 'down', { x: 0, y: 0, z: 0 }, { edge: 'back' })).toBe(
      'along the underside of the wall cabinet, at the back near the wall, shining down and washing the wall'
    );
    expect(lightPlacement('strip', m, 'the corner unit', 'down', { x: 0, y: 0, z: 0 }, { corner: true })).toMatch(/in an L along its front and open side/);
  });
});
