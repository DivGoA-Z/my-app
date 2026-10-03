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
import { Check } from 'lucide-react';
import { describeFinish } from '../../lib/materials3d';
import { finishSwatch } from '../../lib/designFinishes';
import { cn } from '@/lib/utils';
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
      {/* Big swatches, grouped by type (§86): a finish is chosen by how
          it looks, and this is the part the customer leans in to see. */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Finish</span>
        {finishes.length === 0 && <span className="text-sm text-muted-foreground">No finishes in your catalogue yet.</span>}
        {/* One grid in type order, the type as a caption: grouping under
            headings left one swatch per row with a small catalogue. */}
        <div role="radiogroup" aria-label="Finish" className="grid grid-cols-3 gap-2">
              {finishTypeGroups.flatMap(([, group]) => group).map((f) => {
                const sw = finishSwatch(f);
                const on = f.id === cabinet.finishId;
                const name = f.brand ? `${f.brand} ${f.label}` : f.label;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={name}
                    onClick={() => updateCabinet(cabinet.id, { finishId: f.id })}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border p-1 text-left transition-colors',
                      on ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/60'
                    )}
                  >
                    <span
                      className="relative block aspect-square w-full rounded-lg border border-black/5 bg-cover bg-center"
                      style={sw?.image ? { backgroundImage: `url(${sw.image})` } : { backgroundColor: sw?.color ?? '#dcd7cf' }}
                    >
                      {on && (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 px-0.5 text-xs font-medium leading-tight">{name}</span>
                    <span className="px-0.5 text-[11px] text-muted-foreground">{f.finishTypeLabel}</span>
                  </button>
                );
              })}
        </div>
        <span className="text-xs text-muted-foreground">{describeFinish(selectedFinish)}</span>
      </div>

      {/* Per-cabinet colour, separate from the shared finish row so
          recolouring one cabinet doesn't repaint every cabinet using
          that finish. */}
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-[13px] font-semibold">Colour override</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-10 w-14 rounded-[10px] p-0"
            style={{ backgroundColor: swatchColor }}
            onClick={() => setIsPickingColor((open) => !open)}
            aria-label="Pick colour"
          />
          {cabinet.colorOverride ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[13px]"
              onClick={() => updateCabinet(cabinet.id, { colorOverride: undefined })}
            >
              Reset to finish
            </Button>
          ) : (
            <span className="text-[13px] text-muted-foreground">Using the finish's own colour</span>
          )}
        </div>

        {isPickingColor && (
          <div className="mt-1 rounded-xl border border-border bg-card p-2.5 shadow-card">
            <ColorPicker
              value={swatchColor}
              onChange={(hex) => updateCabinet(cabinet.id, { colorOverride: hex })}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
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
