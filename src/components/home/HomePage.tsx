// src/components/home/HomePage.tsx
//
// The business's home (docs/UX_PLAN.md, mockup "Home"; §70): what needs
// doing today. Every number comes from lib/pipeline.ts, so Home and
// Customers can't disagree. Cards, as agreed on review:
//   Quotes out · Follow-ups due · Approved jobs (open) · Installs coming up
// then a Follow up list (one next action each) and Continue designing
// (unapproved designs edited in the last 7 days).

import { useEffect, useState } from 'react';
import { AlertTriangle, MessageCircle, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { PageHeader } from '../shell/AppShell';
import { FirstRunChecklist } from '../dashboard/FirstRunChecklist';
import { InstallDateDialog, NewCustomerDialog } from '../customers/CustomerDialogs';
import { useCustomerList, INR, formatShortDate, initials } from '../customers/customerData';
import { usePipelineActions } from '../customers/usePipelineActions';
import { STAGE_META, continueDesigning, daysSince, followUps, homeStats, type FollowUp } from '../../lib/pipeline';
import { buildWhatsAppLink } from '../../lib/whatsapp';
import { fetchMainFinishIds, finishSwatch } from '../../lib/designFinishes';
import { isPlaceholderRateCard } from '../../types/rates';
import { useLayoutStore } from '../../store/layoutStore';
import { useAuthStore } from '../../store/authStore';
import type { CustomerProject } from '../../types/customer';
import { cn } from '@/lib/utils';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function edited(iso: string, now: Date): string {
  const d = daysSince(iso, now);
  return d <= 0 ? 'Edited today' : d === 1 ? 'Edited yesterday' : `Edited ${d} days ago`;
}

const ACTION_LABEL: Record<FollowUp['action'], string> = {
  whatsapp: 'WhatsApp',
  'start-design': 'Start design',
  'open-design': 'Open design',
  'set-install-date': 'Set date',
};

export function HomePage({
  onOpenDesign,
  onNavigate,
}: {
  onOpenDesign: (projectId: string) => void;
  onNavigate: (page: 'customers' | 'catalogue' | 'rates') => void;
}) {
  const { customers, setCustomers, isLoading, error } = useCustomerList();
  const { saveInstallDate } = usePipelineActions(customers, setCustomers);
  const rateCard = useLayoutStore((s) => s.rateCard);
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const businessId = useAuthStore((s) => s.businessId);
  const [adding, setAdding] = useState(false);
  const [dating, setDating] = useState<CustomerProject | null>(null);
  const now = new Date();

  const stats = homeStats(customers, now);
  const todo = followUps(customers, now);
  const designing = continueDesigning(customers, now).slice(0, 6);
  const finishes = useLayoutStore((s) => s.finishes);
  const [mainFinish, setMainFinish] = useState<Record<string, string>>({});
  const designingKey = designing.map((c) => c.id).join(',');
  useEffect(() => {
    if (!designingKey) return;
    let cancelled = false;
    fetchMainFinishIds(designingKey.split(','))
      .then((m) => !cancelled && setMainFinish(m))
      .catch(() => {}); // best-effort: cards show without a picture
    return () => {
      cancelled = true;
    };
  }, [designingKey]);

  function act(f: FollowUp) {
    const c = f.customer;
    if (f.action === 'whatsapp') {
      const first = c.clientName.split(/\s+/)[0];
      window.open(
        buildWhatsAppLink(c.phone, `Hello ${first}, just checking in on the kitchen quote we sent. Happy to answer any questions.`),
        '_blank'
      );
    } else if (f.action === 'set-install-date') {
      setDating(c);
    } else {
      onOpenDesign(c.id);
    }
  }

  const cards = [
    {
      k: 'Quotes out',
      v: String(stats.quotesOut.count),
      note: stats.quotesOut.count ? `${INR.format(stats.quotesOut.value)} waiting on customers` : 'None waiting',
      warn: false,
    },
    {
      k: 'Follow-ups due',
      v: String(stats.followUpCount),
      note: stats.followUpCount ? 'Listed below' : "You're up to date",
      warn: stats.followUpCount > 0,
    },
    {
      k: 'Approved jobs (open)',
      v: stats.approvedOpen.count ? INR.format(stats.approvedOpen.value) : '0',
      note: `${stats.approvedOpen.count} ${stats.approvedOpen.count === 1 ? 'job' : 'jobs'} · ${stats.approvedOpen.notStarted} not started · ${stats.approvedOpen.inProduction} in production`,
      warn: false,
    },
    {
      k: 'Installs coming up',
      v: String(stats.installs.count),
      note: stats.installs.next
        ? `Next: ${formatShortDate(stats.installs.next.date)}, ${stats.installs.next.name}`
        : 'No install dates set',
      warn: false,
    },
  ];

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={greeting(now)}
        subtitle={now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        action={
          <Button size="touch-lg" onClick={() => setAdding(true)}>
            <Plus /> New customer
          </Button>
        }
      />

      <FirstRunChecklist
        businessId={businessId}
        isRatesDone={!isPlaceholderRateCard(rateCard)}
        isCatalogueDone={cabinetCatalog.length > 0}
        isFirstCustomerDone={customers.length > 0}
        onOpenRates={() => onNavigate('rates')}
        onOpenCatalogue={() => onNavigate('catalogue')}
        onAddLead={() => setAdding(true)}
      />

      {/* PRINCIPLES: the placeholder disclosure never goes away until the
          business replaces the seeded rates. */}
      {isPlaceholderRateCard(rateCard) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-warning-foreground">
          <AlertTriangle className="size-5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 text-sm">
            <strong>Your quotes use sample rates.</strong> Enter your own board, labour and hardware prices
            before sending a real quote.
          </span>
          <Button variant="link" className="h-auto p-0 font-semibold text-warning-foreground" onClick={() => onNavigate('rates')}>
            Set rates →
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* One strip, hairline-divided (Premium A), rather than four
          boxes that all weigh the same. */}
      {isLoading ? (
        <Skeleton className="h-32 rounded-[20px]" />
      ) : (
        <div className="grid grid-cols-2 overflow-hidden rounded-[20px] bg-card shadow-card lg:grid-cols-4">
          {cards.map((c, i) => (
            <div
              key={c.k}
              className={cn(
                'flex flex-col gap-2 px-5 py-5 lg:px-6 lg:py-6',
                i % 2 === 1 && 'border-l border-secondary',
                i >= 2 && 'border-t border-secondary lg:border-t-0',
                i === 2 && 'lg:border-l'
              )}
            >
              <span className="text-[13px] font-semibold text-muted-foreground">{c.k}</span>
              <span className="text-[26px] font-extrabold tracking-[-0.03em] lg:text-[30px]">{c.v}</span>
              <span className={cn('text-[13px]', c.warn ? 'font-semibold text-warning-foreground' : 'text-muted-foreground')}>
                {c.note}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="flex flex-col rounded-2xl bg-card shadow-card p-4 lg:p-5">
          <div className="flex items-center justify-between pb-2">
            <h2 className="text-[17px] font-semibold">Follow up</h2>
            <Button variant="link" className="h-auto p-0 font-semibold" onClick={() => onNavigate('customers')}>
              All customers
            </Button>
          </div>
          {!isLoading && todo.length === 0 && (
            <p className="border-t border-secondary py-6 text-center text-[15px] text-muted-foreground">
              Nothing to chase. You're up to date.
            </p>
          )}
          {todo.slice(0, 8).map((f) => (
            <div key={f.customer.id} className="flex items-center gap-3 border-t border-secondary py-3">
              <div className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground">
                {initials(f.customer.clientName)}
              </div>
              <button type="button" onClick={() => onOpenDesign(f.customer.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[15px] font-semibold">{f.customer.clientName}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{f.why}</span>
              </button>
              <span className={cn('hidden h-6 items-center rounded-full px-2.5 text-xs font-semibold sm:inline-flex', STAGE_META[f.customer.status].pill)}>
                {STAGE_META[f.customer.status].label}
              </span>
              <Button variant="outline" size="touch" onClick={() => act(f)}>
                {f.action === 'whatsapp' && <MessageCircle />}
                {ACTION_LABEL[f.action]}
              </Button>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-card shadow-card p-4 lg:p-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[17px] font-semibold">Continue designing</h2>
            <span className="text-[13px] text-muted-foreground">Designs not yet approved, edited in the last 7 days</span>
          </div>
          {!isLoading && designing.length === 0 && (
            <p className="py-6 text-center text-[15px] text-muted-foreground">
              No designs in progress. Add a customer to start one.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {designing.map((c) => {
              // The design's main material (Premium A): the finish most
              // of its cabinets use, as a photo.
              const swatch = finishSwatch(finishes.find((f) => f.id === mainFinish[c.id]));
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenDesign(c.id)}
                  className="flex flex-col overflow-hidden rounded-[18px] bg-card text-left shadow-card transition-shadow hover:shadow-float"
                >
                  <div className="relative h-28 bg-secondary">
                    {swatch?.image ? (
                      <img src={swatch.image} alt={`${swatch.label} finish`} className="size-full object-cover" />
                    ) : swatch?.color ? (
                      <div className="size-full" style={{ backgroundColor: swatch.color }} />
                    ) : null}
                    <span className={cn('absolute left-3 top-3 inline-flex h-[26px] items-center rounded-full bg-white/90 px-2.5 text-xs font-bold text-foreground')}>
                      {STAGE_META[c.status].label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 px-4 pb-4 pt-3.5">
                    <span className="truncate text-[15px] font-bold">{c.clientName}</span>
                    <span className="flex justify-between gap-2 text-[13px] text-muted-foreground">
                      <span className="truncate">{[swatch?.label, edited(c.updatedAt, now)].filter(Boolean).join(' · ')}</span>
                      <span className="shrink-0 font-bold text-foreground">{c.quoteTotal != null ? INR.format(c.quoteTotal) : '—'}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <NewCustomerDialog open={adding} onOpenChange={setAdding} onCreated={(c) => setCustomers((prev) => [c, ...prev])} />
      <InstallDateDialog
        customer={dating}
        onCancel={() => setDating(null)}
        onSave={(date) => {
          if (dating) void saveInstallDate(dating, date);
          setDating(null);
        }}
      />
    </div>
  );
}
