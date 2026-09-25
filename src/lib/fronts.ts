// src/lib/fronts.ts
//
// Turns a FrontLayout (types/front.ts) into the two things it has to
// produce, from ONE subdivision pass:
//
//   1. PANELS — the rectangles to draw: shutters, drawer fronts, the
//      trolley's single face. With handle positions on them.
//   2. HARDWARE — hinges, channels, baskets, shelves and handles, with
//      counts, so lib/bom.ts can finally charge for them.
//
// Deriving both from the same call is the point. If the renderer
// subdivided the face its own way and the quote counted hardware its
// own way, a cabinet could show three drawers and be billed for two.
//
// COORDINATES: everything here is in MILLIMETRES, in the front face's
// own frame — origin at the centre of the face, +x right, +y UP. That
// matches how the trade specifies a cabinet elevation, and it maps onto
// the 3D mesh's local space directly (the mesh is a box centred on the
// origin, so its front face is exactly this rectangle at
// z = +depthMm/2). The renderer converts to metres at the last moment.

import type { FrontKind, FrontLayout, FrontRowKind, HandleSpec } from '../types/front';
import { clampCount, clampTambourShelfCount } from '../types/front';
import type { HardwareSpec, PlacedCabinetItem } from '../types/cabinet';
import type { HardwareRates } from '../types/rates';

// Gap around and between panels. Real kitchens run 2–4mm; at 3mm the
// shadow line reads clearly in the 3D view without looking like the
// doors don't fit.
export const REVEAL_MM = 3;

// How thick a shutter/drawer front is. Standard 18mm board.
//
// Panels are INSET into the stated depth rather than added on top of
// it, so a 600mm-deep cabinet stays 600mm deep. That matters because
// the depth is what the client is charged against and what collision
// uses — a cabinet that silently became 618mm deep would be a quote
// error, not just a rendering one. The reveal gaps let the carcass
// show behind, which is what makes the inset read correctly.
export const FRONT_THICKNESS_MM = 18;

// How far a bar handle sits in from the edge it's mounted near.
const HANDLE_EDGE_INSET_MM = 45;

// Hinges per door leaf. A tall door needs more or it twists.
function hingesPerLeaf(heightMm: number): number {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1600) return 3;
  return 4;
}

// Hardware rates USED to be a hardcoded constant here, with a comment
// promising a future settings table. They now arrive as a parameter
// from the business's rate card (types/rates.ts, `rate_cards` table).
//
// The units still differ per key and are still not all piece counts:
// 'channel' is a PAIR of runners, which is how they are sold and
// fitted; a gola or edge profile's count is running metres. See
// HardwareSpec in types/cabinet.ts.
//
// Rates are threaded through as a REQUIRED argument rather than
// defaulted. That is deliberate and it is the whole point of the
// change: a defaulted pricing input is how hardware silently cost ₹0
// on every quote for weeks, and a second time is not worth the
// convenience of a shorter call.

// ---- Panels ----

export type Rect = { centerXMm: number; centerYMm: number; widthMm: number; heightMm: number };

export interface HandlePlacement {
  // Centre, in the front face frame (mm, +y up).
  centerXMm: number;
  centerYMm: number;
  // Length along its own axis.
  lengthMm: number;
  orientation: 'vertical' | 'horizontal';
  handle: HandleSpec;
}

export interface FrontPanel {
  index: number;
  // Centre, in the front face frame (mm, +y up).
  centerXMm: number;
  centerYMm: number;
  widthMm: number;
  heightMm: number;
  // Null for kinds that carry no handle at all — open shelves, false
  // fronts, and any front whose handle is 'handleless'.
  handle: HandlePlacement | null;
  // Which row-kind produced this panel — every panel-producing case
  // sets its own, and 'mixed' preserves whatever its rows' panels
  // already carry. Exists so the 3D renderer can give a panel a
  // different physical treatment (a tambour's ridged shutter vs. a
  // flat door) without re-deriving "what kind of front is this" from
  // the panel's shape alone, which a plain rectangle can't answer.
  kind: FrontRowKind;
}

export interface FrontBreakdown {
  panels: FrontPanel[];
  // Visible shelf boards, for the open-shelf kind only. Without these
  // an open-shelf unit renders as an empty box, which reads as a
  // missing door rather than as open shelving — and the shelves are
  // charged for, so showing nothing would mean charging for something
  // invisible.
  shelves: Rect[];
  hardware: HardwareSpec[];
  // Total panel area, for reference — NOT wired into the quote's
  // finish costing, which still charges the full front face. A real
  // shutter run is cut from sheets with waste, so panel area alone
  // would under-charge; recorded here so the eventual sheet-yield
  // calculation has the number it needs.
  panelAreaMm2: number;
}

function normaliseRatios(count: number, ratios: number[] | undefined): number[] {
  // Ratios are only trusted when there's exactly one per row. A
  // mismatched array (drawer count edited without touching the ratios)
  // falls back to equal heights rather than silently applying the
  // wrong distribution to the wrong drawers.
  const usable =
    ratios && ratios.length === count && ratios.every((r) => Number.isFinite(r) && r > 0)
      ? ratios
      : Array.from({ length: count }, () => 1);

  const total = usable.reduce((a, b) => a + b, 0);
  return usable.map((r) => r / total);
}

// Which front kinds have no shutter/drawer front at all, so the
// CARCASS behind them needs a real opening rather than a sealed box —
// see carcassBands below.
const OPEN_CARCASS_KINDS: FrontKind[] = ['open-shelf', 'appliance-housing'];

export interface CarcassBand {
  centerYMm: number;
  heightMm: number;
  // True: no front panel exists here, so the carcass itself needs a
  // genuine opening (see Room3DCanvas.tsx's per-band carcass build).
  // False: a door/drawer/trolley front covers this band, so the
  // existing sealed-box carcass is correct and unchanged.
  open: boolean;
  // Which row-kind this band belongs to — same reasoning FrontPanel's
  // own `kind` field has: the 3D renderer needs to give a TAMBOUR band
  // a different treatment (open it up when an appliance is placed
  // behind the shutter, so there's something to see) without
  // re-deriving "what kind of front is this row" from a plain
  // centerYMm/heightMm pair, which can't answer that on its own.
  kind: FrontRowKind;
}

// Height bands for the CARCASS specifically — one band for the whole
// cabinet for a plain (non-mixed) front, or one per row for 'mixed'.
// Deliberately NOT rows()/rowBands-with-reveals: those exist to place
// the visible FRONT PANELS with the shadow-line gaps between them,
// but a carcass divider between two compartments is a real, continuous
// piece of board with no gap in it. Using the reveal-gapped split here
// would put a few millimetres of nothing inside the cabinet's own
// body, which would show as a thin dark slit in what should be solid
// carcass material.
export function carcassBands(layout: FrontLayout, heightMm: number): CarcassBand[] {
  if (layout.kind === 'mixed') {
    const rowSpecs = layout.rows ?? [];
    // No rows configured yet — nothing meaningful to report as `kind`,
    // so this is treated as a plain sealed band (false-front: no
    // opening, no handle, no hardware — the least presumptive default).
    if (rowSpecs.length === 0) return [{ centerYMm: 0, heightMm, open: false, kind: 'false-front' }];

    const fractions = normaliseRatios(
      rowSpecs.length,
      rowSpecs.map((r) => r.heightRatio)
    );
    const bands: CarcassBand[] = [];
    let cursorY = heightMm / 2; // top edge, walking down — same order rows() uses
    for (let i = 0; i < rowSpecs.length; i++) {
      const bandHeight = heightMm * fractions[i];
      bands.push({
        centerYMm: cursorY - bandHeight / 2,
        heightMm: bandHeight,
        open: OPEN_CARCASS_KINDS.includes(rowSpecs[i].kind),
        kind: rowSpecs[i].kind,
      });
      cursorY -= bandHeight;
    }
    return bands;
  }

  return [{ centerYMm: 0, heightMm, open: OPEN_CARCASS_KINDS.includes(layout.kind), kind: layout.kind }];
}

// Splits the face into `count` COLUMNS, left to right.
function columns(widthMm: number, heightMm: number, count: number) {
  const available = widthMm - REVEAL_MM * (count + 1);
  const colWidth = available / count;
  const panelHeight = heightMm - REVEAL_MM * 2;

  return Array.from({ length: count }, (_, i) => ({
    centerXMm: -widthMm / 2 + REVEAL_MM + i * (colWidth + REVEAL_MM) + colWidth / 2,
    centerYMm: 0,
    widthMm: colWidth,
    heightMm: panelHeight,
  }));
}

// Splits the face into ROWS, TOP TO BOTTOM — which is the order the
// trade lists drawers in, and the order heightRatios is written in.
function rows(widthMm: number, heightMm: number, count: number, ratios: number[] | undefined) {
  const available = heightMm - REVEAL_MM * (count + 1);
  const fractions = normaliseRatios(count, ratios);
  const panelWidth = widthMm - REVEAL_MM * 2;

  const out = [];
  let cursorY = heightMm / 2 - REVEAL_MM; // top inner edge, walking down
  for (let i = 0; i < count; i++) {
    const rowHeight = available * fractions[i];
    out.push({
      centerXMm: 0,
      centerYMm: cursorY - rowHeight / 2,
      widthMm: panelWidth,
      heightMm: rowHeight,
    });
    cursorY -= rowHeight + REVEAL_MM;
  }
  return out;
}

// Splits the face into vertical BANDS, top to bottom, for the 'mixed'
// case's recursive composition. Same reveal-and-ratio math as rows()
// above, but keeps each band's FULL width rather than reveal-reducing
// it — every band gets its own recursive computeFrontBreakdown call,
// which applies its OWN horizontal reveal when it builds real panels.
// Reveal-reducing twice would leave a mixed cabinet's panels a few mm
// narrower than the equivalent plain one.
function rowBands(widthMm: number, heightMm: number, count: number, ratios: number[] | undefined) {
  const available = heightMm - REVEAL_MM * (count + 1);
  const fractions = normaliseRatios(count, ratios);

  const out: Rect[] = [];
  let cursorY = heightMm / 2 - REVEAL_MM;
  for (let i = 0; i < count; i++) {
    const bandHeight = available * fractions[i];
    out.push({
      centerXMm: 0,
      centerYMm: cursorY - bandHeight / 2,
      widthMm,
      heightMm: bandHeight,
    });
    cursorY -= bandHeight + REVEAL_MM;
  }
  return out;
}

// Thickness of a visible shelf board. Exported so a tambour's own
// "which slot" picker (FrontPicker.tsx) can compute each slot's real
// clear height from the SAME boards it's about to render, rather than
// a second, potentially-diverging estimate of where they sit.
export const SHELF_THICKNESS_MM = 18;

// `count` shelves divide the interior into count+1 compartments, so
// they sit at even fractions of the height rather than at 1/count —
// three shelves in a 900mm unit go at 225/450/675, not 300/600/900
// (the last of which would be the top of the carcass). Exported for
// the same reason SHELF_THICKNESS_MM is.
export function shelfBoards(widthMm: number, heightMm: number, count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    centerXMm: 0,
    centerYMm: -heightMm / 2 + ((i + 1) * heightMm) / (count + 1),
    widthMm: widthMm - REVEAL_MM * 2,
    heightMm: SHELF_THICKNESS_MM,
  }));
}

// Where the handle goes on one panel. `side` says which edge a
// vertical bar hugs; 'center' puts a horizontal bar across the middle,
// which is what a drawer front takes.
function placeHandle(
  rect: Rect,
  handle: HandleSpec | undefined,
  side: 'left' | 'right' | 'center'
): HandlePlacement | null {
  // No handle chosen, or the catalogue hasn't loaded yet — no geometry
  // and, downstream, no charge. See resolveHandle in types/front.ts for
  // why that's the honest reading rather than inventing a default price.
  if (!handle) return null;
  if (handle.kind === 'handleless') return null;

  // Profiles are cut to the panel and run along its top edge rather
  // than being a discrete object placed on the face — that's the whole
  // visual point of gola/edge-profile handles, and it's also why they
  // price per metre.
  if (handle.kind === 'gola' || handle.kind === 'edge-profile') {
    return {
      centerXMm: rect.centerXMm,
      centerYMm: rect.centerYMm + rect.heightMm / 2,
      lengthMm: rect.widthMm,
      orientation: 'horizontal',
      handle,
    };
  }

  if (handle.kind === 'knob') {
    // A knob has no length to orient, so it just sits near the edge —
    // or centred near the top for a drawer.
    const x =
      side === 'center'
        ? rect.centerXMm
        : rect.centerXMm +
          (side === 'right' ? 1 : -1) * (rect.widthMm / 2 - HANDLE_EDGE_INSET_MM);
    return {
      centerXMm: x,
      centerYMm: side === 'center' ? rect.centerYMm : rect.centerYMm,
      lengthMm: handle.lengthMm,
      orientation: 'horizontal',
      handle,
    };
  }

  // Bar handle: vertical on a door (hugging the opening edge),
  // horizontal and centred on a drawer.
  if (side === 'center') {
    return {
      centerXMm: rect.centerXMm,
      centerYMm: rect.centerYMm,
      // Never longer than the front it's screwed to.
      lengthMm: Math.min(handle.lengthMm, rect.widthMm * 0.8),
      orientation: 'horizontal',
      handle,
    };
  }

  return {
    centerXMm:
      rect.centerXMm + (side === 'right' ? 1 : -1) * (rect.widthMm / 2 - HANDLE_EDGE_INSET_MM),
    centerYMm: rect.centerYMm,
    lengthMm: Math.min(handle.lengthMm, rect.heightMm * 0.8),
    orientation: 'vertical',
    handle,
  };
}

// Handles priced per running metre contribute METRES to the hardware
// line rather than a piece count, so HardwareSpec.count carries "how
// many of this item's own unit" — pieces for a bar, metres for a
// profile. bom.ts multiplies count x unitCost either way, so the
// arithmetic stays correct without a second code path.
function handleHardware(placements: HandlePlacement[]): HardwareSpec | null {
  if (placements.length === 0) return null;
  const handle = placements[0].handle;

  if (handle.pricingMode === 'per-metre') {
    const metres = placements.reduce((sum, p) => sum + p.lengthMm / 1000, 0);
    return { type: 'handle', count: metres, unitCost: handle.price };
  }

  return { type: 'handle', count: placements.length, unitCost: handle.price };
}

// Takes a RESOLVED HandleSpec rather than an id, so this module needs
// no access to the handle catalogue and stays a pure function of its
// arguments — callers resolve, which is also what lets the 3D view and
// the quote resolve from the same store array.
export function computeFrontBreakdown(
  layout: FrontLayout,
  widthMm: number,
  heightMm: number,
  handle: HandleSpec | undefined,
  rates: HardwareRates
): FrontBreakdown {
  const hardware: HardwareSpec[] = [];
  let rects: { rect: Rect; side: 'left' | 'right' | 'center' }[] = [];

  switch (layout.kind) {
    case 'appliance-housing':
      // An open aperture. No panel, no hardware — the oven that goes
      // in it is priced as an appliance.
      return { panels: [], shelves: [], hardware: [], panelAreaMm2: 0 };

    case 'mixed': {
      const rowSpecs = layout.rows ?? [];
      if (rowSpecs.length === 0) {
        return { panels: [], shelves: [], hardware: [], panelAreaMm2: 0 };
      }

      const bands = rowBands(
        widthMm,
        heightMm,
        rowSpecs.length,
        rowSpecs.map((r) => r.heightRatio)
      );

      const panels: FrontPanel[] = [];
      const shelves: Rect[] = [];
      let panelAreaMm2 = 0;
      // Merged by type rather than left as one entry per row, so two
      // drawer rows read as one "Drawer channels x5" line instead of
      // two separate lines that would also collide as React keys
      // (FrontPicker lists this array keyed by h.type).
      const hardwareByType = new Map<HardwareSpec['type'], HardwareSpec>();

      rowSpecs.forEach((rowSpec, i) => {
        const band = bands[i];
        const subLayout: FrontLayout = {
          kind: rowSpec.kind,
          count: rowSpec.count,
          hinge: rowSpec.hinge,
          heightRatios: rowSpec.heightRatios,
        };
        const sub = computeFrontBreakdown(subLayout, band.widthMm, band.heightMm, handle, rates);

        for (const panel of sub.panels) {
          panels.push({
            ...panel,
            index: panels.length,
            centerYMm: band.centerYMm + panel.centerYMm,
            // The handle is a NESTED object with its own centerYMm,
            // computed by placeHandle() in the row's own LOCAL frame
            // (typically centred on that row's panel) — offsetting the
            // panel alone leaves every row's handle sitting at its
            // pre-offset height, which is why they all lined up at
            // roughly the middle of the whole face regardless of which
            // row they belonged to.
            handle: panel.handle
              ? { ...panel.handle, centerYMm: band.centerYMm + panel.handle.centerYMm }
              : null,
          });
        }
        for (const shelf of sub.shelves) {
          shelves.push({ ...shelf, centerYMm: band.centerYMm + shelf.centerYMm });
        }
        panelAreaMm2 += sub.panelAreaMm2;

        for (const hw of sub.hardware) {
          const existing = hardwareByType.get(hw.type);
          // unitCost is the same rate-card figure regardless of which
          // row it came from — only the count accumulates.
          if (existing) existing.count += hw.count;
          else hardwareByType.set(hw.type, { ...hw });
        }
      });

      return { panels, shelves, hardware: Array.from(hardwareByType.values()), panelAreaMm2 };
    }

    case 'open-shelf': {
      const count = clampCount(layout.count);
      // Open shelves have no fronts to draw, but the shelves
      // themselves are real cut-and-edge-banded boards that nothing
      // was charging for.
      hardware.push({ type: 'shelf', count, unitCost: rates.shelf });
      return { panels: [], shelves: shelfBoards(widthMm, heightMm, count), hardware, panelAreaMm2: 0 };
    }

    case 'false-front': {
      // One panel, full face. Costs a shutter in material and finish;
      // no hinges, no handle, because it doesn't open.
      const rect = columns(widthMm, heightMm, 1)[0];
      return {
        panels: [{ index: 0, ...rect, handle: null, kind: 'false-front' }],
        shelves: [],
        hardware: [],
        panelAreaMm2: rect.widthMm * rect.heightMm,
      };
    }

    case 'tambour': {
      // Same shape as false-front — one full-face panel, priced for
      // its material and finish — but no handle: a tambour rides on
      // its own track and is gripped by a finger-pull groove moulded
      // into the bottom slat, not a bar/knob from the handle
      // catalogue. No hinges either, for the same reason a sliding
      // door never gets any. `kind: 'tambour'` is what tells the 3D
      // renderer to draw the ridged shutter look instead of a flat
      // panel — see CabinetMesh in Room3DCanvas.tsx.
      const rect = columns(widthMm, heightMm, 1)[0];
      // Shelves inside the compartment — what an appliance placed in
      // it (FrontPicker's own tambour picker) actually rests on,
      // reusing the exact same shelfBoards geometry open-shelf uses.
      // clampTambourShelfCount rather than clampCount: unlike every
      // other count-driven kind, a tambour is allowed down to ZERO
      // shelves (the appliance then sits directly on the cabinet's own
      // floor) — defaults to 1 (something to rest on) only when
      // genuinely unset.
      const shelfCount = clampTambourShelfCount(layout.count);
      const hardware: HardwareSpec[] = [];
      if (shelfCount > 0) hardware.push({ type: 'shelf', count: shelfCount, unitCost: rates.shelf });
      return {
        panels: [{ index: 0, ...rect, handle: null, kind: 'tambour' }],
        shelves: shelfBoards(widthMm, heightMm, shelfCount),
        hardware,
        panelAreaMm2: rect.widthMm * rect.heightMm,
      };
    }

    case 'single-door': {
      const rect = columns(widthMm, heightMm, 1)[0];
      // Handle goes on the edge OPPOSITE the hinge — that's the edge
      // that actually swings.
      const side = layout.hinge === 'right' ? 'left' : 'right';
      rects = [{ rect, side }];
      hardware.push({
        type: 'hinge',
        count: hingesPerLeaf(heightMm),
        unitCost: rates.hinge,
      });
      break;
    }

    case 'double-door': {
      const [left, right] = columns(widthMm, heightMm, 2);
      // Each door's handle hugs the centre meeting line, so they sit
      // as a facing pair — the arrangement anyone recognises as a
      // two-door cabinet.
      rects = [
        { rect: left, side: 'right' },
        { rect: right, side: 'left' },
      ];
      hardware.push({
        type: 'hinge',
        count: hingesPerLeaf(heightMm) * 2,
        unitCost: rates.hinge,
      });
      break;
    }

    case 'drawers': {
      const count = clampCount(layout.count);
      rects = rows(widthMm, heightMm, count, layout.heightRatios).map((rect) => ({
        rect,
        side: 'center' as const,
      }));
      // One channel PAIR per drawer — the biggest hardware line in the
      // whole quote, and previously counted as zero.
      hardware.push({ type: 'channel', count, unitCost: rates.channel });
      break;
    }

    case 'trolley': {
      const tiers = clampCount(layout.count);
      // ONE shutter, regardless of tiers — the baskets ride behind it.
      const rect = columns(widthMm, heightMm, 1)[0];
      rects = [{ rect, side: 'center' }];
      hardware.push({ type: 'channel', count: tiers, unitCost: rates.channel });
      hardware.push({ type: 'basket', count: tiers, unitCost: rates.basket });
      break;
    }
  }

  // Only single-door/double-door/drawers/trolley reach here — every
  // other kind returns directly above — so this cast just names what
  // TypeScript can't see across the switch's early returns.
  const rectsKind = layout.kind as FrontRowKind;
  const panels: FrontPanel[] = rects.map(({ rect, side }, index) => ({
    index,
    ...rect,
    handle: placeHandle(rect, handle, side),
    kind: rectsKind,
  }));

  const handleLine = handleHardware(
    panels.map((p) => p.handle).filter((h): h is HandlePlacement => h !== null)
  );
  if (handleLine) hardware.push(handleLine);

  return {
    panels,
    shelves: [],
    hardware,
    panelAreaMm2: panels.reduce((sum, p) => sum + p.widthMm * p.heightMm, 0),
  };
}

// Convenience wrapper for a placed cabinet, resolving its own front
// layout and handle. Falls back to the module type's default when a
// cabinet has no stored layout — which is every cabinet saved before
// this feature existed.
export function cabinetFrontBreakdown(
  item: PlacedCabinetItem,
  fallbackLayout: FrontLayout,
  handle: HandleSpec | undefined,
  rates: HardwareRates
): FrontBreakdown {
  return computeFrontBreakdown(
    item.frontLayout ?? fallbackLayout,
    item.widthMm,
    item.heightMm,
    handle,
    rates
  );
}

// A magic-corner pull-out system or a carousel/lazy-susan mechanism is
// a real component that exists regardless of which door front sits in
// front of it — a magic corner and a blind corner can both use a plain
// single door, so the mechanism can't be derived from FrontKind the
// way every other hardware line in this file is. Keyed on moduleType
// instead, which is why it lives as its own function rather than
// another case in computeFrontBreakdown's switch.
export function cornerMechanismHardware(
  moduleType: PlacedCabinetItem['moduleType'],
  rates: HardwareRates
): HardwareSpec[] {
  switch (moduleType) {
    case 'corner-magic':
      return [{ type: 'cornerMagic', count: 1, unitCost: rates.cornerMagic }];
    case 'corner-carousel':
      return [{ type: 'cornerCarousel', count: 1, unitCost: rates.cornerCarousel }];
    default:
      return [];
  }
}

// The hardware a cabinet is charged for. An explicit item.hardware
// array WINS over derivation, so a one-off (a lift-up mechanism, an
// imported fitting) can still be entered by hand — but nothing sets it
// today, which is precisely why every quote so far has charged ₹0 of
// hardware. An override replaces the corner mechanism too: a business
// that's typed in a full hardware list for one cabinet meant it to be
// the whole story, not an addition to it.
export function effectiveHardware(
  item: PlacedCabinetItem,
  fallbackLayout: FrontLayout,
  handle: HandleSpec | undefined,
  rates: HardwareRates
): HardwareSpec[] {
  if (item.hardware && item.hardware.length > 0) return item.hardware;
  return [
    ...cabinetFrontBreakdown(item, fallbackLayout, handle, rates).hardware,
    ...cornerMechanismHardware(item.moduleType, rates),
  ];
}
