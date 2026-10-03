// src/components/customers/CustomersPage.tsx
//
// The pipeline (docs/UX_PLAN.md, mockup "Customers"; §70). Replaces the
// old CustomerDashboard table and keeps everything it did: search, add a
// customer, open the design, change the stage, each project's sent-quote
// history and its captured 360° views.
//
//   - Board (tablet and laptop): one column per stage; drag a card to
//     move it. Installed shows the last 30 days; Lost is a filter.
//   - List (any size; the only view on a phone): rows with a stage pill.
// Every action is also in each card's menu, so nothing depends on drag
// or hover (UI principle 5 — touch is first-class).

import { useState } from 'react';
import { MoreHorizontal, Plus, Search, CalendarDays } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { PageHeader } from '../shell/AppShell';
import { PanoramaViewerModal } from '../panorama/PanoramaViewerModal';
import { InstallDateDialog, LostReasonDialog, NewCustomerDialog } from './CustomerDialogs';
import { useCustomerList, INR, formatShortDate } from './customerData';
import { usePipelineActions } from './usePipelineActions';
import { BOARD_STAGES, STAGE_META, daysSince, onBoard, stageSince } from '../../lib/pipeline';
import { LEAD_STATUSES, LOST_REASON_LABELS, type CustomerProject, type LeadStatus } from '../../types/customer';
import type { QuoteHistoryEntry } from '../../lib/quotes';
import type { CameraNode } from '../../types/Camera';
import { cn } from '@/lib/utils';

type View = 'board' | 'list';
type Filter = 'all' | LeadStatus;

// The one-line "what's happening" under a customer's name.
function activity(c: CustomerProject, history: QuoteHistoryEntry[] | undefined, now: Date): { text: string; late: boolean } {
  const days = daysSince(stageSince(c), now);
  const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  switch (c.status) {
    case 'Quote Sent': {
      const v = history?.[0]?.version;
      return { text: `${v ? `v${v} · ` : ''}sent ${ago}`, late: days >= 3 };
    }
    case 'In Production':
      return c.installDate
        ? { text: `Install ${formatShortDate(c.installDate)}`, late: false }
        : { text: 'No install date yet', late: true };
    case 'Installed':
      return { text: `Installed ${ago}`, late: false };
    case 'Lost':
      return { text: c.lostReason ? `Lost · ${LOST_REASON_LABELS[c.lostReason]}` : 'Lost', late: false };
    default:
      return { text: `${STAGE_META[c.status].label} ${ago}`, late: days >= 3 };
  }
}

interface CardMenuProps {
  c: CustomerProject;
  history: QuoteHistoryEntry[];
  views: CameraNode[];
  onOpenDesign: (id: string) => void;
  moveTo: (c: CustomerProject, s: LeadStatus) => void;
  onSetDate: (c: CustomerProject) => void;
  onPanorama: (cam: CameraNode) => void;
}

// Every card action in one menu, so nothing needs drag or hover.
function CardMenu({ c, history, views, onOpenDesign, moveTo, onSetDate, onPanorama }: CardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-touch" aria-label={`Actions for ${c.clientName}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem className="h-10" onSelect={() => onOpenDesign(c.id)}>
          Open design
        </DropdownMenuItem>
        {(c.status === 'In Production' || c.status === 'Approved') && (
          <DropdownMenuItem className="h-10" onSelect={() => onSetDate(c)}>
            {c.installDate ? 'Change install date' : 'Set install date'}
          </DropdownMenuItem>
        )}
        {/* Flat, not submenus: nested menus are fiddly on a phone (and
            close as the pointer crosses the gap between them). */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Move to</DropdownMenuLabel>
        {LEAD_STATUSES.map((s) => (
          <DropdownMenuItem key={s} className="h-10" disabled={s === c.status} onSelect={() => moveTo(c, s)}>
            <span className={cn('size-2 rounded-full', STAGE_META[s].dot)} />
            {STAGE_META[s].label}
            {s === c.status && <span className="ml-auto text-xs text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
        {views.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">360° views</DropdownMenuLabel>
            {views.map((cam) => (
              <DropdownMenuItem key={cam.id} className="h-10" onSelect={() => onPanorama(cam)}>
                {cam.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Current design: {c.quoteTotal != null ? INR.format(c.quoteTotal) : '—'}
        </DropdownMenuLabel>
        {history.length === 0 ? (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No quotes sent yet</DropdownMenuLabel>
        ) : (
          history.map((h) => (
            <DropdownMenuLabel key={h.id} className="flex justify-between gap-3 text-xs font-normal">
              <span className="text-muted-foreground">
                v{h.version} · sent {formatShortDate(h.sentAt)}
              </span>
              <span>{INR.format(h.grandTotal)}</span>
            </DropdownMenuLabel>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


function StagePill({ status }: { status: LeadStatus }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold', STAGE_META[status].pill)}>
      {STAGE_META[status].label}
    </span>
  );
}

export function CustomersPage({ onOpenDesign }: { onOpenDesign: (projectId: string) => void }) {
  const { customers, setCustomers, isLoading, error, quoteHistories, panoramas } = useCustomerList();
  const { changeStage, saveInstallDate } = usePipelineActions(customers, setCustomers);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('board');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [losing, setLosing] = useState<CustomerProject | null>(null);
  const [dating, setDating] = useState<CustomerProject | null>(null);
  const [panorama, setPanorama] = useState<CameraNode | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const now = new Date();

  const q = query.trim().toLowerCase();
  const matching = customers.filter(
    (c) => !q || [c.clientName, c.phone, c.locality].some((f) => f.toLowerCase().includes(q))
  );
  const lostCount = customers.filter((c) => c.status === 'Lost').length;

  // Moving to Lost always goes through the reason dialog (§69).
  function moveTo(c: CustomerProject, status: LeadStatus) {
    if (status === c.status) return;
    if (status === 'Lost') setLosing(c);
    else void changeStage(c, { status });
  }

  const listRows = matching.filter((c) => (filter === 'all' ? c.status !== 'Lost' : c.status === filter));

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title="Customers"
        action={
          <Button size="touch-lg" onClick={() => setAdding(true)}>
            <Plus /> New customer
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-11 min-w-0 flex-[1_1_320px] items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-muted-foreground">
          <Search className="size-[18px] shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or locality"
            aria-label="Search customers"
            className="h-auto border-0 p-0 text-[15px] shadow-none focus-visible:ring-0"
          />
        </label>
        <div className="hidden rounded-xl bg-secondary p-1 md:flex" role="tablist" aria-label="View">
          {(['board', 'list'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-9 rounded-[9px] px-4 text-sm font-semibold capitalize',
                view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Stage filter: drives the list (and the phone). On the board,
          only "Lost" matters, since every other stage is a column. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {(['all', ...LEAD_STATUSES] as Filter[]).map((f) => {
          const label = f === 'all' ? 'All' : f === 'Lost' ? `Lost (${lostCount})` : STAGE_META[f].label;
          const onBoardView = view === 'board';
          if (onBoardView && f !== 'all' && f !== 'Lost') return null;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
                if (f === 'Lost') setView('list');
              }}
              className={cn(
                'h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold',
                filter === f ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-input bg-card px-6 py-14 text-center">
          <p className="text-[17px] font-semibold">No customers yet</p>
          <p className="max-w-md text-[15px] text-muted-foreground">
            Add your first customer, then start their kitchen design from the card.
          </p>
          <Button size="touch" onClick={() => setAdding(true)}>
            <Plus /> New customer
          </Button>
        </div>
      ) : (
        <>
          {view === 'board' && (
            <div className="hidden gap-3 md:grid md:grid-cols-3 xl:grid-cols-6">
              {BOARD_STAGES.map((stage) => {
                const cards = matching.filter((c) => c.status === stage && onBoard(c, now));
                return (
                  <section
                    key={stage}
                    aria-label={STAGE_META[stage].label}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const c = customers.find((x) => x.id === dragId);
                      if (c) moveTo(c, stage);
                      setDragId(null);
                    }}
                    className={cn(
                      'flex min-h-40 flex-col gap-2.5 rounded-2xl bg-secondary p-3 transition-colors',
                      dragId && 'outline-2 outline-dashed outline-input'
                    )}
                  >
                    <div className="flex items-center justify-between px-1">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span className={cn('size-2.5 rounded-full', STAGE_META[stage].dot)} />
                        {STAGE_META[stage].label}
                      </span>
                      <span className="text-[13px] text-muted-foreground">{cards.length}</span>
                    </div>
                    {cards.map((c) => {
                      const a = activity(c, quoteHistories[c.id], now);
                      return (
                        <article
                          key={c.id}
                          draggable
                          onDragStart={() => setDragId(c.id)}
                          onDragEnd={() => setDragId(null)}
                          className="flex cursor-grab flex-col gap-1 rounded-xl border border-border bg-card p-3 active:cursor-grabbing"
                        >
                          <div className="flex items-start gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenDesign(c.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="block truncate text-[15px] font-semibold">{c.clientName}</span>
                              <span className="block truncate text-[13px] text-muted-foreground">{c.locality || '—'}</span>
                            </button>
                            <CardMenu c={c} history={quoteHistories[c.id] ?? []} views={panoramas[c.id] ?? []} onOpenDesign={onOpenDesign} moveTo={moveTo} onSetDate={setDating} onPanorama={setPanorama} />
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            {stage === 'In Production' && !c.installDate ? (
                              <button
                                type="button"
                                onClick={() => setDating(c)}
                                className="flex items-center gap-1 text-xs font-semibold text-warning-foreground"
                              >
                                <CalendarDays className="size-3.5" /> Set install date
                              </button>
                            ) : (
                              <span className={cn('text-xs', a.late ? 'font-semibold text-warning-foreground' : 'text-muted-foreground')}>
                                {a.text}
                              </span>
                            )}
                            <span className="text-sm font-bold">{c.quoteTotal != null ? INR.format(c.quoteTotal) : '—'}</span>
                          </div>
                        </article>
                      );
                    })}
                    {cards.length === 0 && (
                      <p className="px-1 py-3 text-center text-[13px] text-muted-foreground">
                        {dragId ? 'Drop here' : 'None'}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* The list: always on a phone, and on tablet/laptop when picked. */}
          <div className={cn('flex flex-col gap-2.5', view === 'board' && 'md:hidden')}>
            {listRows.map((c) => {
              const a = activity(c, quoteHistories[c.id], now);
              return (
                <article key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                  <button type="button" onClick={() => onOpenDesign(c.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-base font-semibold">{c.clientName}</span>
                    <span className={cn('block truncate text-[13px]', a.late ? 'font-semibold text-warning-foreground' : 'text-muted-foreground')}>
                      {[c.locality, a.text].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  <span className="hidden text-sm text-muted-foreground md:block">{c.phone}</span>
                  <div className="flex flex-col items-end gap-1.5">
                    <StagePill status={c.status} />
                    <span className="text-sm font-bold">{c.quoteTotal != null ? INR.format(c.quoteTotal) : '—'}</span>
                  </div>
                  <CardMenu c={c} history={quoteHistories[c.id] ?? []} views={panoramas[c.id] ?? []} onOpenDesign={onOpenDesign} moveTo={moveTo} onSetDate={setDating} onPanorama={setPanorama} />
                </article>
              );
            })}
            {listRows.length === 0 && (
              <p className="py-10 text-center text-[15px] text-muted-foreground">
                {q ? `No customers match "${query}".` : 'No customers in this stage.'}
              </p>
            )}
          </div>
        </>
      )}

      <NewCustomerDialog open={adding} onOpenChange={setAdding} onCreated={(c) => setCustomers((prev) => [c, ...prev])} />
      <LostReasonDialog
        customer={losing}
        onCancel={() => setLosing(null)}
        onConfirm={(reason, note) => {
          if (losing) void changeStage(losing, { status: 'Lost', reason, note });
          setLosing(null);
        }}
      />
      <InstallDateDialog
        customer={dating}
        onCancel={() => setDating(null)}
        onSave={(date) => {
          if (dating) void saveInstallDate(dating, date);
          setDating(null);
        }}
      />
      <PanoramaViewerModal
        isOpen={panorama !== null}
        onClose={() => setPanorama(null)}
        cameraLabel={panorama?.label ?? ''}
        panoramaUrl={panorama?.panoramaUrl}
      />
    </div>
  );
}
