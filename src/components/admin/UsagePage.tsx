// src/components/admin/UsagePage.tsx
//
// The software owner's Usage page (§132): AI limits for every business —
// images and tokens, per day / week / month — and what each has used.
// Defaults apply to every business; a business's own number wins. Blank
// means "no limit" for a default and "use the default" for a business.
// Only shown to a super admin; the database refuses anyone else anyway.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Gauge, RotateCcw } from 'lucide-react';
import { PageHeader } from '../shell/AppShell';
import { SectionCard } from '../common/SectionCard';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  fetchUsageOverview,
  LIMIT_KEYS,
  parseLimit,
  saveBusinessLimits,
  saveDefaultLimits,
  shortCount,
  type BusinessUsage,
  type LimitKey,
  type Limits,
  type UsageOverview,
} from '../../lib/usageAdmin';

const ROWS = [
  { label: 'Images', keys: ['images_per_day', 'images_per_week', 'images_per_month'] as LimitKey[] },
  { label: 'Tokens', keys: ['tokens_per_day', 'tokens_per_week', 'tokens_per_month'] as LimitKey[] },
];
const PERIODS = ['Per day', 'Per week', 'Per month'];

type Draft = Record<LimitKey, string>;
const toDraft = (l: Limits | null): Draft => Object.fromEntries(LIMIT_KEYS.map((k) => [k, l?.[k] == null ? '' : String(l[k])])) as Draft;

// Draft → limits, or the first field that isn't a whole number.
function fromDraft(d: Draft): Limits | { bad: LimitKey } {
  const out = {} as Limits;
  for (const k of LIMIT_KEYS) {
    const v = parseLimit(d[k]);
    if (v === undefined) return { bad: k };
    out[k] = v;
  }
  return out;
}

function LimitGrid({ draft, onChange, placeholders }: { draft: Draft; onChange: (d: Draft) => void; placeholders: Record<LimitKey, string> }) {
  return (
    <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-x-3 gap-y-2 text-[13px]">
      <span />
      {PERIODS.map((p) => (
        <span key={p} className="font-semibold text-muted-foreground">
          {p}
        </span>
      ))}
      {ROWS.map((row) => (
        <div key={row.label} className="contents">
          <span className="font-semibold">{row.label}</span>
          {row.keys.map((k, i) => (
            <Input
              key={k}
              inputMode="numeric"
              value={draft[k]}
              placeholder={placeholders[k]}
              aria-label={`${row.label} ${PERIODS[i].toLowerCase()}`}
              onChange={(e) => onChange({ ...draft, [k]: e.target.value })}
              className="h-10 text-[14px] tabular-nums"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const usedOf = (b: BusinessUsage, k: LimitKey): number => {
  const [kind, , period] = k.split('_') as ['images' | 'tokens', 'per', 'day' | 'week' | 'month'];
  return b.used[`${kind}_${period}`];
};

// "3 / 20", red when at or over the limit.
function UsedCell({ b, k }: { b: BusinessUsage; k: LimitKey }) {
  const used = usedOf(b, k);
  const limit = b.limits[k];
  const over = limit !== null && used >= limit;
  return (
    <span className={over ? 'font-semibold text-destructive' : ''}>
      {shortCount(used)}
      <span className="text-muted-foreground"> / {limit === null ? '∞' : shortCount(limit)}</span>
    </span>
  );
}

function BusinessRow({ b, defaults, onSaved }: { b: BusinessUsage; defaults: Limits; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(b.own));
  const [saving, setSaving] = useState(false);
  const placeholders = Object.fromEntries(
    LIMIT_KEYS.map((k) => [k, defaults[k] === null ? 'no limit' : `${defaults[k]!.toLocaleString('en-IN')} (default)`])
  ) as Record<LimitKey, string>;

  async function save(next: Draft) {
    const limits = fromDraft(next);
    if ('bad' in limits) {
      toast.error('Limits must be whole numbers (or blank for the default).');
      return;
    }
    setSaving(true);
    try {
      await saveBusinessLimits(b.id, limits);
      toast.success(`Limits saved for ${b.name}.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-40 flex-col">
          <span className="text-[15px] font-semibold">{b.name}</span>
          <span className="text-[12px] text-muted-foreground">{b.own ? 'Own limits' : 'Default limits'}</span>
        </div>
        <div className="grid flex-1 grid-cols-[auto_repeat(3,minmax(4.5rem,1fr))] gap-x-4 gap-y-1 text-[13px] tabular-nums">
          <span />
          <span className="text-muted-foreground">Today</span>
          <span className="text-muted-foreground">This week</span>
          <span className="text-muted-foreground">This month</span>
          {ROWS.map((row) => (
            <div key={row.label} className="contents">
              <span className="font-semibold">{row.label}</span>
              {row.keys.map((k) => (
                <UsedCell key={k} b={b} k={k} />
              ))}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(toDraft(b.own));
            setEditing((e) => !e);
          }}
        >
          {editing ? 'Cancel' : 'Edit limits'}
        </Button>
      </div>
      {editing && (
        <div className="flex flex-col gap-3 rounded-xl bg-secondary/60 p-3">
          <LimitGrid draft={draft} onChange={setDraft} placeholders={placeholders} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => save(draft)}>
              {saving ? 'Saving…' : 'Save limits'}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving || !b.own} onClick={() => save(toDraft(null))}>
              <RotateCcw /> Use defaults
            </Button>
            <span className="self-center text-[12px] text-muted-foreground">Blank = use the default.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function UsagePage() {
  const [data, setData] = useState<UsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [defaultsDraft, setDefaultsDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetchUsageOverview().then(
      (d) => live && (setData(d), setError(null)),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'Couldn’t load usage.')
    );
    return () => {
      live = false;
    };
  }, [reload]);

  const draft = defaultsDraft ?? toDraft(data?.defaults ?? null);
  const dirty = defaultsDraft !== null;

  async function saveDefaults() {
    const limits = fromDraft(draft);
    if ('bad' in limits) {
      toast.error('Limits must be whole numbers (or blank for no limit).');
      return;
    }
    setSaving(true);
    try {
      await saveDefaultLimits(limits);
      toast.success('Default limits saved. They apply to every business without its own.');
      setDefaultsDraft(null);
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    // pb-24: room below the last row for the floating Help button.
    <div className="flex flex-col gap-5 px-4 pt-6 pb-24 md:px-8 lg:px-10 lg:pt-8">
      <PageHeader title="Usage" subtitle="AI limits for every business" />
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-3 text-[14px] text-destructive">
          {error}
        </p>
      )}
      {data && (
        <>
          <SectionCard
            Icon={Gauge}
            title="Default limits"
            description="For every business without its own limits. Images = Make image; tokens = Help questions and images together (a Help question is ~7,500 tokens). Blank = no limit. Days, weeks (from Monday) and months are in India time."
          >
            <div className="flex flex-col gap-3">
              <LimitGrid draft={draft} onChange={setDefaultsDraft} placeholders={Object.fromEntries(LIMIT_KEYS.map((k) => [k, 'no limit'])) as Record<LimitKey, string>} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!dirty || saving} onClick={saveDefaults}>
                  {saving ? 'Saving…' : 'Save defaults'}
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setDefaultsDraft(null)}>
                    Discard
                  </Button>
                )}
              </div>
            </div>
          </SectionCard>
          <SectionCard Icon={Building2} title="Businesses" description="Used / limit. Red = at the limit: that business can't make images (or ask Help) until the period resets." count={data.businesses.length}>
            <div className="flex flex-col">
              {data.businesses.map((b) => (
                <BusinessRow key={`${b.id}-${reload}`} b={b} defaults={data.defaults} onSaved={() => setReload((n) => n + 1)} />
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
