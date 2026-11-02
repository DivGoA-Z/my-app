// src/components/admin/YourUsage.tsx
//
// "Your usage" (§134), at the top of the Usage page for everyone: your
// business's images and tokens today / this week / this month, out of its
// limits, and a straight-line projection of when each runs out
// (lib/usageProjection.ts). Read-only: only the software owner sets limits.

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { SectionCard } from '../common/SectionCard';
import { cn } from '@/lib/utils';
import { fetchMyUsage, shortCount, type LimitKey, type MyUsage, type UsedNumbers } from '../../lib/usageAdmin';
import { projectionText, projectUsage, type Period } from '../../lib/usageProjection';

const PERIODS: { period: Period; label: string }[] = [
  { period: 'day', label: 'Today' },
  { period: 'week', label: 'This week' },
  { period: 'month', label: 'This month' },
];
const KINDS = [
  { kind: 'images', label: 'Images', unit: 'images' },
  { kind: 'tokens', label: 'Tokens', unit: 'tokens' },
] as const;

function Cell({ used, limit, period, now, unit }: { used: number; limit: number | null; period: Period; now: Date; unit: string }) {
  const p = projectUsage(used, limit, now, period);
  const share = limit ? Math.min(1, used / limit) : 0;
  const warn = p.kind === 'reached' || p.kind === 'runs-out';
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[14px] tabular-nums">
        <span className={cn('font-semibold', p.kind === 'reached' && 'text-destructive')}>{shortCount(used)}</span>
        <span className="text-muted-foreground">{limit === null ? ' used · no limit' : ` of ${shortCount(limit)}`}</span>
      </span>
      {limit !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div
            className={cn('h-full rounded-full', p.kind === 'reached' ? 'bg-destructive' : p.kind === 'runs-out' ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
      {/* "No limit" is already said beside the count. */}
      {p.kind !== 'no-limit' && (
        <span className={cn('text-[12px] leading-snug', warn ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {projectionText(p, period, now, unit)}
        </span>
      )}
    </div>
  );
}

export function YourUsage() {
  const [data, setData] = useState<MyUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyUsage().then(
      (d) => live && (setData(d), setError(null)),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'Couldn’t load your usage.')
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <SectionCard
      Icon={Activity}
      title="Your usage"
      description="AI pictures (Make image) and AI text (Help questions and images together, counted in tokens; a Help question is about 7,500). Days, weeks (from Monday) and months are in India time. To raise a limit, ask the software owner."
    >
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-3 text-[14px] text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-[14px] text-muted-foreground">Loading…</p>}
      {data && (
        <div className="flex flex-col gap-4">
          {KINDS.map(({ kind, label, unit }) => (
            <div key={kind} className="flex flex-col gap-2 md:grid md:grid-cols-[6rem_repeat(3,minmax(0,1fr))] md:items-start md:gap-x-6">
              <span className="text-[14px] font-semibold md:pt-0.5">{label}</span>
              {PERIODS.map(({ period, label: periodLabel }) => (
                <div key={period} className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{periodLabel}</span>
                  <Cell
                    used={data.used[`${kind}_${period}` as keyof UsedNumbers]}
                    limit={data.limits[`${kind}_per_${period}` as LimitKey]}
                    period={period}
                    now={data.now}
                    unit={unit}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
