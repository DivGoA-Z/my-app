// src/components/workshop/WorkshopSettingsPage.tsx
//
// Its own page, separate from Manage Inventory, on purpose (your call,
// 2 Oct 2026): the catalogue page holds the things that set prices —
// rates, boards, charges, catalogue rows — while this one holds how the
// workshop BUILDS, which feeds the cutting list and the wastage
// calculation and moves a price by a few rupees at most (measured: ₹0-30
// on a ~₹2,500 cabinet's board). Keeping them apart keeps "where do I
// change what this costs?" answerable at a glance.

import { Button } from '../ui/button';
import { ConstructionSettingsManager } from './ConstructionSettingsManager';

export function WorkshopSettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex max-w-3xl flex-col gap-4 p-8">
      <Button variant="outline" size="sm" className="self-start" onClick={onBack}>
        ← Back
      </Button>
      <ConstructionSettingsManager />
    </div>
  );
}
