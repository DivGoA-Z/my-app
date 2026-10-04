import { describe, expect, it } from 'vitest';
import { BACKDROP_DARK, BACKDROP_LIGHT, PLASTER_L, contrastingBackdrop, lightnessOfHex, surfaceLightness } from './backdrop';

describe('lightnessOfHex', () => {
  it('white is 1, black is 0, mid grey about half', () => {
    expect(lightnessOfHex('#ffffff')).toBeCloseTo(1, 2);
    expect(lightnessOfHex('#000000')).toBeCloseTo(0, 2);
    expect(lightnessOfHex('#777777')).toBeGreaterThan(0.45);
    expect(lightnessOfHex('#777777')).toBeLessThan(0.55);
  });
});

describe('surfaceLightness', () => {
  it('a colour override wins over the finish', () => {
    expect(surfaceLightness({ solidColor: '#ffffff' }, '#202020')).toBeLessThan(0.2);
  });
  it('no finish is bare plaster (light)', () => {
    expect(surfaceLightness(undefined)).toBe(PLASTER_L);
    expect(PLASTER_L).toBeGreaterThan(0.9);
  });
  it('wood texture reads mid-dark; quartz light', () => {
    expect(surfaceLightness({ proceduralKind: 'wood', solidColor: '#ffffff' })).toBeLessThan(0.6);
    expect(surfaceLightness({ proceduralKind: 'quartz' })).toBeGreaterThan(0.78);
  });
});

describe('contrastingBackdrop (§93)', () => {
  const white = lightnessOfHex('#f4f1ec');
  const wood = surfaceLightness({ proceduralKind: 'wood' });

  it('white fronts on plaster get the dark backdrop', () => {
    expect(contrastingBackdrop([{ lightness: PLASTER_L, weight: 5 }, { lightness: white, weight: 3 }])).toBe(BACKDROP_DARK);
  });

  it('mostly wood fronts get the light backdrop', () => {
    expect(contrastingBackdrop([{ lightness: PLASTER_L, weight: 2 }, { lightness: wood, weight: 6 }])).toBe(BACKDROP_LIGHT);
  });

  it('weights by area: one small dark unit on a light wall stays light', () => {
    expect(contrastingBackdrop([{ lightness: PLASTER_L, weight: 8 }, { lightness: 0.2, weight: 0.5 }])).toBe(BACKDROP_DARK);
  });

  it('a dark painted wall with white units turns to the light backdrop', () => {
    expect(contrastingBackdrop([{ lightness: lightnessOfHex('#2f3a45'), weight: 6 }, { lightness: white, weight: 3 }])).toBe(BACKDROP_LIGHT);
  });
});
