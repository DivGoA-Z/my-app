// src/types/appliance.ts
//
// One row per appliance placed on the 2D grid — stove, chimney, oven,
// OTG, or toaster. Deliberately simpler than PlacedCabinetItem (types/
// cabinet.ts): no material/finish/hardware, since appliances are
// bought as finished units, not built from sheet material + fittings
// like a cabinet is. Priced as a flat unitPrice x quantity in the quote
// (see lib/bom.ts's separate applianceSubtotal), not a per-sqft
// material+labor formula.
//
// ROTATABLE as of the GLTF-model work. It deliberately wasn't, back
// when every appliance rendered as a featureless box and turning one
// changed nothing you could see. Real models invalidated that: a sink
// has a tap at the back, a hob has a control edge, a chimney has a
// front. So rotationDeg now works exactly as it does on
// PlacedCabinetItem, sharing the same primitives in lib/footprint.ts
// so the drawn rectangle, the collision box and the chargeable wall
// area can't disagree about which way it's facing.
//
// Shares the SAME elevationMm convention as PlacedCabinetItem — the
// height of the item's BOTTOM face off the floor — specifically so it
// plugs into the exact same Z-aware collision system (lib/collision.ts)
// without any special-casing. That matters a lot here: a stove/OTG/
// toaster sitting flush on a countertop, or a chimney mounted above a
// hob, are all cases of one item's footprint legitimately overlapping
// another's in X/Y while sitting at a different height — exactly the
// scenario elevationMm + 3D AABB checking was built to allow.
// 'sink' is here rather than as a cabinet ModuleType on purpose. The
// sink UNIT is a cabinet (a laminated carcass that keeps its finish);
// the sink itself is a basin-and-tap fixture sitting at counter
// height inside that cabinet's footprint — structurally identical to
// how every other appliance behaves, so it inherits model rendering,
// Z-aware collision and per-unit pricing for free.
// LIMITATION: countertops aren't cut, so a basin reads as sitting ON
// the worktop rather than inset. Right for a drop-in sink with a
// visible rim, wrong for an undermount.
export type ApplianceType = 'stove' | 'chimney' | 'oven' | 'otg' | 'toaster' | 'sink';

// Single source of truth for display labels — ApplianceToolbar,
// InventoryManager, and QuoteSidebar all show appliance types to the
// user and need to agree on wording (in particular, 'otg' capitalized
// naively would read as "Otg" instead of "OTG").
export const APPLIANCE_TYPE_LABELS: Record<ApplianceType, string> = {
  stove: 'Stove / Hob',
  chimney: 'Chimney',
  oven: 'Oven',
  otg: 'OTG',
  toaster: 'Toaster',
  sink: 'Sink',
};

export interface PlacedApplianceItem {
  id: string;
  layoutId: string;   // FK -> RoomLayout.id
  applianceType: ApplianceType;
  x: number;           // mm, UNROTATED top-left corner on grid — see lib/footprint.ts
  y: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  elevationMm: number; // height of the BOTTOM face off the floor — see lib/collision.ts
  // Quarter turns only, same as PlacedCabinetItem. widthMm/depthMm are
  // the UNROTATED dimensions and never change when this does; the
  // effective on-floor rectangle comes from getFootprint().
  rotationDeg: 0 | 90 | 180 | 270;
  unitPrice: number;   // ₹ per unit
  quantity: number;    // usually 1
  // Which catalogue row this was placed from (FK ->
  // ApplianceCatalogItem.id, types/Catalog.ts).
  //
  // Needed because model resolution used to match on applianceType
  // alone, which silently picks the FIRST catalogue row of that type —
  // fine when a business stocks one chimney, wrong the moment it
  // stocks two, and now actively harmful since the per-model
  // orientation correction would be taken from the wrong row. Optional
  // for layouts saved before it existed, which fall back to the old
  // type match.
  catalogItemId?: string;
  // Optional PER-PLACEMENT model override. Normally left unset: the
  // model comes from the appliance catalogue, resolved at render time
  // (see Room3DCanvas). This exists for the case where one particular
  // unit in one layout should render differently from the catalogue
  // row — nothing sets it today, and it takes priority when it is set.
  modelUrl?: string;
  // Suppresses the red collision highlight/warning for any overlap
  // involving THIS item — see lib/collision.ts. For a known, accepted
  // overlap (e.g. a chimney duct that legitimately runs through a wall
  // cabinet's box) rather than an actual mistake. Never affects
  // placement itself (Principle 6: warn, never block) — only whether
  // the warning is shown. Defaults to false/unset.
  ignoreOverlap?: boolean;
  // Set only when this appliance was created FROM the tambour picker
  // in FrontPicker.tsx, rather than dropped onto the canvas by hand —
  // mirrors FixtureMount's 'cabinet' case (types/fixture.ts): the
  // appliance MOVES WITH its host cabinet and is cascade-removed if
  // that cabinet is deleted or its front changes away from tambour.
  // x/y/elevationMm are still real, ordinary fields (auto-computed
  // once, on pick, to sit resting on the chosen shelf) — this mount
  // only marks OWNERSHIP for that cascade, not a live constraint the
  // way a fixture's cabinet mount is.
  //
  // slotIndex: WHICH of the compartment's shelf slots this sits in,
  // 0 = the bottom slot (floor to the first shelf), counting up —
  // shelves divide one tambour into several independent slots, each
  // able to hold its own appliance, so the cabinetId alone isn't
  // enough to say which one this is.
  mount?: { kind: 'tambour'; cabinetId: string; slotIndex: number };
}

/*
Example JSON:

{
  "id": "app_001",
  "layoutId": "layout_001",
  "applianceType": "stove",
  "x": 900,
  "y": 0,
  "widthMm": 600,
  "depthMm": 550,
  "heightMm": 100,
  "elevationMm": 850,
  "rotationDeg": 0,
  "unitPrice": 32000,
  "quantity": 1,
  "catalogItemId": "appl_hob_600",
  "modelUrl": "/models/hob-600.glb"
}
*/
