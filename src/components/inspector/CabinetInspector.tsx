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

import { ChevronDown, Copy, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { BoardSelect } from '../common/BoardSelect';
import { describePanels } from '../../lib/panels';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useSelectedCabinetId, useSelectedObstacleId } from '../../hooks/useSelection';
import { rotateCabinet, resizeCabinet, duplicateCabinet } from '../../lib/cabinetGeometry';
import { FinishPicker } from './FinishPicker';
import { FrontPicker } from './FrontPicker';
import { CornerPanelControl } from './CornerPanelControl';


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

// onOpenDesigner: opens the Cabinet Designer for this cabinet — App.tsx
// owns which screen is showing, so it's passed in rather than the
// inspector switching views itself.
export function CabinetInspector({ onOpenDesigner }: { onOpenDesigner?: (cabinetId: string) => void } = {}) {
  const selectedCabinetId = useSelectedCabinetId();
  const selectedObstacleId = useSelectedObstacleId();
  const cabinets = useLayoutStore((state) => state.cabinets);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const updateCabinet = useLayoutStore((state) => state.updateCabinet);
  const removeCabinet = useLayoutStore((state) => state.removeCabinet);
  const addCabinet = useLayoutStore((state) => state.addCabinet);
  const selectCabinet = useLayoutStore((state) => state.selectCabinet);


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

  // Laid out for designing WITH the customer (§86): what they choose
  // (finish, front) first and big; workshop settings below; rarely used
  // alert switches folded away.
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[19px] font-semibold leading-tight">{formatModuleType(cabinet.moduleType)}</h3>
          <span className="font-mono text-[13px] text-muted-foreground">
            {cabinet.widthMm} × {cabinet.depthMm} × {cabinet.heightMm} mm · {cabinet.rotationDeg}°
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <QuickAction label="Turn left" onClick={() => handleRotate(-1)}>
          <RotateCcw />
        </QuickAction>
        <QuickAction label="Turn right" onClick={() => handleRotate(1)}>
          <RotateCw />
        </QuickAction>
        <QuickAction label="Duplicate" onClick={handleDuplicate}>
          <Copy />
        </QuickAction>
        <QuickAction label="Delete" onClick={handleDelete} danger>
          <Trash2 />
        </QuickAction>
      </div>

      <FinishPicker cabinet={cabinet} />

      {/* Front (structure) sits under Finish (appearance) deliberately:
          the two are orthogonal, and grouping them adjacently is what
          makes that legible in the UI rather than just in the types. */}
      <FrontPicker cabinet={cabinet} />
      <CornerPanelControl cabinet={cabinet} />

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-[13px] font-semibold">Size</span>
        {/* key={cabinet.id} forces a fresh instance (and therefore fresh
            initial state) whenever the SELECTED cabinet changes —
            otherwise its local width/depth/height state would keep
            showing the PREVIOUS cabinet's numbers after switching. */}
        <DimensionsForm
          key={`${cabinet.id}-${cabinet.widthMm}-${cabinet.depthMm}-${cabinet.heightMm}`}
          widthMm={cabinet.widthMm}
          depthMm={cabinet.depthMm}
          heightMm={cabinet.heightMm}
          onSubmit={handleDimensionsChange}
        />
        <label className="mt-1 flex flex-col gap-1.5 text-[13px] font-semibold">
          Height off the floor
          <input
            type="number"
            min={0}
            value={cabinet.elevationMm}
            onChange={(e) => updateCabinet(cabinet.id, { elevationMm: Number(e.target.value) })}
            className="h-10 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[15px]"
          />
          <span className="text-xs font-normal text-muted-foreground">0 = stands on the floor</span>
        </label>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-[13px] font-semibold">Board</span>
        <BoardSelect
          material={cabinet.material}
          carcassBoardId={cabinet.carcassBoardId}
          onChange={(patch) => updateCabinet(cabinet.id, patch)}
          triggerClassName="h-11! w-full rounded-[10px] text-[15px]"
        />
        <span className="text-xs text-muted-foreground">{describePanels(cabinet.panels)}</span>
        {onOpenDesigner && (
          <Button type="button" variant="outline" size="touch" className="self-start" onClick={() => onOpenDesigner(cabinet.id)}>
            Panels & boards…
          </Button>
        )}
      </div>

      <details className="group rounded-xl border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-[13px] font-semibold">
          More: design checks for this item
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <Label className="flex items-start gap-2.5 text-sm font-medium">
            <Checkbox
              checked={cabinet.ignoreOverlap ?? false}
              onCheckedChange={(checked) => updateCabinet(cabinet.id, { ignoreOverlap: checked === true })}
              className="mt-0.5"
            />
            <span className="flex flex-col">
              Ignore overlap alerts
              <span className="text-xs font-normal text-muted-foreground">e.g. a chimney duct meant to run through this cabinet</span>
            </span>
          </Label>
          <Label className="flex items-start gap-2.5 text-sm font-medium">
            <Checkbox
              checked={cabinet.ignoreClearance ?? false}
              onCheckedChange={(checked) => updateCabinet(cabinet.id, { ignoreClearance: checked === true })}
              className="mt-0.5"
            />
            <span className="flex flex-col">
              Ignore door/drawer clearance alerts
              <span className="text-xs font-normal text-muted-foreground">e.g. an L-corner fit you've checked works in practice</span>
            </span>
          </Label>
        </div>
      </details>
    </div>
  );
}

function QuickAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-xs font-medium transition-colors [&_svg]:size-[18px]',
        danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-secondary'
      )}
    >
      {children}
      {label}
    </button>
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
      className="flex flex-col gap-2"
    >
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['Width', width, setWidth],
            ['Depth', depth, setDepth],
            ['Height', height, setHeight],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {label}
            <input
              type="number"
              min={50}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
              className="h-10 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[15px] px-2"
            />
          </label>
        ))}
      </div>
      {(width !== widthMm || depth !== depthMm || height !== heightMm) && (
        <Button type="submit" size="touch">
          Apply new size
        </Button>
      )}
    </form>
  );
}
