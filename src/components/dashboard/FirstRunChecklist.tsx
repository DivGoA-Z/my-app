// src/components/dashboard/FirstRunChecklist.tsx
//
// The highest-leverage screen a multi-tenant product can have and,
// until now, the one this app didn't — a new business signs in to a
// dashboard with nothing on it and no indication of what to do first.
// Three steps, in the order a business actually needs them: rates
// before a catalogue is worth pricing, a catalogue before a customer's
// layout can be quoted, a first customer to try it all on.
//
// Each step's "done" is computed from real state, not a flag some
// other action sets — so it can never drift out of sync with what
// actually happened. Rendered inside CustomerDashboard (not App.tsx)
// because "first customer created" is CustomerDashboard's own local
// state (its own fetchCustomers() call, not the Zustand store) and
// threading that up to App.tsx just to render this would be a bigger
// change than the checklist itself.
//
// Dismiss is per-business, in localStorage — a genuine per-viewer
// convenience (which browser/device someone dismissed it from doesn't
// matter to anyone else at the business), not state that needs to
// survive a lost laptop. Auto-hides once every step is done, with no
// need for that case to touch localStorage at all.

import { useState } from 'react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export interface FirstRunChecklistProps {
  businessId: string | null;
  isRatesDone: boolean;
  isCatalogueDone: boolean;
  isFirstCustomerDone: boolean;
  // Rates moved to Settings (§70), so each step names its own target.
  onOpenRates: () => void;
  onOpenCatalogue: () => void;
  onAddLead: () => void;
}

function dismissKey(businessId: string): string {
  return `firstRunChecklist:dismissed:${businessId}`;
}

function readDismissed(businessId: string | null): boolean {
  if (!businessId) return false;
  try {
    return localStorage.getItem(dismissKey(businessId)) === '1';
  } catch {
    // Private browsing / blocked storage — fail open, same as showing
    // the checklist to a first-time visitor who's never dismissed it.
    return false;
  }
}

export function FirstRunChecklist({
  businessId,
  isRatesDone,
  isCatalogueDone,
  isFirstCustomerDone,
  onOpenRates,
  onOpenCatalogue,
  onAddLead,
}: FirstRunChecklistProps) {
  const [dismissed, setDismissed] = useState(() => readDismissed(businessId));

  const allDone = isRatesDone && isCatalogueDone && isFirstCustomerDone;
  if (allDone || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    if (!businessId) return;
    try {
      localStorage.setItem(dismissKey(businessId), '1');
    } catch {
      // Nothing to fall back to — the checklist just reappears next
      // session, which is a mild annoyance, not a broken feature.
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card shadow-card p-4 lg:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[17px] font-semibold">Getting started</h2>
          <p className="text-[13px] text-muted-foreground">Three things worth doing before sending your first real quote.</p>
        </div>
        <Button variant="ghost" size="touch" onClick={dismiss}>
          Skip
        </Button>
      </div>

      <ChecklistStep
        done={isRatesDone}
        label="Add your rates"
        description="Replace the sample rates with your own purchase prices."
        actionLabel="Open rate card"
        onAction={onOpenRates}
      />
      <ChecklistStep
        done={isCatalogueDone}
        label="Import your cabinet catalogue"
        description="Upload your modules from Excel instead of typing them one at a time."
        actionLabel="Open catalogue"
        onAction={onOpenCatalogue}
      />
      <ChecklistStep
        done={isFirstCustomerDone}
        label="Add your first customer"
        description="Then open their design to draw the kitchen and make a quote."
        actionLabel="Add customer"
        onAction={onAddLead}
      />
    </section>
  );
}

function ChecklistStep({
  done,
  label,
  description,
  actionLabel,
  onAction,
}: {
  done: boolean;
  label: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
          )}
        >
          {done ? '✓' : ''}
        </span>
        <div className="min-w-0">
          <p className={cn('text-[15px] font-semibold', done && 'text-muted-foreground line-through')}>{label}</p>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {!done && (
        <Button variant="outline" size="touch" className="shrink-0" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
