// src/lib/elevationSheet.ts
//
// The four walls on one sheet: the reference image the render brief
// (lib/renderBrief.ts) ships with. Each wall is drawn straight on, as you
// stand in the room facing it, all four at ONE scale so a 3000mm wall
// and a 2400mm wall keep their real proportions next to each other.
//
// WHY NOT A SCREENSHOT OF THE ELEVATION SCREEN (WallElevationView). That
// one is for designers: dimension chains, amber gaps, click-to-measure.
// An image model copies what it sees, so those lines and numbers turn up
// in the "photo". And it draws a unit as one labelled box, while the
// thing image models get wrong is inside the box: two doors or three
// drawers, where the handles are, a sink or a hob. So this is drawn from
// the brief's own data instead: fronts split into their real panels,
// handle marks, countertop, appliances as simple shapes, openings and
// pillars. Labels sit OUTSIDE the drawing (strips above and below each
// wall), never on the units, and match the brief's refs.
//
// Built as an SVG string (pure, testable, no DOM); lib/svgToPng.ts turns
// it into the PNG that gets downloaded.
//
// Colour is deliberately left out — everything is light neutral line
// work. Finishes come from the brief, where they are named and linked to
// swatch photos; a flat fill here would compete with that.

import type { RenderBrief, BoxMm, CabinetEntry, ApplianceEntry } from './renderBrief';
import { fromLeftOnWall } from './renderBrief';
import { planElements, HATCH_DEF } from './planDrawing';
import type { WallOrientation } from '../types/layout';

const WALLS: WallOrientation[] = ['north', 'east', 'south', 'west'];
// Same 60mm "touching the wall" tolerance as lib/surfaceAreas.ts.
const TOUCH_MM = 60;

// Sheet layout, in px.
// The longest wall's drawn length. Image models shrink what they're
// given to roughly 1,500–2,000px on the long side, so the three-column
// sheet is kept to about that at 1× (it's rasterised at 2×).
const DRAW_WIDTH_PX = 800;
const PAD_X = 70;
const TITLE_H = 44;
const LABEL_ROW_H = 20;
const LABEL_ROWS = 3;
const DIM_H = 40;
const SHEET_HEADER_H = 70;
const LABEL_CHAR_PX = 7.2;

const INK = '#292524';
const LIGHT_INK = '#78716c';
const WALL_FILL = '#ffffff';
const INTERIOR_FILL = '#d6d3d1'; // inside a carcass: open niches and shelves
const PANEL_FILL = '#fafaf9';
const GLASS_FILL = '#e0f2fe';
const COUNTER_FILL = '#a8a29e';
const NEIGHBOUR_FILL = '#e7e5e4';
const OPENING_FILL = '#e0f2fe';
const DOOR_FILL = '#f5f5f4';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

interface Label {
  text: string;
  centerMm: number;
  up: boolean; // in the strip above the wall
}

export interface ElevationSheet {
  svg: string;
  widthPx: number;
  heightPx: number;
}

function touchesWall(wall: WallOrientation, box: BoxMm, roomW: number, roomD: number): boolean {
  switch (wall) {
    case 'north':
      return box.minY <= TOUCH_MM;
    case 'south':
      return box.maxY >= roomD - TOUCH_MM;
    case 'west':
      return box.minX <= TOUCH_MM;
    case 'east':
      return box.maxX >= roomW - TOUCH_MM;
  }
}

function rectOf(box: BoxMm) {
  return { x: box.minX, y: box.minY, widthMm: box.maxX - box.minX, depthMm: box.maxY - box.minY };
}

const alongWidth = (wall: WallOrientation, box: BoxMm) =>
  wall === 'north' || wall === 'south' ? box.maxX - box.minX : box.maxY - box.minY;

export function elevationSheetSvg(brief: RenderBrief): ElevationSheet {
  const { widthMm: roomW, depthMm: roomD, ceilingHeightMm: ceiling } = brief.room;
  const longest = Math.max(roomW, roomD);
  const s = DRAW_WIDTH_PX / longest; // px per mm, shared by all four walls
  const drawH = ceiling * s;
  const panelW = DRAW_WIDTH_PX + PAD_X * 2;
  const panelH = TITLE_H + LABEL_ROWS * LABEL_ROW_H + drawH + LABEL_ROWS * LABEL_ROW_H + DIM_H + 20;
  // Three columns: plan + legend, then the four walls in two pairs.
  const widthPx = Math.ceil(panelW * 3);
  const heightPx = Math.ceil(SHEET_HEADER_H + panelH * 2);

  const cabByRef = new Map(brief.cabinets.map((c) => [c.ref, c]));
  const appByRef = new Map(brief.appliances.map((a) => [a.ref, a]));
  const obsByRef = new Map(brief.obstacles.map((o) => [o.ref, o]));
  const opByRef = new Map(brief.openings.map((o) => [o.ref, o]));

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" font-family="Helvetica, Arial, sans-serif">`,
    `<defs>${HATCH_DEF}`,
    `<pattern id="glass" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="14" height="14" fill="${GLASS_FILL}"/><line x1="0" y1="0" x2="0" y2="14" stroke="#7dd3fc" stroke-width="1"/></pattern></defs>`,
    `<rect width="${widthPx}" height="${heightPx}" fill="#ffffff"/>`,
    `<text x="${PAD_X}" y="34" font-size="22" font-weight="bold" fill="${INK}">${esc(brief.designName)} — plan and wall elevations</text>`,
    `<text x="${PAD_X}" y="56" font-size="13" fill="${LIGHT_INK}">Plan from above, then each wall seen straight on from inside the room (all four walls to one scale). Room ${roomW} × ${roomD} mm, ceiling ${ceiling} mm. Labels match the render brief.</text>`
  );
  // Scale bar: 1000 mm.
  const barX = widthPx - PAD_X - 1000 * s;
  out.push(
    `<line x1="${n(barX)}" y1="48" x2="${n(barX + 1000 * s)}" y2="48" stroke="${INK}" stroke-width="2"/>`,
    `<line x1="${n(barX)}" y1="43" x2="${n(barX)}" y2="53" stroke="${INK}" stroke-width="2"/>`,
    `<line x1="${n(barX + 1000 * s)}" y1="43" x2="${n(barX + 1000 * s)}" y2="53" stroke="${INK}" stroke-width="2"/>`,
    `<text x="${n(barX + 500 * s)}" y="38" font-size="12" text-anchor="middle" fill="${INK}">1000 mm</text>`
  );

  // Column 0: the plan (its own fit-to-panel scale, since a deep room
  // would not fit at the walls' scale) over the legend.
  out.push(
    `<text x="${PAD_X}" y="${SHEET_HEADER_H + 26}" font-size="16" font-weight="bold" fill="${INK}">PLAN</text>`,
    `<text x="${PAD_X + 52}" y="${SHEET_HEADER_H + 26}" font-size="12" fill="${LIGHT_INK}">from above, north at the top</text>`,
    `<g data-plan="1">`,
    ...planElements(brief, { x: 20, y: SHEET_HEADER_H + TITLE_H, width: panelW - 40, height: panelH - TITLE_H }),
    '</g>',
    ...legend(PAD_X, SHEET_HEADER_H + panelH + 30)
  );

  WALLS.forEach((wallName, i) => {
    const wall = brief.room.walls.find((w) => w.wall === wallName)!;
    const len = wall.lengthMm;
    const ox = (1 + (i % 2)) * panelW + PAD_X;
    const top = SHEET_HEADER_H + Math.floor(i / 2) * panelH;
    const oy = top + TITLE_H + LABEL_ROWS * LABEL_ROW_H; // y of the ceiling line
    const X = (mm: number) => n(ox + Math.max(0, Math.min(len, mm)) * s);
    const Y = (z: number) => n(oy + (ceiling - z) * s);
    const W = (mm: number) => n(mm * s);
    const rect = (l: number, b: number, w: number, h: number, attrs: string) => {
      const x0 = Math.max(0, l);
      const x1 = Math.min(len, l + w);
      if (x1 <= x0 || h <= 0) return '';
      return `<rect x="${X(x0)}" y="${Y(b + h)}" width="${W(x1 - x0)}" height="${W(h)}" ${attrs}/>`;
    };
    const labels: Label[] = [];
    const g: string[] = [];

    g.push(
      `<text x="${ox}" y="${top + 26}" font-size="16" font-weight="bold" fill="${INK}">${wallName.toUpperCase()} WALL</text>`,
      `<text x="${ox + 120}" y="${top + 26}" font-size="12" fill="${LIGHT_INK}">facing ${wallName}; left end = ${wall.leftCorner} corner · ${len} mm</text>`,
      rect(0, 0, len, ceiling, `fill="${WALL_FILL}" stroke="${INK}" stroke-width="1.5"`)
    );

    // Openings, behind everything that stands in front of the wall.
    for (const el of wall.elementsLeftToRight) {
      const op = opByRef.get(el.ref);
      if (!op) continue;
      const short = op.kind.toLowerCase().startsWith('pass') ? 'hatch' : op.kind.toLowerCase();
      labels.push({ text: `${op.ref} ${short}`, centerMm: el.fromLeftMm + el.widthMm / 2, up: (el.bottomMm + el.topMm) / 2 > ceiling / 2 });
      if (op.door) {
        const open = !op.door.state.startsWith('Closed');
        g.push(rect(el.fromLeftMm, el.bottomMm, el.widthMm, el.topMm - el.bottomMm, `fill="${open ? OPENING_FILL : DOOR_FILL}" stroke="${INK}" stroke-width="1.5"`));
        if (!open) {
          // Handle on the edge that swings: opposite the hinge. No hinge
          // side recorded (out-swinging, sliding) → centre-right, as drawn.
          const hingeLeft = op.door.hingeSide !== 'right';
          const hx = hingeLeft ? el.fromLeftMm + el.widthMm - 80 : el.fromLeftMm + 80;
          g.push(`<circle cx="${X(hx)}" cy="${Y(1000)}" r="${n(Math.max(2.5, 30 * s))}" fill="${INK}"/>`);
        }
      } else {
        g.push(rect(el.fromLeftMm, el.bottomMm, el.widthMm, el.topMm - el.bottomMm, `fill="${OPENING_FILL}" stroke="${INK}" stroke-width="2"`));
        if (op.kind === 'Window') {
          g.push(rect(el.fromLeftMm + 40, el.bottomMm + 40, el.widthMm - 80, el.topMm - el.bottomMm - 80, `fill="none" stroke="${INK}" stroke-width="1"`));
          const mid = el.fromLeftMm + el.widthMm / 2;
          g.push(`<line x1="${X(mid)}" y1="${Y(el.topMm - 40)}" x2="${X(mid)}" y2="${Y(el.bottomMm + 40)}" stroke="${INK}" stroke-width="1"/>`);
        }
      }
    }

    // Sides of units that belong to the neighbouring walls but stand in
    // this wall's corners — without them an L-run looks like it stops.
    const sideOf = (ref: string, against: { wall: WallOrientation } | null, box: BoxMm) => {
      if (!against || against.wall === wallName || !touchesWall(wallName, box, roomW, roomD)) return;
      const left = fromLeftOnWall(wallName, rectOf(box), roomW, roomD);
      g.push(rect(left, box.minZ, alongWidth(wallName, box), box.maxZ - box.minZ, `fill="${NEIGHBOUR_FILL}" stroke="${LIGHT_INK}" stroke-width="1" stroke-dasharray="4 3"`));
      labels.push({ text: `(${ref})`, centerMm: left + alongWidth(wallName, box) / 2, up: box.minZ > ceiling / 2 });
    };
    brief.cabinets.forEach((c) => sideOf(c.ref, c.against, c.box));
    brief.appliances.forEach((a) => sideOf(a.ref, a.against, a.box));

    // Pillars and shafts.
    for (const el of wall.elementsLeftToRight) {
      const o = obsByRef.get(el.ref);
      if (!o) continue;
      g.push(rect(el.fromLeftMm, el.bottomMm, el.widthMm, el.topMm - el.bottomMm, `fill="url(#hatch)" stroke="${INK}" stroke-width="1.5"`));
      labels.push({ text: `${o.ref} ${o.type.toLowerCase().split(' ').pop()}`, centerMm: el.fromLeftMm + el.widthMm / 2, up: false });
    }

    // Cabinets, then the countertop over them, then appliances on top.
    const counters: string[] = [];
    for (const el of wall.elementsLeftToRight) {
      const c = cabByRef.get(el.ref);
      if (!c) continue;
      g.push(...drawCabinet(c, el.fromLeftMm, rect, X, Y, s));
      labels.push({ text: c.ref, centerMm: el.fromLeftMm + el.widthMm / 2, up: c.box.minZ > ceiling / 2 });
      if (c.countertop && brief.countertop) {
        // Front overhang only shows in plan; sideways it would run into
        // a tall unit beside the run, so the slab is drawn unit-wide.
        counters.push(rect(el.fromLeftMm, c.box.maxZ, el.widthMm, brief.countertop.thicknessMm, `fill="${COUNTER_FILL}" stroke="${INK}" stroke-width="1"`));
      }
    }
    g.push(...counters);
    for (const el of wall.elementsLeftToRight) {
      const a = appByRef.get(el.ref);
      if (!a) continue;
      g.push(...drawAppliance(a, el.fromLeftMm, el.widthMm, rect, X, Y, s));
      labels.push({ text: `${a.ref} ${SHORT_APPLIANCE[a.type] ?? a.type.toLowerCase()}`, centerMm: el.fromLeftMm + el.widthMm / 2, up: a.box.minZ > ceiling / 2 });
    }

    // Floor line, heavier, drawn last so nothing covers it.
    g.push(`<line x1="${X(0)}" y1="${Y(0)}" x2="${X(len)}" y2="${Y(0)}" stroke="${INK}" stroke-width="3"/>`);

    // Labels in strips above and below, stacked into rows so they never
    // overlap; a thin tick ties each to its item.
    for (const up of [true, false]) {
      const rows: number[] = Array.from({ length: LABEL_ROWS }, () => -Infinity);
      const strip = labels.filter((l) => l.up === up).sort((a, b) => a.centerMm - b.centerMm);
      for (const l of strip) {
        const cx = ox + l.centerMm * s;
        const half = (l.text.length * LABEL_CHAR_PX) / 2 + 4;
        let row = rows.findIndex((right) => right < cx - half);
        if (row === -1) row = LABEL_ROWS - 1;
        rows[row] = cx + half;
        const ty = up ? oy - 8 - row * LABEL_ROW_H : Y(0) + 18 + row * LABEL_ROW_H;
        const tickFrom = up ? oy : Y(0);
        const tickTo = up ? ty + 4 : ty - 13;
        g.push(
          `<line x1="${n(cx)}" y1="${n(tickFrom)}" x2="${n(cx)}" y2="${n(tickTo)}" stroke="${LIGHT_INK}" stroke-width="0.8"/>`,
          `<text x="${n(cx)}" y="${n(ty)}" font-size="12" text-anchor="middle" fill="${INK}">${esc(l.text)}</text>`
        );
      }
    }

    // Overall dimensions: length below, height on the left.
    const dimY = Y(0) + LABEL_ROWS * LABEL_ROW_H + 22;
    g.push(
      `<line x1="${X(0)}" y1="${n(dimY)}" x2="${X(len)}" y2="${n(dimY)}" stroke="${LIGHT_INK}" stroke-width="1"/>`,
      `<line x1="${X(0)}" y1="${n(dimY - 5)}" x2="${X(0)}" y2="${n(dimY + 5)}" stroke="${LIGHT_INK}" stroke-width="1"/>`,
      `<line x1="${X(len)}" y1="${n(dimY - 5)}" x2="${X(len)}" y2="${n(dimY + 5)}" stroke="${LIGHT_INK}" stroke-width="1"/>`,
      `<text x="${n((X(0) + X(len)) / 2)}" y="${n(dimY + 16)}" font-size="12" text-anchor="middle" fill="${LIGHT_INK}">${len} mm</text>`,
      `<text x="${n(ox - 14)}" y="${n((Y(0) + Y(ceiling)) / 2)}" font-size="12" text-anchor="middle" fill="${LIGHT_INK}" transform="rotate(-90 ${n(ox - 14)} ${n((Y(0) + Y(ceiling)) / 2)})">${ceiling} mm</text>`
    );

    out.push(`<g data-wall="${wallName}">`, ...g.filter(Boolean), '</g>');
  });

  out.push('</svg>');
  return { svg: out.join('\n'), widthPx, heightPx };
}

// What the symbols mean, for a model reading the sheet cold.
function legend(x: number, y: number): string[] {
  const rows: [string, string][] = [
    [`<line x1="0" y1="8" x2="34" y2="8" stroke="${INK}" stroke-width="3"/>`, 'Plan: heavy edge = the front of a unit (its doors open this way)'],
    [`<rect x="0" y="0" width="34" height="16" fill="${'#e7e5e4'}" stroke="${INK}"/>`, 'Plan: grey = countertop over base units; darker = tall unit'],
    [`<rect x="0" y="0" width="34" height="16" fill="none" stroke="${INK}" stroke-dasharray="6 4"/>`, 'Plan: dashed = wall-hung unit or chimney, above the counter'],
    [`<rect x="0" y="0" width="34" height="16" fill="url(#hatch)" stroke="${INK}"/>`, 'Pillar or shaft (structure, plastered like the wall)'],
    [`<rect x="0" y="0" width="34" height="16" fill="${OPENING_FILL}" stroke="${INK}"/>`, 'Window; a dashed quarter arc is a door swinging into the kitchen'],
    [`<rect x="0" y="0" width="34" height="16" fill="${INTERIOR_FILL}" stroke="${INK}"/>`, 'Elevation: darker inside a unit = open niche or open shelving'],
    [`<rect x="0" y="0" width="34" height="16" fill="${NEIGHBOUR_FILL}" stroke="${LIGHT_INK}" stroke-dasharray="4 3"/>`, 'Elevation: (C3) = the side of a unit on the next wall'],
    [`<polygon points="0,8 34,0 34,16" fill="#d97706" fill-opacity="0.18" stroke="#d97706"/>`, 'Plan: where the photo is taken from, and what it sees'],
  ];
  const out = [`<text x="${x}" y="${y}" font-size="16" font-weight="bold" fill="${INK}">KEY</text>`];
  rows.forEach(([symbol, words], i) => {
    const ry = y + 22 + i * 28;
    out.push(`<g transform="translate(${x} ${ry})">${symbol}</g>`, `<text x="${x + 48}" y="${ry + 12}" font-size="13" fill="${INK}">${esc(words)}</text>`);
  });
  out.push(
    `<text x="${x}" y="${y + 22 + rows.length * 28 + 20}" font-size="13" font-weight="bold" fill="${INK}">A diagram of geometry only: never draw its lines, labels or hatching.</text>`,
    `<text x="${x}" y="${y + 22 + rows.length * 28 + 40}" font-size="13" fill="${INK}">Colours, materials and light come from the render brief (JSON).</text>`
  );
  return out;
}

type RectFn = (l: number, b: number, w: number, h: number, attrs: string) => string;

function drawCabinet(
  c: CabinetEntry,
  left: number,
  rect: RectFn,
  X: (mm: number) => number,
  Y: (z: number) => number,
  s: number
): string[] {
  const g: string[] = [];
  const bottom = c.box.minZ;
  const w = c.sizeMm.width;
  // The carcass interior shows wherever there's no front: open shelves
  // and appliance niches read as openings, not as blank doors.
  g.push(rect(left, bottom, w, c.sizeMm.height, `data-ref="${c.ref}" fill="${INTERIOR_FILL}" stroke="${INK}" stroke-width="1.5"`));
  for (const z of c.fronts.shelvesFromBottomMm) {
    g.push(rect(left + 18, bottom + z, w - 36, 18, `fill="${PANEL_FILL}" stroke="${LIGHT_INK}" stroke-width="0.8"`));
  }
  for (const p of c.fronts.panels) {
    g.push(
      rect(left + p.fromLeftMm, bottom + p.fromBottomMm, p.widthMm, p.heightMm, `data-panel="${esc(p.kind)}" fill="${p.glass ? 'url(#glass)' : PANEL_FILL}" stroke="${INK}" stroke-width="1"`)
    );
    if (p.kind === 'tambour') {
      // Slats, so it doesn't read as a plain door.
      for (let z = 60; z < p.heightMm; z += 60) {
        const y = Y(bottom + p.fromBottomMm + z);
        g.push(`<line x1="${X(left + p.fromLeftMm)}" y1="${y}" x2="${X(left + p.fromLeftMm + p.widthMm)}" y2="${y}" stroke="${LIGHT_INK}" stroke-width="0.6"/>`);
      }
    }
    const h = p.handle;
    if (!h || h.kind === 'handleless') continue;
    const hx = left + h.centerFromLeftMm;
    const hz = bottom + h.centerFromBottomMm;
    if (h.kind === 'knob') {
      g.push(`<circle data-handle="knob" cx="${X(hx)}" cy="${Y(hz)}" r="${n(Math.max(2.5, 18 * s))}" fill="${INK}"/>`);
    } else if (h.orientation === 'vertical') {
      g.push(`<line data-handle="${h.kind}" x1="${X(hx)}" y1="${Y(hz + h.lengthMm / 2)}" x2="${X(hx)}" y2="${Y(hz - h.lengthMm / 2)}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`);
    } else {
      g.push(`<line data-handle="${h.kind}" x1="${X(hx - h.lengthMm / 2)}" y1="${Y(hz)}" x2="${X(hx + h.lengthMm / 2)}" y2="${Y(hz)}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`);
    }
  }
  return g;
}

function drawAppliance(
  a: ApplianceEntry,
  left: number,
  width: number,
  rect: RectFn,
  X: (mm: number) => number,
  Y: (z: number) => number,
  s: number
): string[] {
  const g: string[] = [];
  const b = a.box.minZ;
  const h = a.box.maxZ - a.box.minZ;
  const attrs = `data-ref="${a.ref}"`;
  switch (a.type) {
    case 'Chimney': {
      // Canopy at the bottom, duct above: the shape everyone reads as a hood.
      const canopy = Math.min(h, Math.max(120, h * 0.4));
      const inset = width * 0.3;
      g.push(
        `<polygon ${attrs} points="${X(left)},${Y(b)} ${X(left + width)},${Y(b)} ${X(left + width - inset)},${Y(b + canopy)} ${X(left + inset)},${Y(b + canopy)}" fill="${PANEL_FILL}" stroke="${INK}" stroke-width="1.5"/>`,
        rect(left + inset, b + canopy, width - inset * 2, h - canopy, `fill="${PANEL_FILL}" stroke="${INK}" stroke-width="1.5"`)
      );
      break;
    }
    case 'Sink': {
      // Seen straight on, a sink is its rim on the counter and its tap.
      // The bowl's depth isn't recorded, so none is drawn (an outline of
      // the stored box read as an object standing on the counter).
      g.push(rect(left, b, width, 15, `${attrs} fill="${LIGHT_INK}" stroke="${INK}" stroke-width="1"`));
      const tx = left + width / 2;
      g.push(
        `<path d="M ${X(tx)} ${Y(b)} L ${X(tx)} ${Y(b + 300)} Q ${X(tx)} ${Y(b + 360)} ${X(tx + 60)} ${Y(b + 360)} L ${X(tx + 110)} ${Y(b + 330)}" fill="none" stroke="${INK}" stroke-width="${n(Math.max(2, 25 * s))}" stroke-linecap="round"/>`
      );
      break;
    }
    case 'Stove / Hob': {
      g.push(rect(left, b, width, Math.max(h, 30), `${attrs} fill="${INK}" stroke="${INK}" stroke-width="1"`));
      break;
    }
    default:
      // A plain box: the data says nothing about doors or a freezer
      // split, and a guessed line here would be copied as fact.
      g.push(rect(left, b, width, h, `${attrs} fill="${PANEL_FILL}" stroke="${INK}" stroke-width="1.5"`));
  }
  return g;
}
