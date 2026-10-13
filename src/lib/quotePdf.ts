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
import { fitLogo, type PdfBranding } from './pdfAssets';
import type { CustomerProject } from '../types/customer';
import { APPLIANCE_TYPE_LABELS } from '../types/appliance';

// The rupee sign needs a font that has it. jsPDF's built-in fonts
// (the standard 14, encoded WinAnsi) have no ₹ (U+20B9), and asking for
// it doesn't error: it silently truncates to the low byte (0xB9), which
// WinAnsi maps to "¹", so amounts printed "¹10,150". Until §94 this
// file printed "Rs." instead. Now the PDF embeds the app's own font
// (lib/pdfAssets.ts), which has ₹; if that font couldn't load, the
// document falls back to Helvetica and "Rs." rather than fail.
const AMOUNT_FORMATTER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const PDF_FONT = 'PlusJakartaSans';
function hasEmbeddedFont(doc: jsPDF): boolean {
  return Boolean(doc.getFontList()[PDF_FONT]);
}
function formatAmount(doc: jsPDF, value: number): string {
  return `${hasEmbeddedFont(doc) ? '₹' : 'Rs. '}${AMOUNT_FORMATTER.format(value)}`;
}
// The embedded font has Regular and Bold only; italic prints Regular.
function pickFont(doc: jsPDF, style: 'normal' | 'bold' | 'italic') {
  if (hasEmbeddedFont(doc)) doc.setFont(PDF_FONT, style === 'bold' ? 'bold' : 'normal');
  else doc.setFont('helvetica', style);
}

// The business name, phone and GSTIN come from the business's own
// record via PdfBranding (§94). They used to come from VITE_BUSINESS_NAME
// / VITE_BUSINESS_PHONE in `.env`, with a comment that there was no
// businesses table yet; that stopped being true at §70, and meant the
// name set in Settings never reached the PDF.

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
  pickFont(doc, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(text, MARGIN, y);
  return y + 16;
}

// `branding` is required, never defaulted: a call site that forgot it
// should fail to compile, not print a blank or wrong business name (the
// same lesson as calculateBOM's PricingContext, CLAUDE.md).
export function generateQuotePdfBlob(quote: FrozenQuote, project: CustomerProject, branding: PdfBranding): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  if (branding.fonts) {
    doc.addFileToVFS('PJS-Regular.ttf', branding.fonts.regular);
    doc.addFont('PJS-Regular.ttf', PDF_FONT, 'normal');
    doc.addFileToVFS('PJS-Bold.ttf', branding.fonts.bold);
    doc.addFont('PJS-Bold.ttf', PDF_FONT, 'bold');
  }
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

  y = drawBusinessHeader(doc, branding, y, pageWidth);

  pickFont(doc, 'bold');
  doc.setFontSize(20);
  doc.text(`Kitchen Quote — v${quote.version}`, MARGIN, y);
  y += 22;

  pickFont(doc, 'normal');
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
  pickFont(doc, 'normal');
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
        formatAmount(doc, marked(line.lineTotal - (line.unmarkedCost ?? 0)) + (line.unmarkedCost ?? 0)),
      ]),
      styles: { font: hasEmbeddedFont(doc) ? PDF_FONT : 'helvetica', fontSize: 8, cellPadding: 4, valign: 'middle' },
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
        formatAmount(doc, marked(line.lineTotal)),
      ]),
      styles: { font: hasEmbeddedFont(doc) ? PDF_FONT : 'helvetica', fontSize: 8, cellPadding: 4 },
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
        line.suppliedByUs ? formatAmount(doc, marked(line.cost)) : 'Existing — by others',
      ]),
      styles: { font: hasEmbeddedFont(doc) ? PDF_FONT : 'helvetica', fontSize: 8, cellPadding: 4 },
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
        s.fixtureSubtotal > 0 ? formatAmount(doc, marked(line.cost)) : 'by electrician',
      ]),
      styles: { font: hasEmbeddedFont(doc) ? PDF_FONT : 'helvetica', fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = afterLastTable(doc, y) + 20;
    if (s.fixtureSubtotal === 0 && s.fixtureSpecifiedTotal > 0) {
      pickFont(doc, 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Specified only — ${formatAmount(doc, s.fixtureSpecifiedTotal)} if the electrical work is billed by us.`,
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
    pickFont(doc, 'normal');
    doc.setFontSize(9);
    doc.text(
      `${s.countertopLineItem.finish} — ${s.countertopLineItem.areaSqM.toFixed(2)} m²`,
      MARGIN,
      y
    );
    doc.text(
      s.countertopSubtotal > 0 ? formatAmount(doc, marked(s.countertopSubtotal)) : 'by homeowner',
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
    // `?? 0`-safe: absent on a quote frozen before §58.
    ...(s.edgeBandingSubtotal ? ([['Edge banding', marked(s.edgeBandingSubtotal)]] as [string, number][]) : []),
    ...(s.glassSubtotal ? ([['Glass doors', marked(s.glassSubtotal)]] as [string, number][]) : []),
    ['Appliances', marked(s.applianceSubtotal)],
    ...(s.openingSubtotal > 0 ? ([['Doors & windows', marked(s.openingSubtotal)]] as [string, number][]) : []),
    ...(s.fixtureSubtotal > 0 ? ([['Lighting', marked(s.fixtureSubtotal)]] as [string, number][]) : []),
  ];

  pickFont(doc, 'normal');
  doc.setFontSize(10);
  for (const [label, amount] of totalsRows) {
    y = ensureSpace(doc, y, 40);
    doc.text(label, MARGIN, y);
    doc.text(formatAmount(doc, amount), pageWidth - MARGIN, y, { align: 'right' });
    y += 16;
  }

  // §130: a discount (absent on quotes frozen before it existed).
  if ((s.discountAmount ?? 0) > 0) {
    y = ensureSpace(doc, y, 60) + 2;
    doc.setDrawColor(200);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 16;
    doc.text('Subtotal', MARGIN, y);
    doc.text(formatAmount(doc, s.subtotalBeforeDiscount ?? s.grandTotal), pageWidth - MARGIN, y, { align: 'right' });
    y += 16;
    doc.text(s.discount?.kind === 'percent' ? `Discount (${s.discount.value}%)` : 'Discount', MARGIN, y);
    doc.text(`- ${formatAmount(doc, s.discountAmount ?? 0)}`, pageWidth - MARGIN, y, { align: 'right' });
    y += 16;
  }

  y = ensureSpace(doc, y, 60) + 4;
  doc.setDrawColor(0);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 20;
  pickFont(doc, 'bold');
  doc.setFontSize(13);
  doc.text('Grand Total', MARGIN, y);
  doc.text(formatAmount(doc, s.grandTotal), pageWidth - MARGIN, y, { align: 'right' });
  y += 26;

  pickFont(doc, 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'This quote is fixed as of the date above and will not change with later rate or design updates.',
    MARGIN,
    y
  );

  return doc.output('blob');
}

// The header (§94): logo on the left when there is one, with the name,
// phone and GSTIN right-aligned beside it; without a logo, the name on
// the left and phone/GSTIN on the right, as before. Returns the y below.
function drawBusinessHeader(doc: jsPDF, b: PdfBranding, top: number, pageWidth: number): number {
  const details = [b.phone, b.gstin && `GSTIN ${b.gstin}`].filter(Boolean) as string[];
  if (b.logo) {
    const size = fitLogo(b.logo.widthPx, b.logo.heightPx);
    doc.addImage(b.logo.dataUrl, 'PNG', MARGIN, top - 12, size.width, size.height);
    let ty = top;
    pickFont(doc, 'bold');
    doc.setFontSize(14);
    doc.text(b.name, pageWidth - MARGIN, ty, { align: 'right' });
    pickFont(doc, 'normal');
    doc.setFontSize(10);
    for (const line of details) {
      ty += 14;
      doc.text(line, pageWidth - MARGIN, ty, { align: 'right' });
    }
    return Math.max(top - 12 + size.height, ty) + 26;
  }
  pickFont(doc, 'bold');
  doc.setFontSize(16);
  doc.text(b.name, MARGIN, top);
  pickFont(doc, 'normal');
  doc.setFontSize(10);
  details.forEach((line, i) => doc.text(line, pageWidth - MARGIN, top + i * 14, { align: 'right' }));
  return top + Math.max(0, details.length - 1) * 14 + 26;
}
