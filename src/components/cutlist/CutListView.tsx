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

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { AlertTriangle, ArrowLeft, Download, GlassWater, Layers, PlusSquare, Snowflake } from 'lucide-react';
import { SectionCard } from '../common/SectionCard';
import { useLayoutStore } from '../../store/layoutStore';
import {
  computeCutList,
  thawCutList,
  consolidateParts,
  describeEdgeBanding,
  groupKey,
  type CutList,
} from '../../lib/cutList';
import { buildWorkbookBlob } from '../../lib/importExport/xlsxHelpers';
import { downloadBlob } from '../../lib/downloadBlob';
import { generateCutListPdf, generatePartLabelsPdf } from '../../lib/workshopPdf';
import { ExtraPartsEditor } from '../common/ExtraPartsEditor';
import { SheetLayoutView } from './SheetLayoutView';
import { nestParts } from '../../lib/nesting';
import { useQuoteStatus } from '../../hooks/useQuoteStatus';
import { useEffectiveConstruction } from '../../hooks/usePhysicalCabinets';
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
    // To send to the glass supplier (§63). Thickness is left blank: the
    // app doesn't record it, so the business fills it in.
    {
      name: 'Glass order',
      headers: ['Cabinet', 'Panel', 'Height (mm)', 'Width (mm)', 'Tint', 'Qty', 'Thickness (mm)'],
      rows: cutList.glass.map((g) => ({
        Cabinet: g.cabinetRef,
        Panel: g.name,
        'Height (mm)': g.heightMm,
        'Width (mm)': g.widthMm,
        Tint: g.tint,
        Qty: g.quantity,
        'Thickness (mm)': '',
      })),
    },
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
  initialQuoteId,
}: {
  onClose: () => void;
  onOpenWorkshop: () => void;
  // "This part is wrong" → one click to the cabinet it comes from (§48).
  // The list itself is never edited directly: it's derived from the
  // design, and the same parts set the price.
  onOpenDesigner: (cabinetId: string) => void;
  // Open straight to a frozen quote's cutting list (§60) — the quote
  // panel's "Cutting list" link passes its quote id.
  initialQuoteId?: string;
}) {
  const cabinets = useLayoutStore((s) => s.cabinets);
  const looseParts = useLayoutStore((s) => s.currentLayout?.looseParts);
  const setLooseParts = useLayoutStore((s) => s.setLooseParts);
  const finishes = useLayoutStore((s) => s.finishes);
  // Business settings with this project's depth override applied (§61).
  const settings = useEffectiveConstruction();
  const rateCard = useLayoutStore((s) => s.rateCard);
  const currentProject = useLayoutStore((s) => s.currentProject);
  const [mode, setMode] = useState<Mode>('cutting');
  const quotes = useLayoutStore((s) => s.quotes);
  const loadQuotes = useLayoutStore((s) => s.loadQuotes);
  const quoteStatus = useQuoteStatus();
  // Load this project's quotes here too — they used to arrive only when
  // the quote sidebar had been opened, so opening the Cutting List first
  // showed no frozen versions at all.
  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes, currentProject?.id]);
  // Which cutting list: the live design, or one frozen with a quote (§60).
  const frozenQuotes = quotes.filter((q) => q.cutList);
  const [version, setVersion] = useState<string>(
    initialQuoteId && frozenQuotes.some((q) => q.id === initialQuoteId) ? initialQuoteId : 'current'
  );
  const frozen = version === 'current' ? undefined : frozenQuotes.find((q) => q.id === version);

  const liveCutList = useMemo(
    () => computeCutList(cabinets, settings, finishes, rateCard, looseParts ?? []),
    [cabinets, settings, finishes, rateCard, looseParts]
  );
  // A frozen version shows exactly its saved parts, laid out with the
  // boards (sheet sizes) and workshop settings saved WITH that quote — not
  // today's — so it reads as it did the day it was frozen.
  // No manual useMemo here: the React compiler memoises this component
  // itself, and it rejects a hand-written memo keyed on a value found by
  // searching a list (it can't prove it stable). Thawing is cheap anyway.
  const cutList = frozen?.cutList ? thawCutList(frozen.cutList) : liveCutList;
  const viewBoards = frozen ? frozen.pricingContext.rates.boards : rateCard.boards;
  const viewSettings = frozen?.pricingContext.construction ?? settings;
  const frozenIsLatestAndStale = frozen && quoteStatus.latest?.id === frozen.id && quoteStatus.isStale;

  // Cabinet ref ("C3") → its id, so a ref on any row can open that
  // cabinet in the Designer. Loose parts have no cabinet.
  const idByRef = new Map(cutList.parts.filter((p) => p.cabinetId).map((p) => [p.cabinetRef, p.cabinetId]));
  const refLink = (ref: string, title?: string) => {
    // A frozen list's cabinets may since have changed or gone — no links.
    const id = frozen ? undefined : idByRef.get(ref);
    if (!id) return <span key={ref} title={title}>{ref}</span>;
    return (
      <button
        key={ref}
        type="button"
        title={title ? `${title} — open in the Cabinet Designer` : 'Open in the Cabinet Designer'}
        className="inline-flex h-7 items-center rounded-full bg-secondary px-2.5 font-mono text-xs font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={() => onOpenDesigner(id)}
      >
        {ref}
      </button>
    );
  };

  const totalPieces = cutList.groups.reduce((n, g) => n + g.pieceCount, 0);

  const pdfInfo = {
    projectName: currentProject?.clientName ?? '',
    versionLabel: frozen ? `Quote v${frozen.version} (frozen ${new Date(frozen.frozenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : 'Current design',
    boards: viewBoards,
    settings: viewSettings,
  };
  const pdfFileBase = `cutting-list-${(currentProject?.clientName ?? 'project').replace(/[^a-z0-9]+/gi, '-')}${frozen ? `-quote-v${frozen.version}` : ''}`;

  // The page's numbers at a glance (§83), like Home's strip.
  const totalAreaSqM = cutList.groups.reduce((n, g) => n + g.areaSqM, 0);
  const totalEdgeM = cutList.groups.reduce((n, g) => n + g.edgeBandM, 0);
  const glassCount = cutList.glass.reduce((n, g) => n + g.quantity, 0);
  const stats = [
    { k: 'Pieces', v: String(totalPieces) },
    { k: 'Cabinets', v: String(new Set(cutList.parts.map((p) => p.cabinetRef)).size) },
    { k: 'Boards', v: String(cutList.groups.length) },
    { k: 'Board area', v: `${totalAreaSqM.toFixed(2)} m²` },
    { k: 'Edge banding', v: `${totalEdgeM.toFixed(1)} m` },
    ...(glassCount ? [{ k: 'Glass panels', v: String(glassCount) }] : []),
  ];
  const th = 'px-3 py-2.5 font-semibold';
  const td = 'px-3 py-2.5';
  const num = 'px-3 py-2.5 text-right font-mono tabular-nums';

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Header (§83): back, what this is, which version, how to view it,
          and the three ways out (Excel, printed list, part labels). */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <Button variant="outline" size="icon-touch" onClick={onClose} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Cutting list</span>
          <span className="truncate text-lg font-extrabold tracking-[-0.02em]">{currentProject?.clientName ?? 'This design'}</span>
        </div>
        {/* Live design or a frozen quote's list (§60). Always shown, so it
            can be found: quotes frozen before §60 carry no list and are
            listed greyed out with the reason (§66). */}
        <select
          aria-label="Which cutting list"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="h-11 min-w-0 max-w-[280px] rounded-[10px] border border-input bg-card px-3 text-sm font-medium"
        >
          <option value="current">Current design</option>
          {quotes.map((q) => (
            <option key={q.id} value={q.id} disabled={!q.cutList}>
              Quote v{q.version} ({q.sentAt ? 'sent' : 'frozen'} {new Date(q.sentAt ?? q.frozenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})
              {q.cutList ? '' : ' — frozen before cutting lists were saved'}
            </option>
          ))}
          {quotes.length === 0 && <option disabled>No frozen quotes yet</option>}
        </select>
        <div className="flex-1" />
        {/* All three are downloads (§84). A separate "Download" caption
            with an icon was tried and read as a button that did nothing
            (§88), so each button carries the download arrow and says
            what file it gives you. */}
        <div role="group" aria-label="Downloads" className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="touch"
            title="Download the cutting list as an Excel workbook"
            disabled={cutList.parts.length === 0}
            onClick={() =>
              exportWorkbook(cutList, viewSettings, viewBoards, `${currentProject?.clientName ?? ''}${frozen ? `-quote-v${frozen.version}` : ''}`)
            }
          >
            <Download /> Excel sheet
          </Button>
          {/* Printable workshop documents (§64), from the version shown. */}
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={cutList.parts.length === 0}
            title="Download stickers for every cut piece (PDF)"
            onClick={() => downloadBlob(generatePartLabelsPdf(cutList, pdfInfo), `${pdfFileBase}-labels.pdf`)}
          >
            <Download /> Part labels PDF
          </Button>
          <Button
            type="button"
            size="touch"
            disabled={cutList.parts.length === 0}
            title="Download the printable cutting list with sheet layouts (PDF)"
            onClick={() => downloadBlob(generateCutListPdf(cutList, pdfInfo), `${pdfFileBase}.pdf`)}
          >
            <Download /> Cutting list PDF
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        {frozen && (
          <div className="flex gap-3 rounded-2xl bg-info/10 px-4 py-3.5 text-sm text-info">
            <Snowflake className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
            <p>
              <strong className="font-semibold">Frozen with quote v{frozen.version}</strong> on{' '}
              {new Date(frozen.frozenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              {frozen.sentAt ? ' and sent to the customer' : ''}: read-only, exactly as it was then.{' '}
              {frozenIsLatestAndStale
                ? 'The design has changed since — cut from this list only if the customer agreed to this version.'
                : quoteStatus.latest && quoteStatus.latest.id !== frozen.id
                  ? 'A newer quote version exists.'
                  : ''}
            </p>
          </div>
        )}

        {!frozen && !settings.confirmed && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3.5 text-sm text-warning-foreground">
            <AlertTriangle className="size-5 shrink-0" strokeWidth={1.8} />
            {/* min-w lets the button wrap below the text on a phone
                instead of squeezing it into a narrow column. */}
            <p className="min-w-[220px] flex-1">
              <strong className="font-semibold">Built on assumed construction.</strong> Part sizes follow the default
              workshop convention. Confirm it with your carpenter before anything is cut.
            </p>
            <Button type="button" variant="outline" size="touch" className="border-warning/40 bg-transparent text-warning-foreground" onClick={onOpenWorkshop}>
              Workshop settings
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="View" className="flex rounded-xl bg-secondary p-1">
            {(
              [
                ['cutting', 'For cutting'],
                ['cabinet', 'By cabinet'],
                ['sheets', 'Sheets & waste'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={
                  mode === m
                    ? 'h-10 rounded-[9px] bg-card px-4 text-sm font-semibold shadow-sm'
                    : 'h-10 rounded-[9px] px-4 text-sm font-semibold text-muted-foreground hover:text-foreground'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-muted-foreground">
            Sizes in mm, length × width. "2L 1W" edge banding = both long edges and one short edge.
          </span>
        </div>

        {cutList.parts.length > 0 && (
          <div className={`grid grid-cols-2 overflow-hidden rounded-[20px] bg-card shadow-card sm:grid-cols-3 ${stats.length === 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
            {stats.map((st) => (
              <div key={st.k} className="flex flex-col gap-1 border-b border-r border-secondary px-5 py-4">
                <span className="text-[13px] font-semibold text-muted-foreground">{st.k}</span>
                <span className="text-xl font-extrabold tracking-tight">{st.v}</span>
              </div>
            ))}
          </div>
        )}

        {mode === 'sheets' ? (
          <SheetLayoutView cutList={cutList} boards={viewBoards} settings={viewSettings} />
        ) : cutList.parts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-input bg-card/60 px-6 py-14 text-center text-[15px] text-muted-foreground">
            No cabinets placed yet. Add cabinets to the design and their parts appear here.
          </div>
        ) : (
          <>
            {cutList.groups.map((g) => (
              <SectionCard
                key={g.key}
                Icon={Layers}
                title={g.label}
                description={`${g.pieceCount} pieces · ${g.areaSqM.toFixed(2)} m² · ${g.edgeBandM.toFixed(1)} m edge banding`}
              >
                <div className="-mx-4 overflow-x-auto md:-mx-6">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-y border-border bg-secondary text-[13px] text-muted-foreground">
                        {mode === 'cabinet' && <th className={th + ' pl-4 md:pl-6'}>Cabinet</th>}
                        <th className={th + (mode === 'cabinet' ? '' : ' pl-4 md:pl-6')}>Part</th>
                        <th className={th + ' text-right'}>Length</th>
                        <th className={th + ' text-right'}>Width</th>
                        <th className={th + ' text-right'}>Qty</th>
                        <th className={th}>Edge</th>
                        <th className={th}>Grain</th>
                        {mode === 'cutting' && <th className={th + ' pr-4 md:pr-6'}>Cabinets</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mode === 'cutting'
                        ? consolidateParts(g.parts).map((p, i) => (
                            <tr key={i} className="border-b border-secondary last:border-b-0">
                              <td className={td + ' pl-4 font-medium md:pl-6'}>{p.name}</td>
                              <td className={num}>{p.lengthMm}</td>
                              <td className={num}>{p.widthMm}</td>
                              <td className={num + ' font-semibold'}>{p.quantity}</td>
                              <td className={td + ' font-mono text-[13px]'}>{describeEdgeBanding(p.edgeBanding)}</td>
                              <td className={td}>{p.grainFixed ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-foreground">Grain</span> : ''}</td>
                              <td className={td + ' pr-4 md:pr-6'}>
                                <span className="flex flex-wrap gap-1">{p.cabinetRefs.map((ref) => <span key={ref}>{refLink(ref)}</span>)}</span>
                              </td>
                            </tr>
                          ))
                        : g.parts.map((p, i) => (
                            <tr key={i} className="border-b border-secondary last:border-b-0">
                              <td className={td + ' pl-4 md:pl-6'}>{refLink(p.cabinetRef, p.cabinetLabel)}</td>
                              <td className={td + ' font-medium'}>{p.name}</td>
                              <td className={num}>{p.lengthMm}</td>
                              <td className={num}>{p.widthMm}</td>
                              <td className={num + ' font-semibold'}>{p.quantity}</td>
                              <td className={td + ' font-mono text-[13px]'}>{describeEdgeBanding(p.edgeBanding)}</td>
                              <td className={td}>{p.grainFixed ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-foreground">Grain</span> : ''}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            ))}

            {/* Glass to order (§63) — cut by the glass supplier, not the
                workshop, so it isn't nested on sheets; same sizes the quote
                prices glass on. */}
            {cutList.glass.length > 0 && (
              <SectionCard
                Icon={GlassWater}
                title="Glass to order"
                description={`${glassCount} panels, cut to size by your glass supplier. Add the thickness on the order.`}
              >
                <div className="-mx-4 overflow-x-auto md:-mx-6">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-y border-border bg-secondary text-[13px] text-muted-foreground">
                        <th className={th + ' pl-4 md:pl-6'}>Cabinet</th>
                        <th className={th}>Panel</th>
                        <th className={th + ' text-right'}>Height</th>
                        <th className={th + ' text-right'}>Width</th>
                        <th className={th}>Tint</th>
                        <th className={th + ' pr-4 text-right md:pr-6'}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cutList.glass.map((g, i) => (
                        <tr key={i} className="border-b border-secondary last:border-b-0">
                          <td className={td + ' pl-4 md:pl-6'}>{refLink(g.cabinetRef, g.cabinetLabel)}</td>
                          <td className={td + ' font-medium'}>{g.name}</td>
                          <td className={num}>{g.heightMm}</td>
                          <td className={num}>{g.widthMm}</td>
                          <td className={td}>{g.tint}</td>
                          <td className={num + ' pr-4 font-semibold md:pr-6'}>{g.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}

            {cutList.warnings.length > 0 && (
              <div className="flex gap-3 rounded-2xl bg-card px-4 py-4 shadow-card md:px-6">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-foreground" strokeWidth={1.8} />
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold">Not on this list</span>
                  <ul className="list-disc pl-4 text-sm text-muted-foreground">
                    {cutList.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}

        {/* Loose parts — board pieces that don't belong to any one cabinet
            (§48). Saved with the project, listed above under their board,
            and priced inside Material like any panel. Not editable on a
            frozen list (§60) — a frozen quote never changes. */}
        {!frozen && (
          <SectionCard
            Icon={PlusSquare}
            title="Loose parts"
            description="Fillers, a plinth or skirting, end panels: board pieces that aren't part of any cabinet."
            help={
              <p>
                Each is cut, listed above under its board, and charged on the quote like any panel: real area × the
                board's rate. To change a cabinet's own parts, tap its C-number.
              </p>
            }
          >
            <ExtraPartsEditor parts={looseParts ?? []} onChange={setLooseParts} requireBoard namePlaceholder="e.g. Filler, left wall" />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
