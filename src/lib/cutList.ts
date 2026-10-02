// src/lib/cutList.ts
//
// The cutting list: every board part the workshop cuts for a layout,
// derived from the cabinets' dimensions and fronts plus the business's
// ConstructionSettings (types/construction.ts).
//
// DERIVED, NEVER STORED — same rule as lib/bom.ts's header: a stored
// cutting list goes stale the moment a cabinet is resized. It's
// recomputed from the design every time it's shown or exported.
//
// DOES NOT FEED THE PRICE. Pricing is area-based by design
// (docs/PRINCIPLES.md Principle 2); this is a production document. The
// one intended bridge is phase 2's nesting, which will MEASURE sheet
// waste and let a business copy that figure into the project's sheet
// waste factor — by choice, never automatically.
//
// CONVENTIONS every part below follows
// - Millimetres, rounded to a whole mm (a workshop saw is set in whole
//   mm; 0.5mm precision here would be false precision) — exact halves
//   round DOWN, see mm() below for why.
// - `lengthMm` is the dimension that runs along the grain for a part
//   where grain matters (fronts — the finish's pattern runs vertically),
//   and simply the height-wise/longer dimension otherwise.
// - Carcass depth excludes the front: fronts are INSET into the stated
//   cabinet depth (lib/fronts.ts's FRONT_THICKNESS_MM comment), so a
//   600mm-deep cabinet has a 582mm carcass behind an 18mm shutter.
// - Edge banding is counted per EDGE, split by which dimension the edge
//   runs along — "1 long edge" on a side panel is its front edge.
//   Visible front edges of the carcass are banded; backs never are;
//   fronts (shutters, drawer fronts) are banded all round.
//
// KNOWN GAPS, surfaced as warnings rather than silently omitted
// (Principle 10): drawer box parts (phase 3), tambour shutters (bought
// as a unit), glass panels (ordered cut to size from a glass supplier),
// and the corner carousel's diagonal front carcass (listed as a
// rectangular box).

import type { MaterialType, PlacedCabinetItem } from '../types/cabinet';
import type { ConstructionSettings } from '../types/construction';
import type { SurfaceFinish } from '../types/finish';
import { resolveFinish } from '../types/finish';
import { defaultFrontLayout, GLASS_TINT_LABELS } from '../types/front';
import type { HardwareRates } from '../types/rates';
import { hasCountertop } from './cabinetGeometry';
import { carcassBands, computeFrontBreakdown, FRONT_THICKNESS_MM } from './fronts';
import { describeFinish } from './materials3d';

export type CutPartKind = 'carcass' | 'back' | 'front';

export interface EdgeBanding {
  // How many edges running along the part's LENGTH are banded (0-2),
  // and how many along its WIDTH (0-2).
  length: 0 | 1 | 2;
  width: 0 | 1 | 2;
}

export interface CutPart {
  // "C3" — the cabinet's position in the layout's cabinet list, 1-based.
  // Stable for a given design; what a workshop writes on each part.
  cabinetRef: string;
  cabinetLabel: string;
  kind: CutPartKind;
  name: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  material: MaterialType;
  // Fronts only — the laminate/acrylic that goes on this part.
  finish?: string;
  // Already multiplied by the cabinet's own quantity.
  quantity: number;
  edgeBanding: EdgeBanding;
  // True: the part may NOT be rotated on the sheet (its length must run
  // along the sheet's grain). Phase 2's nesting reads this.
  grainFixed: boolean;
}

export interface CutListGroup {
  key: string;
  // "18mm HDMR — carcass"
  label: string;
  kind: CutPartKind;
  material: MaterialType;
  thicknessMm: number;
  finish?: string;
  parts: CutPart[];
  pieceCount: number;
  areaSqM: number;
  edgeBandM: number;
}

export interface CutList {
  parts: CutPart[];
  groups: CutListGroup[];
  // Human-readable, one per known gap that affects THIS layout.
  warnings: string[];
}

// computeFrontBreakdown needs rates to price hardware; the cutting list
// only reads its geometry, so zeros are passed — no price produced here
// can leak anywhere (the hardware array is never read).
const NO_RATES: HardwareRates = {
  hinge: 0,
  channel: 0,
  basket: 0,
  shelf: 0,
  cornerMagic: 0,
  cornerCarousel: 0,
};

const MM2_PER_SQM = 1_000_000;

const FRONT_PART_NAMES: Record<string, string> = {
  'single-door': 'Shutter',
  'double-door': 'Shutter',
  'open-shelf': 'Shutter',
  drawers: 'Drawer front',
  trolley: 'Trolley front',
  'false-front': 'False front',
};

function formatModuleType(moduleType: string): string {
  return moduleType
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Whole mm, with an exact .5 rounded DOWN rather than up. Caught by
// running this on an 800mm double-door wall unit: each leaf is 395.5mm,
// and ordinary rounding made both 396 — two leaves plus three 3mm
// reveals = 801mm, a millimetre wider than the cabinet. Down-rounding a
// half can only ever leave a hair more gap; up-rounding can make doors
// that don't fit. The 0.001 nudge leaves every non-half value rounding
// normally (395.9 → 396, 395.4 → 395).
const mm = (value: number) => Math.round(value - 0.001);

function cabinetParts(
  item: PlacedCabinetItem,
  cabinetRef: string,
  settings: ConstructionSettings,
  finishes: SurfaceFinish[],
  warnings: string[]
): CutPart[] {
  const T = settings.carcassThicknessMm;
  const W = item.widthMm;
  const H = item.heightMm;
  const isBase = hasCountertop(item.moduleType);
  const usesRails = isBase && settings.baseTop === 'rails';
  const backT = settings.backFit === 'inset-full' ? T : settings.backThicknessMm;

  // See the header: the front is inset into the stated depth. A nailed-
  // on back sits behind the carcass, so it takes its own thickness out
  // of the carcass depth too, or the cabinet would end up deeper than
  // quoted and collide with the wall.
  const carcassDepth =
    item.depthMm - FRONT_THICKNESS_MM - (settings.backFit === 'nailed-on' ? backT : 0);
  // An inset full-thickness back sits INSIDE the carcass, between the
  // sides, so top/bottom/shelves stop in front of it.
  const innerDepth = carcassDepth - (settings.backFit === 'inset-full' ? T : 0);
  // Shelves and dividers also stop short of the front by the setback,
  // and — for a grooved back — short of the back board itself.
  // Approximation: the groove's distance from the rear edge isn't a
  // setting yet, so only the back's own thickness is allowed for.
  const shelfDepth =
    innerDepth - settings.shelfSetbackMm - (settings.backFit === 'grooved' ? backT : 0);
  const betweenWidth = W - 2 * T;

  const label = `${formatModuleType(item.moduleType)} ${W}×${item.depthMm}×${H}`;
  const q = item.quantity;
  const parts: CutPart[] = [];
  const add = (
    part: Omit<CutPart, 'cabinetRef' | 'cabinetLabel' | 'material' | 'lengthMm' | 'widthMm'> & {
      lengthMm: number;
      widthMm: number;
    }
  ) => {
    const lengthMm = mm(part.lengthMm);
    const widthMm = mm(part.widthMm);
    if (lengthMm <= 0 || widthMm <= 0 || part.quantity <= 0) return;
    parts.push({ ...part, lengthMm, widthMm, cabinetRef, cabinetLabel: label, material: item.material });
  };

  // ---- Sides ----
  // Shortened by T at each end whose panel runs OVER them. Rails always
  // fit between the sides, so a railed base top never shortens them.
  const topOver = !usesRails && settings.topFit === 'over-sides';
  const bottomOver = settings.bottomFit === 'over-sides';
  add({
    kind: 'carcass',
    name: 'Side',
    lengthMm: H - (topOver ? T : 0) - (bottomOver ? T : 0),
    widthMm: carcassDepth,
    thicknessMm: T,
    quantity: 2 * q,
    edgeBanding: { length: 1, width: 0 },
    grainFixed: false,
  });

  // ---- Top, or rails ----
  if (usesRails) {
    add({
      kind: 'carcass',
      name: 'Front rail',
      lengthMm: betweenWidth,
      widthMm: settings.railWidthMm,
      thicknessMm: T,
      quantity: q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
    add({
      kind: 'carcass',
      name: 'Back rail',
      lengthMm: betweenWidth,
      widthMm: settings.railWidthMm,
      thicknessMm: T,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
    });
  } else {
    add({
      kind: 'carcass',
      name: 'Top',
      lengthMm: topOver ? W : betweenWidth,
      widthMm: innerDepth,
      thicknessMm: T,
      quantity: q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
  }

  // ---- Bottom ----
  add({
    kind: 'carcass',
    name: 'Bottom',
    lengthMm: bottomOver ? W : betweenWidth,
    widthMm: innerDepth,
    thicknessMm: T,
    quantity: q,
    edgeBanding: { length: 1, width: 0 },
    grainFixed: false,
  });

  // ---- Back ----
  // The inner opening is W−2T by H−2T in every convention: the top
  // (or back rail) and bottom are T thick whether they sit between the
  // sides or over them.
  const innerH = H - 2 * T;
  if (settings.backFit === 'grooved') {
    add({
      kind: 'back',
      name: 'Back',
      lengthMm: innerH + 2 * settings.grooveDepthMm,
      widthMm: betweenWidth + 2 * settings.grooveDepthMm,
      thicknessMm: backT,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
    });
  } else if (settings.backFit === 'nailed-on') {
    add({
      kind: 'back',
      name: 'Back',
      lengthMm: H,
      widthMm: W,
      thicknessMm: backT,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
    });
  } else {
    add({
      kind: 'carcass',
      name: 'Back',
      lengthMm: innerH,
      widthMm: betweenWidth,
      thicknessMm: T,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
    });
  }

  // ---- Dividers, shelves, fronts ----
  const layout = item.frontLayout ?? defaultFrontLayout(item.moduleType, W);
  const bands = carcassBands(layout, H);
  if (bands.length > 1) {
    add({
      kind: 'carcass',
      name: 'Divider',
      lengthMm: betweenWidth,
      widthMm: shelfDepth,
      thicknessMm: T,
      quantity: (bands.length - 1) * q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
  }

  // No handle is passed: only panel/shelf GEOMETRY is read here, and a
  // handle never changes a panel's size.
  const breakdown = computeFrontBreakdown(layout, W, H, undefined, NO_RATES);
  if (breakdown.shelves.length > 0) {
    add({
      kind: 'carcass',
      name: 'Shelf',
      lengthMm: betweenWidth,
      widthMm: shelfDepth,
      thicknessMm: T,
      quantity: breakdown.shelves.length * q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
  }

  const finishLabel = describeFinish(resolveFinish(finishes, item.finishId));
  let glassCount = 0;
  let glassTint: string | undefined;
  let tambourCount = 0;
  for (const panel of breakdown.panels) {
    if (panel.glassTint) {
      glassCount++;
      glassTint = GLASS_TINT_LABELS[panel.glassTint];
      continue;
    }
    if (panel.kind === 'tambour') {
      tambourCount++;
      continue;
    }
    add({
      kind: 'front',
      name: FRONT_PART_NAMES[panel.kind] ?? 'Front',
      lengthMm: panel.heightMm,
      widthMm: panel.widthMm,
      thicknessMm: FRONT_THICKNESS_MM,
      finish: finishLabel,
      quantity: q,
      edgeBanding: { length: 2, width: 2 },
      grainFixed: true,
    });
  }

  if (glassCount > 0) {
    warnings.push(
      `${cabinetRef}: ${glassCount * q} glass panel${glassCount * q === 1 ? '' : 's'} (${glassTint}) not listed — order cut to size from the glass supplier.`
    );
  }
  if (tambourCount > 0) {
    warnings.push(`${cabinetRef}: tambour shutter not listed — bought as a unit.`);
  }
  if (item.moduleType === 'corner-carousel') {
    warnings.push(
      `${cabinetRef}: corner carousel listed as a plain rectangular box — its diagonal front isn't modelled yet. Check with your carpenter.`
    );
  }
  // Panel kinds survive 'mixed' composition (FrontPanel.kind), so this
  // catches a drawer row inside a mixed front too.
  if (breakdown.panels.some((p) => p.kind === 'drawers')) {
    warnings.push(`${cabinetRef}: drawer box parts not listed yet (drawer fronts are).`);
  }
  return parts;
}

export function computeCutList(
  cabinets: PlacedCabinetItem[],
  settings: ConstructionSettings,
  finishes: SurfaceFinish[]
): CutList {
  const warnings: string[] = [];
  const parts = cabinets.flatMap((item, i) =>
    cabinetParts(item, `C${i + 1}`, settings, finishes, warnings)
  );

  // Grouped by what's physically the same stock: carcass board of one
  // material and thickness is one pile of sheets; thin backs another;
  // fronts are split by finish too, because a walnut shutter and a
  // white one are cut from differently laminated boards.
  const byKey = new Map<string, CutListGroup>();
  for (const part of parts) {
    const key = [part.kind, part.material, part.thicknessMm, part.finish ?? ''].join('|');
    let group = byKey.get(key);
    if (!group) {
      const kindLabel = part.kind === 'front' ? `fronts, ${part.finish}` : part.kind === 'back' ? 'backs' : 'carcass';
      group = {
        key,
        label: `${part.thicknessMm}mm ${part.material} — ${kindLabel}`,
        kind: part.kind,
        material: part.material,
        thicknessMm: part.thicknessMm,
        finish: part.finish,
        parts: [],
        pieceCount: 0,
        areaSqM: 0,
        edgeBandM: 0,
      };
      byKey.set(key, group);
    }
    group.parts.push(part);
    group.pieceCount += part.quantity;
    group.areaSqM += (part.lengthMm * part.widthMm * part.quantity) / MM2_PER_SQM;
    group.edgeBandM += edgeBandMm(part) / 1000;
  }

  const kindOrder: CutPartKind[] = ['carcass', 'back', 'front'];
  const groups = [...byKey.values()].sort(
    (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.label.localeCompare(b.label)
  );
  return { parts, groups, warnings };
}

// Running length of edge banding on ALL copies of one part row.
export function edgeBandMm(part: CutPart): number {
  return (
    (part.edgeBanding.length * part.lengthMm + part.edgeBanding.width * part.widthMm) *
    part.quantity
  );
}

// "2L 1W" / "—" — the trade's shorthand for which edges get banded.
export function describeEdgeBanding(e: EdgeBanding): string {
  if (e.length === 0 && e.width === 0) return '—';
  return [e.length ? `${e.length}L` : '', e.width ? `${e.width}W` : ''].filter(Boolean).join(' ');
}

// Identical parts merged, for the workshop's cutting view: same stock
// (group), same name, same size, same banding → one row with the
// quantities summed and the cabinet refs listed. The per-cabinet list
// is still what's exported alongside, so nothing is lost.
export interface ConsolidatedPart extends Omit<CutPart, 'cabinetRef' | 'cabinetLabel'> {
  cabinetRefs: string[];
}

export function consolidateParts(parts: CutPart[]): ConsolidatedPart[] {
  const byKey = new Map<string, ConsolidatedPart>();
  for (const p of parts) {
    const key = [
      p.kind,
      p.material,
      p.thicknessMm,
      p.finish ?? '',
      p.name,
      p.lengthMm,
      p.widthMm,
      p.edgeBanding.length,
      p.edgeBanding.width,
      p.grainFixed,
    ].join('|');
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += p.quantity;
      if (!existing.cabinetRefs.includes(p.cabinetRef)) existing.cabinetRefs.push(p.cabinetRef);
    } else {
      byKey.set(key, {
        kind: p.kind,
        name: p.name,
        lengthMm: p.lengthMm,
        widthMm: p.widthMm,
        thicknessMm: p.thicknessMm,
        material: p.material,
        finish: p.finish,
        quantity: p.quantity,
        edgeBanding: p.edgeBanding,
        grainFixed: p.grainFixed,
        cabinetRefs: [p.cabinetRef],
      });
    }
  }
  return [...byKey.values()];
}
