// src/components/quote/QuoteSidebar.tsx
//
// Renders the live BOM as an itemized price table next to RoomCanvas.
// Purely a consumer of useBOM() — no pricing logic lives here, so this
// can never drift from the numbers CabinetLayer and collision detection
// are working from. It updates automatically whenever cabinets or
// appliances are dragged, added, or removed, because useBOM()
// recomputes off the same Zustand cabinets/appliances arrays everything
// else reads.
//
// Appliances get their own table + subtotal rather than being merged
// into the cabinet table — see the note on ApplianceLineItem in
// lib/bom.ts for why the two don't share a row shape.
//
// Also where this project's own margin is edited (per-project, not a
// business-wide rate — see RoomLayout.marginPercent and
// docs/DECISIONS.md §15), along with its sheet waste override (same
// pattern — RoomLayout.sheetWasteFactor, §35), and where the
// Cost/Selling toggle lives — the ONLY place either total is shown. The toggle is business-only;
// the frozen quote and the PDF always print the selling figures.

import { useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { useBOM } from '../../hooks/useBOM';
import { useLayoutStore } from '../../store/layoutStore';
import { DEFAULT_MARGIN_PERCENT } from '../../lib/bom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { APPLIANCE_TYPE_LABELS } from '../../types/appliance';
import type { ApplianceType } from '../../types/appliance';
import { QuoteFreezePanel } from './QuoteFreezePanel';
import { ChargeRatesList } from '../common/ChargeRatesList';
import { boardLabel } from '../../types/rates';

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatINR(value: number): string {
  return INR_FORMATTER.format(value);
}

// 'sink-unit' -> 'Sink Unit'
function formatModuleType(moduleType: string): string {
  return moduleType
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatApplianceType(applianceType: ApplianceType): string {
  return APPLIANCE_TYPE_LABELS[applianceType];
}

export function QuoteSidebar({ onOpenCutList }: { onOpenCutList?: (quoteId: string) => void } = {}) {
  const bom = useBOM();
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const setMarginPercent = useLayoutStore((s) => s.setMarginPercent);
  const setSheetWasteFactor = useLayoutStore((s) => s.setSheetWasteFactor);
  const businessWasteFactor = useLayoutStore((s) => s.rateCard.sheetWasteFactor);
  const rateBoards = useLayoutStore((s) => s.rateCard.boards);
  const businessChargeRates = useLayoutStore((s) => s.rateCard.othersRates);
  const customiseChargeRates = useLayoutStore((s) => s.customiseChargeRates);
  const setChargeRates = useLayoutStore((s) => s.setChargeRates);
  const resetChargeRates = useLayoutStore((s) => s.resetChargeRates);
  const projectChargeRates = currentLayout?.chargeRates;
  const legacyChargeCount =
    (currentLayout?.projectCharges?.labor.length ?? 0) +
    (currentLayout?.projectCharges?.other.length ?? 0);
  // Internal, business-only, session-only (not persisted) — this is
  // the ONE place either total is shown side by side. A frozen quote,
  // the PDF, and the WhatsApp link always show the selling total
  // (bom.grandTotal) regardless of this toggle; a customer never sees
  // "cost view" exists.
  const [view, setView] = useState<'selling' | 'cost'>('selling');

  // Applied to EVERY displayed cost figure, not just the grand total —
  // confirmed with the business rather than assumed: cabinet/appliance/
  // opening/fixture/countertop rows and every summary subtotal are all
  // marked up in Selling view, so the rows sum to the Grand Total
  // exactly (no separate, unexplained "Margin" line to reconcile
  // against). Identity in Cost view. See docs/DECISIONS.md §15.
  const markup = (value: number) =>
    view === 'selling' ? value * (1 + bom.marginPercent / 100) : value;

  return (
    <aside className="flex flex-col gap-4 p-4">
      {/* Cost/Selling toggle and the project's margin box both live at
          the top, not buried at the bottom of the summary — they
          change every figure on this panel, so they should be the
          first thing you see, not the last. Margin is per-project,
          business-only — see RoomLayout.marginPercent's own comment
          and docs/DECISIONS.md §15 for why this isn't a business-wide
          rate card field. */}
      {/* §86: the customer sits beside you, so margin, sheet waste, the
          charge editor and the Cost view sit in one fold, closed by
          default. Closing it returns to Selling, so the panel can't be
          left showing cost by accident. The figures below are always
          what the customer pays unless Cost is picked in here. */}
      <details
        className="group rounded-xl border border-border"
        onToggle={(e) => {
          if (!(e.currentTarget as HTMLDetailsElement).open) setView('selling');
        }}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[13px] font-semibold">
          <span className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" />
            Your pricing
            <span className="font-normal text-muted-foreground">(not shown to the customer)</span>
          </span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">
          {view === 'cost' ? 'Showing what this costs you' : 'Showing what the customer pays'}
        </span>
        <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
          <Button type="button" variant={view === 'selling' ? 'outline' : 'ghost'} size="sm" onClick={() => setView('selling')}>
            Selling
          </Button>
          <Button type="button" variant={view === 'cost' ? 'outline' : 'ghost'} size="sm" onClick={() => setView('cost')}>
            Cost
          </Button>
        </div>
      </div>

      <Label className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-normal text-muted-foreground">
          Margin for this project (%)
        </span>
        <Input
          type="number"
          min={0}
          step={1}
          value={currentLayout?.marginPercent ?? DEFAULT_MARGIN_PERCENT}
          onChange={(e) => setMarginPercent(Number(e.target.value))}
          className="h-10 w-20 text-right font-mono text-[15px]"
        />
      </Label>

      {/* Per-project override of the rate card's sheet waste factor
          (RoomLayout.sheetWasteFactor). Blank means "use the business
          default", shown as the placeholder — deliberately NOT
          pre-filled with it, or every project would silently pin
          today's default and stop following the rate card. */}
      {/* Calculated waste (§53): no single number to override — each
          board's factor comes from this project's own sheet layout, so
          it's shown read-only. Approx: the one-factor override as before. */}
      {bom.wasteMode === 'calculated' ? (
        <div className="-mt-2 flex flex-col gap-0.5 text-[13px] text-muted-foreground">
          <span>Sheet waste — calculated from this project's sheet layout:</span>
          <span className="text-foreground">
            {bom.boardWasteFactors.length === 0
              ? 'no board parts yet'
              : bom.boardWasteFactors
                  .map((w) => {
                    const board = rateBoards.find((b) => b.id === w.boardId);
                    return `${board ? boardLabel(board) : 'Board'} ×${w.factor.toFixed(2)}`;
                  })
                  .join(' · ')}
          </span>
        </div>
      ) : (
      <Label className="-mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-normal text-muted-foreground">
          Sheet waste for this project (×)
          {currentLayout?.sheetWasteFactor !== undefined && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ml-1 h-auto p-0 text-[13px]"
              onClick={() => setSheetWasteFactor(undefined)}
            >
              use default ({businessWasteFactor})
            </Button>
          )}
        </span>
        <Input
          type="number"
          min={1}
          step={0.01}
          placeholder={String(businessWasteFactor)}
          value={currentLayout?.sheetWasteFactor ?? ''}
          onChange={(e) =>
            setSheetWasteFactor(e.target.value === '' ? undefined : Number(e.target.value))
          }
          className="h-10 w-20 text-right font-mono text-[15px]"
        />
      </Label>
      )}

      {/* This project's labour and other charges (RoomLayout.
          chargeRates). Follows the business rate card until
          customised; once customised it is the project's own copy, with
          every rate-card option plus "Add margin" — untick it for a
          price already fixed (an extra service at ₹20,000 stays
          ₹20,000). See docs/DECISIONS.md §39. */}
      <div className="flex flex-col gap-2 rounded-md border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">Labour and other charges</span>
          {projectChargeRates ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-[13px]"
              onClick={resetChargeRates}
            >
              Use business-level rate-card charges again
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={customiseChargeRates}>
              Customise for this project
            </Button>
          )}
        </div>
        {projectChargeRates ? (
          <ChargeRatesList
            rates={projectChargeRates}
            onChange={setChargeRates}
            inputClassName="h-9 text-sm"
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Using your business rates ({businessChargeRates.length}{' '}
            {businessChargeRates.length === 1 ? 'charge' : 'charges'}). Customise to change a
            rate, add a charge such as an extra service, or choose what prints — for this
            project only.
            {legacyChargeCount > 0 &&
              ` Also includes ${legacyChargeCount} earlier project ${
                legacyChargeCount === 1 ? 'charge' : 'charges'
              } — customise to edit.`}
          </p>
        )}
      </div>

        </div>
      </details>

      {view === 'cost' && (
        <p className="-mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning-foreground">
          Cost view: these are your costs, not the customer's prices.
        </p>
      )}

      {bom.lineItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cabinets placed yet.</p>
      ) : (
        // Stacked rows rather than a five-column table (§86): the panel
        // is 400px, and the columns squeezed every cell to three lines.
        <div className="flex flex-col">
          <span className="pb-1 text-[13px] font-semibold">Cabinets</span>
          {bom.lineItems.map((line) => (
            <div key={line.cabinetId} className="flex flex-col gap-0.5 border-b border-border py-2.5 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  {formatModuleType(line.moduleType)}
                  {line.quantity > 1 && <span className="font-normal text-muted-foreground"> × {line.quantity}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatINR(markup(line.lineTotal - line.unmarkedCost) + line.unmarkedCost)}
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {line.widthMm} × {line.depthMm} × {line.heightMm} mm
              </span>
              {/* The front configuration is what the client is actually
                  choosing between — "600mm base unit" tells them
                  nothing, "600mm, 3 drawers" is the line that costs
                  money. */}
              <span className="text-muted-foreground">
                {line.frontDescription} · {line.handleDescription}
              </span>
              <span className="text-muted-foreground">
                {line.material} / {line.finish}
              </span>
              {/* Itemised hardware, so a client asking "why does this
                  drawer unit cost more than that door unit" can be shown
                  the answer instead of told it. */}
              {line.hardwareDetail.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {line.hardwareDetail
                    .map((h) => `${h.label} × ${Number.isInteger(h.count) ? h.count : `${h.count.toFixed(2)}m`} (${formatINR(h.cost)})`)
                    .join(' · ')}
                </span>
              )}
              {/* A part with no board line is priced at ₹0 — said out
                  loud here rather than quietly under-quoting
                  (Principle 1). */}
              {line.missingBoard && (
                <span className="text-xs font-medium text-destructive">
                  Some board isn't on your rate card — priced ₹0. See the cutting list.
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {bom.openingLineItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-foreground">Doors &amp; Windows</h4>
          {/* Listed even at zero cost. An opening that silently vanished
              from the paperwork is how a site argument starts about
              whether a door was in the price — and the deducted area is
              what explains why the wall tiling is less than the room's
              raw dimensions suggest. */}
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {bom.openingLineItems.map((line) => (
                <tr key={line.openingId} className="border-b border-border">
                  <td className="py-1.5 pr-2 text-foreground">
                    {line.description}
                    <div className="text-xs font-normal text-muted-foreground">
                      {line.surface} · deducts {line.deductedSqM.toFixed(2)} m² of tiling
                    </div>
                  </td>
                  <td className="py-1.5 pl-2 text-right text-foreground">
                    {line.suppliedByUs ? (
                      <span className="font-medium">{formatINR(markup(line.cost))}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Existing — by others
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.fixtureLineItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <h4 className="text-xs font-semibold text-foreground">Lighting</h4>
            {/* When electrical isn't charged, the figure it WOULD come
                to is still shown. The business is choosing not to bill
                it, which is different from the work being free, and the
                electrician quoting separately will want the same
                schedule. */}
            {bom.fixtureSubtotal === 0 && bom.fixtureSpecifiedTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                specified only — {formatINR(markup(bom.fixtureSpecifiedTotal))} if charged
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {bom.fixtureLineItems.map((line) => (
                <tr key={line.fixtureId} className="border-b border-border">
                  <td className="py-1.5 pr-2 text-foreground">
                    {line.description}
                    <div className="text-xs font-normal text-muted-foreground">
                      {line.mountDescription} · {line.colorTempK}K
                      {line.note ? ` · ${line.note}` : ''}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-muted-foreground">
                    {line.unit === 'm' ? `${line.amount.toFixed(2)} m` : `${line.amount} pcs`}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-foreground">
                    {bom.fixtureSubtotal > 0 ? (
                      <span className="font-medium">{formatINR(markup(line.cost))}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">by electrician</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.applianceLineItems.length > 0 && (
        <div className="overflow-x-auto border-t border-border pt-3">
          <h4 className="mb-1.5 text-xs font-semibold text-foreground">Appliances</h4>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Appliance</th>
                <th className="py-1.5 pr-2 font-medium">Dimensions (mm)</th>
                <th className="py-1.5 pr-2 text-center font-medium">Qty</th>
                <th className="py-1.5 pl-2 text-right font-medium">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {bom.applianceLineItems.map((line) => (
                <tr key={line.applianceId} className="border-b border-border">
                  <td className="py-1.5 pr-2 text-foreground">
                    {formatApplianceType(line.applianceType)}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {line.widthMm} × {line.depthMm} × {line.heightMm}
                  </td>
                  <td className="py-1.5 pr-2 text-center text-muted-foreground">{line.quantity}</td>
                  <td className="py-1.5 pl-2 text-right font-medium text-foreground">
                    {formatINR(markup(line.lineTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.countertopLineItem && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <h4 className="text-xs font-semibold text-foreground">Countertop / Slab</h4>
            {/* Same "specified only" treatment as Lighting — in Delhi
                NCR the kitchen business usually doesn't supply the
                slab, the homeowner arranges stone separately, so the
                figure it WOULD come to is still shown even when it
                isn't being charged. */}
            {bom.countertopSubtotal === 0 && bom.countertopSpecifiedTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                specified only — {formatINR(markup(bom.countertopSpecifiedTotal))} if charged
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              <tr className="border-b border-border">
                <td className="py-1.5 pr-2 text-foreground">
                  {bom.countertopLineItem.finish}
                  <div className="text-xs font-normal text-muted-foreground">
                    {bom.countertopLineItem.areaSqM.toFixed(2)} m²
                  </div>
                </td>
                <td className="py-1.5 pl-2 text-right text-foreground">
                  {bom.countertopSubtotal > 0 ? (
                    <span className="font-medium">{formatINR(markup(bom.countertopSubtotal))}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">by homeowner</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Material</span>
          <span>{formatINR(markup(bom.materialSubtotal))}</span>
        </div>
        <div className="flex justify-between">
          <span>Finish</span>
          <span>{formatINR(markup(bom.finishSubtotal))}</span>
        </div>
        {bom.surfaceSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Floor / walls / ceiling</span>
            <span>{formatINR(markup(bom.surfaceSubtotal))}</span>
          </div>
        )}
        {/* Not charged (§123), but shown, as the slab is when off. */}
        {bom.surfaceSubtotal === 0 && (bom.surfaceSpecifiedTotal ?? 0) > 0 && (
          <div className="flex justify-between">
            <span>Floor / walls / ceiling</span>
            <span>not charged · {formatINR(markup(bom.surfaceSpecifiedTotal!))} if charged</span>
          </div>
        )}
        {bom.countertopSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Countertop / slab</span>
            <span>{formatINR(markup(bom.countertopSubtotal))}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Hardware</span>
          <span>{formatINR(markup(bom.hardwareSubtotal))}</span>
        </div>
        {/* Charge rows ticked "show on quote" (labour, by default) —
            each its own line. Marked up unless the row is fixed-price
            (applyMargin false). The unticked rest are in "Other"
            below. See BOMSummary.shownOtherLines. */}
        {bom.shownOtherLines.map((c, i) => (
          <div key={`shown-${i}`} className="flex justify-between">
            <span>{c.label}</span>
            <span>{formatINR(c.applyMargin === false ? c.amount : markup(c.amount))}</span>
          </div>
        ))}
        {bom.othersSubtotal + bom.othersUnmarkedSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Other</span>
            <span>{formatINR(markup(bom.othersSubtotal) + bom.othersUnmarkedSubtotal)}</span>
          </div>
        )}
        {/* Exact metres from the cutting list × ₹/m (§58); hidden at ₹0. */}
        {bom.edgeBandingSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Edge banding</span>
            <span>{formatINR(markup(bom.edgeBandingSubtotal))}</span>
          </div>
        )}
        {bom.glassSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Glass doors</span>
            <span>{formatINR(markup(bom.glassSubtotal))}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Appliances</span>
          <span>{formatINR(markup(bom.applianceSubtotal))}</span>
        </div>

        <div className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-semibold text-foreground">
          <span>{view === 'cost' ? 'Total Cost' : 'Grand Total'}</span>
          <span>{formatINR(view === 'cost' ? bom.costGrandTotal : bom.grandTotal)}</span>
        </div>
        {/* Only in Cost view (§86): the margin isn't for the customer's
            eyes, and the Selling view is the one they look at. */}
        {view === 'cost' && (
          <span className="text-xs text-muted-foreground">
            The customer pays {formatINR(bom.grandTotal)}: your cost plus {bom.marginPercent}% margin
            {bom.unmarkedTotal > 0 ? ', except on fixed-price charges.' : '.'}
          </span>
        )}
      </div>

      {/* Kept as its OWN component (QuoteFreezePanel's own header
          comment explains why: this is the one part of the sidebar
          that writes), but rendered here so it visually sits where its
          own comment says it should — at the bottom of the quote
          sidebar. It was built but never actually composed in here
          before now, which is why Freeze/Download/Share never
          appeared. */}
      <QuoteFreezePanel onOpenCutList={onOpenCutList} />
    </aside>
  );
}
