// src/components/cutlist/SheetLayoutView.tsx
//
// The Cutting List page's "Sheets" view (§49): every board's parts laid
// out on whole sheets by lib/nesting.ts, a drawing of each sheet, and
// the MEASURED waste per board line. An add-on (Principle 12): nothing
// on this page changes a quote by itself.
//
// Waste is shown PER BOARD LINE (§53): sheet area bought ÷ part area,
// every sheet counted in full, the last one included (§51). Whether a
// quote uses these is the rate card's "Sheet waste on quotes" switch —
// Calculated uses them automatically; Approx keeps the one typed factor.

import { useMemo } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import type { CutList } from '../../lib/cutList';
import { nestParts, type CutSpec } from '../../lib/nesting';
import { boardSheetSizes } from '../../types/rates';
import { SheetDrawing } from './SheetDrawing';

export function SheetLayoutView({ cutList }: { cutList: CutList }) {
  const settings = useLayoutStore((s) => s.constructionSettings);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const businessWaste = useLayoutStore((s) => s.rateCard.sheetWasteFactor);
  const wasteMode = useLayoutStore((s) => s.rateCard.wasteMode);

  const boards = useLayoutStore((s) => s.rateCard.boards);
  const cut: CutSpec = useMemo(
    () => ({ kerfMm: settings.kerfMm, trimMm: settings.sheetTrimMm }),
    [settings.kerfMm, settings.sheetTrimMm]
  );

  // One nesting run per board group (same groups as the cutting list —
  // each is physically its own stack of sheets), on the sizes THAT board
  // is bought in (BoardRate.sheetSizes, §52).
  const nested = useMemo(
    () =>
      cutList.groups.map((g) => {
        const board = boards.find((b) => b.id === g.parts[0]?.boardId);
        const sizes = boardSheetSizes(board);
        return { group: g, sizes, result: nestParts(g.parts, sizes, cut) };
      }),
    [cutList, boards, cut]
  );

  const totals = nested.reduce(
    (t, { result }) => ({
      sheets: t.sheets + result.sheets.length,
      parts: t.parts + result.partsAreaSqM,
      bought: t.bought + result.sheetsAreaSqM,
      unplaced: t.unplaced + result.unplaced.length,
    }),
    { sheets: 0, parts: 0, bought: 0, unplaced: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const factor = totals.parts > 0 ? round2(totals.bought / totals.parts) : 1;
  const current = currentLayout?.sheetWasteFactor ?? businessWaste;
  // Measured factor per BOARD LINE — its carcass and front groups
  // combined — the same figure calculated mode prices with
  // (lib/nesting.ts's measuredBoardWaste combines groups the same way).
  const perBoard = new Map<string, { label: string; parts: number; bought: number }>();
  for (const { group, result } of nested) {
    const id = group.parts[0]?.boardId;
    if (!id) continue;
    const prev = perBoard.get(id) ?? { label: group.parts[0].boardName, parts: 0, bought: 0 };
    perBoard.set(id, { ...prev, parts: prev.parts + result.partsAreaSqM, bought: prev.bought + result.sheetsAreaSqM });
  }


  if (cutList.parts.length === 0) {
    return <p className="text-xs text-gray-500">Nothing to lay out yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="px-2 py-1.5 font-medium">Board</th>
              <th className="px-2 py-1.5 text-right font-medium">Pieces</th>
              <th className="px-2 py-1.5 text-right font-medium">Sheets</th>
              <th className="px-2 py-1.5 text-right font-medium">Parts (m²)</th>
              <th className="px-2 py-1.5 text-right font-medium">Sheets (m²)</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Share of the sheets bought that doesn't end up in a part — every sheet counted in full">
                Waste
              </th>
            </tr>
          </thead>
          <tbody>
            {nested.map(({ group, result }) => (
              <tr key={group.key} className="border-b border-gray-100">
                <td className="px-2 py-1 text-gray-800">{group.label}</td>
                <td className="px-2 py-1 text-right tabular-nums">{group.pieceCount}</td>
                <td className="px-2 py-1 text-right tabular-nums">{result.sheets.length}</td>
                <td className="px-2 py-1 text-right tabular-nums">{result.partsAreaSqM.toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{result.sheetsAreaSqM.toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{result.wastePercent.toFixed(0)}%</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-2 py-1">Total</td>
              <td />
              <td className="px-2 py-1 text-right tabular-nums">{totals.sheets}</td>
              <td className="px-2 py-1 text-right tabular-nums">{totals.parts.toFixed(2)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{totals.bought.toFixed(2)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {totals.bought > 0 ? ((1 - totals.parts / totals.bought) * 100).toFixed(0) : 0}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {totals.unplaced > 0 && (
        <p className="text-xs font-medium text-red-600">
          {totals.unplaced} piece{totals.unplaced === 1 ? '' : 's'} won't fit on any size its board
          is bought in — add a larger sheet size to that board on the rate card, or split the part.
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 text-xs text-gray-700">
        <span className="font-medium">Waste measured from these layouts, per board</span>
        <span className="text-[11px] text-gray-500">
          Sheet area bought ÷ area of parts, every sheet counted in full — how much of each board
          this job buys for every 1 m² that ends up in cabinets.
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {[...perBoard.values()].map((w) => (
            <span key={w.label}>
              {w.label}: <strong className="font-semibold">×{(w.bought / w.parts).toFixed(2)}</strong>
            </span>
          ))}
          <span className="text-gray-500">(all boards together ×{factor})</span>
        </div>
        {/* No "use this" button any more (§53): calculated waste is a
            business-wide switch on the rate card, and when it's on, every
            quote uses these per-board figures automatically. */}
        <span className={`text-[11px] ${wasteMode === 'calculated' ? 'text-emerald-700' : 'text-gray-500'}`}>
          {wasteMode === 'calculated'
            ? "This project's quote uses these per-board figures automatically (Sheet waste on quotes: Calculated)."
            : `Quotes use the approx factor ×${current} now. To price on these measured per-board figures instead, set "Sheet waste on quotes" to Calculated on the rate card (Manage Inventory → Boards).`}
        </span>
        <span className="text-[10px] text-gray-400">
          Layouts come from a standard sheet-packing method (guillotine cuts a panel saw can
          follow): good, not guaranteed best. Compare with your carpenter's actual sheet count.
        </span>
      </div>

      {nested.map(({ group, sizes, result }) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-gray-800">
            {group.label} — {result.sheets.length} sheet{result.sheets.length === 1 ? '' : 's'}
            <span className="ml-2 font-normal text-gray-500">
              bought in {sizes.map((z) => `${z.lengthMm}×${z.widthMm}`).join(' or ')}
            </span>
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {result.sheets.map((_, i) => (
              <SheetDrawing key={i} result={result} index={i} trimMm={cut.trimMm} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
