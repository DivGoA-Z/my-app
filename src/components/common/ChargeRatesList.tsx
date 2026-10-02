// src/components/common/ChargeRatesList.tsx
//
// Editor for a "Labour and other charges" list (OtherRate[]), used in
// two places that must behave identically: the business rate card
// (RateCardManager) and a project's own override of it (QuoteSidebar,
// RoomLayout.chargeRates). One wrapper so the two can't drift, and they
// are now IDENTICAL — the "Add margin" tick was project-only for one
// round (a rate-card rate was assumed to always be a cost), and you
// asked for both sides to match: a business can have a fixed-price
// charge it adds to every job, too. See docs/DECISIONS.md §38-§40.

import {
  OTHER_RATE_BASES,
  OTHER_RATE_BASIS_LABELS,
  type OtherRate,
  type OtherRateBasis,
} from '../../types/rates';
import { NamedAmountList, type NamedAmountFlag, type NamedAmountRow } from './NamedAmountList';

const BASIS_CHOICES = OTHER_RATE_BASES.map((b) => ({ value: b, label: OTHER_RATE_BASIS_LABELS[b] }));

const SHOW_FLAG: NamedAmountFlag = { key: 'show', label: 'Show on quote', defaultValue: false };
const MARGIN_FLAG: NamedAmountFlag = { key: 'margin', label: 'Add margin', defaultValue: true };

const toRows = (rates: OtherRate[]): NamedAmountRow[] =>
  rates.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.rate,
    choice: r.basis,
    flags: { show: r.showOnQuote, margin: r.applyMargin },
  }));

// The cast is safe: `choice` only ever comes from BASIS_CHOICES or
// defaultChoice="cabinet", and sanitizeOtherRates re-validates it on
// save anyway. A missing flag falls back to the same default the tick
// box shows, so what's saved is what was on screen.
const fromRows = (rows: NamedAmountRow[]): OtherRate[] =>
  rows.map((r) => ({
    id: r.id,
    label: r.label,
    rate: r.value,
    basis: (r.choice ?? 'cabinet') as OtherRateBasis,
    showOnQuote: r.flags?.show ?? SHOW_FLAG.defaultValue,
    applyMargin: r.flags?.margin ?? MARGIN_FLAG.defaultValue,
  }));

export function ChargeRatesList({
  rates,
  onChange,
  inputClassName,
}: {
  rates: OtherRate[];
  onChange: (rates: OtherRate[]) => void;
  inputClassName?: string;
}) {
  return (
    <NamedAmountList
      labelPlaceholder="e.g. Edge banding"
      choices={BASIS_CHOICES}
      defaultChoice="cabinet"
      flagOptions={[SHOW_FLAG, MARGIN_FLAG]}
      inputClassName={inputClassName}
      rows={toRows(rates)}
      onChange={(rows) => onChange(fromRows(rows))}
    />
  );
}
