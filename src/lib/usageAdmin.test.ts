// The Usage page's numbers (§132).
import { describe, expect, it } from 'vitest';
import { parseLimit, shortCount } from './usageAdmin';

describe('limits typed on the Usage page', () => {
  it('reads whole numbers, blank as "no limit / default", and refuses the rest', () => {
    expect(parseLimit('20')).toBe(20);
    expect(parseLimit(' 5,00,000 ')).toBe(500000);
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('   ')).toBeNull();
    expect(parseLimit('2.5')).toBeUndefined();
    expect(parseLimit('-3')).toBeUndefined();
    expect(parseLimit('ten')).toBeUndefined();
    expect(parseLimit('0')).toBe(0);
  });

  it('shows big counts short', () => {
    expect(shortCount(999)).toBe('999');
    expect(shortCount(52300)).toBe('52.3k');
    expect(shortCount(500000)).toBe('500k');
    expect(shortCount(1234567)).toBe('1.2M');
  });
});
