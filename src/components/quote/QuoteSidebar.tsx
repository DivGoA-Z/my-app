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
    <aside className="w-96 shrink-0 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      {/* Cost/Selling toggle and the project's margin box both live at
          the top, not buried at the bottom of the summary — they
          change every figure on this panel, so they should be the
          first thing you see, not the last. Margin is per-project,
          business-only — see RoomLayout.marginPercent's own comment
          and docs/DECISIONS.md §15 for why this isn't a business-wide
          rate card field. */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-gray-700">Quote Summary</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
            {view === 'cost' ? 'What this costs you' : 'What the customer pays'}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant={view === 'selling' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setView('selling')}
            >
              Selling
            </Button>
            <Button
              type="button"
              variant={view === 'cost' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setView('cost')}
            >
              Cost
            </Button>
          </div>
        </div>
      </div>

      <Label className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-normal text-gray-500">
          Margin for this project (%)
        </span>
        <Input
          type="number"
          min={0}
          step={1}
          value={currentLayout?.marginPercent ?? DEFAULT_MARGIN_PERCENT}
          onChange={(e) => setMarginPercent(Number(e.target.value))}
          className="h-6 w-16 text-right"
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
        <div className="-mt-2 flex flex-col gap-0.5 text-[11px] text-gray-500">
          <span>Sheet waste — calculated from this project's sheet layout:</span>
          <span className="text-gray-700">
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
        <span className="text-[11px] font-normal text-gray-500">
          Sheet waste for this project (×)
          {currentLayout?.sheetWasteFactor !== undefined && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ml-1 h-auto p-0 text-[11px]"
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
          className="h-6 w-16 text-right"
        />
      </Label>
      )}

      {/* This project's labour and other charges (RoomLayout.
          chargeRates). Follows the business rate card until
          customised; once customised it is the project's own copy, with
          every rate-card option plus "Add margin" — untick it for a
          price already fixed (an extra service at ₹20,000 stays
          ₹20,000). See docs/DECISIONS.md §39. */}
      <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-gray-600">Labour and other charges</span>
          {projectChargeRates ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px]"
              onClick={resetChargeRates}
            >
              Reset to business rates
            </Button>
          ) : (
            <Button type="button" variant="outline" size="xs" onClick={customiseChargeRates}>
              Customise for this project
            </Button>
          )}
        </div>
        {projectChargeRates ? (
          <ChargeRatesList
            rates={projectChargeRates}
            onChange={setChargeRates}
            inputClassName="h-6 text-xs"
          />
        ) : (
          <p className="text-[11px] text-gray-500">
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

      {bom.lineItems.length === 0 ? (
        <p className="text-xs text-gray-500">No cabinets placed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-1.5 pr-2 font-medium">Cabinet Unit</th>
                <th className="py-1.5 pr-2 font-medium">Dimensions (mm)</th>
                <th className="py-1.5 pr-2 text-center font-medium">Qty</th>
                <th className="py-1.5 pr-2 font-medium">Material / Finish</th>
                <th className="py-1.5 pl-2 text-right font-medium">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {bom.lineItems.map((line) => (
                <tr key={line.cabinetId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-800">
                    {formatModuleType(line.moduleType)}
                    {/* The front configuration is what the client is
                        actually choosing between — "600mm base unit"
                        tells them nothing, "600mm, 3 drawers" is the
                        line that costs money. */}
                    <div className="text-[10px] font-normal text-gray-500">
                      {line.frontDescription} · {line.handleDescription}
                    </div>
                    {/* A part with no board line is priced at ₹0 —
                        said out loud here rather than quietly under-
                        quoting (Principle 1). Business-only: this
                        sidebar is never shown to a customer. */}
                    {line.missingBoard && (
                      <div className="text-[10px] font-medium text-red-600">
                        Some board isn't on your rate card — priced ₹0. See the cutting list.
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600">
                    {line.widthMm} × {line.depthMm} × {line.heightMm}
                  </td>
                  <td className="py-1.5 pr-2 text-center text-gray-600">{line.quantity}</td>
                  <td className="py-1.5 pr-2 text-gray-600">
                    {line.material} / {line.finish}
                    {/* Itemised hardware, so a client asking "why does
                        this drawer unit cost more than that door unit"
                        can be shown the answer instead of told it. */}
                    {line.hardwareDetail.length > 0 && (
                      <div className="mt-0.5 flex flex-col text-[10px] text-gray-400">
                        {line.hardwareDetail.map((h) => (
                          <span key={h.label}>
                            {h.label} ×{' '}
                            {Number.isInteger(h.count) ? h.count : `${h.count.toFixed(2)}m`} —{' '}
                            {formatINR(h.cost)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-medium text-gray-800">
                    {formatINR(markup(line.lineTotal - line.unmarkedCost) + line.unmarkedCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.openingLineItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-gray-700">Doors &amp; Windows</h4>
          {/* Listed even at zero cost. An opening that silently vanished
              from the paperwork is how a site argument starts about
              whether a door was in the price — and the deducted area is
              what explains why the wall tiling is less than the room's
              raw dimensions suggest. */}
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {bom.openingLineItems.map((line) => (
                <tr key={line.openingId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-800">
                    {line.description}
                    <div className="text-[10px] font-normal text-gray-500">
                      {line.surface} · deducts {line.deductedSqM.toFixed(2)} m² of tiling
                    </div>
                  </td>
                  <td className="py-1.5 pl-2 text-right text-gray-800">
                    {line.suppliedByUs ? (
                      <span className="font-medium">{formatINR(markup(line.cost))}</span>
                    ) : (
                      <span className="text-[10px] text-gray-500">
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
            <h4 className="text-xs font-semibold text-gray-700">Lighting</h4>
            {/* When electrical isn't charged, the figure it WOULD come
                to is still shown. The business is choosing not to bill
                it, which is different from the work being free, and the
                electrician quoting separately will want the same
                schedule. */}
            {bom.fixtureSubtotal === 0 && bom.fixtureSpecifiedTotal > 0 && (
              <span className="text-[10px] text-gray-400">
                specified only — {formatINR(markup(bom.fixtureSpecifiedTotal))} if charged
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {bom.fixtureLineItems.map((line) => (
                <tr key={line.fixtureId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-800">
                    {line.description}
                    <div className="text-[10px] font-normal text-gray-500">
                      {line.mountDescription} · {line.colorTempK}K
                      {line.note ? ` · ${line.note}` : ''}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-600">
                    {line.unit === 'm' ? `${line.amount.toFixed(2)} m` : `${line.amount} pcs`}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-gray-800">
                    {bom.fixtureSubtotal > 0 ? (
                      <span className="font-medium">{formatINR(markup(line.cost))}</span>
                    ) : (
                      <span className="text-[10px] text-gray-500">by electrician</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.applianceLineItems.length > 0 && (
        <div className="overflow-x-auto border-t border-gray-200 pt-3">
          <h4 className="mb-1.5 text-xs font-semibold text-gray-700">Appliances</h4>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-1.5 pr-2 font-medium">Appliance</th>
                <th className="py-1.5 pr-2 font-medium">Dimensions (mm)</th>
                <th className="py-1.5 pr-2 text-center font-medium">Qty</th>
                <th className="py-1.5 pl-2 text-right font-medium">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {bom.applianceLineItems.map((line) => (
                <tr key={line.applianceId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-800">
                    {formatApplianceType(line.applianceType)}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600">
                    {line.widthMm} × {line.depthMm} × {line.heightMm}
                  </td>
                  <td className="py-1.5 pr-2 text-center text-gray-600">{line.quantity}</td>
                  <td className="py-1.5 pl-2 text-right font-medium text-gray-800">
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
            <h4 className="text-xs font-semibold text-gray-700">Countertop / Slab</h4>
            {/* Same "specified only" treatment as Lighting — in Delhi
                NCR the kitchen business usually doesn't supply the
                slab, the homeowner arranges stone separately, so the
                figure it WOULD come to is still shown even when it
                isn't being charged. */}
            {bom.countertopSubtotal === 0 && bom.countertopSpecifiedTotal > 0 && (
              <span className="text-[10px] text-gray-400">
                specified only — {formatINR(markup(bom.countertopSpecifiedTotal))} if charged
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1.5 pr-2 text-gray-800">
                  {bom.countertopLineItem.finish}
                  <div className="text-[10px] font-normal text-gray-500">
                    {bom.countertopLineItem.areaSqM.toFixed(2)} m²
                  </div>
                </td>
                <td className="py-1.5 pl-2 text-right text-gray-800">
                  {bom.countertopSubtotal > 0 ? (
                    <span className="font-medium">{formatINR(markup(bom.countertopSubtotal))}</span>
                  ) : (
                    <span className="text-[10px] text-gray-500">by homeowner</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-xs text-gray-600">
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

        <div className="mt-1 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
          <span>{view === 'cost' ? 'Total Cost' : 'Grand Total'}</span>
          <span>{formatINR(view === 'cost' ? bom.costGrandTotal : bom.grandTotal)}</span>
        </div>
        {view === 'selling' && (
          <span className="text-[10px] text-gray-400">
            Includes {bom.marginPercent}% margin
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
