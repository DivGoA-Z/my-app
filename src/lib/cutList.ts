// src/lib/cutList.ts
//
// The cutting list: every board part the workshop cuts for a layout,
// derived from each cabinet's dimensions, fronts and panel spec (which
// panels exist, from which board — types/cabinet.ts's PanelSpec,
// resolved by lib/panels.ts), plus the business's ConstructionSettings
// (how the panels are fitted — types/construction.ts).
//
// DERIVED, NEVER STORED — same rule as lib/bom.ts's header: a stored
// cutting list goes stale the moment a cabinet is resized. It's
// recomputed from the design every time it's shown or exported.
//
// IT IS ALSO WHAT PRICES THE BOARD (since §42). lib/bom.ts charges each
// cabinet's material as the sum of its parts' real areas × each part's
// own board rate — "price by real area" (Principle 2). Before §42 this
// file explicitly did NOT feed the price; that was dropped because the
// area pricing used instead (front face + half a side) was roughly a
// third of the board a cabinet really uses. One decomposition for both
// means the price and the workshop can never disagree about a panel.
//
// CONVENTIONS every part below follows
// - Millimetres, rounded to a whole mm (a workshop saw is set in whole
//   mm; 0.5mm precision here would be false precision) — exact halves
//   round DOWN, see mm() below for why.
// - Every panel's thickness is ITS OWN board's thickness. A 25mm left
//   side and an 18mm right side make the bottom W − 25 − 18 wide.
// - `lengthMm` is the dimension that runs along the grain for a part
//   where grain matters (fronts — the finish's pattern runs vertically),
//   and simply the height-wise/longer dimension otherwise.
// - Carcass depth excludes the front: fronts are INSET into the stated
//   cabinet depth (lib/fronts.ts's FRONT_THICKNESS_MM comment), so a
//   600mm-deep cabinet has a 582mm carcass behind an 18mm shutter.
// - Edge banding is counted per EDGE, split by which dimension the edge
//   runs along — "1 long edge" on a side panel is its front edge.
//   Visible front edges of the carcass are banded; backs never are;
//   fronts are banded all round.
// - An excluded panel (PanelSpec.included false) isn't listed, and the
//   panels around it stop allowing for it: no bottom → the sides run the
//   full height and the back stops at the floor of the carcass; no left
//   side → the bottom runs out to the left edge.
//
// KNOWN GAPS, surfaced as warnings rather than silently omitted
// (Principle 10): drawer box parts (phase 3), glass panels (ordered cut
// to size from a glass supplier), and the corner carousel's diagonal
// front carcass (listed as a rectangular box).

import type { MaterialType, PanelRole, PlacedCabinetItem } from '../types/cabinet';
import { PANEL_ROLE_LABELS } from '../types/cabinet';
import type { ConstructionSettings } from '../types/construction';
import type { SurfaceFinish } from '../types/finish';
import { resolveFinish } from '../types/finish';
import { defaultFrontLayout, GLASS_TINT_LABELS } from '../types/front';
import type { BoardRate, HardwareRates, RateCard } from '../types/rates';
import { boardLabel, LEGACY_BOARD_THICKNESS_MM, MATERIAL_RATE_LABELS } from '../types/rates';
import { hasCountertop } from './cabinetGeometry';
import { carcassBands, computeFrontBreakdown } from './fronts';
import { describeFinish } from './materials3d';
import { resolvePanels } from './panels';

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
  // Which cabinet this came from, by id — what lib/bom.ts groups on to
  // price each cabinet's own parts.
  cabinetId: string;
  kind: CutPartKind;
  role: PanelRole;
  name: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  material: MaterialType;
  // The board line this part is cut from — undefined only when no
  // suitable line exists on the rate card (warned; priced at ₹0).
  boardId?: string;
  boardName: string;
  ratePerSqM: number;
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
  // "HDMR 18mm — carcass"
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

export const MM2_PER_SQM = 1_000_000;

const FRONT_PART_NAMES: Record<string, string> = {
  'single-door': 'Shutter',
  'double-door': 'Shutter',
  'open-shelf': 'Shutter',
  drawers: 'Drawer front',
  trolley: 'Trolley front',
  'false-front': 'False front',
  // CORRECTED (§42): phase 1 left tambours off the list as "bought as a
  // unit". types/front.ts's own FrontKind comment says otherwise — "a
  // real, priced panel like a false-front (material + finish, cut and
  // edge-banded)" — and the code comment is the better authority. It is
  // listed as one panel at the shutter's size; how the workshop slats
  // it is the carpenter's call.
  tambour: 'Tambour shutter',
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

// The parts of ONE cabinet. Exported so lib/bom.ts can price a cabinet
// from exactly the parts the cutting list shows for it.
export function cabinetCutParts(
  item: PlacedCabinetItem,
  cabinetRef: string,
  settings: ConstructionSettings,
  finishes: SurfaceFinish[],
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>,
  warnings: string[]
): CutPart[] {
  const W = item.widthMm;
  const H = item.heightMm;
  const isBase = hasCountertop(item.moduleType);
  const panels = resolvePanels(item, rates, warnings, cabinetRef);

  // A role with no board at all still gets listed at the legacy 18mm so
  // the workshop sees the part; it's priced at ₹0 and warned about once
  // per cabinet.
  const missing = new Set<PanelRole>();
  const thick = (role: PanelRole) => {
    const board = panels[role].board;
    if (!board) missing.add(role);
    return board?.thicknessMm ?? LEGACY_BOARD_THICKNESS_MM;
  };
  const has = (role: PanelRole) => panels[role].included;

  const tLeft = has('leftSide') ? thick('leftSide') : 0;
  const tRight = has('rightSide') ? thick('rightSide') : 0;
  // Base units default to rails (your 29 Sep answer), everything else to
  // a full top — overridable per catalogue row and per cabinet.
  const topStyle = panels.top.topStyle ?? (isBase ? 'rails' : 'full');
  const tTop = has('top') ? thick('top') : 0;
  const tBottom = has('bottom') ? thick('bottom') : 0;
  const tBack = has('back') ? thick('back') : 0;
  // The front's physical thickness takes depth even if the business
  // doesn't cut fronts itself (excluded) — the shutter still hangs there
  // — but only an INCLUDED front with no board is worth warning about.
  const tFront = has('fronts')
    ? thick('fronts')
    : (panels.fronts.board?.thicknessMm ?? LEGACY_BOARD_THICKNESS_MM);

  // See the header: the front is inset into the stated depth. A nailed-
  // on back sits behind the carcass, so it takes its own thickness out
  // of the carcass depth too, or the cabinet would end up deeper than
  // quoted and collide with the wall.
  const backFitted = has('back');
  const carcassDepth =
    item.depthMm - tFront - (backFitted && settings.backFit === 'nailed-on' ? tBack : 0);
  // An inset back sits INSIDE the carcass, between the sides, so top,
  // bottom and shelves stop in front of it.
  const innerDepth = carcassDepth - (backFitted && settings.backFit === 'inset-full' ? tBack : 0);
  // Shelves and dividers also stop short of the front by the setback,
  // and — for a grooved back — short of the back board itself.
  // Approximation: the groove's distance from the rear edge isn't a
  // setting yet, so only the back's own thickness is allowed for.
  const shelfDepth =
    innerDepth -
    settings.shelfSetbackMm -
    (backFitted && settings.backFit === 'grooved' ? tBack : 0);
  const betweenWidth = W - tLeft - tRight;

  const label = `${formatModuleType(item.moduleType)} ${W}×${item.depthMm}×${H}`;
  const q = item.quantity;
  const parts: CutPart[] = [];
  const add = (
    role: PanelRole,
    part: Pick<CutPart, 'kind' | 'name' | 'quantity' | 'edgeBanding' | 'grainFixed' | 'finish'> & {
      lengthMm: number;
      widthMm: number;
    }
  ) => {
    const lengthMm = mm(part.lengthMm);
    const widthMm = mm(part.widthMm);
    if (lengthMm <= 0 || widthMm <= 0 || part.quantity <= 0) return;
    const board: BoardRate | undefined = panels[role].board;
    parts.push({
      ...part,
      lengthMm,
      widthMm,
      role,
      cabinetRef,
      cabinetLabel: label,
      cabinetId: item.id,
      thicknessMm: board?.thicknessMm ?? LEGACY_BOARD_THICKNESS_MM,
      material: board?.material ?? item.material,
      boardId: board?.id,
      boardName: board ? boardLabel(board) : `${MATERIAL_RATE_LABELS[item.material]} (no board line)`,
      ratePerSqM: board?.ratePerSqM ?? 0,
    });
  };

  // ---- Sides ----
  // Shortened at each end whose panel runs OVER them. Rails always fit
  // between the sides, so a railed top never shortens them; an excluded
  // top or bottom doesn't either.
  const topOver = has('top') && topStyle === 'full' && settings.topFit === 'over-sides';
  const bottomOver = has('bottom') && settings.bottomFit === 'over-sides';
  const sideHeight = H - (topOver ? tTop : 0) - (bottomOver ? tBottom : 0);
  for (const role of ['leftSide', 'rightSide'] as const) {
    if (!has(role)) continue;
    add(role, {
      kind: 'carcass',
      name: role === 'leftSide' ? 'Left side' : 'Right side',
      lengthMm: sideHeight,
      widthMm: carcassDepth,
      quantity: q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
  }

  // ---- Top, or rails ----
  if (has('top')) {
    if (topStyle === 'rails') {
      add('top', {
        kind: 'carcass',
        name: 'Front rail',
        lengthMm: betweenWidth,
        widthMm: settings.railWidthMm,
        quantity: q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
      });
      add('top', {
        kind: 'carcass',
        name: 'Back rail',
        lengthMm: betweenWidth,
        widthMm: settings.railWidthMm,
        quantity: q,
        edgeBanding: { length: 0, width: 0 },
        grainFixed: false,
      });
    } else {
      add('top', {
        kind: 'carcass',
        name: 'Top',
        lengthMm: topOver ? W : betweenWidth,
        widthMm: innerDepth,
        quantity: q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
      });
    }
  }

  // ---- Bottom ----
  if (has('bottom')) {
    add('bottom', {
      kind: 'carcass',
      name: 'Bottom',
      lengthMm: bottomOver ? W : betweenWidth,
      widthMm: innerDepth,
      quantity: q,
      edgeBanding: { length: 1, width: 0 },
      grainFixed: false,
    });
  }

  // ---- Back ----
  // The inner opening: between the sides, and between the top (or back
  // rail) and the bottom — each only if that panel is actually built.
  const innerH = H - tTop - tBottom;
  if (backFitted) {
    const g = settings.grooveDepthMm;
    const [backH, backW] =
      settings.backFit === 'grooved'
        ? [innerH + 2 * g, betweenWidth + 2 * g]
        : settings.backFit === 'nailed-on'
          ? [H, W]
          : [innerH, betweenWidth];
    add('back', {
      kind: 'back',
      name: 'Back',
      lengthMm: backH,
      widthMm: backW,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
    });
  }

  // ---- Dividers, shelves, fronts ----
  const layout = item.frontLayout ?? defaultFrontLayout(item.moduleType, W);
  const bands = carcassBands(layout, H);
  // No handle is passed: only panel/shelf GEOMETRY is read here, and a
  // handle never changes a panel's size.
  const breakdown = computeFrontBreakdown(layout, W, H, undefined, NO_RATES);

  if (has('shelves')) {
    if (bands.length > 1) {
      add('shelves', {
        kind: 'carcass',
        name: 'Divider',
        lengthMm: betweenWidth,
        widthMm: shelfDepth,
        quantity: (bands.length - 1) * q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
      });
    }
    if (breakdown.shelves.length > 0) {
      add('shelves', {
        kind: 'carcass',
        name: 'Shelf',
        lengthMm: betweenWidth,
        widthMm: shelfDepth,
        quantity: breakdown.shelves.length * q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
      });
    }
  }

  const finishLabel = describeFinish(resolveFinish(finishes, item.finishId));
  let glassCount = 0;
  let glassTint: string | undefined;
  for (const panel of breakdown.panels) {
    if (panel.glassTint) {
      glassCount++;
      glassTint = GLASS_TINT_LABELS[panel.glassTint];
      continue;
    }
    if (!has('fronts')) continue;
    add('fronts', {
      kind: 'front',
      name: FRONT_PART_NAMES[panel.kind] ?? 'Front',
      lengthMm: panel.heightMm,
      widthMm: panel.widthMm,
      finish: finishLabel,
      quantity: q,
      edgeBanding: { length: 2, width: 2 },
      grainFixed: true,
    });
  }

  if (missing.size > 0) {
    warnings.push(
      `${cabinetRef}: no ${MATERIAL_RATE_LABELS[item.material]} board on the rate card for its ${[...missing]
        .map((r) => PANEL_ROLE_LABELS[r].toLowerCase())
        .join(', ')} — listed at ${LEGACY_BOARD_THICKNESS_MM}mm and priced at ₹0. Add a board line or pick another board.`
    );
  }
  if (glassCount > 0) {
    warnings.push(
      `${cabinetRef}: ${glassCount * q} glass panel${glassCount * q === 1 ? '' : 's'} (${glassTint}) not listed — order cut to size from the glass supplier.`
    );
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
  finishes: SurfaceFinish[],
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>
): CutList {
  const warnings: string[] = [];
  const parts = cabinets.flatMap((item, i) =>
    cabinetCutParts(item, `C${i + 1}`, settings, finishes, rates, warnings)
  );

  // Grouped by what's physically the same stock: one board line is one
  // pile of sheets. Fronts are split by finish too, because a walnut
  // shutter and a white one are cut from differently laminated boards.
  // A back is carcass (you pointed that out) but usually a different,
  // thinner board — so it gets its own group, labelled as carcass.
  const byKey = new Map<string, CutListGroup>();
  for (const part of parts) {
    const key = groupKey(part);
    let group = byKey.get(key);
    if (!group) {
      const kindLabel =
        part.kind === 'front' ? `fronts, ${part.finish}` : part.kind === 'back' ? 'carcass back' : 'carcass';
      group = {
        key,
        label: `${part.boardName} — ${kindLabel}`,
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
    group.areaSqM += partAreaSqM(part);
    group.edgeBandM += edgeBandMm(part) / 1000;
  }

  const kindOrder: CutPartKind[] = ['carcass', 'back', 'front'];
  const groups = [...byKey.values()].sort(
    (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.label.localeCompare(b.label)
  );
  return { parts, groups, warnings };
}

export function groupKey(p: Pick<CutPart, 'kind' | 'boardId' | 'boardName' | 'finish'>): string {
  return [p.kind, p.boardId ?? p.boardName, p.finish ?? ''].join('|');
}

// Real area of ALL copies of one part row, in m².
export function partAreaSqM(part: CutPart): number {
  return (part.lengthMm * part.widthMm * part.quantity) / MM2_PER_SQM;
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
export interface ConsolidatedPart {
  kind: CutPartKind;
  name: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  boardName: string;
  finish?: string;
  quantity: number;
  edgeBanding: EdgeBanding;
  grainFixed: boolean;
  cabinetRefs: string[];
}

export function consolidateParts(parts: CutPart[]): ConsolidatedPart[] {
  const byKey = new Map<string, ConsolidatedPart>();
  for (const p of parts) {
    const key = [
      groupKey(p),
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
        boardName: p.boardName,
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
