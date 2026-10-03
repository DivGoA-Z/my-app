// Tests for pricing (lib/bom.ts). Each figure was verified by hand and by
// a throwaway run when the behaviour was built (docs/DECISIONS.md
// §35-§53); these keep them true (§55). Prices use the app's seeded
// placeholder rates (HDMR 18mm ₹1,400/m², HDMR 6mm ₹450/m², shelf
// supports ₹80…) — change a seed on purpose and these will say so.

import { describe, expect, it } from 'vitest';
import { calculateBOM } from './bom';
import { computeCutList } from './cutList';
import { nestParts } from './nesting';
import { DEFAULT_LABOUR_RATES, defaultRateCard } from '../types/rates';
import { baseUnit, cabinet, construction, layout, lShapedKitchen, pricing } from '../test/fixtures';

const rupees = (n: number) => Math.round(n);

describe('board priced on real area (§42)', () => {
  it('600×600×720 base unit: ₹2,567 of board on 2.11 m²', () => {
    const line = calculateBOM([baseUnit()], [], pricing()).lineItems[0];
    expect(rupees(line.materialCost)).toBe(2567);
    expect(line.materialArea).toBeCloseTo(2.109, 2);
  });
  it('unticking the back removes exactly the back (₹183)', () => {
    const line = calculateBOM([baseUnit({ panels: { back: { included: false } } })], [], pricing()).lineItems[0];
    expect(rupees(line.materialCost)).toBe(2385);
  });
  it('a BWP left side costs only that side more', () => {
    const line = calculateBOM([baseUnit({ panels: { leftSide: { boardId: 'board-bwp-18' } } })], [], pricing()).lineItems[0];
    expect(rupees(line.materialCost)).toBe(2902);
  });
  it('adding a thicker board line never moves an old cabinet (§44)', () => {
    const rates = defaultRateCard();
    const withThicker = { boards: [...rates.boards, { id: 'hdmr-25', material: 'HDMR' as const, thicknessMm: 25, ratePerSqM: 1900 }] };
    const old = calculateBOM([baseUnit()], [], pricing({ rates: withThicker })).lineItems[0];
    expect(rupees(old.materialCost)).toBe(2567);
    const chosen = calculateBOM([baseUnit({ carcassBoardId: 'hdmr-25' })], [], pricing({ rates: withThicker })).lineItems[0];
    expect(rupees(chosen.materialCost)).toBe(3364);
  });
  it('a cabinet with no board line at all is flagged, not silently cheap', () => {
    const rates = defaultRateCard();
    const line = calculateBOM([baseUnit()], [], pricing({ rates: { boards: rates.boards.filter((b) => b.material !== 'HDMR'), defaultBackBoardId: 'none' } })).lineItems[0];
    expect(line.materialCost).toBe(0);
    expect(line.missingBoard).toBe(true);
  });
});

describe('shelves, extra parts and loose parts (§48)', () => {
  it('an extra shelf adds its board (₹439) and supports & fitting (₹80) — once', () => {
    const plain = calculateBOM([baseUnit()], [], pricing()).lineItems[0];
    const shelf = calculateBOM([baseUnit({ panels: { shelves: { extraCount: 1 } } })], [], pricing()).lineItems[0];
    expect(rupees(shelf.materialCost - plain.materialCost)).toBe(439);
    expect(shelf.hardwareCost - plain.hardwareCost).toBe(80);
  });
  it('unticked shelves add nothing, even with an extra count', () => {
    const line = calculateBOM([baseUnit({ panels: { shelves: { extraCount: 1, included: false } } })], [], pricing()).lineItems[0];
    expect(rupees(line.materialCost)).toBe(2567);
  });
  it('a 564×100 stiffener adds ₹79', () => {
    const line = calculateBOM(
      [baseUnit({ extraParts: [{ id: 'e', name: 'Stiffener', lengthMm: 564, widthMm: 100, quantity: 1, edgeLong: 1, edgeShort: 0 }] })],
      [],
      pricing()
    ).lineItems[0];
    expect(rupees(line.materialCost)).toBe(2646);
  });
  it('loose parts are priced inside Material, not on any cabinet line', () => {
    const bom = calculateBOM([baseUnit()], [], pricing({
      layout: layout({ looseParts: [{ id: 'f', name: 'Filler', lengthMm: 720, widthMm: 75, quantity: 2, boardId: 'board-hdmr-18', edgeLong: 1, edgeShort: 0 }] }),
    }));
    expect(rupees(bom.loosePartsCost)).toBe(151);
    expect(rupees(bom.materialSubtotal)).toBe(2567 + 151);
  });
});

describe('drawer boxes are priced (§56)', () => {
  it('a 3-drawer unit pays for its tandem bottoms and backs: +₹1,462 of board', () => {
    const unit = (extra = {}) => cabinet('drawer-unit', 600, 600, 720, { frontLayout: { kind: 'drawers', count: 3 }, ...extra });
    const withBoxes = calculateBOM([unit()], [], pricing()).lineItems[0];
    const bought = calculateBOM([unit({ panels: { drawerBoxes: { included: false } } })], [], pricing()).lineItems[0];
    // 3 × (540×489 bottom + 477×176 back) = 1.044036 m² of 18mm HDMR at
    // ₹1,400 = ₹1,461.65
    expect(rupees(withBoxes.materialCost - bought.materialCost)).toBe(1462);
  });
});

describe('edge banding by the metre (§58)', () => {
  it('₹0 by default — nothing charged until a rate is set', () => {
    expect(calculateBOM([baseUnit()], [], pricing()).edgeBandingSubtotal).toBe(0);
  });
  it('charges the cutting list\'s exact metres × the rate', () => {
    // base unit: sides 2×0.72 = 1.44, front rail 0.564 (back rail none),
    // bottom 0.564, shutter 2×0.714 + 2×0.594 = 2.616 → 5.184 m of edge
    const line = calculateBOM([baseUnit()], [], pricing({ rates: { edgeBandingRatePerM: 10 } })).lineItems[0];
    expect(line.edgeBandingCost).toBeCloseTo(51.84, 2);
  });
});

describe('sheet waste (§53)', () => {
  const kitchen = lShapedKitchen();
  const l = layout({ sheetWasteFactor: 1.45 });

  it('calculated mode prices board at exactly what the sheets cost', () => {
    const bom = calculateBOM(kitchen, [], pricing({ rates: { wasteMode: 'calculated' }, layout: l }));
    const rates = defaultRateCard();
    const cl = computeCutList(kitchen, construction(), [], rates, []);
    const sheetCost = cl.groups.reduce((t, g) => {
      const r = nestParts(g.parts, [{ lengthMm: 2440, widthMm: 1220 }], { kerfMm: 4, trimMm: 10 });
      return t + r.sheetsAreaSqM * g.parts[0].ratePerSqM;
    }, 0);
    expect(rupees(bom.materialSubtotal)).toBe(rupees(sheetCost));
    expect(bom.wasteMode).toBe('calculated');
    expect(bom.boardWasteFactors.find((w) => w.boardId === 'board-hdmr-6')!.factor).toBeCloseTo(1.8, 1);
  });
  it('approx mode uses the one factor everywhere', () => {
    const bom = calculateBOM(kitchen, [], pricing({ layout: l }));
    const noWaste = calculateBOM(kitchen, [], pricing({ layout: layout({ sheetWasteFactor: undefined }) }));
    expect(bom.wasteMode).toBe('approx');
    expect(bom.materialSubtotal).toBeCloseTo(noWaste.materialSubtotal * 1.45, 6);
  });
});

describe('charges and margin (§38-§40)', () => {
  it('labour rows price as before: 150/sq ft × area + 2,500 per cabinet', () => {
    const line = calculateBOM([baseUnit()], [], pricing()).lineItems[0];
    expect(line.othersCost).toBeCloseTo(150 * line.areaSqFt + 2500, 6);
  });
  it('a business lump sum is charged once per project, inside the marked-up cost', () => {
    const rates = { othersRates: [...DEFAULT_LABOUR_RATES, { id: 'd', label: 'Delivery', rate: 2000, basis: 'lumpsum' as const, showOnQuote: false, applyMargin: true }] };
    const two = calculateBOM([baseUnit(), baseUnit()], [], pricing({ rates, layout: layout() }));
    expect(two.othersSubtotal).toBe(2000);
  });
  it('a fixed-price row is never marked up, and lines still sum to the grand total', () => {
    const l = layout({
      marginPercent: 25,
      chargeRates: [{ id: 'x', label: 'Extra service', rate: 20000, basis: 'lumpsum', showOnQuote: true, applyMargin: false }],
    });
    const bom = calculateBOM([baseUnit()], [], pricing({ layout: l }));
    expect(bom.unmarkedTotal).toBe(20000);
    expect(bom.marginAmount).toBeCloseTo((bom.costGrandTotal - 20000) * 0.25, 6);
    expect(bom.grandTotal).toBeCloseTo(bom.costGrandTotal + bom.marginAmount, 6);
    expect(bom.shownOtherLines.find((c) => c.label === 'Extra service')).toMatchObject({ amount: 20000, applyMargin: false });
  });
});
