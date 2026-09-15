// src/components/canvas/PickChooser.tsx
//
// The list that appears when a click lands on more than one item.
//
// A DOM popup rather than something drawn inside Konva, deliberately:
// it needs to sit above the canvas, scroll if it's long, and be
// dismissable with Escape — all of which are free in HTML and all of
// which would have to be built by hand on a canvas.
//
// Every row shows its HEIGHT off the floor, because that's usually the
// only thing distinguishing two otherwise identical rows. "LED strip
// 4000K — 2150mm" versus "LED strip 4000K — 1438mm" is the difference
// between the cove light on top of a wall unit and the task light
// underneath it, and nothing else on the row can tell you which is
// which.

import { useEffect } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { usePickerStore } from '../../store/pickerStore';
import { SELECTABLE_TYPE_LABELS } from '../../types/selection';

// Colour per type, so the list reads as "a light, a cabinet, an
// appliance" at a glance rather than as five identical rows of text.
const TYPE_DOT: Record<string, string> = {
  cabinet: 'bg-amber-400',
  appliance: 'bg-rose-400',
  obstacle: 'bg-slate-400',
  opening: 'bg-sky-400',
  fixture: 'bg-yellow-300',
};

export function PickChooser() {
  const open = usePickerStore((s) => s.open);
  const closePicker = usePickerStore((s) => s.closePicker);
  const select = useLayoutStore((s) => s.select);

  // Escape closes without selecting. Registered only while the popup is
  // open, so it can't swallow Escape from anything else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePicker]);

  if (!open) return null;

  return (
    <>
      {/* Full-screen backdrop so a click anywhere else dismisses. It's
          transparent and sits below the list — clicking the list itself
          never reaches it. */}
      <div className="fixed inset-0 z-20" onPointerDown={() => closePicker()} />

      <div
        className="fixed z-30 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        // Positioned at the pointer, nudged down-right so the cursor
        // isn't covering the first row it's meant to read.
        style={{ left: open.screenX + 8, top: open.screenY + 8 }}
      >
        <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {open.candidates.length} items here
        </div>

        {open.candidates.map((candidate) => (
          <button
            key={`${candidate.type}-${candidate.id}`}
            onClick={() => {
              select({ type: candidate.type, id: candidate.id });
              closePicker();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-50"
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                TYPE_DOT[candidate.type] ?? 'bg-gray-400'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-gray-800">{candidate.label}</span>
              <span className="block text-[10px] text-gray-400">
                {SELECTABLE_TYPE_LABELS[candidate.type]} · {Math.round(candidate.heightMm)}mm
                off floor
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
