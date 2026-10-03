// src/lib/workshopPdf.ts
//
// Printable workshop documents (§64): the cutting list as a PDF, and a
// sheet of part labels to stick on every cut piece. Built from the same
// CutList (lib/cutList.ts) and nesting (lib/nesting.ts) the Cutting List
// page shows, so paper and screen can't disagree — and from whichever
// version is selected there (live design or a frozen quote's list).
//
// jsPDF's built-in Helvetica covers WinAnsi only: "×", "—" and "²" print,
// but "₹", arrows and the "turned" symbol (⟲) don't — so these documents
// say "turned" in words and carry no prices (they're for the workshop).

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { consolidateParts, describeEdgeBanding, type CutList } from './cutList';
import { nestParts } from './nesting';
import { boardSheetSizes, type BoardRate } from '../types/rates';
import type { ConstructionSettings } from '../types/construction';

const MARGIN = 36;

export interface WorkshopDocInfo {
  projectName: string;
  // "Current design" or "Quote v3 (frozen 2 Oct)".
  versionLabel: string;
  boards: BoardRate[];
  settings: ConstructionSettings;
}

function header(doc: jsPDF, title: string, info: WorkshopDocInfo): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title, MARGIN, MARGIN + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `${info.projectName || 'Project'} — ${info.versionLabel} — printed ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    MARGIN,
    MARGIN + 22
  );
  let y = MARGIN + 36;
  if (!info.settings.confirmed) {
    // Same warning the screen shows — never let paper drop it.
    doc.setTextColor(160, 90, 0);
    doc.text('Built on ASSUMED workshop settings — confirm them with your carpenter before cutting.', MARGIN, y);
    y += 14;
  }
  doc.setTextColor(0);
  return y + 6;
}

function afterTable(doc: jsPDF, fallback: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;
}

// The cutting list as a printable document: a parts table per board
// (identical parts merged, as the saw operator works), the glass order,
// then one landscape page per nested sheet with every piece drawn,
// labelled and sized.
export function generateCutListPdf(cutList: CutList, info: WorkshopDocInfo): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = header(doc, 'Cutting list', info);

  for (const g of cutList.groups) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    if (y > doc.internal.pageSize.getHeight() - 90) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(`${g.label}  (${g.pieceCount} pieces, ${g.areaSqM.toFixed(2)} m², ${g.edgeBandM.toFixed(1)} m edge banding)`, MARGIN, y);
    autoTable(doc, {
      startY: y + 6,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Part', 'Length', 'Width', 'Qty', 'Edge', 'Grain', 'Cabinets']],
      body: consolidateParts(g.parts).map((p) => [
        p.name,
        String(p.lengthMm),
        String(p.widthMm),
        String(p.quantity),
        describeEdgeBanding(p.edgeBanding),
        p.grainFixed ? 'Along length' : '',
        p.cabinetRefs.join(', '),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [55, 65, 81] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    y = afterTable(doc, y) + 18;
  }

  if (cutList.glass.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Glass to order (cut by the glass supplier — add thickness)', MARGIN, y);
    autoTable(doc, {
      startY: y + 6,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Cabinet', 'Panel', 'Height', 'Width', 'Tint', 'Qty']],
      body: cutList.glass.map((gl) => [gl.cabinetRef, gl.name, String(gl.heightMm), String(gl.widthMm), gl.tint, String(gl.quantity)]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [55, 65, 81] },
    });
    y = afterTable(doc, y) + 18;
  }

  if (cutList.warnings.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const w of cutList.warnings) {
      if (y > doc.internal.pageSize.getHeight() - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      doc.text(doc.splitTextToSize(`Note: ${w}`, doc.internal.pageSize.getWidth() - 2 * MARGIN), MARGIN, y);
      y += 12;
    }
  }

  // Sheet layouts, one landscape page each.
  const cut = { kerfMm: info.settings.kerfMm, trimMm: info.settings.sheetTrimMm };
  for (const g of cutList.groups) {
    const board = info.boards.find((b) => b.id === g.parts[0]?.boardId);
    const result = nestParts(g.parts, boardSheetSizes(board), cut);
    result.sheets.forEach((sheet, i) => {
      doc.addPage('a4', 'landscape');
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${g.label} — sheet ${i + 1} of ${result.sheets.length} (${sheet.lengthMm} × ${sheet.widthMm})`, MARGIN, MARGIN);
      const scale = Math.min((pw - 2 * MARGIN) / sheet.lengthMm, (ph - 2 * MARGIN - 30) / sheet.widthMm);
      const ox = MARGIN;
      const oy = MARGIN + 20;
      doc.setDrawColor(150);
      doc.setFillColor(229, 231, 235);
      doc.rect(ox, oy, sheet.lengthMm * scale, sheet.widthMm * scale, 'FD');
      doc.setFillColor(255, 255, 255);
      doc.rect(
        ox + cut.trimMm * scale,
        oy + cut.trimMm * scale,
        (sheet.lengthMm - 2 * cut.trimMm) * scale,
        (sheet.widthMm - 2 * cut.trimMm) * scale,
        'F'
      );
      for (const pc of sheet.pieces) {
        const x = ox + pc.x * scale;
        const yy = oy + pc.y * scale;
        const w = pc.w * scale;
        const h = pc.h * scale;
        doc.setDrawColor(107, 90, 69);
        doc.setFillColor(243, 227, 199);
        doc.rect(x, yy, w, h, 'FD');
        if (w > 40 && h > 18) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.max(5, Math.min(8, h / 3)));
          doc.setTextColor(40);
          const lines = [`${pc.part.cabinetRef} ${pc.part.name}`, `${pc.part.lengthMm} × ${pc.part.widthMm}${pc.rotated ? ' (turned)' : ''}`];
          doc.text(lines, x + w / 2, yy + h / 2, { align: 'center', baseline: 'middle', maxWidth: w - 4 });
        }
      }
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text('Grain runs along the sheet length (left to right).', ox, oy + sheet.widthMm * scale + 14);
      doc.setTextColor(0);
    });
  }

  return doc.output('blob');
}

// Part labels: one per physical piece, 3 × 8 = 24 per A4 page — the
// common sticker-sheet layout (63.5 × 33.9 mm labels). Each says which
// cabinet and part it is, its size, board and banding, and "piece n of
// N", so every cut piece can be tagged at the saw and matched at
// assembly.
export function generatePartLabelsPdf(cutList: CutList, info: WorkshopDocInfo): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cols = 3;
  const rows = 8;
  const labelW = 63.5;
  const labelH = 33.9;
  const left = (210 - cols * labelW) / 2;
  const top = (297 - rows * labelH) / 2;

  const pieces = cutList.parts.flatMap((p) => Array.from({ length: p.quantity }, () => p));
  pieces.forEach((p, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const x = left + (slot % cols) * labelW;
    const y = top + Math.floor(slot / cols) * labelH;
    doc.setDrawColor(210);
    doc.rect(x + 1, y + 1, labelW - 2, labelH - 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(`${p.cabinetRef}  ${p.name}`, x + 3, y + 6, { maxWidth: labelW - 6 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${p.lengthMm} × ${p.widthMm} × ${p.thicknessMm} mm`, x + 3, y + 13);
    doc.text(p.boardName, x + 3, y + 18, { maxWidth: labelW - 6 });
    doc.text(`Edge: ${describeEdgeBanding(p.edgeBanding)}${p.extraEdgeBandMm ? ' + diagonal' : ''}`, x + 3, y + 23);
    doc.setTextColor(110);
    doc.setFontSize(7);
    doc.text(`${info.projectName || 'Project'} · piece ${i + 1} of ${pieces.length}`, x + 3, y + labelH - 4, { maxWidth: labelW - 6 });
  });
  if (pieces.length === 0) {
    doc.setFontSize(10);
    doc.text('No parts to label.', 20, 20);
  }
  return doc.output('blob');
}
