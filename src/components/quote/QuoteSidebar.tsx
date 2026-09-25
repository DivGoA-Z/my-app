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

import { useBOM } from '../../hooks/useBOM';
import { APPLIANCE_TYPE_LABELS } from '../../types/appliance';
import type { ApplianceType } from '../../types/appliance';
import { QuoteFreezePanel } from './QuoteFreezePanel';

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

export function QuoteSidebar() {
  const bom = useBOM();

  return (
    <aside className="w-96 shrink-0 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-sm text-gray-700">Quote Summary</h3>

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
                    {formatINR(line.lineTotal)}
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
                      <span className="font-medium">{formatINR(line.cost)}</span>
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
                specified only — {formatINR(bom.fixtureSpecifiedTotal)} if charged
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
                      <span className="font-medium">{formatINR(line.cost)}</span>
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
                    {formatINR(line.lineTotal)}
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
                specified only — {formatINR(bom.countertopSpecifiedTotal)} if charged
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
                    <span className="font-medium">{formatINR(bom.countertopSubtotal)}</span>
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
          <span>{formatINR(bom.materialSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Finish</span>
          <span>{formatINR(bom.finishSubtotal)}</span>
        </div>
        {bom.surfaceSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Floor / walls / ceiling</span>
            <span>{formatINR(bom.surfaceSubtotal)}</span>
          </div>
        )}
        {bom.countertopSubtotal > 0 && (
          <div className="flex justify-between">
            <span>Countertop / slab</span>
            <span>{formatINR(bom.countertopSubtotal)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Hardware</span>
          <span>{formatINR(bom.hardwareSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Labor</span>
          <span>{formatINR(bom.laborSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Appliances</span>
          <span>{formatINR(bom.applianceSubtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
          <span>Grand Total</span>
          <span>{formatINR(bom.grandTotal)}</span>
        </div>
      </div>

      {/* Kept as its OWN component (QuoteFreezePanel's own header
          comment explains why: this is the one part of the sidebar
          that writes), but rendered here so it visually sits where its
          own comment says it should — at the bottom of the quote
          sidebar. It was built but never actually composed in here
          before now, which is why Freeze/Download/Share never
          appeared. */}
      <QuoteFreezePanel />
    </aside>
  );
}
