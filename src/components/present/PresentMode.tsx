// src/components/present/PresentMode.tsx
//
// The customer-facing screen (Principle 8: "two audiences, two
// views" — docs/PRINCIPLES.md). No grid, no dimension labels, no
// overlap/clearance/kitchen-check banners, no inspectors, no
// toolbars. Two sub-views: the 3D walkthrough (Room3DCanvas, exactly
// what the designer's own "3D Preview" already renders — orbit +
// click-a-camera-node, no editing capability exists there to begin
// with) and a stripped floor plan (RoomCanvas + the item layers only,
// dimensions/warnings forced off). The floor plan is wrapped in
// `pointer-events-none` rather than threading a new read-only prop
// through 5 layer components — a stray click during a live
// presentation can't drag a cabinet, and this is a screen to WALK a
// customer through, not to edit from.
//
// Price is hidden by default and revealed only when the designer taps
// "Reveal Price" — Principle 8's "reveals price when the designer
// chooses" — reusing useBOM()'s grandTotal, the exact number the PDF/
// WhatsApp quote already shows a customer (never the cost-basis view
// QuoteSidebar's Cost/Selling toggle can switch to).
//
// The reveal has its own further disclosure: a "View price breakdown"
// toggle showing the same category subtotals QuoteSidebar's Selling
// view shows (Material, Finish, Floor/walls/ceiling, Hardware, Labour,
// Fabrication, Glass doors, Appliances, ...), each already marked up
// from cost via the SAME formula QuoteSidebar uses, so the rows sum to
// grandTotal exactly. There is no Cost view here at all, unlike
// QuoteSidebar — Present mode shows a customer only what they're
// charged, never a margin or a cost figure.

import { useState } from 'react';
import { RoomCanvas } from '../canvas/RoomCanvas';
import { CabinetLayer } from '../canvas/CabinetLayer';
import { ObstacleLayer } from '../canvas/ObstacleLayer';
import { ApplianceLayer } from '../canvas/ApplianceLayer';
import { OpeningLayer } from '../canvas/OpeningLayer';
import { FixtureLayer } from '../canvas/FixtureLayer';
import { Room3DCanvas } from '../canvas3d/Room3DCanvas';
import { useBOM } from '../../hooks/useBOM';
import { Button } from '../ui/button';

// Same formatting as QuoteSidebar's own formatINR — kept local rather
// than shared, matching how quotePdf.ts already has its own separate
// INR formatter for its own display context.
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

interface PresentModeProps {
  widthMm: number;
  depthMm: number;
  onExit: () => void;
}

export function PresentMode({ widthMm, depthMm, onExit }: PresentModeProps) {
  const [subView, setSubView] = useState<'3d' | 'plan'>('3d');
  const [showPrice, setShowPrice] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const bom = useBOM();

  // Cost -> selling, same formula and same rows QuoteSidebar's own
  // Selling view uses (docs/DECISIONS.md §15) — so this breakdown sums
  // to exactly grandTotal, with no separate "Margin" line to reconcile
  // against. Unlike QuoteSidebar, there is no Cost view here at all:
  // Present mode never shows cost or margin, only what the customer is
  // actually charged (Principle 1).
  const sell = (value: number) => value * (1 + bom.marginPercent / 100);

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExit}>
          ← Exit Present Mode
        </Button>

        <div className="ml-4 flex items-center gap-1">
          <Button
            variant={subView === '3d' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSubView('3d')}
          >
            3D Walkthrough
          </Button>
          <Button
            variant={subView === 'plan' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSubView('plan')}
          >
            Floor Plan
          </Button>
        </div>

        <Button
          variant={showPrice ? 'default' : 'outline'}
          size="sm"
          className="ml-auto"
          onClick={() => setShowPrice((v) => !v)}
        >
          {showPrice ? 'Hide Price' : 'Reveal Price'}
        </Button>
      </div>

      {showPrice && (
        <div className="flex w-fit flex-col items-center gap-3 self-center rounded-lg border border-gray-200 bg-white px-8 py-5 shadow-sm">
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-gray-500">Total</span>
            <span className="text-3xl font-semibold text-gray-800">
              {INR_FORMATTER.format(bom.grandTotal)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
          >
            {showBreakdown ? 'Hide price breakdown ▴' : 'View price breakdown ▾'}
          </button>

          {showBreakdown && (
            <div className="flex w-56 flex-col gap-1 border-t border-gray-200 pt-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Material</span>
                <span>{INR_FORMATTER.format(sell(bom.materialSubtotal))}</span>
              </div>
              <div className="flex justify-between">
                <span>Finish</span>
                <span>{INR_FORMATTER.format(sell(bom.finishSubtotal))}</span>
              </div>
              {bom.surfaceSubtotal > 0 && (
                <div className="flex justify-between">
                  <span>Floor / walls / ceiling</span>
                  <span>{INR_FORMATTER.format(sell(bom.surfaceSubtotal))}</span>
                </div>
              )}
              {bom.countertopSubtotal > 0 && (
                <div className="flex justify-between">
                  <span>Countertop / slab</span>
                  <span>{INR_FORMATTER.format(sell(bom.countertopSubtotal))}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Hardware</span>
                <span>{INR_FORMATTER.format(sell(bom.hardwareSubtotal))}</span>
              </div>
              {/* Charge rows ticked "show on quote" — see
                  BOMSummary.shownOtherLines. Marked up unless fixed-price. */}
              {bom.shownOtherLines.map((c, i) => (
                <div key={`shown-${i}`} className="flex justify-between">
                  <span>{c.label}</span>
                  <span>
                    {INR_FORMATTER.format(c.applyMargin === false ? c.amount : sell(c.amount))}
                  </span>
                </div>
              ))}
              {/* Fixed-price rows (applyMargin false) are already selling
                  prices — added after sell(), never through it. */}
              {bom.othersSubtotal + bom.othersUnmarkedSubtotal > 0 && (
                <div className="flex justify-between">
                  <span>Other</span>
                  <span>
                    {INR_FORMATTER.format(sell(bom.othersSubtotal) + bom.othersUnmarkedSubtotal)}
                  </span>
                </div>
              )}
              {bom.edgeBandingSubtotal > 0 && (
                <div className="flex justify-between">
                  <span>Edge banding</span>
                  <span>{INR_FORMATTER.format(sell(bom.edgeBandingSubtotal))}</span>
                </div>
              )}
              {bom.glassSubtotal > 0 && (
                <div className="flex justify-between">
                  <span>Glass doors</span>
                  <span>{INR_FORMATTER.format(sell(bom.glassSubtotal))}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Appliances</span>
                <span>{INR_FORMATTER.format(sell(bom.applianceSubtotal))}</span>
              </div>

              <div className="mt-1 flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-800">
                <span>Grand Total</span>
                <span>{INR_FORMATTER.format(bom.grandTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {subView === '3d' ? (
        <Room3DCanvas widthMm={widthMm} depthMm={depthMm} />
      ) : (
        <div className="pointer-events-none">
          <RoomCanvas widthMm={widthMm} depthMm={depthMm}>
            <CabinetLayer
              widthMm={widthMm}
              depthMm={depthMm}
              showDimensions={false}
              showOverlapWarnings={false}
              showClearanceWarnings={false}
            />
            <ObstacleLayer widthMm={widthMm} depthMm={depthMm} />
            <ApplianceLayer widthMm={widthMm} depthMm={depthMm} showOverlapWarnings={false} />
            <OpeningLayer widthMm={widthMm} depthMm={depthMm} />
            <FixtureLayer widthMm={widthMm} depthMm={depthMm} />
          </RoomCanvas>
        </div>
      )}
    </div>
  );
}
