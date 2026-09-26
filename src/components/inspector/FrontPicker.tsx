// src/components/inspector/FrontPicker.tsx
//
// Edits how the selected cabinet's front is configured — doors,
// drawers, a trolley pull-out, open shelves — and shows the hardware
// that configuration costs, live, as it changes.
//
// The hardware readout is the point of this panel, not a decoration.
// Drawer channels are the single largest hardware line in an Indian
// modular kitchen, and until parametric fronts existed the quote
// charged ZERO for them on every cabinet. Putting the derived counts
// and the running total right under the dropdown means the person
// choosing "3 drawers" over "single door" can see what that choice
// costs at the moment they make it, rather than discovering it in the
// quote afterwards.
//
// Structural, and deliberately separate from FinishPicker: a front is
// HOW THE BOX OPENS, a finish is what it looks like. A walnut door and
// a white door are the same front.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  DOUBLE_DOOR_MIN_WIDTH_MM,
  FRONT_KIND_LABELS,
  GLASS_TINT_LABELS,
  MAX_FRONT_COUNT,
  MIN_FRONT_COUNT,
  MAX_MIXED_ROWS,
  MIN_MIXED_ROWS,
  clampCount,
  clampTambourShelfCount,
  defaultFrontLayout,
  defaultMixedRows,
  resolveHandle,
} from '../../types/front';
import type {
  FrontKind,
  FrontLayout,
  FrontRowKind,
  FrontRowLayout,
  GlassTint,
} from '../../types/front';
import {
  computeFrontBreakdown,
  shelfBoards,
  FRONT_THICKNESS_MM,
  GLASSABLE_FRONT_KINDS,
  SHELF_THICKNESS_MM,
} from '../../lib/fronts';
import type { PlacedCabinetItem } from '../../types/cabinet';
import type { PlacedApplianceItem } from '../../types/appliance';

const FRONT_KINDS: FrontKind[] = [
  'single-door',
  'double-door',
  'drawers',
  'trolley',
  'open-shelf',
  'false-front',
  'appliance-housing',
  'tambour',
  'mixed',
];

// A row inside a 'mixed' front can be any of the above EXCEPT 'mixed'
// itself — see FrontRowKind's comment in types/front.ts.
const ROW_KINDS: FrontRowKind[] = FRONT_KINDS.filter((k): k is FrontRowKind => k !== 'mixed');

// Which kinds have a meaningful count, and what that count is CALLED —
// "3" means three different things across drawers, trolley tiers and
// shelves, and labelling it generically as "Count" makes the trolley
// case genuinely ambiguous (tiers, or shutters?). Shared by the
// top-level picker and each row of a 'mixed' one.
const COUNT_LABELS: Partial<Record<FrontKind, string>> = {
  drawers: 'Number of drawers',
  trolley: 'Number of pull-out tiers',
  'open-shelf': 'Number of shelves',
  tambour: 'Number of shelves',
};

const GLASS_TINTS: GlassTint[] = ['clear', 'black', 'brown', 'yellow'];

// Wording for the glass toggle/hint varies by front kind — "door" for
// single/double-door and open-shelf (something that hinges), "front"
// for drawers (nothing hinges; the drawer FACE itself is glass) — see
// describeFrontRow's own comment in lib/bom.ts for the same
// distinction on the quote.
function glassToggleLabel(kind: FrontKind): string {
  return kind === 'drawers' ? 'Glass fronts' : 'Glass door';
}

function glassHint(kind: FrontKind): string {
  switch (kind) {
    case 'drawers':
      return 'Each drawer front is glass instead of the cabinet’s own board and finish. Priced separately, below.';
    case 'open-shelf':
      return "A hinged glass door in front of the shelves — the shelves and whatever's on them stay visible through it. Priced separately, below.";
    default:
      return 'This front is glass instead of the cabinet’s own board and finish. Priced separately, below.';
  }
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

// 1 sq ft = 304.8mm x 304.8mm — same conversion lib/bom.ts uses for
// its own MM2_PER_SQFT, duplicated here rather than imported so this
// file (an inspector component) doesn't reach into the pricing engine
// for one constant.
const MM2_PER_SQFT = 304.8 * 304.8;

// Radix Select rejects an empty-string item value, so "no appliance in
// this slot" / "no handle in the catalogue yet" need real sentinels,
// mapped back to '' (pickTambourAppliance's own "clear this slot" path)
// or left absent (handle) in the handlers below.
const NO_APPLIANCE_VALUE = '__none__';
const NO_HANDLE_VALUE = '__none__';

const HARDWARE_LABELS: Record<string, string> = {
  hinge: 'Hinges',
  channel: 'Drawer channels (pairs)',
  handle: 'Handles',
  basket: 'Wire baskets',
  shelf: 'Shelves',
  cornerMagic: 'Magic corner mechanism',
  cornerCarousel: 'Carousel / lazy susan mechanism',
};

// The corner mechanism is priced off moduleType (cornerMechanismHardware
// in lib/fronts.ts), not off the front kind this picker edits, so it
// deliberately doesn't appear in the breakdown below — showing it here
// would read as "choosing this front changes the mechanism cost", which
// isn't true. It's still priced correctly in the actual quote
// (effectiveHardware includes it); this preview is just scoped to what
// the FRONT choice itself produces.

export function FrontPicker({ cabinet }: { cabinet: PlacedCabinetItem }) {
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const handles = useLayoutStore((state) => state.handles);
  // The SAME rate card bom.ts prices from, so the hardware subtotal
  // previewed here and the figure on the quote cannot diverge.
  const rateCard = useLayoutStore((state) => state.rateCard);
  const applianceCatalog = useLayoutStore((state) => state.applianceCatalog);
  const appliances = useLayoutStore((state) => state.appliances);
  const addAppliance = useLayoutStore((state) => state.addAppliance);
  const updateAppliance = useLayoutStore((state) => state.updateAppliance);
  const removeAppliance = useLayoutStore((state) => state.removeAppliance);
  const layoutId = useLayoutStore((state) => state.currentLayout?.id ?? '');
  const [tambourFitError, setTambourFitError] = useState<string | null>(null);

  // Read-time fallback rather than a stored default, so a cabinet
  // placed before fronts existed shows the sensible layout for its
  // module type instead of an empty dropdown.
  const layout: FrontLayout =
    cabinet.frontLayout ?? defaultFrontLayout(cabinet.moduleType, cabinet.widthMm);

  const handle = resolveHandle(handles, cabinet.handleId);
  const breakdown = computeFrontBreakdown(
    layout,
    cabinet.widthMm,
    cabinet.heightMm,
    handle,
    rateCard.hardware
  );

  const hardwareTotal = breakdown.hardware.reduce((s, h) => s + h.count * h.unitCost, 0);
  const isOverridden = (cabinet.hardware?.length ?? 0) > 0;
  const countLabel = COUNT_LABELS[layout.kind];

  // Glass is priced SEPARATELY from the hardware breakdown above (see
  // FrontBreakdown.glassAreaMm2's own comment) — the same rate card
  // bom.ts prices from, so this preview and the quote's glassCost
  // can't diverge.
  const glassPanel = breakdown.panels.find((p) => p.glassTint);
  const glassAreaSqFt = breakdown.glassAreaMm2 / MM2_PER_SQFT;
  const glassCost = glassPanel ? glassAreaSqFt * rateCard.glassRates[glassPanel.glassTint!] : 0;
  // A narrow glassed open-shelf gets ONE glass door (same width split
  // as a plain door front — see lib/fronts.ts), which needs the same
  // hinge-side choice a single-door front does.
  const isSingleGlassDoor =
    layout.kind === 'open-shelf' && Boolean(layout.glass) && cabinet.widthMm < DOUBLE_DOOR_MIN_WIDTH_MM;

  function setLayout(next: Partial<FrontLayout>) {
    updateCabinet(cabinet.id, { frontLayout: { ...layout, ...next } });
  }

  // Every appliance placed via THIS cabinet's own tambour picker below
  // (PlacedApplianceItem.mount) — one per shelf slot, at most.
  const tambourMountedAppliances = appliances.filter(
    (a) => a.mount?.kind === 'tambour' && a.mount.cabinetId === cabinet.id
  );

  function removeAllTambourAppliances() {
    for (const a of tambourMountedAppliances) removeAppliance(a.id);
  }

  function setKind(kind: FrontKind) {
    // Leaving 'tambour' cascades every mounted appliance away with it
    // — same reasoning removeCabinet's own cascade uses (types/
    // appliance.ts's mount comment): an appliance "in" a compartment
    // that no longer exists shouldn't linger as an orphan.
    if (kind !== 'tambour') removeAllTambourAppliances();
    setTambourFitError(null);
    // Switching kind starts from that kind's OWN default rather than
    // carrying the old fields over — a hinge side means nothing on a
    // drawer stack, and stale heightRatios sized for 3 drawers would
    // be silently ignored on a 4-drawer switch.
    if (kind === 'mixed') {
      updateCabinet(cabinet.id, { frontLayout: { kind, rows: defaultMixedRows() } });
      return;
    }
    const fresh = defaultFrontLayout(cabinet.moduleType, cabinet.widthMm);
    updateCabinet(cabinet.id, {
      frontLayout: kind === fresh.kind ? fresh : { kind, count: fresh.count ?? 3 },
    });
  }

  // Shelves genuinely divide a tambour into independent slots — the
  // report this replaced: an appliance was placed centred across the
  // WHOLE compartment, ignoring that a shelf sits partway through it,
  // so it was rendered cutting straight through the shelf board, and
  // the old fit check (against the whole compartment's height) never
  // caught it because a slot's real clear height is much less than
  // that. `slotClearances` computes each slot's real box FROM THE SAME
  // `shelfBoards` call Room3DCanvas.tsx renders the shelves with —
  // not a second, potentially-diverging estimate of where they sit —
  // so a fit check here can't disagree with what's actually drawn.
  //
  // Width/depth clearance is identical for every slot (shelves don't
  // narrow the compartment, only divide its height); only the height
  // — and therefore which appliances fit — differs per slot. Slot 0 is
  // the bottom (floor to the first shelf), counting up. Scoped to a
  // TOP-LEVEL tambour front only, same reason tambourInteriorMm was —
  // a mixed front's tambour row would need that row's own band height.
  const shelfCount = layout.kind === 'tambour' ? clampTambourShelfCount(layout.count) : 0;
  const tambourShelves = shelfBoards(cabinet.widthMm, cabinet.heightMm, shelfCount);
  // Ascending, bottom to top: the carcass floor, each shelf CENTRE,
  // the carcass ceiling — shelfCount+2 boundaries bracketing
  // shelfCount+1 slots.
  const tambourBoundaries = [
    -cabinet.heightMm / 2,
    ...tambourShelves.map((s) => s.centerYMm),
    cabinet.heightMm / 2,
  ];
  const tambourSlotWidthMm = cabinet.widthMm - 2 * FRONT_THICKNESS_MM;
  const tambourSlotDepthMm = cabinet.depthMm - FRONT_THICKNESS_MM;
  const tambourSlotCount = shelfCount + 1;
  function tambourSlotClearance(slotIndex: number) {
    // The boundary AT a shelf is that shelf's CENTRE, not its face —
    // half its own thickness still belongs to the shelf, not the
    // slot's clear space. The two outermost boundaries are carcass
    // walls instead of shelves, which are FRONT_THICKNESS_MM thick,
    // not SHELF_THICKNESS_MM — different constants, even though both
    // currently happen to be 18mm.
    const bottomIsFloor = slotIndex === 0;
    const topIsCeiling = slotIndex === tambourSlotCount - 1;
    const clearBottomLocalMm =
      tambourBoundaries[slotIndex] + (bottomIsFloor ? FRONT_THICKNESS_MM : SHELF_THICKNESS_MM / 2);
    const clearTopLocalMm =
      tambourBoundaries[slotIndex + 1] - (topIsCeiling ? FRONT_THICKNESS_MM : SHELF_THICKNESS_MM / 2);
    return {
      widthMm: tambourSlotWidthMm,
      depthMm: tambourSlotDepthMm,
      heightMm: Math.max(0, clearTopLocalMm - clearBottomLocalMm),
      // Absolute room-space elevation of this slot's clear floor —
      // same LOCAL-to-ABSOLUTE conversion Room3DCanvas.tsx's own
      // occupyingAppliance uses (item.elevationMm + item.heightMm/2 +
      // centerYMm), so a placed appliance's elevationMm lines up with
      // the SAME height band that check looks for.
      restingElevationMm: cabinet.elevationMm + cabinet.heightMm / 2 + clearBottomLocalMm,
    };
  }

  function applianceInSlot(slotIndex: number) {
    return tambourMountedAppliances.find((a) => a.mount?.kind === 'tambour' && a.mount.slotIndex === slotIndex);
  }

  function pickTambourAppliance(slotIndex: number, catalogItemId: string) {
    const existing = applianceInSlot(slotIndex);
    if (!catalogItemId) {
      if (existing) removeAppliance(existing.id);
      setTambourFitError(null);
      return;
    }
    const item = applianceCatalog.find((a) => a.id === catalogItemId);
    if (!item) return;

    const clearance = tambourSlotClearance(slotIndex);
    const tooWide = item.widthMm > clearance.widthMm;
    const tooDeep = item.depthMm > clearance.depthMm;
    const tooTall = item.heightMm > clearance.heightMm;
    if (tooWide || tooDeep || tooTall) {
      const which = [tooWide && 'width', tooDeep && 'depth', tooTall && 'height']
        .filter(Boolean)
        .join(', ');
      setTambourFitError(
        `${item.label} (${item.widthMm}×${item.depthMm}×${item.heightMm}mm) doesn't fit on this ` +
          `shelf — it has ${clearance.widthMm}×${clearance.depthMm}×${Math.round(clearance.heightMm)}mm ` +
          `clear (too much on ${which}). Choose a smaller appliance.`
      );
      return;
    }
    setTambourFitError(null);

    // Centred on width/depth; resting on the slot's own floor
    // (shelf-top or carcass floor) on height, rather than floating
    // centred in the slot — an appliance sits ON something, it
    // doesn't hover. Facing the same direction as the cabinet, so it
    // doesn't appear to face a different way than the open shutter.
    const placement = {
      applianceType: item.applianceType,
      x: cabinet.x + (cabinet.widthMm - item.widthMm) / 2,
      y: cabinet.y + (cabinet.depthMm - item.depthMm) / 2,
      widthMm: item.widthMm,
      depthMm: item.depthMm,
      heightMm: item.heightMm,
      elevationMm: clearance.restingElevationMm,
      rotationDeg: cabinet.rotationDeg,
      unitPrice: item.unitPrice,
      catalogItemId: item.id,
      // This appliance is DELIBERATELY placed inside the tambour
      // cabinet's own footprint — that overlap is the entire point,
      // same as a chimney duct routed through a wall cabinet
      // (lib/collision.ts). Without this, every tambour-picked
      // appliance reads as a collision the designer never asked about
      // and can't fix, since the fit check above already guarantees
      // it genuinely belongs in that slot.
      ignoreOverlap: true,
    };

    if (existing) {
      updateAppliance(existing.id, placement);
    } else {
      const newAppliance: PlacedApplianceItem = {
        id: crypto.randomUUID(),
        layoutId,
        quantity: 1,
        mount: { kind: 'tambour', cabinetId: cabinet.id, slotIndex },
        ...placement,
      };
      addAppliance(newAppliance);
    }
  }

  // A shelf-count change can shrink the slot list — cascade any
  // appliance that was sitting in a slot that no longer exists,
  // rather than leaving it silently mounted to an index nothing
  // renders at anymore.
  function setTambourShelfCount(nextCount: number) {
    for (const a of tambourMountedAppliances) {
      if (a.mount?.kind === 'tambour' && a.mount.slotIndex >= nextCount + 1) {
        removeAppliance(a.id);
      }
    }
    setLayout({ count: nextCount, heightRatios: undefined });
  }

  function setRows(rows: FrontRowLayout[]) {
    updateCabinet(cabinet.id, { frontLayout: { ...layout, kind: 'mixed', rows } });
  }

  function updateRow(index: number, patch: Partial<FrontRowLayout>) {
    const rows = layout.rows ?? [];
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const rows = layout.rows ?? [];
    if (rows.length >= MAX_MIXED_ROWS) return;
    setRows([...rows, { kind: 'open-shelf', count: 1, heightRatio: 1 }]);
  }

  function removeRow(index: number) {
    const rows = layout.rows ?? [];
    if (rows.length <= MIN_MIXED_ROWS) return;
    setRows(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-2">
      <span className="text-xs font-medium text-gray-700">Front</span>

      <div className="flex flex-col gap-1 text-xs text-gray-600">
        Configuration
        <Select value={layout.kind} onValueChange={(value) => setKind(value as FrontKind)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRONT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {FRONT_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {layout.kind === 'mixed' && (
        <div className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-2">
          <span className="text-[10px] font-medium text-gray-500">Rows, top to bottom</span>
          {(layout.rows ?? []).map((row, index) => (
            <div key={index} className="flex flex-col gap-1 rounded border border-gray-200 bg-white p-1.5">
              <div className="flex items-center gap-1">
                <Select
                  value={row.kind}
                  onValueChange={(value) =>
                    // Same reasoning as the top-level setKind: a fresh
                    // row rather than carrying stale fields (a hinge
                    // side, drawer ratios) across a kind change.
                    updateRow(index, {
                      kind: value as FrontRowKind,
                      count: undefined,
                      hinge: undefined,
                      heightRatios: undefined,
                    })
                  }
                >
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROW_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {FRONT_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(layout.rows?.length ?? 0) > MIN_MIXED_ROWS && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeRow(index)}
                    aria-label="Remove row"
                    className="text-red-600 hover:text-red-800"
                  >
                    ×
                  </Button>
                )}
              </div>

              {COUNT_LABELS[row.kind] && (
                <label className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                  {COUNT_LABELS[row.kind]}
                  <input
                    type="number"
                    min={MIN_FRONT_COUNT}
                    max={MAX_FRONT_COUNT}
                    value={clampCount(row.count)}
                    onChange={(e) =>
                      updateRow(index, {
                        count: clampCount(Number(e.target.value)),
                        heightRatios: undefined,
                      })
                    }
                    className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs"
                  />
                </label>
              )}

              {GLASSABLE_FRONT_KINDS.includes(row.kind) && (
                <div className="flex flex-col gap-1 rounded border border-gray-200 bg-gray-50 p-1.5">
                  <Label className="flex items-center justify-between gap-2 text-[10px] font-normal text-gray-500">
                    {glassToggleLabel(row.kind)}
                    <Checkbox
                      checked={Boolean(row.glass)}
                      onCheckedChange={(checked) =>
                        updateRow(index, {
                          glass: checked === true ? { tint: row.glass?.tint ?? 'clear' } : undefined,
                        })
                      }
                    />
                  </Label>
                  {row.glass && (
                    <Select
                      value={row.glass.tint}
                      onValueChange={(value) => updateRow(index, { glass: { tint: value as GlassTint } })}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GLASS_TINTS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {GLASS_TINT_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {(row.kind === 'single-door' ||
                (row.kind === 'open-shelf' &&
                  row.glass &&
                  cabinet.widthMm < DOUBLE_DOOR_MIN_WIDTH_MM)) && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                  Hinge side
                  <Select
                    value={row.hinge ?? 'left'}
                    onValueChange={(value) => updateRow(index, { hinge: value as 'left' | 'right' })}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <label className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                Height share
                <input
                  type="number"
                  min={0.2}
                  step={0.1}
                  value={row.heightRatio}
                  onChange={(e) =>
                    updateRow(index, { heightRatio: Math.max(0.2, Number(e.target.value)) })
                  }
                  className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs"
                />
              </label>
            </div>
          ))}

          {(layout.rows?.length ?? 0) < MAX_MIXED_ROWS && (
            <Button variant="link" size="xs" className="h-auto self-start p-0 text-[10px]" onClick={addRow}>
              + Add row
            </Button>
          )}
        </div>
      )}

      {countLabel && (
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          {countLabel}
          <input
            type="number"
            min={layout.kind === 'tambour' ? 0 : MIN_FRONT_COUNT}
            max={MAX_FRONT_COUNT}
            value={layout.kind === 'tambour' ? shelfCount : clampCount(layout.count)}
            onChange={(e) => {
              // Tambour allows 0 shelves (the appliance then rests
              // directly on the cabinet's own floor) and cascades any
              // appliance whose slot no longer exists; every other
              // count-driven kind keeps the ordinary MIN_FRONT_COUNT
              // floor and plain clampCount.
              if (layout.kind === 'tambour') {
                setTambourShelfCount(clampTambourShelfCount(Number(e.target.value)));
                return;
              }
              // Clamped on the way in as well as on read, so the stored
              // value can't drift outside the range the geometry can
              // actually subdivide.
              setLayout({
                count: clampCount(Number(e.target.value)),
                // Ratios are per-drawer; a changed count makes the old
                // array meaningless, so drop it rather than let
                // normaliseRatios silently fall back.
                heightRatios: undefined,
              });
            }}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      )}

      {GLASSABLE_FRONT_KINDS.includes(layout.kind) && (
        <div className="flex flex-col gap-1.5 rounded border border-gray-200 bg-gray-50 p-2">
          <Label className="flex items-center justify-between gap-2 text-xs font-normal text-gray-600">
            {glassToggleLabel(layout.kind)}
            <Checkbox
              checked={Boolean(layout.glass)}
              onCheckedChange={(checked) =>
                setLayout({
                  glass: checked === true ? { tint: layout.glass?.tint ?? 'clear' } : undefined,
                })
              }
            />
          </Label>
          {layout.glass && (
            <div className="flex flex-col gap-1 text-xs text-gray-600">
              Tint
              <Select
                value={layout.glass.tint}
                onValueChange={(value) => setLayout({ glass: { tint: value as GlassTint } })}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GLASS_TINTS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {GLASS_TINT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[10px] font-normal text-gray-400">{glassHint(layout.kind)}</span>
            </div>
          )}
        </div>
      )}

      {layout.kind === 'tambour' && (
        <div className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-2">
          <span className="text-[10px] font-medium text-gray-500">
            Appliance per shelf, bottom to top
          </span>
          {Array.from({ length: tambourSlotCount }, (_, slotIndex) => {
            const clearance = tambourSlotClearance(slotIndex);
            const inSlot = applianceInSlot(slotIndex);
            const positionLabel =
              tambourSlotCount === 1
                ? 'Whole compartment (no shelf)'
                : slotIndex === 0
                  ? 'Bottom slot'
                  : slotIndex === tambourSlotCount - 1
                    ? 'Top slot'
                    : `Slot ${slotIndex + 1} of ${tambourSlotCount}`;
            return (
              <div key={slotIndex} className="flex flex-col gap-1 rounded border border-gray-200 bg-white p-1.5">
                <div className="flex flex-col gap-1 text-[11px] text-gray-600">
                  {positionLabel} — {clearance.widthMm}×{clearance.depthMm}×
                  {Math.round(clearance.heightMm)}mm clear
                  <Select
                    value={inSlot?.catalogItemId ?? NO_APPLIANCE_VALUE}
                    onValueChange={(value) =>
                      pickTambourAppliance(slotIndex, value === NO_APPLIANCE_VALUE ? '' : value)
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_APPLIANCE_VALUE}>None</SelectItem>
                      {applianceCatalog.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label} ({a.widthMm}×{a.depthMm}×{a.heightMm}mm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
          <span className="text-[10px] text-gray-400">
            Placed centred and resting on the shelf below, facing the same way as the shutter —
            drag it on the canvas afterwards if you want it positioned differently.
          </span>
          {tambourFitError && (
            <Alert variant="destructive">
              <AlertDescription>{tambourFitError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {(layout.kind === 'single-door' || isSingleGlassDoor) && (
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
          Hinge side
          <Select
            value={layout.hinge ?? 'left'}
            onValueChange={(value) => setLayout({ hinge: value as 'left' | 'right' })}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-gray-600">
        Handle
        <Select
          value={handle?.id ?? NO_HANDLE_VALUE}
          onValueChange={(value) =>
            updateCabinet(cabinet.id, { handleId: value === NO_HANDLE_VALUE ? '' : value })
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Sentinel item only appears while the catalogue is still
                loading or genuinely empty — otherwise resolveHandle
                always lands on something. */}
            {handles.length === 0 && (
              <SelectItem value={NO_HANDLE_VALUE}>No handles in catalogue</SelectItem>
            )}
            {handles.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-gray-100 pt-2">
        {breakdown.hardware.length === 0 ? (
          <span className="text-[10px] text-gray-400">
            No hardware for this configuration.
          </span>
        ) : (
          breakdown.hardware.map((h) => (
            <div key={h.type} className="flex justify-between text-[10px] text-gray-500">
              <span>
                {HARDWARE_LABELS[h.type]} ×{' '}
                {/* A gola or edge profile is billed by running metre,
                    not by piece, so its count is a length — showing it
                    as a bare integer would read as "1 handle" for a
                    2.4m profile. */}
                {Number.isInteger(h.count) ? h.count : `${h.count.toFixed(2)} m`}
              </span>
              <span className="tabular-nums">{INR.format(h.count * h.unitCost)}</span>
            </div>
          ))
        )}

        {breakdown.hardware.length > 0 && (
          <div className="flex justify-between border-t border-gray-100 pt-1 text-[10px] font-medium text-gray-600">
            <span>Hardware{cabinet.quantity > 1 ? ` × ${cabinet.quantity}` : ''}</span>
            <span className="tabular-nums">
              {INR.format(hardwareTotal * cabinet.quantity)}
            </span>
          </div>
        )}

        {/* Glass is its own line, not folded into "Hardware" above —
            see FrontBreakdown.glassAreaMm2's own comment for why it's
            priced separately (by area and tint, not per-piece). */}
        {glassPanel && (
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>
              {GLASS_TINT_LABELS[glassPanel.glassTint!]} glass ({glassAreaSqFt.toFixed(1)} sq ft)
              {cabinet.quantity > 1 ? ` × ${cabinet.quantity}` : ''}
            </span>
            <span className="tabular-nums">{INR.format(glassCost * cabinet.quantity)}</span>
          </div>
        )}

        {isOverridden && (
          <span className="text-[10px] text-amber-600">
            This cabinet has hand-entered hardware, which overrides the counts above in the
            quote.
          </span>
        )}
      </div>
    </div>
  );
}
