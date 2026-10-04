// src/components/toolbar/ObstacleToolbar.tsx
//
// Sidebar control for adding structural obstacles (pillar, plumbing
// shaft, exposed pipe, or electrical panel) to the current layout, plus
// a list of existing obstacles with a delete action for each. New
// obstacles drop in at the room origin (0,0) — drag them into place
// afterward via ObstacleLayer. Editing a PLACED obstacle's dimensions/
// height/floor-to-ceiling afterward is ObstacleInspector's job (select
// it on the canvas) — this toolbar only covers creation.
//
// The "Type" dropdown below is a single unified picker: it lists the
// business's own named presets (from the layout store's
// obstaclePresets — "Standard Column", "Mid-Wall Electrical Point",
// etc, managed from InventoryManager and backed by Supabase, see
// lib/Inventory.ts) ABOVE a "Generic Type" group with the four raw
// structural categories. Picking a preset pre-fills every field below
// from that preset (still freely editable before adding — e.g. widen a
// "Standard Column" for one particular corner); picking a generic type
// resets the form to that type's bare defaults. Either way, "+ Add"
// commits whatever is currently in the form. This replaced an earlier
// design with a separate row of one-click preset buttons ABOVE this
// dropdown — that meant newly-saved presets never showed up IN the
// dropdown itself (only the buttons), which is exactly the dropdown
// this toolbar now fixes: presets now live in the one dropdown, so a
// newly-saved preset is immediately selectable here too.

import { toast } from 'sonner';
import { X } from 'lucide-react';
import { startPlaceGesture } from '../editor/placeDrag';
import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { OBSTACLE_TYPE_LABELS } from '../../types/layout';
import type { ObstacleType } from '../../types/layout';
import { PARTIAL_OBSTACLE_HEIGHT_MM } from '../../lib/collision';

// All four render correctly via ObstacleLayer/ObstacleInspector — every
// type is addable here now (exposed-pipe/electrical-panel used to be
// left out of this dropdown while the feature was still MVP-scoped).
const ADDABLE_TYPES: ObstacleType[] = ['pillar', 'shaft', 'exposed-pipe', 'electrical-panel'];

// Sensible starting point per type when a generic type is picked from
// the dropdown — freely overridden afterward via the checkbox right
// below it, or later via ObstacleInspector.
function defaultFloorToCeiling(type: ObstacleType): boolean {
  return type === 'pillar';
}

// Dropdown option values are tagged so one handler can tell a saved
// preset apart from a bare structural type: "preset:<id>" vs
// "type:<ObstacleType>". Neither an obstacle preset id nor an
// ObstacleType value can contain a colon, so this is unambiguous to
// parse back apart.
const TYPE_OPTION_PREFIX = 'type:';
const PRESET_OPTION_PREFIX = 'preset:';

export interface ObstacleToolbarProps {
  onManageInventory: () => void;
}

export function ObstacleToolbar({ onManageInventory }: ObstacleToolbarProps) {
  const obstacles = useLayoutStore((state) => state.obstacles);
  const addObstacle = useLayoutStore((state) => state.addObstacle);
  const removeObstacle = useLayoutStore((state) => state.removeObstacle);
  const obstaclePresets = useLayoutStore((state) => state.obstaclePresets);

  // What the dropdown is currently showing — a tagged option value (see
  // TYPE_OPTION_PREFIX/PRESET_OPTION_PREFIX above), not the raw
  // ObstacleType, since a preset and a generic type can share the same
  // underlying type but need to render as different selected options.
  const [selection, setSelection] = useState<string>(`${TYPE_OPTION_PREFIX}pillar`);
  const [type, setType] = useState<ObstacleType>('pillar');
  // Non-null only while `selection` points at a preset — drives the "+
  // Add {label}" button text so it reads "+ Add Standard Column"
  // instead of the generic type label when a preset is picked.
  const [presetLabel, setPresetLabel] = useState<string | null>(null);
  const [widthMm, setWidthMm] = useState(300);
  const [depthMm, setDepthMm] = useState(300);
  const [floorToCeiling, setFloorToCeiling] = useState(true);
  const [heightMm, setHeightMm] = useState(PARTIAL_OBSTACLE_HEIGHT_MM);
  // How far off the floor a NON-floor-to-ceiling obstacle starts — see
  // Obstacle.elevationMm (types/layout.ts). 0 by default (most partial
  // obstacles, like a knee-height duct, still touch the floor); this is
  // what lets something like a mid-wall electrical fixture be created
  // starting above the floor instead of always reaching down to it.
  const [elevationMm, setElevationMm] = useState(0);

  // Picking a generic type resets the form to that type's bare
  // defaults (freely overridden below); picking a preset pre-fills
  // every field from the preset instead, still editable before adding.
  function handleSelectionChange(value: string) {
    setSelection(value);
    if (value.startsWith(PRESET_OPTION_PREFIX)) {
      const presetId = value.slice(PRESET_OPTION_PREFIX.length);
      const preset = obstaclePresets.find((p) => p.id === presetId);
      if (!preset) return;
      setType(preset.type);
      setPresetLabel(preset.label);
      setWidthMm(preset.widthMm);
      setDepthMm(preset.depthMm);
      setFloorToCeiling(preset.floorToCeiling);
      setHeightMm(preset.heightMm);
      setElevationMm(preset.elevationMm);
    } else {
      const nextType = value.slice(TYPE_OPTION_PREFIX.length) as ObstacleType;
      setType(nextType);
      setPresetLabel(null);
      setFloorToCeiling(defaultFloorToCeiling(nextType));
    }
  }

  function handleAdd() {
    addObstacle({
      id: crypto.randomUUID(),
      type,
      x: 0,
      y: 0,
      widthMm,
      depthMm,
      floorToCeiling,
      heightMm,
      elevationMm: floorToCeiling ? 0 : elevationMm,
      rotationDeg: 0,
    });
  }

  // A preset is one tap (§85); "Custom size" is for anything else.
  function presetObstacle(preset: (typeof obstaclePresets)[number]) {
    return {
      id: crypto.randomUUID(),
      type: preset.type,
      x: 0,
      y: 0,
      widthMm: preset.widthMm,
      depthMm: preset.depthMm,
      floorToCeiling: preset.floorToCeiling,
      heightMm: preset.heightMm,
      elevationMm: preset.floorToCeiling ? 0 : preset.elevationMm,
      rotationDeg: 0 as const,
    };
  }

  function addPreset(preset: (typeof obstaclePresets)[number]) {
    addObstacle(presetObstacle(preset));
    toast.success(`Added ${preset.label}`, { description: 'It’s in the corner of the room. Drag it into place.' });
  }

  const sizeBox = (label: string, value: number, onChange: (n: number) => void, min: number, hint?: string) => (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      {label}
      <span className="flex h-11 items-center gap-1.5 rounded-[10px] border border-input bg-card px-3">
        <input type="number" min={min} step={10} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[15px] outline-none" />
        <span className="text-sm font-normal text-muted-foreground">mm</span>
      </span>
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {obstaclePresets.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">Your presets</span>
          <div className="grid grid-cols-2 gap-2.5">
            {obstaclePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => addPreset(preset)}
                // Drag onto the plan (§91). A pillar or shaft isn't turned
                // to face anything: it lands where it's dropped.
                onPointerDown={(e) =>
                  startPlaceGesture(e, () => {
                    const o = presetObstacle(preset);
                    return { label: preset.label, widthMm: o.widthMm, depthMm: o.depthMm, autoTurn: false, commit: ({ x, y }) => addObstacle({ ...o, x, y }) };
                  })
                }
                title={`Drag onto the plan, or click to add ${preset.label}`}
                className="flex touch-pan-y flex-col gap-1 rounded-xl select-none border border-border bg-card p-2.5 text-left transition-colors hover:border-primary hover:bg-accent/40"
              >
                <span className="flex h-12 items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,#e2dfd8_0_4px,#efede8_4px_10px)]" />
                <span className="line-clamp-2 text-[13px] font-semibold leading-tight">{preset.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {preset.widthMm} × {preset.depthMm}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
        <span className="text-[15px] font-semibold">Custom size</span>
        <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Type
          <Select value={selection} onValueChange={handleSelectionChange}>
            <SelectTrigger className="h-11! w-full rounded-[10px] bg-card text-[15px] font-normal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {obstaclePresets.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Your presets</SelectLabel>
                  {obstaclePresets.map((preset) => (
                    <SelectItem key={preset.id} value={`${PRESET_OPTION_PREFIX}${preset.id}`}>
                      {preset.label} ({preset.widthMm}×{preset.depthMm}mm)
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Type</SelectLabel>
                {ADDABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={`${TYPE_OPTION_PREFIX}${t}`}>
                    {OBSTACLE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {presetLabel && (
            <span className="text-xs font-normal text-muted-foreground">Loaded from "{presetLabel}". Change anything before adding.</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {sizeBox('Width', widthMm, setWidthMm, 50)}
          {sizeBox('Depth', depthMm, setDepthMm, 50)}
        </div>
        <Label className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox checked={floorToCeiling} onCheckedChange={(checked) => setFloorToCeiling(checked === true)} />
          <span className="flex flex-col">
            Floor to ceiling
            <span className="text-xs font-normal text-muted-foreground">Blocks every height, like a column</span>
          </span>
        </Label>
        {!floorToCeiling && (
          <div className="grid grid-cols-2 gap-2.5">
            {sizeBox('Height', heightMm, setHeightMm, 50)}
            {sizeBox('Off the floor', elevationMm, setElevationMm, 0, 'e.g. a mid-wall box')}
          </div>
        )}
        <Button size="touch" onClick={handleAdd}>
          + Add {presetLabel ?? OBSTACLE_TYPE_LABELS[type]}
        </Button>
      </div>

      {obstacles.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-[13px] font-semibold text-muted-foreground">In this room</span>
          {obstacles.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <span className="min-w-0">
                {OBSTACLE_TYPE_LABELS[o.type]}{' '}
                <span className="font-mono text-xs text-muted-foreground">
                  {o.widthMm}×{o.depthMm}
                  {o.floorToCeiling ? '' : `, ${o.heightMm} high${o.elevationMm > 0 ? `, ${o.elevationMm} up` : ''}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeObstacle(o.id)}
                aria-label={`Remove ${OBSTACLE_TYPE_LABELS[o.type]}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="ghost" size="touch" className="self-start text-primary" onClick={onManageInventory}>
        Manage presets
      </Button>
    </div>
  );
}
