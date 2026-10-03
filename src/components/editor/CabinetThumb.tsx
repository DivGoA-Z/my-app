// src/components/editor/CabinetThumb.tsx
//
// A small front drawing of a cabinet for the editor's picture tiles
// (§85, UI principle 6: pictures over words). Generated from the
// cabinet's size and front (single/double door, drawers, open shelves,
// trolley, appliance opening…) and filled with its finish — the photo or
// generated texture where there is one, its colour otherwise. Not a
// render: a clear, recognisable sketch, drawn in proportion.

import { useId } from 'react';
import type { FrontLayout } from '../../types/front';
import { clampCount, defaultFrontLayout } from '../../types/front';
import type { ModuleType } from '../../types/cabinet';
import { finishSwatch } from '../../lib/designFinishes';
import { useLayoutStore } from '../../store/layoutStore';

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

  // The front panels as rectangles in the cabinet's own frame.
  const panels: { x: number; y: number; w: number; h: number; handle?: 'v' | 'h' | 'left' | 'right' }[] = [];
  const inner = { x: x0 + gap, y: y0 + gap, w: w - gap * 2, h: h - gap * 2 };
  const count = clampCount(front.count ?? 3);
  switch (front.kind) {
    case 'double-door': {
      const half = (inner.w - gap) / 2;
      panels.push({ ...inner, w: half, handle: 'right' }, { ...inner, x: inner.x + half + gap, w: half, handle: 'left' });
      break;
    }
    case 'drawers':
    case 'trolley': {
      const each = (inner.h - gap * (count - 1)) / count;
      for (let i = 0; i < count; i++) panels.push({ ...inner, y: inner.y + i * (each + gap), h: each, handle: 'h' });
      break;
    }
    case 'open-shelf':
    case 'appliance-housing':
      break;
    default:
      panels.push({ ...inner, handle: front.hinge === 'right' ? 'left' : 'right' });
  }
  const shelves = front.kind === 'open-shelf' ? Math.max(1, count - 1) : 0;

  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} className={className} role="img" aria-label={`${moduleType} front`}>
      {sw?.image && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width={boxW} height={boxH}>
            <image href={sw.image} width={boxW} height={boxH} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        </defs>
      )}
      {/* Carcass: a darker interior shows through open fronts. */}
      <rect x={x0} y={y0} width={w} height={h} rx={1} fill={front.kind === 'open-shelf' || front.kind === 'appliance-housing' ? '#d9d5cc' : fill} stroke={stroke} strokeWidth={0.8} />
      {Array.from({ length: shelves }).map((_, i) => {
        const y = y0 + ((i + 1) * h) / (shelves + 1);
        return <line key={i} x1={x0} x2={x0 + w} y1={y} y2={y} stroke={stroke} strokeWidth={0.8} />;
      })}
      {front.kind === 'appliance-housing' && (
        <rect x={x0 + w * 0.12} y={y0 + h * 0.15} width={w * 0.76} height={h * 0.45} rx={1} fill="#3b3d40" opacity={0.7} />
      )}
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
