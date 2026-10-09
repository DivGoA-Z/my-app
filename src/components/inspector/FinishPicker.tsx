// src/components/inspector/FinishPicker.tsx
//
// Shared finish selector + per-cabinet colour override, used by BOTH
// the 2D CabinetInspector and the 3D overlay (Cabinet3DInspector).
//
// Extracted rather than duplicated: these two panels edit exactly the
// same two fields with exactly the same semantics, and the colour
// semantics in particular are subtle enough (replace vs tint, depending
// on whether the finish is textured) that two copies would drift.

//
// A compact row since §125: the swatch grid and colour block made the
// inspector so long you scrolled past them to reach anything else. The
// row opens the same finish library as Surfaces (SurfaceFinishPicker,
// 'cabinet': chips by type, prices, and the colour override inside,
// with its replace-vs-tint explanation).

import { useLayoutStore } from '../../store/layoutStore';
import { SurfaceFinishPicker } from '../toolbar/SurfaceFinishPicker';
import type { PlacedCabinetItem } from '../../types/cabinet';

export interface FinishPickerProps {
  cabinet: PlacedCabinetItem;
}

export function FinishPicker({ cabinet }: FinishPickerProps) {
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">Finish</span>
      <SurfaceFinishPicker
        title="Finish"
        surface="cabinet"
        finishId={cabinet.finishId}
        tint={cabinet.colorOverride}
        // A cabinet always has a finish: there's no "not specified".
        onFinishChange={(id) => id && updateCabinet(cabinet.id, { finishId: id })}
        onTintChange={(hex) => updateCabinet(cabinet.id, { colorOverride: hex ?? undefined })}
      />
    </div>
  );
}
