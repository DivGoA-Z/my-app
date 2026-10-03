// Tests for the pipeline rules behind Home and Customers (§70).

import { describe, expect, it } from 'vitest';
import { continueDesigning, followUps, homeStats, onBoard } from './pipeline';
import type { CustomerProject, LeadStatus } from '../types/customer';

const now = new Date('2026-10-10T12:00:00');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

let n = 0;
function c(status: LeadStatus, extra: Partial<CustomerProject> = {}): CustomerProject {
  n += 1;
  return {
    id: `p${n}`, clientName: `Customer ${n}`, phone: '', address: '', locality: '', status,
    createdAt: daysAgo(30), updatedAt: daysAgo(1), statusChangedAt: daysAgo(1), ...extra,
  };
}

describe('Home cards', () => {
  it('approved jobs (open) = Approved + In Production, whenever approved, with the split', () => {
    const s = homeStats(
      [c('Approved', { quoteTotal: 100, statusChangedAt: daysAgo(60) }), c('In Production', { quoteTotal: 50 }), c('In Production', { quoteTotal: 25 }), c('Installed', { quoteTotal: 999 })],
      now
    );
    expect(s.approvedOpen).toEqual({ count: 3, value: 175, notStarted: 1, inProduction: 2 });
  });
  it('quotes out and the next install', () => {
    const s = homeStats(
      [
        c('Quote Sent', { quoteTotal: 200 }),
        c('In Production', { installDate: '2026-10-20', clientName: 'Later' }),
        c('In Production', { installDate: '2026-10-12', clientName: 'Sooner' }),
        c('In Production', { installDate: '2026-10-01', clientName: 'Past' }),
      ],
      now
    );
    expect(s.quotesOut).toEqual({ count: 1, value: 200 });
    expect(s.installs).toEqual({ count: 2, next: { date: '2026-10-12', name: 'Sooner' } });
  });
});

describe('Follow up', () => {
  it('flags stale stages and a missing install date, most overdue first', () => {
    const list = followUps(
      [
        c('Quote Sent', { statusChangedAt: daysAgo(5) }),
        c('Quote Sent', { statusChangedAt: daysAgo(1) }),
        c('Lead', { statusChangedAt: daysAgo(9) }),
        c('In Production'),
        c('Approved', { statusChangedAt: daysAgo(40) }),
      ],
      now
    );
    expect(list.map((f) => [f.customer.status, f.action])).toEqual([
      ['Lead', 'start-design'],
      ['Quote Sent', 'whatsapp'],
      ['In Production', 'set-install-date'],
    ]);
  });
  it('falls back to updatedAt for rows from before status_changed_at', () => {
    expect(followUps([c('Quote Sent', { statusChangedAt: undefined, updatedAt: daysAgo(4) })], now)).toHaveLength(1);
  });
});

describe('Continue designing and the board', () => {
  it('only unapproved designs edited in the last 7 days', () => {
    const list = continueDesigning([c('Layout Drafted'), c('Approved'), c('Lead', { updatedAt: daysAgo(10) })], now);
    expect(list.map((x) => x.status)).toEqual(['Layout Drafted']);
  });
  it('Installed shows for 30 days; Lost never', () => {
    expect(onBoard(c('Installed', { statusChangedAt: daysAgo(10) }), now)).toBe(true);
    expect(onBoard(c('Installed', { statusChangedAt: daysAgo(40) }), now)).toBe(false);
    expect(onBoard(c('Lost'), now)).toBe(false);
  });
});
