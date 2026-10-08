import { describe, expect, it } from 'vitest';
import { rotateTarget } from './rotateTarget';

const sinkUnit = { type: 'cabinet' as const, id: 'sink-unit' };
const sink = { type: 'appliance' as const, id: 'sink' };
const unitRect = { x: 0, y: 0, widthMm: 900, depthMm: 600 };

describe('rotateTarget (§115)', () => {
  it('turns the selected sink unit when the sink on top is double-clicked', () => {
    expect(rotateTarget(sink, sinkUnit, unitRect, 450, 300)).toEqual(sinkUnit);
  });
  it('turns what was clicked when nothing else is selected', () => {
    expect(rotateTarget(sink, null, null, 450, 300)).toEqual(sink);
    expect(rotateTarget(sink, sink, { x: 0, y: 0, widthMm: 600, depthMm: 450 }, 10, 10)).toEqual(sink);
  });
  it('turns what was clicked when the double-click is outside the selection', () => {
    expect(rotateTarget(sink, sinkUnit, unitRect, 1200, 300)).toEqual(sink);
  });
});

describe('parseHexInput (§115)', async () => {
  const { parseHexInput } = await import('./color');
  it('accepts what people type or paste', () => {
    expect(parseHexInput('c08a4e')).toBe('#c08a4e');
    expect(parseHexInput(' #C08A4E ')).toBe('#c08a4e');
    expect(parseHexInput('#abc')).toBe('#aabbcc');
  });
  it('waits while the code is unfinished', () => {
    expect(parseHexInput('#')).toBeNull();
    expect(parseHexInput('c08a')).toBeNull();
    expect(parseHexInput('#c08a4g')).toBeNull();
  });
});
