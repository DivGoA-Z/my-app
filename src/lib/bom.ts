// src/lib/bom.ts
//
// BOM (Bill of Materials) is intentionally NOT stored as state anywhere.
// It is a pure, derived value computed from the current
// PlacedCabinetItem[]/PlacedApplianceItem[] arrays. Storing computed
// totals alongside source data is a common source of bugs (numbers
// going stale after an edit) — always recompute instead.
//
// BOMLineItem carries dimensions/quantity/material/finish alongside the
// cost figures specifically so UI (QuoteSidebar) never has to re-derive
// display data from PlacedCabinetItem separately — one source of truth.
//
// Appliances get their OWN line item shape (ApplianceLineItem) and
// subtotal, kept separate from cabinet costing rather than folded into
// one generic line type — an appliance is a flat unitPrice x quantity
// (bought as a finished unit), with no per-sqft material/labor formula
// and no hardware, so forcing it into BOMLineItem's shape would mean
// several fields that never apply.

import type { PlacedCabinetItem } from '../types/cabinet';
import { defaultFrontLayout, FRONT_KIND_LABELS, resolveHandle } from '../types/front';
import type { FrontLayout, HandleSpec } from '../types/front';
import { effectiveHardware } from './fronts';
import type { SurfaceFinish } from '../types/finish';
import { resolveFinish, findFinish } from '../types/finish';
import { describeFinish } from './materials3d';
import type { PlacedApplianceItem, ApplianceType } from '../types/appliance';
import type { RoomLayout, WallOrientation } from '../types/layout';
import { computeRoomSurfaceAreas } from './surfaceAreas';
import { countertopAreaSqM } from './cabinetGeometry';
import { voidAreaMm2 } from './openings';
import { OPENING_KIND_LABELS } from '../types/opening';
import { resolveAllFixtures, fixtureQuantity } from './fixtures';
import { CABINET_FACE_LABELS } from '../types/fixture';
import type { FixtureCatalogItem, LightFixture } from '../types/fixture';
import type { SurfaceAreaBreakdown } from './surfaceAreas';
import type { RateCard } from '../types/rates';

export interface BOMLineItem {
  cabinetId: string;
  moduleType: string;
  material: string;
  // Human-readable finish description ("Merino Walnut 4102 (Laminate)")
  // rather than a bare enum value — finishes are real products now.
  finish: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  quantity: number;
  areaSqFt: number;
  // Front-face area the finish is charged on — see finishedAreaSqM.
  finishedAreaSqM: number;
  // How the front is configured ("Drawers x3", "Double door"), plus
  // the handle. Shown in the quote because it's what the client is
  // choosing between — "600mm base unit" tells them nothing, "600mm,
  // 3 drawers, bar handle" is the thing that costs money.
  frontDescription: string;
  handleDescription: string;
  // Itemised so the quote can show WHY hardware costs what it does.
  // Every one of these was silently empty before parametric fronts.
  hardwareDetail: { label: string; count: number; unitCost: number; cost: number }[];
  materialCost: number;
  finishCost: number;
  hardwareCost: number;
  laborCost: number;
  lineTotal: number;
}

export interface ApplianceLineItem {
  applianceId: string;
  applianceType: ApplianceType;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

// One room surface (floor, ceiling, or a named wall). Exposed and
// concealed area are charged at DIFFERENT rates because they're
// different products — the cheap tile goes where nobody sees it.
// Occupied area is reported but never charged: a structural pillar
// means there's no surface there to finish at all.
export interface SurfaceLineItem {
  surface: string; // "Floor", "North wall", "Ceiling"
  exposedFinish: string;
  exposedSqM: number;
  exposedCost: number;
  concealedFinish: string | null; // null = concealed area not finished
  concealedSqM: number;
  concealedCost: number;
  // Shown in the quote for transparency — it explains why the charged
  // area is less than the room's raw dimensions suggest.
  occupiedSqM: number;
  // Area deducted for doors and windows. Reported SEPARATELY from
  // occupied rather than merged into it, because the two answer
  // different client questions: occupied is "there's a pillar in the
  // way", void is "we don't tile the doorway". A 900x2100 door is
  // 1.89 m² the client was previously being charged for.
  voidSqM: number;
  lineTotal: number;
}

// A door or window, on the quote. Almost always a SPECIFICATION rather
// than a charge: kitchen doors and windows are the builder's, already
// in place, so suppliedByUs defaults false and cost is 0.
//
// It still prints. That's deliberate — an opening that silently
// vanished from the paperwork is how a site argument starts about
// whether a door was included. Listing it at ₹0 with who supplies it
// makes the scope explicit in both directions.
export interface OpeningLineItem {
  openingId: string;
  surface: string;      // "North wall"
  description: string;  // "Door 900 x 2100mm"
  deductedSqM: number;
  suppliedByUs: boolean;
  cost: number;
}

// A light fixture on the quote.
//
// Always listed, even when electrical isn't charged — that's the whole
// design of the global toggle. The kitchen business either doesn't do
// the electrical work or bills it separately, but the fixtures are part
// of the DESIGN either way, and a lighting plan that vanished from the
// paperwork is how a client ends up with no under-cabinet light and a
// reasonable belief they'd agreed to one.
export interface FixtureLineItem {
  fixtureId: string;
  description: string;
  mountDescription: string;
  colorTempK: number;
  // Metres for a strip run, pieces for a spot. Unit says which.
  amount: number;
  unit: 'm' | 'pcs';
  rate: number;
  cost: number;
  note?: string;
}

// The countertop/slab, as ONE line for the whole layout — a kitchen's
// slab is one continuous material, same reasoning as floor/ceiling
// being a single finish rather than per-cabinet. Null when no
// countertop finish has been assigned, or its catalogue row was
// deleted — same "omit rather than show a misleading zero" rule
// buildSurfaceLineItems uses for floor/wall/ceiling.
//
// Same optional-charge shape as FixtureLineItem/fixtureSpecifiedTotal,
// for the same market reason: in Delhi NCR the kitchen business usually
// doesn't supply the slab, the homeowner arranges stone separately. So
// this always carries its real rate and specifiedTotal even when
// priceCountertop is off — the global toggle decides whether that
// number reaches countertopSubtotal, not whether the line exists.
export interface CountertopLineItem {
  finish: string;
  areaSqM: number;
  rate: number;
  specifiedTotal: number;
}

export interface BOMSummary {
  lineItems: BOMLineItem[];
  applianceLineItems: ApplianceLineItem[];
  surfaceLineItems: SurfaceLineItem[];
  openingLineItems: OpeningLineItem[];
  fixtureLineItems: FixtureLineItem[];
  countertopLineItem: CountertopLineItem | null;
  materialSubtotal: number;
  finishSubtotal: number;
  hardwareSubtotal: number;
  laborSubtotal: number;
  applianceSubtotal: number;
  surfaceSubtotal: number;
  // Only non-zero for openings the business actually supplies.
  openingSubtotal: number;
  // Zero unless layout.priceElectrical is on. `fixtureSpecifiedTotal`
  // is what it WOULD come to — shown so the business can see the
  // number it's choosing not to charge, rather than having to work it
  // out by toggling.
  fixtureSubtotal: number;
  fixtureSpecifiedTotal: number;
  // Same shape as fixtureSubtotal/fixtureSpecifiedTotal — zero unless
  // layout.priceCountertop is on.
  countertopSubtotal: number;
  countertopSpecifiedTotal: number;
  grandTotal: number;
}

// Everything needed to put a price on a layout, in one object.
//
// This REPLACED six positional parameters, five of which had `= []`
// defaults. That signature was not merely ugly, it was actively
// dangerous, and it had already produced the same bug twice: a caller
// that forgot `handles` got a quote with ₹0 of hardware, silently and
// with no type error, because the default was a valid empty catalogue.
// The sidebar and the saved project record could — and did — disagree
// about the same layout's total.
//
// So this parameter is REQUIRED and has no default. Forgetting a field
// is now a compile error at the call site instead of a wrong number in
// front of a customer. That is worth more than the convenience of
// calculateBOM(items) in a scratch script.
//
// Every field is a catalogue the caller already holds in the store, so
// building one is a destructure, not work.
export interface PricingContext {
  finishes: SurfaceFinish[];
  handles: HandleSpec[];
  fixtureCatalog: FixtureCatalogItem[];
  // Labour and hardware rates — the two things that used to be
  // hardcoded module constants here and in lib/fronts.ts.
  rates: RateCard;
  // The room itself, for floor/ceiling/wall finishes and for openings
  // and fixtures, all of which are properties of the layout rather than
  // of any item. Genuinely optional: a caller pricing a bare cabinet
  // list has no room, and gets no surface, opening or fixture lines.
  // This is the one field whose absence is a real state rather than an
  // oversight, which is why it is the only optional one.
  layout?: RoomLayout;
}

// 1 sq ft = 304.8mm x 304.8mm
const MM2_PER_SQFT = 304.8 * 304.8;
const MM2_PER_SQM = 1000 * 1000;

// Area the FINISH is charged on. Deliberately front-face only, not
// the same estimate used for material/labor above: laminate, acrylic
// and veneer are bought and priced as shutter area, and carcass
// interiors are either unfinished or use a much cheaper liner. Sides
// of end-of-run units do get finished in practice, so this slightly
// under-counts on those — refine once real rates are in.
function finishedAreaSqM(item: PlacedCabinetItem): number {
  return (item.widthMm * item.heightMm) / MM2_PER_SQM;
}

// Simplified surface-area estimate used for material + labor costing:
// front face area, plus a discounted allowance for carcass sides/back.
// Computed in mm² (matching the stored dimensions), then converted to
// sq ft for costing.
function estimateAreaSqFt(item: PlacedCabinetItem): number {
  const frontFaceMm2 = item.widthMm * item.heightMm;
  const sideAllowanceMm2 = item.depthMm * item.heightMm * 0.5;
  return (frontFaceMm2 + sideAllowanceMm2) / MM2_PER_SQFT;
}

export function calculateBOM(
  items: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[],
  ctx: PricingContext
): BOMSummary {
  const { finishes, handles, fixtureCatalog, rates, layout } = ctx;
  const lineItems: BOMLineItem[] = items.map((item) => {
    const areaSqFt = estimateAreaSqFt(item) * item.quantity;
    const materialCost = item.unitPrice * item.quantity;
    const finish = resolveFinish(finishes, item.finishId);
    const finishArea = finishedAreaSqM(item) * item.quantity;
    const finishCost = finishArea * (finish?.pricePerSqM ?? 0);

    // Hardware is DERIVED from the front layout now (lib/fronts.ts),
    // falling back to the module type's default layout for cabinets
    // saved before fronts existed. Reading item.hardware directly, as
    // this used to, meant reading a field nothing ever wrote — so
    // hardwareCost was ₹0 for every cabinet in every quote.
    // NOT named `layout` — that's the RoomLayout parameter of this
    // function, and shadowing it here would make a later edit reach for
    // the wrong one silently.
    const frontLayout = item.frontLayout ?? defaultFrontLayout(item.moduleType, item.widthMm);
    const handle = resolveHandle(handles, item.handleId);
    const hardware = effectiveHardware(item, frontLayout, handle, rates.hardware);
    const hardwareDetail = hardware.map((h) => ({
      label: HARDWARE_LABELS[h.type],
      count: h.count,
      unitCost: h.unitCost,
      cost: h.count * h.unitCost * item.quantity,
    }));
    const hardwareCost = sum(hardwareDetail, (h) => h.cost);
    const laborCost = areaSqFt * rates.laborRatePerSqFt;

    return {
      cabinetId: item.id,
      moduleType: item.moduleType,
      material: item.material,
      finish: describeFinish(finish),
      widthMm: item.widthMm,
      depthMm: item.depthMm,
      heightMm: item.heightMm,
      quantity: item.quantity,
      areaSqFt,
      finishedAreaSqM: finishArea,
      frontDescription: describeFront(frontLayout),
      handleDescription: handle?.label ?? 'No handle',
      hardwareDetail,
      materialCost,
      finishCost,
      hardwareCost,
      laborCost,
      lineTotal: materialCost + finishCost + hardwareCost + laborCost,
    };
  });

  const applianceLineItems: ApplianceLineItem[] = appliances.map((item) => ({
    applianceId: item.id,
    applianceType: item.applianceType,
    widthMm: item.widthMm,
    depthMm: item.depthMm,
    heightMm: item.heightMm,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
  }));

  const applianceSubtotal = sum(applianceLineItems, (l) => l.lineTotal);

  const surfaceLineItems = layout
    ? buildSurfaceLineItems(layout, items, appliances, finishes)
    : [];
  const surfaceSubtotal = sum(surfaceLineItems, (l) => l.lineTotal);

  const openingLineItems = layout ? buildOpeningLineItems(layout) : [];
  const openingSubtotal = sum(openingLineItems, (l) => l.cost);

  const fixtureLineItems = layout
    ? buildFixtureLineItems(layout, items, fixtureCatalog)
    : [];
  const fixtureSpecifiedTotal = sum(fixtureLineItems, (l) => l.amount * l.rate);
  // The global electrical switch, applied HERE rather than by zeroing
  // each line — so the lines keep their real rates and can print as a
  // specification with honest numbers next to a zero charge.
  const fixtureSubtotal = layout?.priceElectrical ? fixtureSpecifiedTotal : 0;

  const countertopLineItem = layout
    ? buildCountertopLineItem(layout, items, finishes)
    : null;
  const countertopSpecifiedTotal = countertopLineItem?.specifiedTotal ?? 0;
  // Same treatment as fixtureSubtotal — the global switch decides
  // whether the real number reaches the charge, not whether the line
  // exists or what rate it shows.
  const countertopSubtotal = layout?.priceCountertop ? countertopSpecifiedTotal : 0;

  return {
    lineItems,
    applianceLineItems,
    surfaceLineItems,
    openingLineItems,
    fixtureLineItems,
    countertopLineItem,
    materialSubtotal: sum(lineItems, (l) => l.materialCost),
    finishSubtotal: sum(lineItems, (l) => l.finishCost),
    hardwareSubtotal: sum(lineItems, (l) => l.hardwareCost),
    laborSubtotal: sum(lineItems, (l) => l.laborCost),
    applianceSubtotal,
    surfaceSubtotal,
    openingSubtotal,
    fixtureSubtotal,
    fixtureSpecifiedTotal,
    countertopSubtotal,
    countertopSpecifiedTotal,
    grandTotal:
      sum(lineItems, (l) => l.lineTotal) +
      applianceSubtotal +
      surfaceSubtotal +
      openingSubtotal +
      fixtureSubtotal +
      countertopSubtotal,
  };
}

function sum<T>(arr: T[], pick: (item: T) => number): number {
  return arr.reduce((total, item) => total + pick(item), 0);
}

// Trade wording, and note the units differ per row: 'channel' is a
// PAIR of runners (how they're sold and fitted), and a gola/edge
// profile's count is running metres rather than pieces — see
// HardwareSpec in types/cabinet.ts.
const HARDWARE_LABELS: Record<string, string> = {
  hinge: 'Hinges',
  channel: 'Drawer channels (pairs)',
  handle: 'Handles',
  basket: 'Wire baskets',
  shelf: 'Shelves',
  cornerMagic: 'Magic corner mechanism',
  cornerCarousel: 'Carousel / lazy susan mechanism',
};

function describeFrontRow(row: { kind: keyof typeof FRONT_KIND_LABELS; count?: number }): string {
  const base = FRONT_KIND_LABELS[row.kind];
  // Only the count-driven kinds get a number appended — "Double door
  // x2" would read as two cabinets.
  if (row.kind === 'drawers' || row.kind === 'open-shelf' || row.kind === 'trolley') {
    return `${base} x${row.count ?? 1}`;
  }
  return base;
}

function describeFront(layout: FrontLayout): string {
  // "Open shelves x1 + Drawers x2" — each row named the same way a
  // plain (non-mixed) front already is, joined in the stored top-to-
  // bottom order.
  if (layout.kind === 'mixed') {
    return (layout.rows ?? []).map(describeFrontRow).join(' + ');
  }
  return describeFrontRow(layout);
}

const WALL_LABELS: Record<WallOrientation, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
};

function describeMount(fixture: LightFixture, cabinets: PlacedCabinetItem[]): string {
  const m = fixture.mount;
  switch (m.kind) {
    case 'ceiling':
      return 'Ceiling';
    case 'wall':
      return `${m.wallId.charAt(0).toUpperCase()}${m.wallId.slice(1)} wall, ${m.heightMm}mm high`;
    case 'cabinet': {
      const cabinet = cabinets.find((c) => c.id === m.cabinetId);
      const where = CABINET_FACE_LABELS[m.face];
      // Named by module type and size rather than by id — the quote is
      // read on site by someone matching it against real cabinets.
      return cabinet
        ? `${where} — ${cabinet.moduleType} ${cabinet.widthMm}mm`
        : `${where} — cabinet no longer in the layout`;
    }
    case 'free':
      return `Free position, ${m.zMm}mm high`;
  }
}

function buildFixtureLineItems(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  fixtureCatalog: FixtureCatalogItem[]
): FixtureLineItem[] {
  // Resolved through the SAME helper the 3D view uses, so the quote and
  // the render agree on run lengths — a cabinet-mounted strip's length
  // comes from the cabinet, and both sides have to read it the same way
  // or the client is billed for a different amount of strip than they
  // were shown.
  return resolveAllFixtures(layout, cabinets, fixtureCatalog).map((placement) => {
    const { amount, unit } = fixtureQuantity(placement);
    return {
      fixtureId: placement.fixture.id,
      description: `${placement.item.label}`,
      mountDescription: describeMount(placement.fixture, cabinets),
      colorTempK: placement.item.colorTempK,
      amount,
      unit,
      rate: placement.item.price,
      cost: amount * placement.item.price,
      note: placement.fixture.note,
    };
  });
}

function buildOpeningLineItems(layout: RoomLayout): OpeningLineItem[] {
  const ceilingHeightMm = layout.dimensions.ceilingHeightMm ?? 2700;

  return layout.walls.flatMap((wall) => {
    const openings = wall.openings ?? [];
    return openings.map((opening) => {
      // Deducted area is computed per-opening through the SAME clipping
      // helper the wall total uses, so the sum of these rows always
      // matches the wall's voidSqM rather than drifting from it on an
      // off-the-edge or overlapping opening.
      const deductedMm2 = voidAreaMm2(wall.lengthMm, ceilingHeightMm, [opening]);

      return {
        openingId: opening.id,
        surface: WALL_LABELS[wall.orientation],
        description: `${OPENING_KIND_LABELS[opening.kind]} ${opening.widthMm} × ${opening.heightMm}mm`,
        deductedSqM: deductedMm2 / MM2_PER_SQM,
        suppliedByUs: opening.suppliedByUs,
        cost: opening.suppliedByUs ? (opening.unitPrice ?? 0) : 0,
      };
    });
  });
}

function buildSurfaceLineItems(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  appliances: PlacedApplianceItem[],
  finishes: SurfaceFinish[]
): SurfaceLineItem[] {
  const areas = computeRoomSurfaceAreas(layout, cabinets, appliances);

  const line = (
    surface: string,
    area: SurfaceAreaBreakdown,
    exposedFinishId: string | undefined,
    concealedFinishId: string | undefined
  ): SurfaceLineItem | null => {
    // No finish assigned means the business hasn't specified this
    // surface — omit it rather than showing a zero-cost row that reads
    // like the work is free.
    if (!exposedFinishId) return null;

    const exposed = findFinish(finishes, exposedFinishId);
    const concealed = findFinish(finishes, concealedFinishId);

    const exposedCost = area.exposedSqM * (exposed?.pricePerSqM ?? 0);
    const concealedCost = area.concealedSqM * (concealed?.pricePerSqM ?? 0);

    return {
      surface,
      exposedFinish: describeFinish(exposed),
      exposedSqM: area.exposedSqM,
      exposedCost,
      concealedFinish: concealed ? describeFinish(concealed) : null,
      concealedSqM: area.concealedSqM,
      concealedCost,
      occupiedSqM: area.occupiedSqM,
      voidSqM: area.voidSqM,
      lineTotal: exposedCost + concealedCost,
    };
  };

  const rows: (SurfaceLineItem | null)[] = [
    line('Floor', areas.floor, layout.floorFinishId, layout.floorConcealedFinishId),
    // Ceilings have no concealed rate — nothing hides ceiling except a
    // full-height unit, and that OCCUPIES the area rather than
    // concealing it (see surfaceAreas.ts).
    line('Ceiling', areas.ceiling, layout.ceilingFinishId, undefined),
    ...layout.walls.map((wall) =>
      line(WALL_LABELS[wall.orientation], areas.walls[wall.orientation], wall.finishId, wall.concealedFinishId)
    ),
  ];

  return rows.filter((row): row is SurfaceLineItem => row !== null);
}

function buildCountertopLineItem(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  finishes: SurfaceFinish[]
): CountertopLineItem | null {
  // No finish assigned, or its catalogue row was since deleted — same
  // "omit rather than show a misleading number" rule the surface lines
  // above use.
  const finish = findFinish(finishes, layout.countertopFinishId);
  if (!finish) return null;

  const areaSqM = countertopAreaSqM(cabinets);
  const rate = finish.pricePerSqM ?? 0;

  return {
    finish: describeFinish(finish),
    areaSqM,
    rate,
    specifiedTotal: areaSqM * rate,
  };
}
