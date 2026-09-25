// src/components/inventory/RateCardManager.tsx
//
// Edits the business's rate card: site installation labour (per sq
// ft), consumable/mechanism hardware rates, material rates by
// substrate, and per-cabinet fabrication/other rates.
//
// Margin does NOT live here, deliberately — it's edited in
// QuoteSidebar instead, per PROJECT rather than one business-wide
// number, since two jobs don't have to carry the same margin the way
// a hinge is the same hinge everywhere. See docs/DECISIONS.md §15.
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
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription } from '../ui/alert';
import { useLayoutStore } from '../../store/layoutStore';
import {
  PLACEHOLDER_RATES,
  RATE_LABELS,
  MATERIAL_RATE_LABELS,
  type CardPricedHardware,
  type RateCard,
} from '../../types/rates';
import type { MaterialType } from '../../types/cabinet';

const HARDWARE_KEYS: CardPricedHardware[] = [
  'hinge',
  'channel',
  'basket',
  'shelf',
  'cornerMagic',
  'cornerCarousel',
];

const MATERIAL_KEYS: MaterialType[] = ['HDMR', 'Plywood', 'BWP', 'MDF', 'Particle Board'];

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
    draft.fabricationRatePerUnit !== rateCard.fabricationRatePerUnit ||
    draft.othersRatePerUnit !== rateCard.othersRatePerUnit ||
    HARDWARE_KEYS.some((k) => draft.hardware[k] !== rateCard.hardware[k]) ||
    MATERIAL_KEYS.some((k) => draft.materialRates[k] !== rateCard.materialRates[k]);

  // Whether the business is still on the seeded numbers. Compared by
  // value rather than by a flag, so editing a rate back to 150 honestly
  // counts as still-placeholder — the point is what the number IS, not
  // whether someone has visited this screen.
  const isPlaceholder =
    draft.laborRatePerSqFt === PLACEHOLDER_RATES.laborRatePerSqFt &&
    draft.fabricationRatePerUnit === PLACEHOLDER_RATES.fabricationRatePerUnit &&
    draft.othersRatePerUnit === PLACEHOLDER_RATES.othersRatePerUnit &&
    HARDWARE_KEYS.every((k) => draft.hardware[k] === PLACEHOLDER_RATES.hardware[k]) &&
    MATERIAL_KEYS.every((k) => draft.materialRates[k] === PLACEHOLDER_RATES.materialRates[k]);

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
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-900">
            <strong className="font-semibold">These are placeholder rates.</strong> They're
            the right order of magnitude for Delhi NCR retail, but they aren't your prices.
            Check them against your own purchase invoices before sending a quote built on them.
          </AlertDescription>
        </Alert>
      )}

      <Label className="flex flex-col items-stretch gap-1">
        <span className="text-xs font-medium text-gray-600">
          Labour — site installation (₹ per sq ft)
        </span>
        <Input
          type="number"
          min={0}
          step={1}
          value={draft.laborRatePerSqFt}
          onChange={(e) =>
            setDraft({ ...draft, laborRatePerSqFt: Number(e.target.value) })
          }
        />
        <span className="text-[11px] font-normal text-gray-500">
          Fitting the finished cabinet on site. Charged on estimated cabinet area — sq ft
          rather than sq m because that's still the billing unit in the trade. Not the same
          as Fabrication below, which is workshop labour to build the box in the first place.
        </span>
      </Label>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Per-cabinet (₹ per unit)</legend>
        <Label className="flex items-center justify-between gap-3 font-normal">
          <span className="text-xs text-gray-600">Fabrication (cut, edge-band, assemble)</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={draft.fabricationRatePerUnit}
            onChange={(e) =>
              setDraft({ ...draft, fabricationRatePerUnit: Number(e.target.value) })
            }
            className="w-28 text-right"
          />
        </Label>
        <Label className="flex items-center justify-between gap-3 font-normal">
          <span className="text-xs text-gray-600">Other</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={draft.othersRatePerUnit}
            onChange={(e) => setDraft({ ...draft, othersRatePerUnit: Number(e.target.value) })}
            className="w-28 text-right"
          />
        </Label>
        <p className="text-[11px] text-gray-500">
          Flat per cabinet, regardless of size — unlike material/finish (priced by area) or
          site labour above (priced by area). Fabrication is workshop labour to actually
          build one cabinet box; Other is a deliberate catch-all with no real number behind
          it yet (packing, delivery, a specific site's conditions — whatever doesn't fit
          elsewhere), which is why it defaults to ₹0 instead of a placeholder guess.
        </p>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Hardware (₹ per unit)</legend>
        {HARDWARE_KEYS.map((key) => (
          <Label key={key} className="flex items-center justify-between gap-3 font-normal">
            <span className="text-xs text-gray-600">{RATE_LABELS[key]}</span>
            <Input
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
              className="w-28 text-right"
            />
          </Label>
        ))}
        <p className="text-[11px] text-gray-500">
          A drawer channel is priced per <strong>pair</strong> of runners, and a hinge per
          individual piece — that's how each is sold and fitted. Handles are priced on their
          own catalogue rows, not here.
        </p>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Material (₹ per sq m)</legend>
        {MATERIAL_KEYS.map((key) => (
          <Label key={key} className="flex items-center justify-between gap-3 font-normal">
            <span className="text-xs text-gray-600">{MATERIAL_RATE_LABELS[key]}</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={draft.materialRates[key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  materialRates: { ...draft.materialRates, [key]: Number(e.target.value) },
                })
              }
              className="w-28 text-right"
            />
          </Label>
        ))}
        <p className="text-[11px] text-gray-500">
          Charged on each cabinet's own estimated carcass area (the same rough estimate
          labour is charged on) times its substrate's rate here — a Plywood cabinet and a
          BWP one of the same size now cost differently, instead of both quietly costing
          whatever the catalogue's flat price happened to be.
        </p>
      </fieldset>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
