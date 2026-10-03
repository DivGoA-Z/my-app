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
// - Carcass depth follows ConstructionSettings.depthIncludesFront (§47):
//   by default the front is INSET into the stated depth (lib/fronts.ts's
//   FRONT_THICKNESS_MM comment), so a 600mm-deep cabinet has a 582mm
//   carcass behind an 18mm shutter; set to carcass-only, the carcass is
//   the full 600 and the shutter sits in front of it.
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

import type { ExtraPart, MaterialType, PanelRole, PlacedCabinetItem } from '../types/cabinet';
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

// Where ONE physical piece sits in its cabinet, for the Cabinet
// Designer's 3D preview. Millimetres, cabinet-local: origin at the
// centre of the cabinet's bounding box, +x to the right (as seen from the
// front), +y up, +z towards the front. `s*` are full extents along each
// axis. Computed here, from the same thicknesses and fits as the cut
// sizes, so the preview can't show a panel the cutting list doesn't
// list, or at a different size (§46).
export interface PartBox {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
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
  // 'extra' for a hand-entered part (ExtraPart — on a cabinet or loose
  // on the project, §48), which has no standard panel role.
  role: PanelRole | 'extra';
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
  // One box per piece in a SINGLE cabinet (not multiplied by the
  // cabinet's quantity) — see PartBox. Geometry only; pricing never
  // reads it.
  boxes: PartBox[];
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
  // How much of the stated depth the front takes: all of its thickness
  // if "600" includes the shutter, none if "600" is the carcass alone
  // (ConstructionSettings.depthIncludesFront, §47).
  const tFrontInDepth = settings.depthIncludesFront ? tFront : 0;
  const carcassDepth =
    item.depthMm - tFrontInDepth - (backFitted && settings.backFit === 'nailed-on' ? tBack : 0);
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

  // ---- 3D frame for PartBox (see its comment) ----
  // Carcass runs from its back plane to just behind the fronts; an inset
  // back additionally pushes top/bottom/shelves forward of itself.
  const D = item.depthMm;
  const zFront = D / 2 - tFrontInDepth;
  const zBack = -D / 2 + (backFitted && settings.backFit === 'nailed-on' ? tBack : 0);
  const zInnerBack = zBack + (backFitted && settings.backFit === 'inset-full' ? tBack : 0);
  const xInL = -W / 2 + tLeft;
  const xInR = W / 2 - tRight;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): PartBox => ({
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    cz: (z0 + z1) / 2,
    sx: Math.abs(x1 - x0),
    sy: Math.abs(y1 - y0),
    sz: Math.abs(z1 - z0),
  });

  const label = `${formatModuleType(item.moduleType)} ${W}×${item.depthMm}×${H}`;
  const q = item.quantity;
  const parts: CutPart[] = [];
  const add = (
    role: PanelRole,
    part: Pick<CutPart, 'kind' | 'name' | 'quantity' | 'edgeBanding' | 'grainFixed' | 'finish' | 'boxes'> & {
      lengthMm: number;
      widthMm: number;
    },
    // A part cut from a different board than its role's — a wooden drawer
    // box's bottom is the thin back board, though it belongs to the
    // drawer boxes (§56).
    boardOverride?: BoardRate
  ) => {
    const lengthMm = mm(part.lengthMm);
    const widthMm = mm(part.widthMm);
    if (lengthMm <= 0 || widthMm <= 0 || part.quantity <= 0) return;
    const board: BoardRate | undefined = boardOverride ?? panels[role].board;
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
  // Shortened at each end whose panel runs OVER them; an excluded top or
  // bottom doesn't. The top's rule applies to rails too since §47 (it
  // used to be hardcoded that rails always fit between the sides) — one
  // business-wide corner rule per joint, set on the Workshop page.
  const topOver = has('top') && settings.topFit === 'over-sides';
  // Edge banding goes on edges that face the CUSTOMER, never the wall
  // (your rule, §47). A side's front edge always does. Its BOTTOM edge
  // does too on anything mounted off the floor — a wall cabinet's side
  // is seen from below. (A cabinet stacked on another, like a loft over
  // a tall unit, would be over-counted; rare enough to accept.)
  const sideBottomShows = item.elevationMm > 0;
  const bottomOver = has('bottom') && settings.bottomFit === 'over-sides';
  const sideHeight = H - (topOver ? tTop : 0) - (bottomOver ? tBottom : 0);
  const sideY0 = -H / 2 + (bottomOver ? tBottom : 0);
  const sideY1 = H / 2 - (topOver ? tTop : 0);
  for (const role of ['leftSide', 'rightSide'] as const) {
    if (!has(role)) continue;
    add(role, {
      kind: 'carcass',
      name: role === 'leftSide' ? 'Left side' : 'Right side',
      lengthMm: sideHeight,
      widthMm: carcassDepth,
      quantity: q,
      edgeBanding: { length: 1, width: sideBottomShows ? 1 : 0 },
      grainFixed: false,
      boxes: [
        role === 'leftSide'
          ? box(-W / 2, xInL, sideY0, sideY1, zBack, zFront)
          : box(xInR, W / 2, sideY0, sideY1, zBack, zFront),
      ],
    });
  }

  // ---- Top, or rails ----
  if (has('top')) {
    if (topStyle === 'rails') {
      add('top', {
        kind: 'carcass',
        name: 'Front rail',
        lengthMm: topOver ? W : betweenWidth,
        widthMm: settings.railWidthMm,
        quantity: q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
        boxes: [box(topOver ? -W / 2 : xInL, topOver ? W / 2 : xInR, H / 2 - tTop, H / 2, zFront - settings.railWidthMm, zFront)],
      });
      add('top', {
        kind: 'carcass',
        name: 'Back rail',
        lengthMm: topOver ? W : betweenWidth,
        widthMm: settings.railWidthMm,
        quantity: q,
        edgeBanding: { length: 0, width: 0 },
        grainFixed: false,
        boxes: [box(topOver ? -W / 2 : xInL, topOver ? W / 2 : xInR, H / 2 - tTop, H / 2, zInnerBack, zInnerBack + settings.railWidthMm)],
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
        boxes: [box(topOver ? -W / 2 : xInL, topOver ? W / 2 : xInR, H / 2 - tTop, H / 2, zInnerBack, zFront)],
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
      boxes: [
        box(bottomOver ? -W / 2 : xInL, bottomOver ? W / 2 : xInR, -H / 2, -H / 2 + tBottom, zInnerBack, zFront),
      ],
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
    // Where it sits front-to-back. A grooved back's groove distance from
    // the rear edge isn't a setting, so the preview puts it 10mm in — a
    // picture-only guess; the cut SIZE above doesn't depend on it.
    const backZ0 =
      settings.backFit === 'nailed-on' ? -D / 2 : settings.backFit === 'inset-full' ? zBack : zBack + 10;
    const yMid = (-H / 2 + tBottom + (H / 2 - tTop)) / 2;
    const xMid = settings.backFit === 'nailed-on' ? 0 : (xInL + xInR) / 2;
    add('back', {
      kind: 'back',
      name: 'Back',
      lengthMm: backH,
      widthMm: backW,
      quantity: q,
      edgeBanding: { length: 0, width: 0 },
      grainFixed: false,
      boxes: [
        box(xMid - backW / 2, xMid + backW / 2, yMid - backH / 2, yMid + backH / 2, backZ0, backZ0 + tBack),
      ],
    });
  }

  // ---- Dividers, shelves, fronts ----
  const layout = item.frontLayout ?? defaultFrontLayout(item.moduleType, W);
  const bands = carcassBands(layout, H);
  // No handle is passed: only panel/shelf GEOMETRY is read here, and a
  // handle never changes a panel's size.
  const breakdown = computeFrontBreakdown(layout, W, H, undefined, NO_RATES);

  if (has('shelves')) {
    const tShelf = thick('shelves');
    const shelfZ1 = zFront - settings.shelfSetbackMm;
    const shelfZ0 = shelfZ1 - shelfDepth;
    if (bands.length > 1) {
      add('shelves', {
        kind: 'carcass',
        name: 'Divider',
        lengthMm: betweenWidth,
        widthMm: shelfDepth,
        quantity: (bands.length - 1) * q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
        // One at each boundary between bands (bands run top to bottom).
        boxes: bands.slice(0, -1).map((b) => {
          const y = b.centerYMm - b.heightMm / 2;
          return box(xInL, xInR, y - tShelf / 2, y + tShelf / 2, shelfZ0, shelfZ1);
        }),
      });
    }
    // Extra shelves (PanelSpec.extraCount, §48): spread evenly through
    // the TALLEST compartment that has no shelves of its own — for a
    // plain door cabinet, the whole carcass between bottom and top.
    const extra = Math.max(0, Math.floor(panels.shelves.extraCount ?? 0));
    if (extra > 0) {
      const inBand = (y: number, b: { centerYMm: number; heightMm: number }) =>
        y > b.centerYMm - b.heightMm / 2 && y < b.centerYMm + b.heightMm / 2;
      const free = bands.filter((b) => !breakdown.shelves.some((sh) => inBand(sh.centerYMm, b)));
      const band = [...(free.length > 0 ? free : bands)].sort((a, b) => b.heightMm - a.heightMm)[0];
      const y0 = Math.max(band.centerYMm - band.heightMm / 2, -H / 2 + tBottom);
      const y1 = Math.min(band.centerYMm + band.heightMm / 2, H / 2 - tTop);
      add('shelves', {
        kind: 'carcass',
        name: 'Shelf',
        lengthMm: betweenWidth,
        widthMm: shelfDepth,
        quantity: extra * q,
        edgeBanding: { length: 1, width: 0 },
        grainFixed: false,
        boxes: Array.from({ length: extra }, (_, i) => {
          const y = y0 + ((i + 1) * (y1 - y0)) / (extra + 1);
          return box(xInL, xInR, y - tShelf / 2, y + tShelf / 2, shelfZ0, shelfZ1);
        }),
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
        boxes: breakdown.shelves.map((r) =>
          box(xInL, xInR, r.centerYMm - tShelf / 2, r.centerYMm + tShelf / 2, shelfZ0, shelfZ1)
        ),
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
      boxes: [
        box(
          panel.centerXMm - panel.widthMm / 2,
          panel.centerXMm + panel.widthMm / 2,
          panel.centerYMm - panel.heightMm / 2,
          panel.centerYMm + panel.heightMm / 2,
          // In the stated depth's front slice, or just in front of the
          // carcass when "600" means the carcass alone.
          zFront,
          zFront + tFront
        ),
      ],
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
  // ---- Drawer boxes (§56) ----
  // One box behind every drawer front — panel kinds survive 'mixed'
  // composition, so a drawer row inside a mixed front counts too. Sized
  // from the cabinet's inner width, the drawer front's own height, and a
  // standard runner length; the rules are Workshop settings, defaulted to
  // the common tandem-box figures. Untick "Drawer boxes" in the Cabinet
  // Designer when boxes are bought ready-made.
  const drawerFronts = breakdown.panels.filter((p) => p.kind === 'drawers');
  if (drawerFronts.length > 0 && has('drawerBoxes')) {
    // Longest standard runner (270–650mm, 50mm steps) that fits with
    // 10mm to spare at the back.
    const runner = [650, 600, 550, 500, 450, 400, 350, 300, 270].find((l) => l <= innerDepth - 10);
    if (!runner) {
      warnings.push(`${cabinetRef}: too shallow for standard drawer runners — drawer boxes not listed.`);
    } else {
      const tBox = thick('drawerBoxes');
      const z1 = zFront;
      const z0 = zFront - runner;
      const xMid = (xInL + xInR) / 2;
      for (const f of drawerFronts) {
        const yBase = f.centerYMm - f.heightMm / 2 + 15; // box floor sits just above the front's bottom edge
        if (settings.drawerBox === 'tandem') {
          // Metal sides come with the runner system; the workshop cuts
          // the bottom and the back.
          const bottomW = betweenWidth - settings.tandemBottomWidthDeductionMm;
          const bottomD = runner - settings.tandemBottomDepthDeductionMm;
          const backW = betweenWidth - settings.tandemBackWidthDeductionMm;
          const backH = Math.max(50, f.heightMm - settings.tandemBackHeightReductionMm);
          add('drawerBoxes', {
            kind: 'carcass',
            name: 'Drawer bottom',
            lengthMm: bottomD,
            widthMm: bottomW,
            quantity: q,
            edgeBanding: { length: 0, width: 0 },
            grainFixed: false,
            boxes: [box(xMid - bottomW / 2, xMid + bottomW / 2, yBase, yBase + tBox, z1 - bottomD, z1)],
          });
          add('drawerBoxes', {
            kind: 'carcass',
            name: 'Drawer back',
            lengthMm: backW,
            widthMm: backH,
            quantity: q,
            // Its top edge shows when the drawer is open.
            edgeBanding: { length: 1, width: 0 },
            grainFixed: false,
            boxes: [box(xMid - backW / 2, xMid + backW / 2, yBase + tBox, yBase + tBox + backH, z0, z0 + tBox)],
          });
        } else {
          // Wooden box: two sides, an inner front and a back from the
          // drawer-box board; a bottom from the thin back board, grooved
          // into the four sides.
          const boxW = betweenWidth - settings.woodenSlideClearanceMm;
          const boxH = Math.max(50, f.heightMm - settings.woodenBoxHeightReductionMm);
          const g = settings.grooveDepthMm;
          const bottomBoard = panels.back.board ?? panels.drawerBoxes.board;
          const tBottom = bottomBoard?.thicknessMm ?? LEGACY_BOARD_THICKNESS_MM;
          const xL = xMid - boxW / 2;
          const xR = xMid + boxW / 2;
          add('drawerBoxes', {
            kind: 'carcass',
            name: 'Drawer side',
            lengthMm: runner,
            widthMm: boxH,
            quantity: 2 * q,
            edgeBanding: { length: 1, width: 0 },
            grainFixed: false,
            boxes: [
              box(xL, xL + tBox, yBase, yBase + boxH, z0, z1),
              box(xR - tBox, xR, yBase, yBase + boxH, z0, z1),
            ],
          });
          add('drawerBoxes', {
            kind: 'carcass',
            name: 'Drawer inner front & back',
            lengthMm: boxW - 2 * tBox,
            widthMm: boxH,
            quantity: 2 * q,
            edgeBanding: { length: 1, width: 0 },
            grainFixed: false,
            boxes: [
              box(xL + tBox, xR - tBox, yBase, yBase + boxH, z1 - tBox, z1),
              box(xL + tBox, xR - tBox, yBase, yBase + boxH, z0, z0 + tBox),
            ],
          });
          // The bottom sits in grooves cut into the inside faces, so —
          // like a grooved back — it's drawn at its full cut size,
          // reaching g into each side. (First drawn without the grooves;
          // the test suite caught the picture disagreeing with the cut
          // size by 16mm.)
          add(
            'drawerBoxes',
            {
              kind: 'back',
              name: 'Drawer bottom',
              lengthMm: runner - 2 * tBox + 2 * g,
              widthMm: boxW - 2 * tBox + 2 * g,
              quantity: q,
              edgeBanding: { length: 0, width: 0 },
              grainFixed: false,
              boxes: [box(xL + tBox - g, xR - tBox + g, yBase + 10, yBase + 10 + tBottom, z0 + tBox - g, z1 - tBox + g)],
            },
            bottomBoard
          );
        }
      }
    }
  }

  // ---- Hand-entered extra parts (§48) ----
  // Board: the part's own, else this cabinet's carcass board. No 3D
  // position — they're not a standard panel, so the Designer's preview
  // notes them instead of guessing where they go.
  for (const ep of item.extraParts ?? []) {
    const board = (ep.boardId ? rates.boards.find((b) => b.id === ep.boardId) : undefined) ?? panels.leftSide.board;
    if (ep.boardId && !rates.boards.some((b) => b.id === ep.boardId)) {
      warnings.push(`${cabinetRef}: the board chosen for "${ep.name}" is no longer on the rate card — using the carcass board.`);
    }
    const part = extraPartToCut(ep, board, cabinetRef, label, item.id, q, item.material);
    if (part) parts.push(part);
  }

  return parts;
}

// A hand-entered part (on a cabinet, or loose on the project) as a cut
// part. `multiplier` is the cabinet's quantity for a cabinet part, 1 for
// a loose one. Null for a part with no size yet (a half-filled row).
function extraPartToCut(
  ep: ExtraPart,
  board: BoardRate | undefined,
  cabinetRef: string,
  cabinetLabel: string,
  cabinetId: string,
  multiplier: number,
  fallbackMaterial: MaterialType
): CutPart | null {
  const lengthMm = mm(ep.lengthMm);
  const widthMm = mm(ep.widthMm);
  const quantity = Math.max(0, Math.floor(ep.quantity)) * multiplier;
  if (!(lengthMm > 0) || !(widthMm > 0) || quantity <= 0) return null;
  return {
    cabinetRef,
    cabinetLabel,
    cabinetId,
    kind: 'carcass',
    role: 'extra',
    name: ep.name.trim() || 'Extra part',
    lengthMm,
    widthMm,
    thicknessMm: board?.thicknessMm ?? LEGACY_BOARD_THICKNESS_MM,
    material: board?.material ?? fallbackMaterial,
    boardId: board?.id,
    boardName: board ? boardLabel(board) : `${MATERIAL_RATE_LABELS[fallbackMaterial]} (no board line)`,
    ratePerSqM: board?.ratePerSqM ?? 0,
    quantity,
    edgeBanding: { length: ep.edgeLong, width: ep.edgeShort },
    grainFixed: false,
    boxes: [],
  };
}

// The project's LOOSE parts (RoomLayout.looseParts, §48) — fillers,
// plinth, end panels. Exported because lib/bom.ts prices exactly these.
export function loosePartsCut(
  looseParts: ExtraPart[],
  rates: Pick<RateCard, 'boards'>,
  warnings: string[]
): CutPart[] {
  return looseParts.flatMap((ep) => {
    const board = ep.boardId ? rates.boards.find((b) => b.id === ep.boardId) : undefined;
    if (!board) warnings.push(`Loose part "${ep.name || 'Extra part'}" has no board on the rate card — priced at ₹0.`);
    const part = extraPartToCut(ep, board, 'Loose', 'Not part of a cabinet', '', 1, 'HDMR');
    return part ? [part] : [];
  });
}

export function computeCutList(
  cabinets: PlacedCabinetItem[],
  settings: ConstructionSettings,
  finishes: SurfaceFinish[],
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>,
  // Required, not defaulted — same reasoning as calculateBOM's
  // PricingContext: a caller that forgot the loose parts would print a
  // cutting list missing them, silently. Pass [] when there are none.
  looseParts: ExtraPart[]
): CutList {
  const warnings: string[] = [];
  const parts = [
    ...cabinets.flatMap((item, i) => cabinetCutParts(item, `C${i + 1}`, settings, finishes, rates, warnings)),
    ...loosePartsCut(looseParts, rates, warnings),
  ];

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
