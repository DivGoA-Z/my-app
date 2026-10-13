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

import { useState, type ReactNode } from 'react';
import { AlertTriangle, GlassWater, HardHat, Layers, Scissors, Wrench } from 'lucide-react';
import { SectionCard } from '../common/SectionCard';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { useLayoutStore } from '../../store/layoutStore';
import {
  RATE_LABELS,
  HARDWARE_RATE_KEYS as HARDWARE_KEYS,
  GLASS_RATE_KEYS as GLASS_KEYS,
  isPlaceholderRateCard,
  boardLabel,
  sameBoards,
  sameOtherRates,
  type RateCard,
} from '../../types/rates';
import { GLASS_TINT_LABELS } from '../../types/front';
import { ChargeRatesList } from '../common/ChargeRatesList';
import { BoardRatesEditor } from './BoardRatesEditor';

// A colour chip per glass tint, for the rate rows.
const GLASS_SWATCH: Record<string, string> = {
  clear: '#E8F1F4',
  black: '#2B2E31',
  brown: '#7A5A3E',
  yellow: '#E2C26A',
};

// Every editable field, compared by value. Used both for the Save
// button's enabled state and for the resync below, so the two can't
// disagree about what "unsaved" means.
function cardsDiffer(a: RateCard, b: RateCard): boolean {
  return (
    a.sheetWasteFactor !== b.sheetWasteFactor ||
    a.wasteMode !== b.wasteMode ||
    a.edgeBandingRatePerM !== b.edgeBandingRatePerM ||
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

  // One row of the card: what it is (and its unit) on the left, the rate
  // in a roomy box with ₹ inside it on the right (§77).
  const rateRow = (key: string, label: string, hint: string | undefined, value: number, onChange: (n: number) => void, step = 1, extra?: ReactNode) => (
    <label key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-secondary py-3 last:border-b-0">
      <span className="flex min-w-0 items-center gap-3">
        {extra}
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-medium">{label}</span>
          {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
        </span>
      </span>
      <span className="flex h-11 w-40 items-center gap-2 rounded-[10px] border border-input bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <span className="text-sm text-muted-foreground">₹</span>
        <Input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-auto min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[15px] shadow-none focus-visible:ring-0"
        />
      </span>
    </label>
  );

  // "Hinge (each)" → label "Hinge", hint "each".
  const splitUnit = (text: string): [string, string | undefined] => {
    const m = text.match(/^(.*?)\s*\((.*)\)\s*$/);
    return m ? [m[1], m[2]] : [text, undefined];
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      {isPlaceholder && (
        <div className="flex gap-3 rounded-2xl bg-warning-soft px-4 py-3.5 text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
          <p className="text-sm leading-relaxed">
            <strong className="font-semibold">These are placeholder rates.</strong> They're the right order of
            magnitude for Delhi NCR retail, but they aren't your prices. Check them against your own purchase
            invoices before sending a quote built on them.
          </p>
        </div>
      )}

      <SectionCard
        Icon={HardHat}
        title="Labour and other charges"
        description="Labour, packing, delivery: anything that isn't material, hardware or glass."
        help={
          <>
            <p>
              Pick how each is charged: <strong className="text-foreground">per sq ft</strong> of each cabinet's
              total board area (every panel, back, shelf and front from the cutting list),{' '}
              <strong className="text-foreground">per cabinet</strong>, or once per project as a{' '}
              <strong className="text-foreground">lump sum</strong>.
            </p>
            <p>
              Tick <strong className="text-foreground">Show on quote</strong> to print a charge as its own line;
              unticked ones are combined into one "Other" line. Untick{' '}
              <strong className="text-foreground">Add margin</strong> for a price you've already fixed: it goes on
              the quote as it is. Each project can override this list from its quote.
            </p>
          </>
        }
      >
        <ChargeRatesList comfortable rates={draft.othersRates} onChange={(othersRates) => setDraft({ ...draft, othersRates })} />
      </SectionCard>

      <SectionCard
        Icon={Wrench}
        title="Hardware"
        description="Fittings priced per piece. Handles are priced on their catalogue rows."
        help={<p>A drawer channel is priced per <strong className="text-foreground">pair</strong> of runners and a hinge per piece, as each is sold and fitted.</p>}
      >
        <div className="flex flex-col">
          {HARDWARE_KEYS.map((key) => {
            const [label, hint] = splitUnit(RATE_LABELS[key]);
            return rateRow(key, label, hint, draft.hardware[key], (n) => setDraft({ ...draft, hardware: { ...draft.hardware, [key]: n } }));
          })}
        </div>
      </SectionCard>

      <SectionCard
        Icon={Layers}
        title="Boards"
        description="Every board you buy: one line per material and thickness, priced per m²."
        help={
          <p>
            HDMR 18mm and HDMR 6mm are different lines at different prices. Each panel of a cabinet is priced at
            its own board's rate, on its real area. Each cabinet picks its carcass board in the catalogue (and per
            cabinet); its back uses the default back board.
          </p>
        }
      >
        <BoardRatesEditor
          boards={draft.boards}
          defaultBackBoardId={draft.defaultBackBoardId}
          onChange={(boards, defaultBackBoardId) => setDraft({ ...draft, boards, defaultBackBoardId })}
        />
      </SectionCard>

      <SectionCard
        Icon={Scissors}
        title="Sheet waste and edge banding"
        description="What the offcuts add to board cost, and the price of the edge tape."
      >
        {/* Approx vs calculated sheet waste (§53, your rule): ONE
            experience-based factor everywhere, or each board line's own
            factor measured from each project's sheet layout. */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Sheet waste on quotes</span>
          <div role="radiogroup" aria-label="Sheet waste on quotes" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ['approx', 'Approx', 'One factor from experience, on every board'],
                ['calculated', 'Calculated', "Each board's real waste, from the sheet layout"],
              ] as const
            ).map(([mode, label, sub]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={draft.wasteMode === mode}
                onClick={() => setDraft({ ...draft, wasteMode: mode })}
                className={
                  draft.wasteMode === mode
                    ? 'flex flex-col items-start gap-0.5 rounded-xl border-2 border-primary bg-accent px-4 py-3 text-left'
                    : 'flex flex-col items-start gap-0.5 rounded-xl border border-input bg-card px-4 py-3 text-left hover:bg-secondary'
                }
              >
                <span className="text-[15px] font-semibold">{label}</span>
                <span className="text-[13px] text-muted-foreground">{sub}</span>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {draft.wasteMode === 'approx'
              ? 'Every quote uses the factor below (a project can override it from its quote).'
              : 'Nothing to fill in: every quote measures it. More accurate when boards differ in price. The factor below is kept for when you switch back.'}
          </p>
        </div>
        <div className="flex flex-col">
          <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-secondary py-3">
            <span className="flex min-w-0 max-w-xl flex-col gap-1">
              <span className="text-[15px] font-medium">Approx sheet waste factor</span>
              <span className="text-[13px] text-muted-foreground">
                Board cost on a quote = board area × that board's rate × this factor. It covers the offcuts you
                pay for but can't use. Labour, finishes, hardware, handles, glass and edge banding are{' '}
                <strong className="font-semibold text-foreground">not</strong> multiplied.
              </span>
            </span>
            <span className="flex h-11 w-40 items-center gap-2 rounded-[10px] border border-input bg-card px-3">
              <span className="text-sm text-muted-foreground">×</span>
              <Input
                type="number"
                min={1}
                step={0.01}
                value={draft.sheetWasteFactor}
                onChange={(e) => setDraft({ ...draft, sheetWasteFactor: Number(e.target.value) })}
                className="h-auto min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[15px] shadow-none focus-visible:ring-0"
              />
            </span>
          </label>
          {rateRow(
            'edge',
            'Edge banding',
            'per running metre, on the edges the customer sees',
            draft.edgeBandingRatePerM,
            (n) => setDraft({ ...draft, edgeBandingRatePerM: n }),
            0.5
          )}
        </div>
        {/* A worked example with the business's own numbers, so "1.10"
            means something concrete (your question, 4 Oct). */}
        {(() => {
          const board = draft.boards.find((b) => b.thicknessMm >= 12 && b.ratePerSqM > 0) ?? draft.boards[0];
          if (!board) return null;
          const area = 10;
          const base = area * board.ratePerSqM;
          const f = draft.sheetWasteFactor;
          return (
            <div className="rounded-xl bg-secondary px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Example with your rates: </span>
              cabinets that use {area} m² of {boardLabel(board)} at ₹{board.ratePerSqM.toLocaleString('en-IN')}/m² = ₹
              {base.toLocaleString('en-IN')} of board.{' '}
              With Approx at × {f}: ₹{base.toLocaleString('en-IN')} × {f} ={' '}
              <span className="font-semibold text-foreground">₹{Math.round(base * f).toLocaleString('en-IN')}</span> of board on the
              quote, before margin. A ₹150/sq ft labour charge stays ₹150/sq ft.
              {draft.wasteMode === 'calculated' && (
                <>
                  {' '}
                  <span className="font-semibold text-foreground">You're on Calculated</span>, so instead each job uses its own
                  factor: sheets bought ÷ board the parts use (for example 1.20 if it needs 12 m² of sheets for 10 m² of parts).
                </>
              )}
            </div>
          );
        })()}
        {draft.edgeBandingRatePerM > 0 && draft.othersRates.some((r) => /edge/i.test(r.label) && r.rate > 0) && (
          <div className="flex gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-[18px] shrink-0" strokeWidth={1.8} />
            You also have an edge-banding row under "Labour and other charges". Remove it, or edge banding is charged
            twice.
          </div>
        )}
      </SectionCard>

      <SectionCard
        Icon={GlassWater}
        title="Glass doors"
        description="Glass fronts by tint, per sq ft of glass."
        help={
          <p>
            Glass is bought and cut as glass, not from the cabinet's board, so it's priced on its own, by the glass
            panel's area in sq ft.
          </p>
        }
      >
        <div className="flex flex-col">
          {GLASS_KEYS.map((key) =>
            rateRow(
              key,
              GLASS_TINT_LABELS[key],
              'per sq ft',
              draft.glassRates[key],
              (n) => setDraft({ ...draft, glassRates: { ...draft.glassRates, [key]: n } }),
              1,
              <span className="size-6 shrink-0 rounded-md ring-1 ring-black/10" style={{ backgroundColor: GLASS_SWATCH[key] }} />
            )
          )}
        </div>
      </SectionCard>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* The save bar. It floats at the bottom of the screen while there
          are unsaved edits, because a user editing a rate near the top
          once never saw the Save at the bottom of the long form, assumed
          edits applied live, and reported "changing rates doesn't update
          the quote". One save action, always reachable. */}
      <div
        className={
          dirty
            ? 'sticky bottom-20 z-30 mr-16 flex flex-wrap items-center gap-3 rounded-2xl bg-sidebar px-4 py-3 text-sidebar-foreground shadow-float md:bottom-4 md:mr-20'
            : 'flex flex-wrap items-center gap-3'
        }
      >
        {dirty && !saving && (
          <span className="min-w-0 flex-1 text-sm text-white">Unsaved changes. Quotes use the old rates until you save.</span>
        )}
        {dirty && !saving && (
          <Button type="button" variant="ghost" size="touch" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-white" onClick={() => setDraft(rateCard)}>
            Discard
          </Button>
        )}
        <Button type="button" size="touch" onClick={save} disabled={!dirty || saving} className={dirty ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90' : ''}>
          {saving ? 'Saving…' : 'Save rates'}
        </Button>
        {!dirty && (
          <span className="text-[13px] text-muted-foreground">
            Saving reprices every open quote. Frozen quotes keep the rates they were sent with.
          </span>
        )}
      </div>
    </div>
  );
}
