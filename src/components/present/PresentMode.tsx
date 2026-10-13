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
import { ArrowLeft, ChevronDown, IndianRupee, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useElementSize } from '../editor/useElementSize';
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
  const { measure, width, height } = useElementSize<HTMLDivElement>();
  const size = { maxWidthPx: Math.max(320, width), maxHeightPx: Math.max(280, height) };

  // Cost -> selling, same formula and same rows QuoteSidebar's own
  // Selling view uses (docs/DECISIONS.md §15) — so this breakdown sums
  // to exactly grandTotal, with no separate "Margin" line to reconcile
  // against. Unlike QuoteSidebar, there is no Cost view here at all:
  // Present mode never shows cost or margin, only what the customer is
  // actually charged (Principle 1).
  const sell = (value: number) => value * (1 + bom.marginPercent / 100);

  // §89: the editor's frame. The view fills the screen and the price
  // opens as a panel on the right, like the editor's quote panel. It
  // used to appear as a card above the view and push the whole layout
  // down when revealed.
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="relative z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:gap-3 md:px-4">
        <Button variant="outline" size="touch" onClick={onExit}>
          <ArrowLeft /> <span className="hidden sm:inline">Back to design</span>
        </Button>
        <div className="flex flex-1 justify-center">
          <div role="tablist" aria-label="View" className="flex rounded-xl bg-secondary p-1">
            {(
              [
                ['3d', '3D walkthrough'],
                ['plan', 'Floor plan'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={subView === v}
                onClick={() => setSubView(v)}
                className={cn(
                  'h-9 rounded-[9px] px-3 text-sm font-semibold md:px-4',
                  subView === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Button
          variant={showPrice ? 'secondary' : 'outline'}
          size="touch"
          aria-pressed={showPrice}
          onClick={() => setShowPrice((v) => !v)}
        >
          <IndianRupee /> <span className="hidden sm:inline">{showPrice ? 'Hide price' : 'Reveal price'}</span>
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          {subView === '3d' ? (
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <Room3DCanvas widthMm={widthMm} depthMm={depthMm} inspectorOverlay />
            </div>
          ) : (
            <div ref={measure} className="pointer-events-none relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {width > 0 && (
                <RoomCanvas widthMm={widthMm} depthMm={depthMm} {...size}>
                  <CabinetLayer
                    widthMm={widthMm}
                    depthMm={depthMm}
                    {...size}
                    showDimensions={false}
                    showOverlapWarnings={false}
                    showClearanceWarnings={false}
                  />
                  <ObstacleLayer widthMm={widthMm} depthMm={depthMm} {...size} />
                  <ApplianceLayer widthMm={widthMm} depthMm={depthMm} {...size} showOverlapWarnings={false} />
                  <OpeningLayer widthMm={widthMm} depthMm={depthMm} {...size} />
                  <FixtureLayer widthMm={widthMm} depthMm={depthMm} {...size} />
                </RoomCanvas>
              )}
            </div>
          )}
        </main>

        {showPrice && (
          <aside
            aria-label="Price"
            className="absolute inset-y-0 right-0 z-20 flex w-[360px] max-w-full flex-col overflow-y-auto border-l border-border bg-card shadow-float xl:static xl:shadow-none"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-4 py-2">
              <span className="text-[17px] font-semibold">Price</span>
              <Button variant="ghost" size="icon-touch" aria-label="Hide price" onClick={() => setShowPrice(false)}>
                <X />
              </Button>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-muted-foreground">Total</span>
                <span className="text-[34px] font-semibold leading-none tabular-nums">{INR_FORMATTER.format(bom.grandTotal)}</span>
              </div>
              <button
                type="button"
                aria-expanded={showBreakdown}
                onClick={() => setShowBreakdown((v) => !v)}
                className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold hover:bg-secondary"
              >
                Price breakdown
                <ChevronDown className={cn('size-4 transition-transform', showBreakdown && 'rotate-180')} />
              </button>
              {showBreakdown && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
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

              {/* §130: the lines add up to the subtotal; the discount comes off it. */}
              {(bom.discountAmount ?? 0) > 0 && (
                <>
                  <div className="mt-1 flex justify-between border-t border-border pt-2">
                    <span>Subtotal</span>
                    <span>{INR_FORMATTER.format(bom.subtotalBeforeDiscount ?? bom.grandTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{bom.discount?.kind === 'percent' ? `Discount (${bom.discount.value}%)` : 'Discount'}</span>
                    <span>− {INR_FORMATTER.format(bom.discountAmount ?? 0)}</span>
                  </div>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold text-foreground">
                <span>Grand Total</span>
                <span>{INR_FORMATTER.format(bom.grandTotal)}</span>
              </div>
            </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
