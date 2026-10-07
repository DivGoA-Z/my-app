// src/lib/planDrawing.ts
//
// The kitchen from above, as a clean line drawing: the fifth panel of
// the elevation sheet (lib/elevationSheet.ts) and the "Top" drawing in
// the editor's elevation tab.
//
// WHY A PLAN AS WELL AS FOUR ELEVATIONS. Elevations show what is ON each
// wall, but not how the walls meet, nothing that stands free of a wall
// (an island), and not where the photo is taken from. A plan shows all
// three; for an image model it's the map that ties the four walls into
// one room.
//
// Drawn from the render brief, like the elevations, so the refs are the
// brief's. Conventions are the trade's: walls as a dark band with gaps
// for openings, door swings as a quarter arc, wall-hung units dashed
// (they're above), base units with the countertop over them, each unit's
// FRONT edge drawn heavy so you can tell which way it opens. North is up,
// matching the 2D plan.

import type { RenderBrief, BoxMm } from './renderBrief';
import { wallLengthMm } from './renderBrief';
import type { WallOrientation } from '../types/layout';

const WALL_MM = 100;
const INK = '#292524';
const LIGHT_INK = '#78716c';
const COUNTER_FILL = '#e7e5e4';
const TALL_FILL = '#d6d3d1';
const OPENING_FILL = '#e0f2fe';
const CAMERA = '#d97706';

export const HATCH_DEF = `<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f5f5f4"/><line x1="0" y1="0" x2="0" y2="8" stroke="${LIGHT_INK}" stroke-width="1.2"/></pattern>`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v * 10) / 10;

const SHORT_APPLIANCE: Record<string, string> = {
  'Stove / Hob': 'hob',
  Chimney: 'chimney',
  Oven: 'oven',
  OTG: 'OTG',
  Toaster: 'toaster',
  Sink: 'sink',
  Refrigerator: 'fridge',
  Microwave: 'microwave',
  Dishwasher: 'dishwasher',
  'Water Purifier (RO)': 'RO',
};

const FACING_VEC: Record<WallOrientation, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

// Along-wall offset (from the wall's START, the stored convention)
// back from the brief's "from the left as you face it".
function offsetFromStart(wall: WallOrientation, fromLeftMm: number, widthMm: number, len: number) {
  return wall === 'north' || wall === 'east' ? fromLeftMm : len - fromLeftMm - widthMm;
}

export interface PlanArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The plan's elements, fitted into `area` (px). Uses the `hatch` pattern,
// which the caller's <defs> must provide (HATCH_DEF).
export function planElements(brief: RenderBrief, area: PlanArea): string[] {
  const { widthMm: W, depthMm: D } = brief.room;
  const margin = 46; // room for the wall names
  const s = Math.min((area.width - margin * 2) / (W + WALL_MM * 2), (area.height - margin * 2) / (D + WALL_MM * 2));
  const ox = area.x + (area.width - W * s) / 2;
  const oy = area.y + (area.height - D * s) / 2;
  const PX = (x: number) => n(ox + x * s);
  const PY = (y: number) => n(oy + y * s);
  const L = (mm: number) => n(mm * s);
  const g: string[] = [];
  const rect = (x: number, y: number, w: number, d: number, attrs: string) =>
    `<rect x="${PX(x)}" y="${PY(y)}" width="${L(w)}" height="${L(d)}" ${attrs}/>`;
  const text = (x: number, y: number, t: string, o: { fill?: string; size?: number; bold?: boolean; rotate?: number } = {}) =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 12}" text-anchor="middle" dominant-baseline="middle" fill="${o.fill ?? INK}"${o.bold ? ' font-weight="bold"' : ''}${o.rotate ? ` transform="rotate(${o.rotate} ${n(x)} ${n(y)})"` : ''}>${esc(t)}</text>`;

  // Walls: a dark band around the room, cut for openings.
  g.push(rect(-WALL_MM, -WALL_MM, W + WALL_MM * 2, D + WALL_MM * 2, `fill="${INK}"`), rect(0, 0, W, D, 'fill="#ffffff"'));

  for (const op of brief.openings) {
    const len = wallLengthMm(op.wall, W, D);
    const start = offsetFromStart(op.wall, op.fromLeftMm, op.widthMm, len);
    const horizontal = op.wall === 'north' || op.wall === 'south';
    const bandX = horizontal ? start : op.wall === 'west' ? -WALL_MM : W;
    const bandY = horizontal ? (op.wall === 'north' ? -WALL_MM : D) : start;
    const bw = horizontal ? op.widthMm : WALL_MM;
    const bd = horizontal ? WALL_MM : op.widthMm;
    if (op.kind === 'Window') {
      g.push(rect(bandX, bandY, bw, bd, `data-ref="${op.ref}" fill="${OPENING_FILL}" stroke="${INK}" stroke-width="1"`));
      // The glass line along the middle of the wall.
      const mx = horizontal ? [start, start + op.widthMm] : [bandX + WALL_MM / 2, bandX + WALL_MM / 2];
      const my = horizontal ? [bandY + WALL_MM / 2, bandY + WALL_MM / 2] : [start, start + op.widthMm];
      g.push(`<line x1="${PX(mx[0])}" y1="${PY(my[0])}" x2="${PX(mx[1])}" y2="${PY(my[1])}" stroke="${INK}" stroke-width="1"/>`);
    } else {
      g.push(rect(bandX, bandY, bw, bd, `data-ref="${op.ref}" fill="#ffffff"`));
    }

    // In-swinging door: the leaf open at 90° and its arc.
    if (op.door?.opensIn && op.door.hingeSide && !op.door.state.startsWith('No door')) {
      const startIsLeft = op.wall === 'north' || op.wall === 'east';
      const hingeAtStart = (op.door.hingeSide === 'left') === startIsLeft;
      const along = hingeAtStart ? start : start + op.widthMm;
      const other = hingeAtStart ? start + op.widthMm : start;
      const inward = { north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0] }[op.wall];
      const wallLine = { north: 0, south: D, west: 0, east: W }[op.wall];
      const pt = (a: number, depth: number): [number, number] =>
        horizontal ? [a, wallLine + inward[1] * depth] : [wallLine + inward[0] * depth, a];
      const pivot = pt(along, 0);
      const leafEnd = pt(along, op.widthMm);
      const jamb = pt(other, 0);
      // Screen y points down, so a positive cross product is clockwise.
      const cross = (leafEnd[0] - pivot[0]) * (jamb[1] - pivot[1]) - (leafEnd[1] - pivot[1]) * (jamb[0] - pivot[0]);
      g.push(
        `<line data-door-leaf="${op.ref}" x1="${PX(pivot[0])}" y1="${PY(pivot[1])}" x2="${PX(leafEnd[0])}" y2="${PY(leafEnd[1])}" stroke="${INK}" stroke-width="2"/>`,
        `<path d="M ${PX(leafEnd[0])} ${PY(leafEnd[1])} A ${L(op.widthMm)} ${L(op.widthMm)} 0 0 ${cross > 0 ? 1 : 0} ${PX(jamb[0])} ${PY(jamb[1])}" fill="none" stroke="${LIGHT_INK}" stroke-width="1" stroke-dasharray="5 4"/>`
      );
    }
  }

  // Pillars and shafts.
  for (const o of brief.obstacles) {
    g.push(boxRect(o.box, `data-ref="${o.ref}" fill="url(#hatch)" stroke="${INK}" stroke-width="1.5"`, rect));
  }

  // Floor-standing units (countertop over base units), then appliances
  // at counter level, then everything hung above, dashed.
  const low = brief.cabinets.filter((c) => c.box.minZ < 900);
  const high = brief.cabinets.filter((c) => c.box.minZ >= 900);
  for (const c of low) {
    const isTall = c.box.maxZ - c.box.minZ > 1500;
    g.push(boxRect(c.box, `data-ref="${c.ref}" fill="${isTall ? TALL_FILL : COUNTER_FILL}" stroke="${INK}" stroke-width="1.5"`, rect));
    g.push(frontEdge(c.box, c.facing, PX, PY, 3));
  }
  const lowAppliances = brief.appliances.filter((a) => a.type !== 'Chimney');
  for (const a of lowAppliances) {
    const fill = a.type === 'Stove / Hob' ? '#57534e' : '#ffffff';
    g.push(boxRect(a.box, `data-ref="${a.ref}" fill="${fill}" stroke="${INK}" stroke-width="1.2"`, rect));
    if (a.type === 'Sink') {
      // The bowl: the catalogue's cutout when known, else inset 40mm.
      const w = a.box.maxX - a.box.minX;
      const d = a.box.maxY - a.box.minY;
      const cw = a.sinkCutoutMm ? Math.min(w, (a.facing === 'north' || a.facing === 'south' ? a.sinkCutoutMm.width : a.sinkCutoutMm.depth)) : w - 80;
      const cd = a.sinkCutoutMm ? Math.min(d, (a.facing === 'north' || a.facing === 'south' ? a.sinkCutoutMm.depth : a.sinkCutoutMm.width)) : d - 80;
      g.push(
        `<rect x="${PX(a.box.minX + (w - cw) / 2)}" y="${PY(a.box.minY + (d - cd) / 2)}" width="${L(cw)}" height="${L(cd)}" rx="${L(40)}" fill="none" stroke="${INK}" stroke-width="1"/>`
      );
    }
    g.push(frontEdge(a.box, a.facing, PX, PY, 2));
  }
  for (const c of high) {
    g.push(boxRect(c.box, `data-ref="${c.ref}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="6 4"`, rect));
  }
  for (const a of brief.appliances.filter((x) => x.type === 'Chimney')) {
    g.push(boxRect(a.box, `data-ref="${a.ref}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="2 3"`, rect));
  }

  // Labels stacked through a unit's depth so three things in one
  // footprint don't collide: a hung unit's near its back (the wall), an
  // appliance on the counter at its centre, a base unit's near its front.
  // A chimney isn't labelled here — it sits over the hob, and the
  // elevation names it.
  const label = (box: BoxMm, facing: WallOrientation, t: string, k: number, fill?: string) => {
    const [fx, fy] = FACING_VEC[facing];
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return text(ox + (cx + fx * k * (box.maxX - box.minX)) * s, oy + (cy + fy * k * (box.maxY - box.minY)) * s, t, { fill });
  };
  for (const c of low) g.push(label(c.box, c.facing, c.ref, 0.36));
  for (const c of high) g.push(label(c.box, c.facing, c.ref, -0.3));
  for (const a of lowAppliances) {
    const t = `${a.ref} ${SHORT_APPLIANCE[a.type] ?? a.type.toLowerCase()}`;
    g.push(label(a.box, a.facing, t, 0, a.type === 'Stove / Hob' ? '#ffffff' : undefined));
  }
  for (const o of brief.obstacles) {
    g.push(text(ox + ((o.box.minX + o.box.maxX) / 2) * s, oy + ((o.box.minY + o.box.maxY) / 2) * s, o.ref, { bold: true }));
  }
  for (const op of brief.openings) {
    const len = wallLengthMm(op.wall, W, D);
    const start = offsetFromStart(op.wall, op.fromLeftMm, op.widthMm, len);
    const mid = start + op.widthMm / 2;
    const out = WALL_MM + 160;
    const [lx, ly] =
      op.wall === 'north' ? [mid, -out] : op.wall === 'south' ? [mid, D + out] : op.wall === 'west' ? [-out, mid] : [W + out, mid];
    g.push(text(ox + lx * s, oy + ly * s, op.ref, { size: 11, fill: LIGHT_INK }));
  }

  // Where the photo is taken from: only a real standing position.
  const v = brief.view;
  if (v && v.mode === 'walkthrough' && v.positionMm.x >= 0 && v.positionMm.x <= W && v.positionMm.y >= 0 && v.positionMm.y <= D) {
    const aspect = v.imageHeightPx > 0 ? v.imageWidthPx / v.imageHeightPx : 16 / 9;
    const halfH = Math.atan(Math.tan((v.verticalFovDeg * Math.PI) / 360) * aspect);
    const reach = Math.min(W, D) * 0.35;
    const h = (v.headingDeg * Math.PI) / 180;
    const ray = (a: number) => [v.positionMm.x + Math.sin(a) * reach, v.positionMm.y - Math.cos(a) * reach];
    const [ax, ay] = ray(h - halfH);
    const [bx, by] = ray(h + halfH);
    g.push(
      `<polygon data-camera="1" points="${PX(v.positionMm.x)},${PY(v.positionMm.y)} ${PX(ax)},${PY(ay)} ${PX(bx)},${PY(by)}" fill="${CAMERA}" fill-opacity="0.18" stroke="${CAMERA}" stroke-width="1.5"/>`,
      `<circle cx="${PX(v.positionMm.x)}" cy="${PY(v.positionMm.y)}" r="5" fill="${CAMERA}"/>`,
      text(ox + v.positionMm.x * s, oy + v.positionMm.y * s + 16, 'camera', { fill: CAMERA, bold: true })
    );
  }

  // Wall names and lengths outside the band.
  const gap = (WALL_MM * s) + 16;
  g.push(
    text(ox + (W * s) / 2, oy - gap, `NORTH WALL · ${W} mm`, { bold: true }),
    text(ox + (W * s) / 2, oy + D * s + gap, `SOUTH WALL · ${W} mm`, { bold: true }),
    text(ox - gap, oy + (D * s) / 2, `WEST WALL · ${D} mm`, { bold: true, rotate: -90 }),
    text(ox + W * s + gap, oy + (D * s) / 2, `EAST WALL · ${D} mm`, { bold: true, rotate: 90 })
  );
  return g;
}

function boxRect(box: BoxMm, attrs: string, rect: (x: number, y: number, w: number, d: number, a: string) => string) {
  return rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, attrs);
}

// The heavy line along the side a unit opens to.
function frontEdge(box: BoxMm, facing: WallOrientation, PX: (x: number) => number, PY: (y: number) => number, width: number) {
  const [x1, y1, x2, y2] =
    facing === 'south'
      ? [box.minX, box.maxY, box.maxX, box.maxY]
      : facing === 'north'
        ? [box.minX, box.minY, box.maxX, box.minY]
        : facing === 'east'
          ? [box.maxX, box.minY, box.maxX, box.maxY]
          : [box.minX, box.minY, box.minX, box.maxY];
  return `<line data-front="1" x1="${PX(x1)}" y1="${PY(y1)}" x2="${PX(x2)}" y2="${PY(y2)}" stroke="${INK}" stroke-width="${width}"/>`;
}

// The plan on its own, for the editor's Top drawing.
export function planSvg(brief: RenderBrief, widthPx: number, heightPx: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" font-family="Helvetica, Arial, sans-serif">`,
    `<defs>${HATCH_DEF}</defs>`,
    `<rect width="${widthPx}" height="${heightPx}" fill="#ffffff"/>`,
    ...planElements(brief, { x: 0, y: 0, width: widthPx, height: heightPx }),
    '</svg>',
  ].join('\n');
}
