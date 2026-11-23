// src/components/inspector/CornerInsideControl.tsx
//
// What's inside a placed corner unit (§148): shelves, magic corner,
// carousel or cylinder trolley, chosen on the cabinet itself. The
// mapping, and why it needs no new price, is in lib/cornerInside.ts.

import { useLayoutStore } from '../../store/layoutStore';
import { CORNER_INSIDES, CORNER_INSIDE_LABELS, cornerInsideChange, cornerInsideOf, type CornerInside } from '../../lib/cornerInside';
import type { PlacedCabinetItem } from '../../types/cabinet';

export function CornerInsideControl({ cabinet }: { cabinet: PlacedCabinetItem }) {
  const updateCabinet = useLayoutStore((s) => s.updateCabinet);
  const inside = cornerInsideOf(cabinet);
  if (!inside) return null;
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      Inside
      <select
        value={inside}
        onChange={(e) => updateCabinet(cabinet.id, cornerInsideChange(cabinet, e.target.value as CornerInside))}
        className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px] font-normal"
      >
        {CORNER_INSIDES.map((k) => (
          <option key={k} value={k}>
            {CORNER_INSIDE_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
