// src/components/inventory/RateCardManager.tsx
//
// Edits the business's rate card: labour per sq ft, and the
// consumable/mechanism hardware rates.
//
// Unlike every other manager in this folder there is no list, no add
// and no delete — the rate card is one row that is edited. So this is a
// form, not a table.
//
// The warning banner is not decoration. Until a business replaces these
// numbers with figures from its own purchase invoices, every quote the
// app produces is built on values that were invented to be plausible.
// Someone will otherwise send one.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useLayoutStore } from '../../store/layoutStore';
import {
  PLACEHOLDER_RATES,
  RATE_LABELS,
  type CardPricedHardware,
  type RateCard,
} from '../../types/rates';

const HARDWARE_KEYS: CardPricedHardware[] = [
  'hinge',
  'channel',
  'basket',
  'shelf',
  'cornerMagic',
  'cornerCarousel',
];

export function RateCardManager() {
  const rateCard = useLayoutStore((state) => state.rateCard);
  const updateRateCard = useLayoutStore((state) => state.updateRateCard);

  // Local draft so a half-typed number never reaches the store — every
  // open quote reprices on each keystroke otherwise, and clearing the
  // field to retype would flash a ₹0 total across the app.
  const [draft, setDraft] = useState<RateCard>(rateCard);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync when the store's card changes identity — on first load, and
  // after a successful save.
  //
  // ADJUSTED DURING RENDER, not in an effect. This was
  // `useEffect(() => setDraft(rateCard), [rateCard])`, which React flags:
  // setState called synchronously in an effect body renders the
  // component, commits, runs the effect, sets state, and renders again —
  // a wasted commit with a visibly stale frame in between.
  //
  // Comparing a stored "what did I last sync from" value during render
  // is React's documented pattern for exactly this (You Might Not Need
  // an Effect → adjusting state when a prop changes). React discards
  // this render and immediately re-runs the component with the new
  // state before touching the DOM, so there is no extra commit and no
  // stale frame.
  //
  // Identity comparison, not deep equality: the store replaces the
  // whole card object on load and on save, and never mutates it in
  // place. Two different objects holding equal numbers would resync
  // harmlessly anyway — it would only discard an unsaved draft that
  // already matched what was saved.
  const [syncedFrom, setSyncedFrom] = useState<RateCard>(rateCard);
  if (syncedFrom !== rateCard) {
    setSyncedFrom(rateCard);
    setDraft(rateCard);
  }

  const dirty =
    draft.laborRatePerSqFt !== rateCard.laborRatePerSqFt ||
    HARDWARE_KEYS.some((k) => draft.hardware[k] !== rateCard.hardware[k]);

  // Whether the business is still on the seeded numbers. Compared by
  // value rather than by a flag, so editing a rate back to 150 honestly
  // counts as still-placeholder — the point is what the number IS, not
  // whether someone has visited this screen.
  const isPlaceholder =
    draft.laborRatePerSqFt === PLACEHOLDER_RATES.laborRatePerSqFt &&
    HARDWARE_KEYS.every((k) => draft.hardware[k] === PLACEHOLDER_RATES.hardware[k]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateRateCard(draft);
      toast.success('Rates saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save rates.';
      setError(message);
      toast.error('Failed to save rates', { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold text-sm text-gray-700">Rate card</h3>
        <p className="mt-1 text-xs text-gray-500">
          The prices that aren't attached to a product. Finishes, handles, fixtures,
          cabinets and appliances are priced on their own catalogue rows.
        </p>
      </div>

      {isPlaceholder && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <strong className="font-semibold">These are placeholder rates.</strong> They're
          the right order of magnitude for Delhi NCR retail, but they aren't your prices.
          Check them against your own purchase invoices before sending a quote built on them.
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">Labour (₹ per sq ft)</span>
        <input
          type="number"
          min={0}
          step={1}
          value={draft.laborRatePerSqFt}
          onChange={(e) =>
            setDraft({ ...draft, laborRatePerSqFt: Number(e.target.value) })
          }
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="text-[11px] text-gray-500">
          Charged on estimated cabinet area. Sq ft rather than sq m because that's
          still the billing unit in the trade.
        </span>
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Hardware (₹ per unit)</legend>
        {HARDWARE_KEYS.map((key) => (
          <label key={key} className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-600">{RATE_LABELS[key]}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={draft.hardware[key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  hardware: { ...draft.hardware, [key]: Number(e.target.value) },
                })
              }
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-right text-sm"
            />
          </label>
        ))}
        <p className="text-[11px] text-gray-500">
          A drawer channel is priced per <strong>pair</strong> of runners — that's how
          they're sold and fitted. Handles are priced on their own catalogue rows, not here.
        </p>
      </fieldset>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save rates'}
        </Button>
        {dirty && !saving && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={() => setDraft(rateCard)}
          >
            Discard changes
          </Button>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        Changing a rate reprices every open quote immediately. Quotes you've already
        frozen and sent keep the rates they were sent with.
      </p>
    </div>
  );
}
