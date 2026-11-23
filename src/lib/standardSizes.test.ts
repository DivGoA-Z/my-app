import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STANDARD_SIZES as STD,
  nonStandardItems,
  normalizeStandardSizes,
  sizeDeviation,
  sizeGroup,
  standardFor,
  withStandardSize,
} from './standardSizes';
import type { ModuleType } from '../types/cabinet';

const item = (moduleType: ModuleType, depthMm: number, heightMm: number, sizeException?: boolean) => ({ moduleType, depthMm, heightMm, sizeException });

describe('standard cabinet sizes (§147)', () => {
  it('groups every unit type as base, wall or tall', () => {
    expect(sizeGroup('sink-unit')).toBe('base');
    expect(sizeGroup('cylinder-trolley')).toBe('base');
    expect(sizeGroup('corner-magic')).toBe('base');
    expect(sizeGroup('wall-cabinet')).toBe('wall');
    expect(sizeGroup('pantry-unit')).toBe('tall');
  });

  it('a corner follows the base height but keeps its own depth', () => {
    expect(standardFor('corner-carousel', STD)).toEqual({ heightMm: 850 });
    expect(sizeDeviation(item('corner-magic', 900, 850), STD)).toBeNull();
    expect(sizeDeviation(item('corner-magic', 600, 720), STD)).toEqual({ heightMm: 850 });
    expect(withStandardSize(item('corner-magic', 600, 720), STD)).toMatchObject({ depthMm: 600, heightMm: 850 });
  });

  it('flags what differs, except kept exceptions', () => {
    const list = [item('base-cabinet', 600, 850), item('base-cabinet', 600, 720), item('wall-cabinet', 350, 700), item('tall-unit', 600, 2400, true)];
    expect(nonStandardItems(list, STD)).toEqual([list[1], list[2]]);
    expect(sizeDeviation(list[2], STD)).toEqual({ depthMm: 300 });
    expect(withStandardSize(list[2], STD)).toMatchObject({ depthMm: 300, heightMm: 700 });
  });

  it('a stored standard falls back to the default where it is missing or nonsense', () => {
    expect(normalizeStandardSizes(null)).toEqual(STD);
    expect(normalizeStandardSizes({ wall: { depthMm: 350, heightMm: -1 } }).wall).toEqual({ depthMm: 350, heightMm: 700 });
  });
});
