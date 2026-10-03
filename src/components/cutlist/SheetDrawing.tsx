// src/components/cutlist/SheetDrawing.tsx
//
// One nested sheet drawn as SVG, with dimension lines (§50): the sheet's
// overall length and width outside its edges, and each piece's own
// length and width inside it, as lines with an arrowhead at each end.
// Pure presentation — no store access — so it can be rendered on its
// own (it was, to check the drawing by eye before shipping it).
//
// Drawn in sheet millimetres (the viewBox is the sheet plus a margin),
// so the browser scales it to whatever width the page gives it.

import { useId } from 'react';
import type { NestResult } from '../../lib/nesting';

// Pastel fills by part kind, so carcass, backs and fronts read apart.
const KIND_FILL: Record<string, string> = {
  carcass: '#f3e3c7',
  back: '#eef0f3',
  front: '#dbe8f5',
};

// Dimension lines are drawn in sheet millimetres, so their text and
// arrows are sized in mm too — 34mm text reads at roughly the same size
// as the app's small labels when a 2440mm sheet is drawn ~600px wide.
const DIM_TEXT = 40;
const DIM_COLOR = '#374151';
// Room around the sheet for its own overall dimensions.
const OUTER = 150;

// A dimension line with an arrowhead at each end and its value centred
// on it — horizontal (label above the line) or vertical (label turned to
// read bottom-to-top, the drafting convention).
function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  markerId,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  markerId: string;
}) {
  const vertical = x1 === x2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={DIM_COLOR}
        strokeWidth={2.5}
        markerStart={`url(#${markerId})`}
        markerEnd={`url(#${markerId})`}
      />
      <text
        x={vertical ? mx - 10 : mx}
        y={vertical ? my : my - 10}
        textAnchor="middle"
        fontSize={DIM_TEXT}
        fill={DIM_COLOR}
        transform={vertical ? `rotate(-90 ${mx - 10} ${my})` : undefined}
        style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 8 }}
      >
        {label}
      </text>
    </g>
  );
}

export function SheetDrawing({ result, index, trimMm }: { result: NestResult; index: number; trimMm: number }) {
  // Unique per drawing — several SVGs on one page must not share marker ids.
  const markerId = `dim-arrow-${useId().replace(/:/g, '')}`;
  const sheet = result.sheets[index];
  // Each sheet carries its own size — one board can be bought in several
  // (§52) — so the drawing reads it from the sheet, never a global.
  const spec = { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, trimMm };
  const used = (sheet.usedAreaMm2 / (spec.lengthMm * spec.widthMm)) * 100;
  return (
    <figure className="flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-card md:p-4">
      <figcaption className="text-[13px] font-medium text-muted-foreground">
        Sheet {index + 1} of {result.sheets.length} · {spec.lengthMm}×{spec.widthMm} · {sheet.pieces.length} pieces ·{' '}
        {used.toFixed(0)}% used
      </figcaption>
      <svg
        viewBox={`${-OUTER} ${-OUTER} ${spec.lengthMm + OUTER + 20} ${spec.widthMm + OUTER + 20}`}
        className="w-full rounded-lg border border-border bg-white"
        role="img"
        aria-label={`Sheet ${index + 1} layout`}
      >
        <defs>
          {/* One arrowhead, used at both ends of every dimension line
              (orient auto-start-reverse flips it for the start). */}
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={DIM_COLOR} />
          </marker>
        </defs>

        {/* The sheet's overall size, outside its edges. */}
        <Dim x1={0} y1={-70} x2={spec.lengthMm} y2={-70} label={`${spec.lengthMm}`} markerId={markerId} />
        <Dim x1={-70} y1={0} x2={-70} y2={spec.widthMm} label={`${spec.widthMm}`} markerId={markerId} />

        {/* Trimmed factory edge */}
        <rect x={0} y={0} width={spec.lengthMm} height={spec.widthMm} fill="#e5e7eb" />
        <rect
          x={spec.trimMm}
          y={spec.trimMm}
          width={spec.lengthMm - 2 * spec.trimMm}
          height={spec.widthMm - 2 * spec.trimMm}
          fill="#ffffff"
        />
        {sheet.pieces.map((pc, i) => {
          // Each piece's own size, inside it: across the top and down the
          // left side, inset so the arrows sit clear of the cut line. Too
          // small a piece to fit a readable line just gets its tooltip.
          const showW = pc.w > 220 && pc.h > 120;
          const showH = pc.h > 220 && pc.w > 120;
          const showName = pc.w > 300 && pc.h > 200;
          // A strip too thin for arrow lines (a rail, a filler) still
          // gets its size, as one compact label along its long side —
          // seen on the first render: a 564×100 rail showed nothing.
          const compact = !showW && !showH && Math.max(pc.w, pc.h) > 200 && Math.min(pc.w, pc.h) > 45;
          const tall = pc.h > pc.w;
          const cx = pc.x + pc.w / 2;
          const cy = pc.y + pc.h / 2;
          return (
            <g key={i}>
              <rect
                x={pc.x}
                y={pc.y}
                width={pc.w}
                height={pc.h}
                fill={KIND_FILL[pc.part.kind] ?? '#eee'}
                stroke="#6b5a45"
                strokeWidth={3}
              >
                <title>
                  {`${pc.part.cabinetRef} ${pc.part.name} — ${pc.part.lengthMm} × ${pc.part.widthMm}${pc.rotated ? ' (turned)' : ''}`}
                </title>
              </rect>
              {showW && (
                <Dim
                  x1={pc.x + 12}
                  y1={pc.y + 55}
                  x2={pc.x + pc.w - 12}
                  y2={pc.y + 55}
                  label={`${pc.w}`}
                  markerId={markerId}
                />
              )}
              {showH && (
                <Dim
                  x1={pc.x + 55}
                  y1={pc.y + 12}
                  x2={pc.x + 55}
                  y2={pc.y + pc.h - 12}
                  label={`${pc.h}`}
                  markerId={markerId}
                />
              )}
              {compact && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.min(DIM_TEXT, Math.min(pc.w, pc.h) * 0.6)}
                  fill={DIM_COLOR}
                  transform={tall ? `rotate(-90 ${cx} ${cy})` : undefined}
                >
                  {`${pc.part.lengthMm}×${pc.part.widthMm}`}
                </text>
              )}
              {showName && (
                <text
                  x={pc.x + pc.w / 2}
                  y={pc.y + pc.h / 2 + 20}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={DIM_TEXT}
                  fill="#4b5563"
                >
                  {`${pc.part.cabinetRef} ${pc.part.name}${pc.rotated ? ' ⟲' : ''}`}
                </text>
              )}
            </g>
          );
        })}
        {/* Grain direction runs along the sheet's length. */}
        <text x={spec.lengthMm - 20} y={spec.widthMm - 18} textAnchor="end" fontSize={34} fill="#6b7280">
          grain →
        </text>
      </svg>
    </figure>
  );
}

