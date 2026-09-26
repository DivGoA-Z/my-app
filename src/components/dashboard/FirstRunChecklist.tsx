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
import { Card, CardContent } from '../ui/card';
import type { InventorySection } from '../inventory/InventoryManager';

export interface FirstRunChecklistProps {
  businessId: string | null;
  isRatesDone: boolean;
  isCatalogueDone: boolean;
  isFirstCustomerDone: boolean;
  onManageInventory: (section?: InventorySection) => void;
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
  onManageInventory,
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
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Getting started</h3>
            <p className="text-xs text-gray-500">
              Three things worth doing before sending your first real quote.
            </p>
          </div>
          <Button variant="ghost" size="xs" onClick={dismiss}>
            Skip
          </Button>
        </div>

        <ChecklistStep
          done={isRatesDone}
          label="Add your rates"
          description="Replace the seeded placeholder rates with your own purchase invoice prices."
          actionLabel="Open rate card"
          onAction={() => onManageInventory()}
        />
        <ChecklistStep
          done={isCatalogueDone}
          label="Import your cabinet catalogue"
          description="Bulk-upload your modules via Excel instead of typing them in one at a time."
          actionLabel="Import catalogue"
          onAction={() => onManageInventory('cabinets')}
        />
        <ChecklistStep
          done={isFirstCustomerDone}
          label="Create your first customer"
          description="Start a lead, then open its 2D canvas to draw a layout and generate a quote."
          actionLabel="Add a lead"
          onAction={onAddLead}
        />
      </CardContent>
    </Card>
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
    <div className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 ring-1 ring-gray-200">
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}
        >
          {done ? '✓' : ''}
        </span>
        <div>
          <p className={`text-xs font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
            {label}
          </p>
          <p className="text-[11px] text-gray-500">{description}</p>
        </div>
      </div>
      {!done && (
        <Button variant="outline" size="xs" className="shrink-0" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
