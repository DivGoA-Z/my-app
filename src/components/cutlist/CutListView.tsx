// src/components/cutlist/CutListView.tsx
//
// The project's cutting list, for the workshop. Pure consumer of
// lib/cutList.ts — no sizing logic lives here, same rule QuoteSidebar
// follows for pricing, so the screen and the Excel export can never
// disagree about a part.
//
// Two views of the same parts:
//   - "For cutting": identical parts merged (same board, size, banding),
//     which is how a saw operator works through a sheet.
//   - "By cabinet": every part under the cabinet it belongs to, which is
//     how an assembler checks a box is complete.
// The export carries both, so choosing one on screen loses nothing.

import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { useLayoutStore } from '../../store/layoutStore';
import {
  computeCutList,
  consolidateParts,
  describeEdgeBanding,
  groupKey,
  type CutList,
} from '../../lib/cutList';
import { buildWorkbookBlob } from '../../lib/importExport/xlsxHelpers';
import { downloadBlob } from '../../lib/downloadBlob';
import { ExtraPartsEditor } from '../common/ExtraPartsEditor';
import { SheetLayoutView } from './SheetLayoutView';
import { nestParts } from '../../lib/nesting';
import { boardSheetSizes, type BoardRate } from '../../types/rates';
import {
  BACK_FIT_LABELS,
  BOTTOM_FIT_LABELS,
  DEPTH_CONVENTION_LABELS,
  FRONTS_FROM_LABELS,
  TOP_FIT_LABELS,
  type ConstructionSettings,
} from '../../types/construction';

// 'sheets': the parts laid out on whole sheets, with measured waste (§49).
type Mode = 'cutting' | 'cabinet' | 'sheets';

function settingsRows(s: ConstructionSettings): Record<string, string | number>[] {
  return [
    { Setting: 'Status', Value: s.confirmed ? 'Confirmed by carpenter' : 'ASSUMED — not yet confirmed' },
    { Setting: 'Cabinet depth means', Value: DEPTH_CONVENTION_LABELS[s.depthIncludesFront ? 'includes-front' : 'carcass-only'] },
    { Setting: 'Carcass bottom', Value: BOTTOM_FIT_LABELS[s.bottomFit] },
    { Setting: 'Carcass top (full top panels)', Value: TOP_FIT_LABELS[s.topFit] },
    { Setting: 'Back panel', Value: BACK_FIT_LABELS[s.backFit] },
    { Setting: 'Groove depth (mm)', Value: s.backFit === 'grooved' ? s.grooveDepthMm : '—' },
    { Setting: 'Rail width (mm)', Value: s.railWidthMm },
    { Setting: 'Fronts cut from', Value: FRONTS_FROM_LABELS[s.frontsFrom] },
    { Setting: 'Shelf setback (mm)', Value: s.shelfSetbackMm },
  ];
}

function exportWorkbook(
  cutList: CutList,
  settings: ConstructionSettings,
  boards: BoardRate[],
  projectName: string
) {
  // Same key computeCutList grouped by, so a part's "Board" cell always
  // names the group it's listed under on screen.
  const byBoard = new Map(cutList.groups.map((g) => [g.key, g.label]));
  const boardOf = (p: CutList['parts'][number]) => byBoard.get(groupKey(p)) ?? p.boardName;

  const cuttingHeaders = ['Board', 'Part', 'Length (mm)', 'Width (mm)', 'Qty', 'Edge banding', 'Grain', 'Cabinets'];
  const cuttingRows = cutList.groups.flatMap((g) =>
    consolidateParts(g.parts).map((p) => ({
      Board: g.label,
      Part: p.name,
      'Length (mm)': p.lengthMm,
      'Width (mm)': p.widthMm,
      Qty: p.quantity,
      'Edge banding': describeEdgeBanding(p.edgeBanding),
      Grain: p.grainFixed ? 'Along length' : 'Any',
      Cabinets: p.cabinetRefs.join(', '),
    }))
  );

  const cabinetHeaders = ['Cabinet', 'Cabinet size', 'Part', 'Board', 'Length (mm)', 'Width (mm)', 'Qty', 'Edge banding', 'Grain'];
  const cabinetRows = cutList.parts.map((p) => ({
    Cabinet: p.cabinetRef,
    'Cabinet size': p.cabinetLabel,
    Part: p.name,
    Board: boardOf(p),
    'Length (mm)': p.lengthMm,
    'Width (mm)': p.widthMm,
    Qty: p.quantity,
    'Edge banding': describeEdgeBanding(p.edgeBanding),
    Grain: p.grainFixed ? 'Along length' : 'Any',
  }));

  const summaryHeaders = ['Board', 'Pieces', 'Area (m²)', 'Edge banding (m)'];
  const summaryRows = cutList.groups.map((g) => ({
    Board: g.label,
    Pieces: g.pieceCount,
    'Area (m²)': Number(g.areaSqM.toFixed(3)),
    'Edge banding (m)': Number(g.edgeBandM.toFixed(2)),
  }));

  const notes = [
    ...(settings.confirmed ? [] : ['Built on ASSUMED construction settings — confirm with your carpenter before cutting.']),
    'Edge banding: "2L 1W" = both long edges and one short edge banded.',
    'Grain "Along length": the part\'s length must run along the board\'s grain — do not rotate.',
    ...cutList.warnings,
  ].map((Note) => ({ Note }));

  // Where every piece goes on which sheet (§49), so the saw operator can
  // follow the same layout the Sheets view draws. x/y measured from the
  // sheet's corner, x along its length (the grain).
  const cut = { kerfMm: settings.kerfMm, trimMm: settings.sheetTrimMm };
  const layoutHeaders = ['Board', 'Sheet', 'Sheet size (mm)', 'Part', 'Cabinet', 'Length (mm)', 'Width (mm)', 'Turned', 'X from corner (mm)', 'Y from corner (mm)'];
  const layoutRows = cutList.groups.flatMap((g) =>
    nestParts(g.parts, boardSheetSizes(boards.find((b) => b.id === g.parts[0]?.boardId)), cut).sheets.flatMap((sh, i) =>
      sh.pieces.map((pc) => ({
        Board: g.label,
        Sheet: i + 1,
        'Sheet size (mm)': `${sh.lengthMm} × ${sh.widthMm}`,
        Part: pc.part.name,
        Cabinet: pc.part.cabinetRef,
        'Length (mm)': pc.part.lengthMm,
        'Width (mm)': pc.part.widthMm,
        Turned: pc.rotated ? 'Yes' : '',
        'X from corner (mm)': Math.round(pc.x),
        'Y from corner (mm)': Math.round(pc.y),
      }))
    )
  );

  const blob = buildWorkbookBlob([
    { name: 'Cutting list', headers: cuttingHeaders, rows: cuttingRows },
    { name: 'By cabinet', headers: cabinetHeaders, rows: cabinetRows },
    { name: 'Summary', headers: summaryHeaders, rows: summaryRows },
    { name: 'Sheet layout', headers: layoutHeaders, rows: layoutRows },
    { name: 'Construction', headers: ['Setting', 'Value'], rows: settingsRows(settings) },
    { name: 'Notes', headers: ['Note'], rows: notes },
  ]);
  const safeName = projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'project';
  downloadBlob(blob, `cutting-list-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function CutListView({
  onClose,
  onOpenWorkshop,
  onOpenDesigner,
}: {
  onClose: () => void;
  onOpenWorkshop: () => void;
  // "This part is wrong" → one click to the cabinet it comes from (§48).
  // The list itself is never edited directly: it's derived from the
  // design, and the same parts set the price.
  onOpenDesigner: (cabinetId: string) => void;
}) {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const looseParts = useLayoutStore((s) => s.currentLayout?.looseParts);
  const setLooseParts = useLayoutStore((s) => s.setLooseParts);
  const finishes = useLayoutStore((s) => s.finishes);
  const settings = useLayoutStore((s) => s.constructionSettings);
  const rateCard = useLayoutStore((s) => s.rateCard);
  const currentProject = useLayoutStore((s) => s.currentProject);
  const [mode, setMode] = useState<Mode>('cutting');

  const cutList = useMemo(
    () => computeCutList(cabinets, settings, finishes, rateCard, looseParts ?? []),
    [cabinets, settings, finishes, rateCard, looseParts]
  );

  // Cabinet ref ("C3") → its id, so a ref on any row can open that
  // cabinet in the Designer. Loose parts have no cabinet.
  const idByRef = new Map(cutList.parts.filter((p) => p.cabinetId).map((p) => [p.cabinetRef, p.cabinetId]));
  const refLink = (ref: string, title?: string) => {
    const id = idByRef.get(ref);
    if (!id) return <span key={ref} title={title}>{ref}</span>;
    return (
      <button
        key={ref}
        type="button"
        title={title ? `${title} — open in the Cabinet Designer` : 'Open in the Cabinet Designer'}
        className="text-blue-700 underline-offset-2 hover:underline"
        onClick={() => onOpenDesigner(id)}
      >
        {ref}
      </button>
    );
  };

  const totalPieces = cutList.groups.reduce((n, g) => n + g.pieceCount, 0);

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          ← Back to 2D
        </Button>
        <h2 className="text-sm font-semibold text-gray-800">
          Cutting list{currentProject ? ` — ${currentProject.clientName}` : ''}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === 'cutting' ? 'secondary' : 'ghost'}
            onClick={() => setMode('cutting')}
          >
            For cutting
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'cabinet' ? 'secondary' : 'ghost'}
            onClick={() => setMode('cabinet')}
          >
            By cabinet
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'sheets' ? 'secondary' : 'ghost'}
            onClick={() => setMode('sheets')}
          >
            Sheets & waste
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={cutList.parts.length === 0}
            onClick={() => exportWorkbook(cutList, settings, rateCard.boards, currentProject?.clientName ?? '')}
          >
            Export to Excel
          </Button>
        </div>
      </div>

      {!settings.confirmed && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-900">
            <strong className="font-semibold">Built on assumed construction.</strong> Part sizes
            follow the default workshop convention (top and bottom between the sides, grooved
            back). Confirm or change it with your carpenter in{' '}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 align-baseline text-amber-900 underline"
              onClick={onOpenWorkshop}
            >
              Workshop settings
            </Button>{' '}
            before anything is cut.
          </AlertDescription>
        </Alert>
      )}

      {mode === 'sheets' ? (
        <SheetLayoutView cutList={cutList} />
      ) : cutList.parts.length === 0 ? (
        <p className="text-xs text-gray-500">No cabinets placed yet.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {totalPieces} pieces from {cabinets.length} cabinet{cabinets.length === 1 ? '' : 's'}.
            Sizes in mm, length × width. Edge banding "2L 1W" means both long edges and one short
            edge. <strong>Grain</strong> parts must not be rotated on the sheet.
          </p>

          {cutList.groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-xs font-semibold text-gray-800">{g.label}</h3>
                <span className="text-[11px] text-gray-500">
                  {g.pieceCount} pieces · {g.areaSqM.toFixed(2)} m² · {g.edgeBandM.toFixed(1)} m edge
                  banding
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                      {mode === 'cabinet' && <th className="px-2 py-1.5 font-medium">Cabinet</th>}
                      <th className="px-2 py-1.5 font-medium">Part</th>
                      <th className="px-2 py-1.5 text-right font-medium">Length</th>
                      <th className="px-2 py-1.5 text-right font-medium">Width</th>
                      <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-2 py-1.5 font-medium">Edge</th>
                      <th className="px-2 py-1.5 font-medium">Grain</th>
                      {mode === 'cutting' && <th className="px-2 py-1.5 font-medium">Cabinets</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {mode === 'cutting'
                      ? consolidateParts(g.parts).map((p, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="px-2 py-1 text-gray-800">{p.name}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.lengthMm}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.widthMm}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.quantity}</td>
                            <td className="px-2 py-1">{describeEdgeBanding(p.edgeBanding)}</td>
                            <td className="px-2 py-1">{p.grainFixed ? 'Grain' : ''}</td>
                            <td className="px-2 py-1 text-gray-500">
                              {p.cabinetRefs.map((ref, k) => (
                                <span key={ref}>
                                  {k > 0 ? ', ' : ''}
                                  {refLink(ref)}
                                </span>
                              ))}
                            </td>
                          </tr>
                        ))
                      : g.parts.map((p, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="px-2 py-1 text-gray-500">{refLink(p.cabinetRef, p.cabinetLabel)}</td>
                            <td className="px-2 py-1 text-gray-800">{p.name}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.lengthMm}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.widthMm}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.quantity}</td>
                            <td className="px-2 py-1">{describeEdgeBanding(p.edgeBanding)}</td>
                            <td className="px-2 py-1">{p.grainFixed ? 'Grain' : ''}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {cutList.warnings.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-gray-200 p-3">
              <h3 className="text-xs font-semibold text-gray-700">Not on this list</h3>
              <ul className="list-disc pl-4 text-[11px] text-gray-600">
                {cutList.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Loose parts — board pieces that don't belong to any one cabinet
          (§48). Saved with the project, listed above under their board,
          and priced inside Material like any panel. */}
      <section className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-800">Loose parts (not part of any cabinet)</h3>
          <p className="text-[11px] text-gray-500">
            Fillers, a plinth or skirting, end panels. Each is cut, listed above under its board,
            and charged on the quote like any panel — real area × the board's rate. To change a
            cabinet's own parts, click its C-number above.
          </p>
        </div>
        <ExtraPartsEditor
          parts={looseParts ?? []}
          onChange={setLooseParts}
          requireBoard
          namePlaceholder="e.g. Filler, left wall"
        />
      </section>
    </div>
  );
}
