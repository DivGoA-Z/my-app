// src/components/canvas3d/Cabinet3DInspector.tsx
//
// Floating panel over the 3D view for the cabinet you just clicked.
// Scope: everything you can JUDGE BY LOOKING — finish, colour,
// substrate, and (added with parametric fronts) the front
// configuration and handle.
//
// Fronts belong here, not just in the 2D inspector, and that's the
// point of the split: whether a run reads better as three drawers or a
// door, and whether a gola profile beats a bar handle, are decisions
// made by looking at the render, not at a floor plan. Leaving them out
// of the 3D panel meant walking back to the 2D view to change something
// you were looking straight at.
//
// Dimensions, position, rotation and delete stay in the 2D inspector on
// purpose. Those are spatial decisions you make against the floor plan,
// where you can see clearances and neighbouring units; resizing a
// cabinet from inside a first-person walkthrough means dragging numbers
// while unable to see what you're colliding with.
//
// Selection is shared state (layoutStore.selectedCabinetId), so clicking
// a cabinet in 3D also selects it in the 2D canvas and vice versa —
// switching views keeps your place rather than resetting it.

import { useLayoutStore } from '../../store/layoutStore';
import { FinishPicker } from '../inspector/FinishPicker';
import { FrontPicker } from '../inspector/FrontPicker';
import type { MaterialType } from '../../types/cabinet';
import type { PlacedCabinetItem } from '../../types/cabinet';

const MATERIALS: MaterialType[] = ['HDMR', 'Plywood', 'MDF', 'Particle Board'];

const MODULE_TYPE_LABELS: Record<string, string> = {
  'base-cabinet': 'Base Cabinet',
  'wall-cabinet': 'Wall Cabinet',
  'tall-unit': 'Tall Unit',
  'sink-unit': 'Sink Unit',
  'cylinder-trolley': 'Cylinder Trolley',
  'corner-unit': 'Corner Unit',
  'drawer-unit': 'Drawer Unit',
};

export interface Cabinet3DInspectorProps {
  cabinet: PlacedCabinetItem;
}

export function Cabinet3DInspector({ cabinet }: Cabinet3DInspectorProps) {
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const selectCabinet = useLayoutStore((state) => state.selectCabinet);

  return (
    // Stops pointer events reaching the canvas underneath — without
    // this, dragging the colour picker's saturation square would also
    // spin the camera, and clicking a control would count as a
    // background click and deselect the very cabinet being edited.
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-64 flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h4 className="text-xs font-semibold text-gray-700">
            {MODULE_TYPE_LABELS[cabinet.moduleType] ?? cabinet.moduleType}
          </h4>
          <span className="text-[10px] text-gray-400">
            {cabinet.widthMm}×{cabinet.depthMm}×{cabinet.heightMm}mm
          </span>
        </div>
        <button
          onClick={() => selectCabinet(null)}
          aria-label="Deselect"
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      <FinishPicker cabinet={cabinet} />

      {/* The very same component the 2D inspector uses — one editor, so
          the two panels can't offer different options or write the
          field differently. */}
      <FrontPicker cabinet={cabinet} />

      {/* Substrate is invisible on a finished cabinet, so it's here for
          costing rather than looks — kept because switching it while
          reviewing a design is a pricing decision you often make at the
          same moment. */}
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Substrate
        <select
          value={cabinet.material}
          onChange={(e) => updateCabinet(cabinet.id, { material: e.target.value as MaterialType })}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-gray-400">
          Affects price and durability, not appearance.
        </span>
      </label>

      <p className="border-t border-gray-200 pt-2 text-[10px] text-gray-400">
        Size, position and rotation are edited on the 2D floor plan, where clearances are visible.
      </p>
    </div>
  );
}
