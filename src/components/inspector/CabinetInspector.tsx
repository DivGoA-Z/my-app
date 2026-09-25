// src/components/inspector/CabinetInspector.tsx
//
// Contextual editing panel for whichever cabinet is currently selected.
// Click a cabinet on the canvas to select it (CabinetLayer's Group
// onClick); click anywhere else to deselect (RoomCanvas's Stage
// onClick). Renders nothing but a placeholder when selectedCabinetId
// is null.
//
// Every action here — rotate, material/finish (finish is now a
// catalogue row, see types/finish.ts), resize, duplicate,
// delete — goes through the same addCabinet/updateCabinet/removeCabinet
// store actions CabinetToolbar and CabinetLayer already use, so
// useCollisions()/useBOM() (and therefore the canvas highlight and the
// QuoteSidebar total) update immediately. There's no separate "recheck
// collisions" or "recalculate quote" step to wire up here.
//
// Rotate/resize/duplicate math lives in lib/cabinetGeometry.ts, shared
// with CabinetLayer's double-click-to-rotate, so the two entry points
// can't drift apart.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { useSelectedCabinetId, useSelectedObstacleId } from '../../hooks/useSelection';
import { rotateCabinet, resizeCabinet, duplicateCabinet } from '../../lib/cabinetGeometry';
import type { MaterialType } from '../../types/cabinet';
import { FinishPicker } from './FinishPicker';
import { FrontPicker } from './FrontPicker';

const MATERIALS: MaterialType[] = ['HDMR', 'Plywood', 'MDF', 'Particle Board'];

// Mirrors the fallback used in App.tsx/CabinetToolbar — only matters
// before any project/layout has loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

// 'sink-unit' -> 'Sink Unit' — same formatter QuoteSidebar uses.
function formatModuleType(moduleType: string): string {
  return moduleType
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function CabinetInspector() {
  const selectedCabinetId = useSelectedCabinetId();
  const selectedObstacleId = useSelectedObstacleId();
  const cabinets = useLayoutStore((state) => state.cabinets);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const removeCabinet = useLayoutStore((state) => state.removeCabinet);
  const addCabinet = useLayoutStore((state) => state.addCabinet);
  const selectCabinet = useLayoutStore((state) => state.selectCabinet);

  const [isEditingDimensions, setIsEditingDimensions] = useState(false);

  const cabinet = cabinets.find((c) => c.id === selectedCabinetId);

  if (!cabinet) {
    // An obstacle is selected instead (the two selections are mutually
    // exclusive — see layoutStore.ts) — let ObstacleInspector take this
    // slot instead of showing a misleading "select a cabinet" message.
    if (selectedObstacleId) {
      return null;
    }
    return (
      <div className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-400">
        Select a cabinet or obstacle on the canvas to edit it.
      </div>
    );
  }

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  function handleRotate(direction: 1 | -1) {
    if (!cabinet) return;
    updateCabinet(cabinet.id, rotateCabinet(cabinet, direction, roomWidthMm, roomDepthMm));
  }

  function handleDuplicate() {
    if (!cabinet) return;
    const copy = duplicateCabinet(cabinet, roomWidthMm, roomDepthMm);
    addCabinet(copy);
    selectCabinet(copy.id); // jump the Inspector straight to editing the new copy
  }

  function handleDelete() {
    if (!cabinet) return;
    removeCabinet(cabinet.id); // store already clears selectedCabinetId for us
  }

  function handleDimensionsChange(widthMm: number, depthMm: number, heightMm: number) {
    if (!cabinet) return;
    updateCabinet(
      cabinet.id,
      resizeCabinet(cabinet, widthMm, depthMm, heightMm, roomWidthMm, roomDepthMm)
    );
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          {formatModuleType(cabinet.moduleType)}
        </h3>
        <button
          onClick={() => selectCabinet(null)}
          aria-label="Deselect"
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">Rotation: {cabinet.rotationDeg}°</span>
        <div className="flex gap-2">
          <button
            onClick={() => handleRotate(-1)}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            −90°
          </button>
          <button
            onClick={() => handleRotate(1)}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            +90°
          </button>
        </div>
      </div>

      <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
        <span>
          Height off floor (mm)
          <br />
          <span className="text-[10px] text-gray-400">0 = sits on the floor</span>
        </span>
        <input
          type="number"
          min={0}
          value={cabinet.elevationMm}
          onChange={(e) => updateCabinet(cabinet.id, { elevationMm: Number(e.target.value) })}
          className="w-20 shrink-0 rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Material
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
      </label>

      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={cabinet.ignoreOverlap ?? false}
          onChange={(e) => updateCabinet(cabinet.id, { ignoreOverlap: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          Ignore overlap alerts for this item
          <br />
          <span className="text-[10px] text-gray-400">
            e.g. a chimney duct that's meant to run through this cabinet
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={cabinet.ignoreClearance ?? false}
          onChange={(e) => updateCabinet(cabinet.id, { ignoreClearance: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          Ignore door/drawer clearance alerts for this item
          <br />
          <span className="text-[10px] text-gray-400">
            e.g. an L-corner fit you've already checked fits in practice
          </span>
        </span>
      </label>

      <FinishPicker cabinet={cabinet} />

      {/* Front (structure) sits under Finish (appearance) deliberately:
          the two are orthogonal, and grouping them adjacently is what
          makes that legible in the UI rather than just in the types. */}
      <FrontPicker cabinet={cabinet} />

      <div className="flex flex-col gap-1">
        <button
          onClick={() => setIsEditingDimensions((open) => !open)}
          className="text-left text-xs text-gray-600 underline hover:text-gray-800"
        >
          {isEditingDimensions
            ? 'Hide dimensions'
            : `Edit dimensions (${cabinet.widthMm}×${cabinet.depthMm}×${cabinet.heightMm}mm)`}
        </button>

        {isEditingDimensions && (
          // key={cabinet.id} forces a fresh instance (and therefore
          // fresh initial state) whenever the SELECTED cabinet changes
          // while this form is open — otherwise its local width/depth/
          // height state would keep showing the PREVIOUS cabinet's
          // numbers after switching selection.
          <DimensionsForm
            key={cabinet.id}
            widthMm={cabinet.widthMm}
            depthMm={cabinet.depthMm}
            heightMm={cabinet.heightMm}
            onSubmit={handleDimensionsChange}
          />
        )}
      </div>

      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <button
          onClick={handleDuplicate}
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
        >
          Duplicate
        </button>
        <button
          onClick={handleDelete}
          className="flex-1 rounded border border-red-300 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface DimensionsFormProps {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  onSubmit: (widthMm: number, depthMm: number, heightMm: number) => void;
}

function DimensionsForm({ widthMm, depthMm, heightMm, onSubmit }: DimensionsFormProps) {
  const [width, setWidth] = useState(widthMm);
  const [depth, setDepth] = useState(depthMm);
  const [height, setHeight] = useState(heightMm);

  return (
    // A <form>, not a <div>, specifically so Enter in any field submits —
    // matching ApplianceInspector's DimensionsForm. The plain div+onClick
    // version this replaced had no way to commit without reaching for the
    // mouse.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!(width > 0 && depth > 0 && height > 0)) return;
        onSubmit(width, depth, height);
      }}
      className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-2"
    >
      <div className="grid grid-cols-3 gap-1">
        <label className="flex flex-col text-[10px] text-gray-500">
          W (mm)
          <input
            type="number"
            min={50}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="rounded border border-gray-300 px-1 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col text-[10px] text-gray-500">
          D (mm)
          <input
            type="number"
            min={50}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded border border-gray-300 px-1 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col text-[10px] text-gray-500">
          H (mm)
          <input
            type="number"
            min={50}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="rounded border border-gray-300 px-1 py-1 text-xs"
          />
        </label>
      </div>
      <button
        type="submit"
        className="rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
      >
        Apply
      </button>
    </form>
  );
}
