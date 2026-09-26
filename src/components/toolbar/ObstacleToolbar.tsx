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

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 w-64">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-gray-700">Add Obstacle</h3>
        <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onManageInventory}>
          Manage
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-3">
        <span className="text-xs font-medium text-gray-600">Custom Size</span>

        <div className="flex flex-col text-xs text-gray-600 gap-1">
          Type
          <Select value={selection} onValueChange={handleSelectionChange}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {obstaclePresets.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Your Presets</SelectLabel>
                  {obstaclePresets.map((preset) => (
                    <SelectItem key={preset.id} value={`${PRESET_OPTION_PREFIX}${preset.id}`}>
                      {preset.label} ({preset.widthMm}×{preset.depthMm}mm)
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Generic Type</SelectLabel>
                {ADDABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={`${TYPE_OPTION_PREFIX}${t}`}>
                    {OBSTACLE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {presetLabel && (
            <span className="text-[10px] font-normal text-gray-400">
              Loaded from "{presetLabel}" — tweak any field below before adding.
            </span>
          )}
        </div>

        <label className="flex flex-col text-xs text-gray-600 gap-1">
          Width (mm)
          <input
            type="number"
            min={50}
            step={10}
            value={widthMm}
            onChange={(e) => setWidthMm(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>

        <label className="flex flex-col text-xs text-gray-600 gap-1">
          Depth (mm)
          <input
            type="number"
            min={50}
            step={10}
            value={depthMm}
            onChange={(e) => setDepthMm(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>

        <Label className="flex items-center justify-between gap-2 text-xs font-normal text-gray-600">
          <span>
            Floor to ceiling
            <br />
            <span className="text-[10px] text-gray-400">blocks every height, like a column</span>
          </span>
          <Checkbox checked={floorToCeiling} onCheckedChange={(checked) => setFloorToCeiling(checked === true)} />
        </Label>

        {!floorToCeiling && (
          <>
            <label className="flex flex-col text-xs text-gray-600 gap-1">
              Height (mm)
              <input
                type="number"
                min={50}
                step={10}
                value={heightMm}
                onChange={(e) => setHeightMm(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>

            <label className="flex flex-col text-xs text-gray-600 gap-1">
              Height off floor (mm)
              <span className="text-[10px] font-normal text-gray-400">
                0 = touches the floor; e.g. a mid-wall electrical fixture doesn't
              </span>
              <input
                type="number"
                min={0}
                step={10}
                value={elevationMm}
                onChange={(e) => setElevationMm(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
          </>
        )}

        <Button size="sm" className="h-auto min-h-8 py-1.5 whitespace-normal" onClick={handleAdd}>
          + Add {presetLabel ?? OBSTACLE_TYPE_LABELS[type]}
        </Button>
      </div>

      {obstacles.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
          <h4 className="font-semibold text-xs text-gray-700">Current Obstacles</h4>
          <p className="text-[10px] text-gray-400">
            Select one on the canvas to edit its size/height, or delete it here.
          </p>
          <ul className="flex flex-col gap-1">
            {obstacles.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-2 py-1"
              >
                <span>
                  {OBSTACLE_TYPE_LABELS[o.type]} — {o.widthMm}×{o.depthMm}mm,{' '}
                  {o.floorToCeiling
                    ? 'floor to ceiling'
                    : o.elevationMm > 0
                      ? `${o.heightMm}mm tall, ${o.elevationMm}mm off floor`
                      : `${o.heightMm}mm tall`}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeObstacle(o.id)}
                  aria-label={`Remove ${OBSTACLE_TYPE_LABELS[o.type]}`}
                  className="text-red-500 hover:text-red-700"
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
