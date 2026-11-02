// src/lib/usageProjection.ts
//
// "When will we run out?" for the Usage page (§134): a straight line
// through what's been used so far in the period. 6 images by 9 am is
// 6 per 9 hours, so about 16 by midnight; a limit of 20 would be reached
// 21 hours later (14 more at that rate), after midnight, so "within the
// limit". 12 by noon is 1 an hour: 20 is reached at 8 pm, "runs out".
//
// Periods are India time (no daylight saving, so a fixed +5:30), the same
// as the database's limits (usage_status_for): days from midnight, weeks
// from Monday, months from the 1st.

export type Period = 'day' | 'week' | 'month';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function periodBounds(now: Date, period: Period): { start: Date; end: Date } {
  // The India-time calendar date, read off a shifted UTC clock.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const midnight = Date.UTC(y, m, d) - IST_OFFSET_MS;
  if (period === 'day') return { start: new Date(midnight), end: new Date(midnight + DAY_MS) };
  if (period === 'week') {
    const sinceMonday = (ist.getUTCDay() + 6) % 7;
    const start = midnight - sinceMonday * DAY_MS;
    return { start: new Date(start), end: new Date(start + 7 * DAY_MS) };
  }
  return { start: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS), end: new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS) };
}

export type Projection =
  | { kind: 'no-limit'; used: number }
  | { kind: 'reached'; used: number; limit: number }
  | { kind: 'unused'; used: 0; limit: number }
  // On course to stay within the limit: about `projected` by the end.
  | { kind: 'within'; used: number; limit: number; projected: number }
  // On course to reach the limit at `at`, before the period ends.
  | { kind: 'runs-out'; used: number; limit: number; projected: number; at: Date };

// A minute's use isn't a rate: below this much elapsed time, the line is
// drawn as if this much had passed, so 1 image at 00:00:05 doesn't read
// as "runs out in a second".
const MIN_ELAPSED_MS = 60 * 60 * 1000;

export function projectUsage(used: number, limit: number | null, now: Date, period: Period): Projection {
  if (limit === null) return { kind: 'no-limit', used };
  if (used >= limit) return { kind: 'reached', used, limit };
  if (used <= 0) return { kind: 'unused', used: 0, limit };
  const { start, end } = periodBounds(now, period);
  const elapsed = Math.max(now.getTime() - start.getTime(), MIN_ELAPSED_MS);
  const rate = used / elapsed; // per ms
  const projected = Math.round(used + rate * (end.getTime() - now.getTime()));
  const at = new Date(now.getTime() + (limit - used) / rate);
  if (at.getTime() < end.getTime()) return { kind: 'runs-out', used, limit, projected, at };
  return { kind: 'within', used, limit, projected };
}

// ---- In words (India time) ----

const IST = 'Asia/Kolkata';
const time = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const dayAndDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
const date = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });

// When the period's count starts again, in words.
function resetsAt(period: Period, now: Date): string {
  const { end } = periodBounds(now, period);
  if (period === 'day') return 'resets at midnight';
  if (period === 'week') return 'resets on Monday';
  return `resets on ${date(end)}`;
}

// "around 8:00 pm today", "around Thu 5 Nov"
function whenInWords(at: Date, now: Date): string {
  if (istDay(at) === istDay(now)) return `around ${time(at)} today`;
  return `around ${dayAndDate(at)}`;
}

const endWord: Record<Period, string> = { day: 'midnight', week: 'the end of the week', month: 'the end of the month' };

// Short counts as on the page: 52.3k, 1.2M.
const short = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${+(n / 1_000).toFixed(1)}k` : String(n));

export function projectionText(p: Projection, period: Period, now: Date, unit: string): string {
  switch (p.kind) {
    case 'no-limit':
      return 'No limit.';
    case 'reached':
      return `Limit reached: ${resetsAt(period, now)}.`;
    case 'unused':
      return 'Nothing used yet.';
    case 'within':
      return `At this rate: about ${short(p.projected)} ${unit} by ${endWord[period]}, within the limit.`;
    case 'runs-out':
      return `At this rate: runs out ${whenInWords(p.at, now)}.`;
  }
}
