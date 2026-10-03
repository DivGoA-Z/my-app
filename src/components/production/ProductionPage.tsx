// src/components/production/ProductionPage.tsx
//
// The workshop's page (§72): every job that's been approved and isn't
// installed yet, soonest install first, with what the workshop needs —
// the cutting list (which carries print, labels, glass order and Excel),
// the install date, and one button to move the job along:
// Approved → Start production → Mark installed.
//
// Named "Production", not "Workshop", because Settings already has a
// "Workshop" tab (how the workshop builds — construction rules), and two
// different things called Workshop would confuse.

import { useState } from 'react';
import { CalendarDays, Scissors } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { PageHeader } from '../shell/AppShell';
import { InstallDateDialog } from '../customers/CustomerDialogs';
import { useCustomerList, INR, formatShortDate } from '../customers/customerData';
import { usePipelineActions } from '../customers/usePipelineActions';
import { STAGE_META, localDate } from '../../lib/pipeline';
import type { CustomerProject } from '../../types/customer';
import { cn } from '@/lib/utils';

// Jobs with an install date first (soonest first), then the undated.
function byInstall(a: CustomerProject, b: CustomerProject): number {
  if (a.installDate && b.installDate) return a.installDate.localeCompare(b.installDate);
  if (a.installDate) return -1;
  if (b.installDate) return 1;
  return a.clientName.localeCompare(b.clientName);
}

export function ProductionPage({
  onOpenCutList,
  onOpenDesign,
}: {
  onOpenCutList: (projectId: string) => void;
  onOpenDesign: (projectId: string) => void;
}) {
  const { customers, setCustomers, isLoading, error } = useCustomerList();
  const { changeStage, saveInstallDate } = usePipelineActions(customers, setCustomers);
  const [dating, setDating] = useState<CustomerProject | null>(null);
  const today = localDate(new Date());

  const jobs = customers.filter((c) => c.status === 'Approved' || c.status === 'In Production').sort(byInstall);
  const groups: { title: string; rows: CustomerProject[] }[] = [
    { title: 'In production', rows: jobs.filter((c) => c.status === 'In Production') },
    { title: 'Approved, not started', rows: jobs.filter((c) => c.status === 'Approved') },
  ];

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader title="Production" subtitle="Approved jobs, for the workshop" />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-input bg-card px-6 py-14 text-center">
          <p className="text-[17px] font-semibold">No approved jobs yet</p>
          <p className="max-w-md text-[15px] text-muted-foreground">
            When a customer approves, move them to Approved on the Customers page and the job appears here.
          </p>
        </div>
      ) : (
        groups.map(
          (g) =>
            g.rows.length > 0 && (
              <section key={g.title} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-[17px] font-semibold">
                  {g.title}
                  <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-semibold text-muted-foreground">
                    {g.rows.length}
                  </span>
                </h2>
                {g.rows.map((c) => {
                  const overdue = c.installDate !== undefined && c.installDate < today;
                  return (
                    <article
                      key={c.id}
                      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-border bg-card px-4 py-4 md:px-5"
                    >
                      <button type="button" onClick={() => onOpenDesign(c.id)} className="min-w-[180px] flex-1 text-left">
                        <span className="block text-base font-semibold">{c.clientName}</span>
                        <span className="block text-[13px] text-muted-foreground">
                          {[c.locality, c.quoteTotal != null ? INR.format(c.quoteTotal) : null].filter(Boolean).join(' · ')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDating(c)}
                        className={cn(
                          'flex h-11 items-center gap-2 rounded-[10px] border px-3 text-sm font-semibold',
                          !c.installDate || overdue
                            ? 'border-warning/40 bg-warning-soft text-warning-foreground'
                            : 'border-border text-foreground hover:bg-secondary'
                        )}
                      >
                        <CalendarDays className="size-[18px]" />
                        {c.installDate
                          ? `${overdue ? 'Was due' : 'Install'} ${formatShortDate(c.installDate)}`
                          : 'Set install date'}
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="touch" onClick={() => onOpenCutList(c.id)}>
                          <Scissors /> Cutting list
                        </Button>
                        {c.status === 'Approved' ? (
                          <Button variant="outline" size="touch" onClick={() => void changeStage(c, { status: 'In Production' })}>
                            Start production
                          </Button>
                        ) : (
                          <Button variant="outline" size="touch" onClick={() => void changeStage(c, { status: 'Installed' })}>
                            Mark installed
                          </Button>
                        )}
                      </div>

                      <span className={cn('hidden h-6 items-center rounded-full px-2.5 text-xs font-semibold xl:inline-flex', STAGE_META[c.status].pill)}>
                        {STAGE_META[c.status].label}
                      </span>
                    </article>
                  );
                })}
              </section>
            )
        )
      )}

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
