// The Usage page's straight-line projection (§134).
import { describe, expect, it } from 'vitest';
import { periodBounds, projectionText, projectUsage } from './usageProjection';

// India time, as an instant: "2026-11-04T09:00" in IST.
const ist = (local: string) => new Date(`${local}:00+05:30`);

describe('periods, in India time', () => {
  it('a day runs midnight to midnight IST', () => {
    expect(periodBounds(ist('2026-11-04T09:00'), 'day')).toEqual({ start: ist('2026-11-04T00:00'), end: ist('2026-11-05T00:00') });
    // 01:00 IST is still the previous day in UTC: the IST date wins.
    expect(periodBounds(ist('2026-11-04T01:00'), 'day').start).toEqual(ist('2026-11-04T00:00'));
  });

  it('a week starts on Monday', () => {
    // 4 Nov 2026 is a Wednesday; 2 Nov the Monday.
    expect(periodBounds(ist('2026-11-04T09:00'), 'week')).toEqual({ start: ist('2026-11-02T00:00'), end: ist('2026-11-09T00:00') });
    // A Sunday belongs to the week that began the Monday before.
    expect(periodBounds(ist('2026-11-08T23:00'), 'week').start).toEqual(ist('2026-11-02T00:00'));
    expect(periodBounds(ist('2026-11-09T00:30'), 'week').start).toEqual(ist('2026-11-09T00:00'));
  });

  it('a month runs from the 1st, across the year end too', () => {
    expect(periodBounds(ist('2026-11-04T09:00'), 'month')).toEqual({ start: ist('2026-11-01T00:00'), end: ist('2026-12-01T00:00') });
    expect(periodBounds(ist('2026-12-31T23:59'), 'month').end).toEqual(ist('2027-01-01T00:00'));
  });
});

describe('the straight line', () => {
  it('6 images by 9 am with a limit of 20: 16 by midnight, within the limit', () => {
    expect(projectUsage(6, 20, ist('2026-11-04T09:00'), 'day')).toEqual({ kind: 'within', used: 6, limit: 20, projected: 16 });
  });

  it('12 images by noon with a limit of 20: runs out at 8 pm', () => {
    const p = projectUsage(12, 20, ist('2026-11-04T12:00'), 'day');
    expect(p.kind).toBe('runs-out');
    if (p.kind !== 'runs-out') return;
    expect(p.at).toEqual(ist('2026-11-04T20:00'));
    expect(p.projected).toBe(24);
  });

  it('a month: 150k tokens in 10 days of a 1M month runs out on day ~67, i.e. not this month', () => {
    const p = projectUsage(150_000, 1_000_000, ist('2026-11-11T00:00'), 'month');
    expect(p).toMatchObject({ kind: 'within', projected: 450_000 });
  });

  it('a week: 70 of 100 by Wednesday midnight runs out on Thursday', () => {
    // Monday 00:00 → Thursday 00:00 = 3 days for 70: 30 more takes 1 2/7 days.
    const p = projectUsage(70, 100, ist('2026-11-05T00:00'), 'week');
    expect(p.kind).toBe('runs-out');
    if (p.kind === 'runs-out') expect(p.at.getTime()).toBeCloseTo(ist('2026-11-05T00:00').getTime() + (30 / 70) * 3 * 86_400_000, -3);
  });

  it('no limit, nothing used, and already at the limit', () => {
    expect(projectUsage(5, null, ist('2026-11-04T09:00'), 'day')).toEqual({ kind: 'no-limit', used: 5 });
    expect(projectUsage(0, 20, ist('2026-11-04T09:00'), 'day')).toEqual({ kind: 'unused', used: 0, limit: 20 });
    expect(projectUsage(20, 20, ist('2026-11-04T09:00'), 'day')).toEqual({ kind: 'reached', used: 20, limit: 20 });
    expect(projectUsage(25, 20, ist('2026-11-04T09:00'), 'day')).toEqual({ kind: 'reached', used: 25, limit: 20 });
  });

  it('a few minutes into the day isn’t treated as a rate', () => {
    // 1 image at 00:05: drawn as if an hour had passed → 24 by midnight.
    expect(projectUsage(1, 30, ist('2026-11-04T00:05'), 'day')).toMatchObject({ kind: 'within' });
  });
});

describe('in words', () => {
  const now = ist('2026-11-04T12:00');
  it('says when it runs out, today or on a later day, in India time', () => {
    expect(projectionText(projectUsage(12, 20, now, 'day'), 'day', now, 'images')).toBe('At this rate: runs out around 8:00 pm today.');
    // Mon 00:00 → Wed 12:00 = 2.5 days for 70; 30 more takes ~1.07 days → Thu.
    expect(projectionText(projectUsage(70, 100, now, 'week'), 'week', now, 'images')).toBe('At this rate: runs out around Thu, 5 Nov.');
  });

  it('within, reached, unused, no limit', () => {
    expect(projectionText(projectUsage(6, 20, ist('2026-11-04T09:00'), 'day'), 'day', now, 'images')).toBe('At this rate: about 16 images by midnight, within the limit.');
    expect(projectionText(projectUsage(150_000, 1_000_000, ist('2026-11-11T00:00'), 'month'), 'month', now, 'tokens')).toBe('At this rate: about 450k tokens by the end of the month, within the limit.');
    expect(projectionText(projectUsage(20, 20, now, 'day'), 'day', now, 'images')).toBe('Limit reached: resets at midnight.');
    expect(projectionText(projectUsage(100, 100, now, 'week'), 'week', now, 'images')).toBe('Limit reached: resets on Monday.');
    expect(projectionText(projectUsage(300, 300, now, 'month'), 'month', now, 'images')).toBe('Limit reached: resets on 1 Dec.');
    expect(projectionText(projectUsage(0, 20, now, 'day'), 'day', now, 'images')).toBe('Nothing used yet.');
    expect(projectionText(projectUsage(3, null, now, 'day'), 'day', now, 'images')).toBe('No limit.');
  });
});
