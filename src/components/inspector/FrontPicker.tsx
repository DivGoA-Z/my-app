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

import { useLayoutStore } from '../../store/layoutStore';
import {
  FRONT_KIND_LABELS,
  MAX_FRONT_COUNT,
  MIN_FRONT_COUNT,
  clampCount,
  defaultFrontLayout,
  resolveHandle,
} from '../../types/front';
import type { FrontKind, FrontLayout } from '../../types/front';
import { computeFrontBreakdown } from '../../lib/fronts';
import type { PlacedCabinetItem } from '../../types/cabinet';

const FRONT_KINDS: FrontKind[] = [
  'single-door',
  'double-door',
  'drawers',
  'trolley',
  'open-shelf',
  'false-front',
  'appliance-housing',
];

// Which kinds have a meaningful count, and what that count is CALLED —
// "3" means three different things across drawers, trolley tiers and
// shelves, and labelling it generically as "Count" makes the trolley
// case genuinely ambiguous (tiers, or shutters?).
const COUNT_LABELS: Partial<Record<FrontKind, string>> = {
  drawers: 'Number of drawers',
  trolley: 'Number of pull-out tiers',
  'open-shelf': 'Number of shelves',
};

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const HARDWARE_LABELS: Record<string, string> = {
  hinge: 'Hinges',
  channel: 'Drawer channels (pairs)',
  handle: 'Handles',
  basket: 'Wire baskets',
  shelf: 'Shelves',
};

export function FrontPicker({ cabinet }: { cabinet: PlacedCabinetItem }) {
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const handles = useLayoutStore((state) => state.handles);
  // The SAME rate card bom.ts prices from, so the hardware subtotal
  // previewed here and the figure on the quote cannot diverge.
  const rateCard = useLayoutStore((state) => state.rateCard);

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

  function setLayout(next: Partial<FrontLayout>) {
    updateCabinet(cabinet.id, { frontLayout: { ...layout, ...next } });
  }

  function setKind(kind: FrontKind) {
    // Switching kind starts from that kind's OWN default rather than
    // carrying the old fields over — a hinge side means nothing on a
    // drawer stack, and stale heightRatios sized for 3 drawers would
    // be silently ignored on a 4-drawer switch.
    const fresh = defaultFrontLayout(cabinet.moduleType, cabinet.widthMm);
    updateCabinet(cabinet.id, {
      frontLayout: kind === fresh.kind ? fresh : { kind, count: fresh.count ?? 3 },
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-2">
      <span className="text-xs font-medium text-gray-700">Front</span>

      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Configuration
        <select
          value={layout.kind}
          onChange={(e) => setKind(e.target.value as FrontKind)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {FRONT_KINDS.map((k) => (
            <option key={k} value={k}>
              {FRONT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {countLabel && (
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          {countLabel}
          <input
            type="number"
            min={MIN_FRONT_COUNT}
            max={MAX_FRONT_COUNT}
            value={clampCount(layout.count)}
            onChange={(e) =>
              // Clamped on the way in as well as on read, so the stored
              // value can't drift outside the range the geometry can
              // actually subdivide.
              setLayout({
                count: clampCount(Number(e.target.value)),
                // Ratios are per-drawer; a changed count makes the old
                // array meaningless, so drop it rather than let
                // normaliseRatios silently fall back.
                heightRatios: undefined,
              })
            }
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      )}

      {layout.kind === 'single-door' && (
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          Hinge side
          <select
            value={layout.hinge ?? 'left'}
            onChange={(e) => setLayout({ hinge: e.target.value as 'left' | 'right' })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Handle
        <select
          value={handle?.id ?? ''}
          onChange={(e) => updateCabinet(cabinet.id, { handleId: e.target.value })}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {/* Empty option only appears while the catalogue is still
              loading or genuinely empty — otherwise resolveHandle
              always lands on something. */}
          {handles.length === 0 && <option value="">No handles in catalogue</option>}
          {handles.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </label>

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
