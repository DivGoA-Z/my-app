import { describe, expect, it } from 'vitest';
import { cabinetFrontBreakdown } from './fronts';
import { defaultFrontLayout, type HandleSpec } from '../types/front';
import { defaultRateCard } from '../types/rates';
import { cabinet } from '../test/fixtures';

const rates = defaultRateCard().hardware;
const handle = (kind: HandleSpec['kind'], lengthMm: number): HandleSpec => ({
  id: 'h',
  label: kind,
  kind,
  lengthMm,
  colorHex: '#888888',
  metalness: 0.9,
  roughness: 0.4,
  pricingMode: kind === 'edge-profile' || kind === 'gola' ? 'per-metre' : 'per-unit',
  price: 0,
  createdAt: '',
  updatedAt: '',
});
// Handle centre measured up from the door's bottom edge (panel frame is centred).
const fromBottom = (moduleType: 'wall-cabinet' | 'base-cabinet', h: HandleSpec) => {
  const c = cabinet(moduleType, 600, 350, 720, { frontLayout: { kind: 'double-door' } });
  const p = cabinetFrontBreakdown(c, defaultFrontLayout(c.moduleType, c.widthMm), h, rates).panels[0];
  return p.handle!.centerYMm - (p.centerYMm - p.heightMm / 2);
};

describe('wall cabinet door handles sit near the bottom edge (§149)', () => {
  it('knob, bar and profile are low on a wall cabinet', () => {
    expect(fromBottom('wall-cabinet', handle('knob', 30))).toBeLessThan(100);
    expect(fromBottom('wall-cabinet', handle('bar', 160))).toBeLessThan(160);
    expect(fromBottom('wall-cabinet', handle('edge-profile', 600))).toBeLessThan(20);
  });

  it('a base cabinet keeps its handle where it was', () => {
    expect(fromBottom('base-cabinet', handle('knob', 30))).toBeGreaterThan(330); // about the middle
    expect(fromBottom('base-cabinet', handle('edge-profile', 600))).toBeGreaterThan(700);
  });
});

describe('lift-up flap (§149)', () => {
  it('one panel, a lift-up mechanism instead of hinges, handle on the bottom edge', () => {
    const c = cabinet('wall-cabinet', 900, 350, 400, { frontLayout: { kind: 'lift-up' } });
    const b = cabinetFrontBreakdown(c, defaultFrontLayout(c.moduleType, c.widthMm), handle('bar', 160), rates);
    expect(b.panels).toHaveLength(1);
    expect(b.hardware.map((h) => h.type)).toEqual(['liftUp', 'handle']);
    expect(b.hardware[0].unitCost).toBe(rates.liftUp);
    const p = b.panels[0];
    expect(p.handle!.orientation).toBe('horizontal');
    expect(p.handle!.centerYMm - (p.centerYMm - p.heightMm / 2)).toBeLessThan(60);
  });

  it('a rate card saved before the rate existed gets the placeholder, not ₹0', async () => {
    const { defaultRateCard: card, sanitizeRateCard } = await import('../types/rates');
    const old = card();
    delete (old.hardware as Partial<typeof old.hardware>).liftUp;
    expect(sanitizeRateCard(old).hardware.liftUp).toBe(card().hardware.liftUp);
  });
});
