// src/components/toolbar/RoomSettingsPanel.tsx
//
// Small popover for editing the CURRENT layout's room dimensions
// (width x depth x ceiling height) — previously fixed at creation with
// no edit path anywhere in the UI. Lives in App.tsx's header row next
// to "3D Preview"/"Save Project", collapsed to a single button until
// clicked open.
//
// Edits go through layoutStore.updateRoomDimensions, which patches
// currentLayout.dimensions directly — RoomCanvas (2D) and Room3DCanvas
// (3D) both already read widthMm/depthMm/ceilingHeightMm reactively
// from currentLayout via App.tsx's props, so a resize here is reflected
// immediately on both without any extra wiring. Saving to Supabase
// still only happens on the normal "Save Project" click, same as every
// other edit in this app (cabinets, obstacles, etc) — this panel only
// touches in-memory state.
//
// Deliberately does NOT move or clamp anything that falls outside the
// new bounds after a shrink — same posture as the rest of this app,
// where collision/overlap is flagged (CollisionWarningBanner) rather
// than silently auto-corrected. Shrinking the room can leave a cabinet
// hanging past the new wall; the user sees it immediately on the
// canvas and can drag it back in.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';

// Mirrors Room3DCanvas's own DEFAULT_CEILING_HEIGHT_MM fallback — kept
// as a separate local constant rather than a shared import since
// neither file exports its default today (small, stable value, not
// worth a shared-constants module for one number).
const DEFAULT_CEILING_HEIGHT_MM = 2700;

export function RoomSettingsPanel() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const updateRoomDimensions = useLayoutStore((state) => state.updateRoomDimensions);
  const setDepthIncludesFront = useLayoutStore((state) => state.setDepthIncludesFront);
  const businessDepthIncludesFront = useLayoutStore((state) => state.constructionSettings.depthIncludesFront);
  // 'business' = follow the Workshop setting; otherwise this project's own.
  const [depthChoice, setDepthChoice] = useState<'business' | 'includes' | 'carcass'>('business');

  const [isOpen, setIsOpen] = useState(false);
  const [widthMm, setWidthMm] = useState(0);
  const [depthMm, setDepthMm] = useState(0);
  const [ceilingHeightMm, setCeilingHeightMm] = useState(DEFAULT_CEILING_HEIGHT_MM);

  if (!currentLayout) {
    return null; // nothing to size until a layout is open
  }

  function handleOpen() {
    // Seed the form from the live layout every time it's opened, so
    // re-opening after an external change (e.g. loading a different
    // project) never shows stale numbers.
    setWidthMm(currentLayout!.dimensions.widthMm);
    setDepthMm(currentLayout!.dimensions.depthMm);
    setCeilingHeightMm(currentLayout!.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM);
    const own = currentLayout!.depthIncludesFront;
    setDepthChoice(own === undefined ? 'business' : own ? 'includes' : 'carcass');
    setIsOpen(true);
  }

  function handleApply() {
    updateRoomDimensions({ widthMm, depthMm, ceilingHeightMm });
    setDepthIncludesFront(depthChoice === 'business' ? undefined : depthChoice === 'includes');
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <Button variant="outline" size="touch" onClick={handleOpen}>
        Room
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-2 flex w-56 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">Room Dimensions</h4>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              ×
            </Button>
          </div>

          <label className="flex flex-col text-xs text-gray-600 gap-1">
            Width — L (mm)
            <input
              type="number"
              min={1000}
              step={50}
              value={widthMm}
              onChange={(e) => setWidthMm(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>

          <label className="flex flex-col text-xs text-gray-600 gap-1">
            Depth — B (mm)
            <input
              type="number"
              min={1000}
              step={50}
              value={depthMm}
              onChange={(e) => setDepthMm(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>

          <label className="flex flex-col text-xs text-gray-600 gap-1">
            Ceiling Height — H (mm)
            <input
              type="number"
              min={2000}
              step={50}
              value={ceilingHeightMm}
              onChange={(e) => setCeilingHeightMm(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>

          {/* This project's override of the Workshop depth convention
              (§61). It moves the plan, 3D view, collision checks,
              cutting list and price together. */}
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Cabinet depth (e.g. 600) means…
            <select
              value={depthChoice}
              onChange={(e) => setDepthChoice(e.target.value as typeof depthChoice)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="business">
                Business default ({businessDepthIncludesFront ? 'includes shutter' : 'carcass only'})
              </option>
              <option value="includes">Includes the shutter</option>
              <option value="carcass">Carcass only (shutter adds in front)</option>
            </select>
          </label>

          <p className="text-[10px] text-gray-400">
            Shrinking the room won't move cabinets/obstacles that end up outside it — drag them
            back in afterward.
          </p>

          <div className="flex gap-2 border-t border-gray-200 pt-3">
            <Button variant="outline" size="xs" className="h-auto min-h-7 flex-1 py-1 whitespace-normal" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button size="xs" className="h-auto min-h-7 flex-1 py-1 whitespace-normal" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
