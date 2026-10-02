// src/lib/quotePdf.ts
//
// Renders a FROZEN quote (never the live BOM — see types/quote.ts) into
// a PDF Blob, entirely client-side. Deliberately mirrors
// QuoteSidebar.tsx's section order and "specified only" treatment for
// lighting/countertop, so the document a customer receives never
// disagrees with what the designer was looking at on screen when they
// froze it.
//
// jsPDF + jspdf-autotable rather than @react-pdf/renderer: this is one
// straightforward imperative pass over an already-computed BOMSummary,
// not a real layout problem, and jsPDF's plain y-cursor model is easy
// to get right without a way to visually preview it in this
// environment — a declarative layout engine's wrapping/flex behaviour
// would be much harder to verify by reading code alone.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FrozenQuote } from '../types/quote';
import type { CustomerProject } from '../types/customer';
import { APPLIANCE_TYPE_LABELS } from '../types/appliance';

// NOT `style: 'currency'` — jsPDF's built-in fonts (Helvetica etc.) are
// the standard 14 PDF fonts, encoded WinAnsi, which has no ₹ glyph
// (U+20B9). Asking jsPDF to draw it doesn't error or fall back to
// nothing; it silently truncates to the low byte of the code point
// (0xB9), which WinAnsi maps to a completely different, unrelated
// glyph — the superscript one, "¹". So every amount rendered "¹10,150"
// instead of "₹10,150". Embedding a Unicode font just for one symbol
// is a lot of machinery for this; "Rs." is ASCII and unambiguous.
// QuoteSidebar.tsx and the WhatsApp message text (lib/whatsapp.ts) are
// real Unicode contexts (DOM, WhatsApp) and keep using the real ₹ via
// their own `style: 'currency'` formatters — this workaround is scoped
// to jsPDF's own font limitation, not applied anywhere else.
const AMOUNT_FORMATTER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
function formatAmount(value: number): string {
  return `Rs. ${AMOUNT_FORMATTER.format(value)}`;
}

// There is no `businesses` table yet (see docs/PRINCIPLES.md, Part 2 —
// multi-tenancy hasn't landed), so there is nowhere else this could
// come from today. Optional env vars, same VITE_-prefixed pattern as
// Supabaseclient.ts, rather than a hardcoded string, so at least a
// single business can put its own name on its own quotes without a
// code change. Revisit once a real per-tenant business profile exists.
const BUSINESS_NAME = import.meta.env.VITE_BUSINESS_NAME || 'Kitchen Studio';
const BUSINESS_PHONE = import.meta.env.VITE_BUSINESS_PHONE || '';

const MARGIN = 40;

// 'sink-unit' -> 'Sink Unit' — same formatter as QuoteSidebar.tsx,
// duplicated rather than imported because that copy is a component-
// local helper, not something lib/ exports.
function formatModuleType(moduleType: string): string {
  return moduleType
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// jspdf-autotable's v5 function API still stashes the last table's
// result on the jsPDF instance itself (`doc.lastAutoTable.finalY`) —
// there is no other way to ask "where did that table end" — but the
// type declarations don't carry that property, hence the cast.
function afterLastTable(doc: jsPDF, fallback: number): number {
  const withTable = doc as unknown as { lastAutoTable?: { finalY: number } };
  return withTable.lastAutoTable?.finalY ?? fallback;
}

// Starts a new page if `needed` points of vertical space don't fit
// before the bottom margin — autoTable paginates itself, but the plain
// text/heading lines between tables need this checked by hand.
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function sectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(text, MARGIN, y);
  return y + 16;
}

export function generateQuotePdfBlob(quote: FrozenQuote, project: CustomerProject): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const s = quote.summary;
  // A PDF is always the SELLING view — there is no toggle here the way
  // QuoteSidebar has one, a customer only ever sees this. Every line
  // shown below (itemised rows and the totals block) is marked up by
  // the same factor, distributed rather than shown as one separate
  // "Margin" line — confirmed with the business rather than assumed,
  // so the printed lines sum to the printed total exactly
  // (docs/DECISIONS.md §15). ONE exception: fixed-price charges
  // (applyMargin false, §39 — and §36's project charges on a quote
  // frozen before that) print unmarked — they were typed as selling
  // prices, and grandTotal already excludes them from margin, so the
  // lines still sum exactly. `s.marginPercent` is undefined for a
  // quote frozen before margin existed at all — factor is exactly 1
  // then, which reproduces that quote's own historical total
  // precisely (a frozen quote never changes, see types/quote.ts).
  const factor = 1 + (s.marginPercent ?? 0) / 100;
  const marked = (value: number) => value * factor;
  let y = MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(BUSINESS_NAME, MARGIN, y);
  if (BUSINESS_PHONE) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(BUSINESS_PHONE, pageWidth - MARGIN, y, { align: 'right' });
  }
  y += 26;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(`Kitchen Quote — v${quote.version}`, MARGIN, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `Frozen ${new Date(quote.frozenAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`,
    MARGIN,
    y
  );
  y += 14;
  if (quote.note) {
    doc.text(quote.note, MARGIN, y);
    y += 14;
  }
  doc.setTextColor(0);
  y += 10;

  y = sectionHeading(doc, y, 'Customer');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(project.clientName, MARGIN, y);
  y += 14;
  doc.text(project.phone, MARGIN, y);
  y += 14;
  doc.text(`${project.address}, ${project.locality}`, MARGIN, y);
  y += 26;

  if (s.lineItems.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Cabinet', 'Dimensions (mm)', 'Qty', 'Material / Finish', 'Total']],
      body: s.lineItems.map((line) => [
        `${formatModuleType(line.moduleType)}\n${line.frontDescription} · ${line.handleDescription}`,
        `${line.widthMm} × ${line.depthMm} × ${line.heightMm}`,
        String(line.quantity),
        `${line.material} / ${line.finish}`,
        // Fixed-price charge rows (§39) inside this line aren't marked
        // up. `?? 0` — absent on a quote frozen before §39.
        formatAmount(marked(line.lineTotal - (line.unmarkedCost ?? 0)) + (line.unmarkedCost ?? 0)),
      ]),
      styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 4: { halign: 'right' } },
    });
    y = afterLastTable(doc, y) + 20;
  }

  if (s.applianceLineItems.length > 0) {
    y = ensureSpace(doc, y, 60);
    y = sectionHeading(doc, y, 'Appliances');
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Appliance', 'Dimensions (mm)', 'Qty', 'Total']],
      body: s.applianceLineItems.map((line) => [
        APPLIANCE_TYPE_LABELS[line.applianceType],
        `${line.widthMm} × ${line.depthMm} × ${line.heightMm}`,
        String(line.quantity),
        formatAmount(marked(line.lineTotal)),
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 3: { halign: 'right' } },
    });
    y = afterLastTable(doc, y) + 20;
  }

  if (s.openingLineItems.length > 0) {
    y = ensureSpace(doc, y, 60);
    y = sectionHeading(doc, y, 'Doors & Windows');
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Opening', 'Total']],
      body: s.openingLineItems.map((line) => [
        `${line.description}\n${line.surface} · deducts ${line.deductedSqM.toFixed(2)} m² of tiling`,
        line.suppliedByUs ? formatAmount(marked(line.cost)) : 'Existing — by others',
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 1: { halign: 'right' } },
    });
    y = afterLastTable(doc, y) + 20;
  }

  if (s.fixtureLineItems.length > 0) {
    y = ensureSpace(doc, y, 60);
    y = sectionHeading(doc, y, 'Lighting');
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Fixture', 'Amount', 'Total']],
      body: s.fixtureLineItems.map((line) => [
        `${line.description}\n${line.mountDescription} · ${line.colorTempK}K`,
        line.unit === 'm' ? `${line.amount.toFixed(2)} m` : `${line.amount} pcs`,
        s.fixtureSubtotal > 0 ? formatAmount(marked(line.cost)) : 'by electrician',
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = afterLastTable(doc, y) + 20;
    if (s.fixtureSubtotal === 0 && s.fixtureSpecifiedTotal > 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Specified only — ${formatAmount(s.fixtureSpecifiedTotal)} if the electrical work is billed by us.`,
        MARGIN,
        y
      );
      doc.setTextColor(0);
      y += 18;
    }
  }

  if (s.countertopLineItem) {
    y = ensureSpace(doc, y, 60);
    y = sectionHeading(doc, y, 'Countertop / Slab');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `${s.countertopLineItem.finish} — ${s.countertopLineItem.areaSqM.toFixed(2)} m²`,
      MARGIN,
      y
    );
    doc.text(
      s.countertopSubtotal > 0 ? formatAmount(marked(s.countertopSubtotal)) : 'by homeowner',
      pageWidth - MARGIN,
      y,
      { align: 'right' }
    );
    y += 20;
  }

  y = ensureSpace(doc, y, 200);
  doc.setDrawColor(200);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 18;

  const totalsRows: [string, number][] = [
    ['Material', marked(s.materialSubtotal)],
    ['Finish', marked(s.finishSubtotal)],
    ...(s.surfaceSubtotal > 0 ? ([['Floor / walls / ceiling', marked(s.surfaceSubtotal)]] as [string, number][]) : []),
    ...(s.countertopSubtotal > 0 ? ([['Countertop / slab', marked(s.countertopSubtotal)]] as [string, number][]) : []),
    ['Hardware', marked(s.hardwareSubtotal)],
    // laborSubtotal/fabricationSubtotal exist only on quotes frozen
    // before §38; printed exactly as they were for those. A newer
    // quote has neither and prints its labour through shownOtherLines.
    ...(s.laborSubtotal ? ([['Labour — installation', marked(s.laborSubtotal)]] as [string, number][]) : []),
    ...(s.fabricationSubtotal ? ([['Fabrication', marked(s.fabricationSubtotal)]] as [string, number][]) : []),
    ...(s.shownOtherLines ?? []).map(
      (c) => [c.label, c.applyMargin === false ? c.amount : marked(c.amount)] as [string, number]
    ),
    // §36's project charges — only on a quote frozen in the short window
    // they existed (since §39 they arrive as fixed-price shownOtherLines).
    // Already the selling price, so NOT marked(); printed exactly as then.
    ...(s.projectLaborCharges ?? []).map((c) => [`Labour — ${c.label}`, c.amount] as [string, number]),
    ...(s.othersSubtotal || s.othersUnmarkedSubtotal
      ? ([['Other', marked(s.othersSubtotal) + (s.othersUnmarkedSubtotal ?? 0)]] as [string, number][])
      : []),
    ...(s.projectOtherCharges ?? []).map((c) => [`Other — ${c.label}`, c.amount] as [string, number]),
    ...(s.glassSubtotal ? ([['Glass doors', marked(s.glassSubtotal)]] as [string, number][]) : []),
    ['Appliances', marked(s.applianceSubtotal)],
    ...(s.openingSubtotal > 0 ? ([['Doors & windows', marked(s.openingSubtotal)]] as [string, number][]) : []),
    ...(s.fixtureSubtotal > 0 ? ([['Lighting', marked(s.fixtureSubtotal)]] as [string, number][]) : []),
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const [label, amount] of totalsRows) {
    y = ensureSpace(doc, y, 40);
    doc.text(label, MARGIN, y);
    doc.text(formatAmount(amount), pageWidth - MARGIN, y, { align: 'right' });
    y += 16;
  }

  y = ensureSpace(doc, y, 60) + 4;
  doc.setDrawColor(0);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Grand Total', MARGIN, y);
  doc.text(formatAmount(s.grandTotal), pageWidth - MARGIN, y, { align: 'right' });
  y += 26;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'This quote is fixed as of the date above and will not change with later rate or design updates.',
    MARGIN,
    y
  );

  return doc.output('blob');
}
