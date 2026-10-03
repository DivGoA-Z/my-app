// src/components/inventory/RateCardManager.tsx
//
// Edits the business's rate card: one "Labour and other charges" list
// (site labour and fabrication are its first two rows — §38 — each row
// per sq ft / per cabinet / lump sum, and shown on the quote or rolled
// into "Other"), consumable/mechanism hardware rates, board lines
// (material × thickness × ₹/m², §42) and the sheet waste factor on
// them, and a glass-door front's rate by tint.
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
  RATE_LABELS,
  HARDWARE_RATE_KEYS as HARDWARE_KEYS,
  GLASS_RATE_KEYS as GLASS_KEYS,
  isPlaceholderRateCard,
  sameBoards,
  sameOtherRates,
  type RateCard,
} from '../../types/rates';
import { GLASS_TINT_LABELS } from '../../types/front';
import { ChargeRatesList } from '../common/ChargeRatesList';
import { BoardRatesEditor } from './BoardRatesEditor';

// Every editable field, compared by value. Used both for the Save
// button's enabled state and for the resync below, so the two can't
// disagree about what "unsaved" means.
function cardsDiffer(a: RateCard, b: RateCard): boolean {
  return (
    a.sheetWasteFactor !== b.sheetWasteFactor ||
    a.wasteMode !== b.wasteMode ||
    // Field-by-field, not JSON.stringify — see sameOtherRates.
    !sameOtherRates(a.othersRates, b.othersRates) ||
    HARDWARE_KEYS.some((k) => a.hardware[k] !== b.hardware[k]) ||
    !sameBoards(a.boards, b.boards) ||
    a.defaultBackBoardId !== b.defaultBackBoardId ||
    GLASS_KEYS.some((k) => a.glassRates[k] !== b.glassRates[k])
  );
}

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
    // EXCEPTION to "resync replaces the draft": a board line can now be
    // added from somewhere else on the same page (a catalogue row's
    // Material dropdown → "+ Add a new board…", components/common/
    // BoardSelect.tsx), which saves the rate card directly. If this
    // draft had unsaved edits at that moment, replacing it would throw
    // them away. So an unsaved draft keeps its edits and just gains any
    // board line that appeared in the store and wasn't there before.
    // Field comparison, not object identity: right after this editor's
    // own Save, the store holds a NEW (sanitised) object equal to the
    // draft, and identity would wrongly call that "unsaved edits".
    const draftWasDirty = cardsDiffer(draft, syncedFrom);
    const added = rateCard.boards.filter(
      (b) => !syncedFrom.boards.some((x) => x.id === b.id) && !draft.boards.some((x) => x.id === b.id)
    );
    setSyncedFrom(rateCard);
    setDraft(draftWasDirty ? { ...draft, boards: [...draft.boards, ...added] } : rateCard);
  }

  const dirty = cardsDiffer(draft, rateCard);

  // Whether the business is still on the seeded numbers. Shared with
  // FirstRunChecklist's "add your rates" step — see isPlaceholderRateCard's
  // own comment in types/rates.ts for why this is a value comparison,
  // not a flag.
  const isPlaceholder = isPlaceholderRateCard(draft);

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm text-gray-700">Rate card</h3>
          <p className="mt-1 text-xs text-gray-500">
            The prices that aren't attached to a product. Finishes, handles, fixtures,
            cabinets and appliances are priced on their own catalogue rows.
          </p>
        </div>
        {/* A second Save at the top, alongside the sticky bar at the
            bottom — your request, so saving never needs a scroll
            first. Same handler and same disabled rule as the bottom
            one; there is still only one draft. */}
        <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save rates'}
        </Button>
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

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Labour and other charges (₹)</legend>
        <p className="text-[11px] text-gray-500">
          Labour, edge banding, packing, delivery — anything that isn't material, hardware or
          glass. Pick how each is charged: per sq ft of cabinet, per cabinet, or once per
          project (lump sum). Tick <strong>Show on quote</strong> to print it as its own line;
          everything unticked is combined into one "Other" line. Untick{' '}
          <strong>Add margin</strong> for a price you've already fixed — it goes on the quote
          as-is. Each project can override this list from its quote.
        </p>
        <ChargeRatesList
          rates={draft.othersRates}
          onChange={(othersRates) => setDraft({ ...draft, othersRates })}
        />
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
        <legend className="text-xs font-medium text-gray-600">Boards</legend>
        <p className="text-[11px] text-gray-500">
          Every board you buy, one line per material and thickness — HDMR 18mm and HDMR 6mm are
          different lines at different prices. Each panel of a cabinet is priced at its own
          board's rate, on its real area. Each cabinet picks its carcass board in the catalogue
          (and per cabinet); its back uses the default back board below.
        </p>
        <BoardRatesEditor
          boards={draft.boards}
          defaultBackBoardId={draft.defaultBackBoardId}
          onChange={(boards, defaultBackBoardId) => setDraft({ ...draft, boards, defaultBackBoardId })}
        />
        {/* Approx vs calculated sheet waste (§53, your rule): ONE
            experience-based factor everywhere, or each board line's own
            factor measured from each project's sheet layout. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-600">Sheet waste on quotes</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Sheet waste on quotes">
            {(
              [
                ['approx', 'Approx — one factor'],
                ['calculated', 'Calculated — per board, from the sheet layout'],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                role="radio"
                aria-checked={draft.wasteMode === mode}
                variant={draft.wasteMode === mode ? 'secondary' : 'ghost'}
                onClick={() => setDraft({ ...draft, wasteMode: mode })}
              >
                {draft.wasteMode === mode ? '✓ ' : ''}
                {label}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">
            {draft.wasteMode === 'approx'
              ? 'Every quote uses the one factor below (a project can override it from its quote).'
              : "Every quote lays its own parts out on each board's sheet sizes and uses each board's measured waste — automatically, nothing to fill in. More accurate when boards differ in price. The factor below is kept for when you switch back."}
          </p>
        </div>
        <Label className="flex items-center justify-between gap-3 font-normal">
          <span className={`text-xs ${draft.wasteMode === 'approx' ? 'text-gray-600' : 'text-gray-400'}`}>
            Approx sheet waste factor (×)
          </span>
          <Input
            type="number"
            min={1}
            step={0.01}
            value={draft.sheetWasteFactor}
            onChange={(e) => setDraft({ ...draft, sheetWasteFactor: Number(e.target.value) })}
            className="w-28 text-right"
          />
        </Label>
        <p className="text-[11px] text-gray-500">
          From experience: board is bought as whole sheets and the offcuts are paid for too. 1.10
          means "buy 10% more than the cabinets use." Multiplies the board rates above only.
        </p>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium text-gray-600">Glass door (₹ per sq ft)</legend>
        {GLASS_KEYS.map((key) => (
          <Label key={key} className="flex items-center justify-between gap-3 font-normal">
            <span className="text-xs text-gray-600">{GLASS_TINT_LABELS[key]}</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={draft.glassRates[key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  glassRates: { ...draft.glassRates, [key]: Number(e.target.value) },
                })
              }
              className="w-28 text-right"
            />
          </Label>
        ))}
        <p className="text-[11px] text-gray-500">
          An open-shelf front's optional glass door (Front Picker, on a cabinet), charged by
          the glass panel's own area — sq ft, not sq m, matching site labour's unit rather
          than the board rates above. Priced separately from Boards: glass is bought
          and cut as glass, not the cabinet's own board.
        </p>
      </fieldset>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* STICKY while there are unsaved edits. It used to sit inline
          at the very bottom of a long form, below Material, waste and
          Glass — a user editing Labour or Other at the top never saw
          it, assumed edits applied live, and reported "changing rates
          doesn't update the quote" (they were never saved). Sticky
          rather than a second button at the top: one save action,
          always reachable from wherever the edit was made. It only
          sticks within this component, so it can't float over the
          Finishes/Handles sections below once the rate card is
          scrolled past. */}
      <div
        className={
          dirty
            ? 'sticky bottom-0 z-10 -mx-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 shadow-sm'
            : 'flex items-center gap-2'
        }
      >
        {dirty && !saving && (
          <span className="text-xs text-amber-900">Unsaved rate changes — quotes use the old rates until saved.</span>
        )}
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
        Saving new rates reprices every open quote. Quotes you've already frozen and
        sent keep the rates they were sent with.
      </p>
    </div>
  );
}

