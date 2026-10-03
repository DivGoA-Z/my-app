// src/components/editor/CabinetThumb.tsx
//
// A small front drawing of a cabinet for the editor's picture tiles
// (§85, UI principle 6: pictures over words). Generated from the
// cabinet's size and front (single/double door, drawers, open shelves,
// trolley, appliance opening…) and filled with its finish — the photo or
// generated texture where there is one, its colour otherwise. Not a
// render: a clear, recognisable sketch, drawn in proportion.

import { useId } from 'react';
import type { FrontLayout, FrontRowLayout } from '../../types/front';
import { clampCount, defaultFrontLayout } from '../../types/front';
import type { ModuleType } from '../../types/cabinet';
import { finishSwatch } from '../../lib/designFinishes';
import { useLayoutStore } from '../../store/layoutStore';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Panel = Rect & { handle?: 'h' | 'left' | 'right' };

export function CabinetThumb({
  moduleType,
  widthMm,
  heightMm,
  frontLayout,
  finishId,
  className,
}: {
  moduleType: ModuleType;
  widthMm: number;
  heightMm: number;
  frontLayout?: FrontLayout;
  finishId?: string;
  className?: string;
}) {
  const patternId = `thumb-${useId().replace(/:/g, '')}`;
  const finish = useLayoutStore((s) => s.finishes.find((f) => f.id === finishId));
  const sw = finishSwatch(finish);
  const front = frontLayout ?? defaultFrontLayout(moduleType, widthMm);

  // Fit the cabinet's proportions into an 80 × 64 box.
  const boxW = 80;
  const boxH = 64;
  const scale = Math.min((boxW - 8) / widthMm, (boxH - 8) / heightMm);
  const w = widthMm * scale;
  const h = heightMm * scale;
  const x0 = (boxW - w) / 2;
  // Wall cabinets hang at the top; everything else stands on the floor line.
  const y0 = moduleType === 'wall-cabinet' ? 4 : boxH - 4 - h;
  const fill = sw?.image ? `url(#${patternId})` : (sw?.color ?? '#efede8');
  const stroke = '#57534b';
  const gap = 1.2;

  // The front as rectangles, region by region: the whole front, or each
  // row of a 'mixed' front (split by its height ratios, top first).
  const inner = { x: x0 + gap, y: y0 + gap, w: w - gap * 2, h: h - gap * 2 };
  const panels: Panel[] = [];
  const openings: Rect[] = [];
  const shelfLines: number[] = [];
  const slats: Rect[] = [];
  const regions: { rect: Rect; row: FrontRowLayout | FrontLayout }[] = [];
  if (front.kind === 'mixed' && front.rows?.length) {
    const total = front.rows.reduce((t, r) => t + (r.heightRatio ?? 1), 0);
    let y = inner.y;
    for (const row of front.rows) {
      const rh = (inner.h * (row.heightRatio ?? 1)) / total;
      regions.push({ rect: { x: inner.x, y, w: inner.w, h: rh - gap }, row });
      y += rh;
    }
  } else {
    regions.push({ rect: inner, row: front });
  }
  for (const { rect, row } of regions) {
    const count = clampCount(row.count ?? 3);
    switch (row.kind) {
      case 'double-door': {
        const half = (rect.w - gap) / 2;
        panels.push({ ...rect, w: half, handle: 'right' }, { ...rect, x: rect.x + half + gap, w: half, handle: 'left' });
        break;
      }
      case 'drawers':
      case 'trolley': {
        const each = (rect.h - gap * (count - 1)) / count;
        for (let k = 0; k < count; k++) panels.push({ ...rect, y: rect.y + k * (each + gap), h: each, handle: 'h' });
        break;
      }
      case 'open-shelf':
        openings.push(rect);
        for (let k = 1; k < Math.max(2, count); k++) shelfLines.push(rect.y + (k * rect.h) / Math.max(2, count));
        break;
      case 'appliance-housing':
        openings.push(rect);
        break;
      case 'tambour':
        slats.push(rect);
        break;
      case 'false-front':
        panels.push({ ...rect });
        break;
      default:
        panels.push({ ...rect, handle: row.hinge === 'right' ? 'left' : 'right' });
    }
  }

  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} className={className} role="img" aria-label={`${moduleType} front`}>
      {sw?.image && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width={boxW} height={boxH}>
            <image href={sw.image} width={boxW} height={boxH} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        </defs>
      )}
      <rect x={x0} y={y0} width={w} height={h} rx={1} fill={fill} stroke={stroke} strokeWidth={0.8} />
      {/* Open fronts show the plain interior. */}
      {openings.map((o, i) => (
        <rect key={`o${i}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="#d9d5cc" stroke={stroke} strokeWidth={0.5} />
      ))}
      {shelfLines.map((y, i) => (
        <line key={`s${i}`} x1={inner.x} x2={inner.x + inner.w} y1={y} y2={y} stroke={stroke} strokeWidth={0.8} />
      ))}
      {front.kind === 'appliance-housing' && (
        <rect x={x0 + w * 0.12} y={y0 + h * 0.15} width={w * 0.76} height={h * 0.45} rx={1} fill="#3b3d40" opacity={0.7} />
      )}
      {slats.map((r, i) => (
        <g key={`t${i}`}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={stroke} strokeWidth={0.6} />
          {Array.from({ length: Math.max(3, Math.floor(r.h / 2.5)) }).map((_, k, arr) => (
            <line key={k} x1={r.x} x2={r.x + r.w} y1={r.y + ((k + 1) * r.h) / (arr.length + 1)} y2={r.y + ((k + 1) * r.h) / (arr.length + 1)} stroke={stroke} strokeWidth={0.3} />
          ))}
        </g>
      ))}
      {panels.map((p, i) => (
        <g key={i}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={0.8} fill={fill} stroke={stroke} strokeWidth={0.6} />
          {p.handle === 'h' && (
            <line x1={p.x + p.w * 0.38} x2={p.x + p.w * 0.62} y1={p.y + Math.min(3, p.h / 3)} y2={p.y + Math.min(3, p.h / 3)} stroke="#2b2b2b" strokeWidth={1} strokeLinecap="round" />
          )}
          {(p.handle === 'left' || p.handle === 'right') && (
            <line
              x1={p.handle === 'right' ? p.x + p.w - 3 : p.x + 3}
              x2={p.handle === 'right' ? p.x + p.w - 3 : p.x + 3}
              y1={p.y + p.h * 0.4}
              y2={p.y + p.h * 0.6}
              stroke="#2b2b2b"
              strokeWidth={1}
              strokeLinecap="round"
            />
          )}
        </g>
      ))}
      {/* The floor line, so base, wall and tall units read at a glance. */}
      <line x1={2} x2={boxW - 2} y1={boxH - 3.4} y2={boxH - 3.4} stroke="#c9c5bc" strokeWidth={0.8} />
    </svg>
  );
}
