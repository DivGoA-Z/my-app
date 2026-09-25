// src/components/inspector/FinishPicker.tsx
//
// Shared finish selector + per-cabinet colour override, used by BOTH
// the 2D CabinetInspector and the 3D overlay (Cabinet3DInspector).
//
// Extracted rather than duplicated: these two panels edit exactly the
// same two fields with exactly the same semantics, and the colour
// semantics in particular are subtle enough (replace vs tint, depending
// on whether the finish is textured) that two copies would drift.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { describeFinish } from '../../lib/materials3d';
import { ColorPicker } from '../common/ColorPicker';
import type { PlacedCabinetItem } from '../../types/cabinet';

export interface FinishPickerProps {
  cabinet: PlacedCabinetItem;
}

export function FinishPicker({ cabinet }: FinishPickerProps) {
  const finishes = useLayoutStore((state) => state.finishes);
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const [isPickingColor, setIsPickingColor] = useState(false);

  const selectedFinish = finishes.find((f) => f.id === cabinet.finishId);
  const isTextured = Boolean(selectedFinish?.albedoUrl || selectedFinish?.proceduralKind);

  // Grouped by finish type for the <optgroup>s — a business with thirty
  // laminates and four acrylics wants them separated, not one flat list.
  const finishTypeGroups = Object.entries(
    finishes.reduce<Record<string, typeof finishes>>((groups, finish) => {
      (groups[finish.finishTypeLabel] ||= []).push(finish);
      return groups;
    }, {})
  );

  const swatchColor =
    cabinet.colorOverride ?? selectedFinish?.solidColor ?? '#dcd7cf';

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Finish
        <select
          value={cabinet.finishId}
          onChange={(e) => updateCabinet(cabinet.id, { finishId: e.target.value })}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {finishes.length === 0 && <option value={cabinet.finishId}>No finishes yet</option>}
          {finishTypeGroups.map(([typeLabel, group]) => (
            <optgroup key={typeLabel} label={typeLabel}>
              {group.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.brand ? `${f.brand} ${f.label}` : f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="text-[10px] text-gray-400">{describeFinish(selectedFinish)}</span>
      </label>

      {/* Per-cabinet colour, separate from the shared finish row so
          recolouring one cabinet doesn't repaint every cabinet using
          that finish. */}
      <div className="flex flex-col gap-1 text-xs text-gray-600">
        <span>Colour override</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-7 w-12 p-0"
            style={{ backgroundColor: swatchColor }}
            onClick={() => setIsPickingColor((open) => !open)}
            aria-label="Pick colour"
          />
          {cabinet.colorOverride ? (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 text-[10px]"
              onClick={() => updateCabinet(cabinet.id, { colorOverride: undefined })}
            >
              Reset to finish
            </Button>
          ) : (
            <span className="text-[10px] text-gray-400">Using the finish's own colour</span>
          )}
        </div>

        {isPickingColor && (
          <div className="mt-1 rounded border border-gray-200 bg-white p-2 shadow-sm">
            <ColorPicker
              value={swatchColor}
              onChange={(hex) => updateCabinet(cabinet.id, { colorOverride: hex })}
            />
            <p className="mt-1 text-[10px] text-gray-400">
              {isTextured
                ? 'This finish has a pattern, so the colour tints it like a stain — browns and ambers read well, saturated colours go muddy.'
                : 'This finish is a solid colour, so the override replaces it outright.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
