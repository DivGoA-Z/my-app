import { describe, expect, it } from 'vitest';
import { gstinCheckChar, gstinProblem, normaliseGstin } from './businessProfile';

// A widely published sample GSTIN with a correct check character.
const VALID = '27AAPFU0939F1ZV';

describe('GSTIN (§94)', () => {
  it('computes the published check character', () => {
    expect(gstinCheckChar(VALID.slice(0, 14))).toBe('V');
  });

  it('accepts a valid GSTIN, in any case and with spaces', () => {
    expect(gstinProblem(VALID)).toBeNull();
    expect(gstinProblem(' 27aapfu0939f1zv ')).toBeNull();
    expect(normaliseGstin('27 aapfu 0939f1zv')).toBe(VALID);
  });

  it('empty is fine: not every business has one', () => {
    expect(gstinProblem('')).toBeNull();
  });

  it('catches a single mistyped character', () => {
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/last character/);
    expect(gstinProblem('27AAPFU0938F1ZV')).toMatch(/last character/);
  });

  it('catches the wrong length and the wrong shape', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
    expect(gstinProblem('AAAAPFU0939F1ZV')).toMatch(/look like/);
  });
});
