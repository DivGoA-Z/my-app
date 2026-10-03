// src/components/inspector/ApplianceInspector.tsx
//
// Contextual editing panel for the selected appliance — the same slot
// CabinetInspector and ObstacleInspector share (the three selections
// are mutually exclusive; see layoutStore).
//
// This is new because appliances were the one placeable type with no
// selection at all. That had three consequences worth spelling out,
// because none of them looked like a missing inspector:
//
//   * no delete except through the toolbar's "Current Appliances"
//     list, which reads as a summary rather than as a control;
//   * no way to change a placed appliance's size or mounting height,
//     even though both are priced and both drive collision;
//   * rotation was double-click-only and therefore undiscoverable —
//     the very thing needed to point a sink's tap into the room.
//
// Rotation goes through rotateAppliance (lib/applianceGeometry), the
// same function the canvas double-click uses, so the two entry points
// re-clamp position identically and can't drift.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useSelectedApplianceId } from '../../hooks/useSelection';
import { rotateAppliance } from '../../lib/applianceGeometry';
import { getFootprint } from '../../lib/footprint';
import { APPLIANCE_TYPE_LABELS } from '../../types/appliance';

const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function ApplianceInspector() {
  const selectedApplianceId = useSelectedApplianceId();
  const appliances = useLayoutStore((state) => state.appliances);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const updateAppliance = useLayoutStore((state) => state.updateAppliance);
  const removeAppliance = useLayoutStore((state) => state.removeAppliance);

  const [isEditingDimensions, setIsEditingDimensions] = useState(false);

  const appliance = appliances.find((a) => a.id === selectedApplianceId);

  // Renders nothing at all when no appliance is selected — unlike
  // CabinetInspector, which owns the "click something" placeholder for
  // this slot. Two panels both claiming the empty state would show the
  // message twice.
  if (!appliance) return null;

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  // What the appliance actually occupies on the floor right now, which
  // differs from widthMm x depthMm on a quarter turn — worth showing,
  // because it's the number that explains why it won't fit.
  const { footprintWidthMm, footprintHeightMm } = getFootprint(
    appliance.widthMm,
    appliance.depthMm,
    appliance.rotationDeg
  );
  const isTurned = footprintWidthMm !== appliance.widthMm;

  function handleRotate(direction: 1 | -1) {
    updateAppliance(
      appliance!.id,
      rotateAppliance(appliance!, direction, roomWidthMm, roomDepthMm)
    );
  }

  return (
    <div className="flex w-56 flex-col gap-3 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="text-[19px] font-semibold leading-tight">
          {APPLIANCE_TYPE_LABELS[appliance.applianceType]}
        </h3>
        <p className="text-[13px] text-muted-foreground">
          {appliance.widthMm}×{appliance.depthMm}×{appliance.heightMm}mm ·{' '}
          {INR.format(appliance.unitPrice)}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Rotation — {appliance.rotationDeg}°</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-auto min-h-10 flex-1 py-1 whitespace-normal" onClick={() => handleRotate(-1)}>
            ↺ 90°
          </Button>
          <Button variant="outline" size="sm" className="h-auto min-h-10 flex-1 py-1 whitespace-normal" onClick={() => handleRotate(1)}>
            ↻ 90°
          </Button>
        </div>
        {isTurned && (
          <span className="text-xs text-muted-foreground">
            Occupies {footprintWidthMm}×{footprintHeightMm}mm turned
          </span>
        )}
      </div>

      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        Off floor (mm)
        <input
          type="number"
          min={0}
          step={10}
          value={appliance.elevationMm}
          onChange={(e) =>
            updateAppliance(appliance.id, { elevationMm: Number(e.target.value) })
          }
          className="w-20 rounded-[10px] border border-input px-2 py-1 text-sm"
        />
      </label>
      <span className="-mt-1 text-xs text-muted-foreground">
        Height of the bottom face — 850 for something on the counter, higher for a chimney.
      </span>

      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        Quantity
        <input
          type="number"
          min={1}
          value={appliance.quantity}
          onChange={(e) =>
            updateAppliance(appliance.id, { quantity: Math.max(1, Number(e.target.value)) })
          }
          className="w-16 rounded-[10px] border border-input px-2 py-1 text-sm"
        />
      </label>

      <Label className="flex items-start gap-2 text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={appliance.ignoreOverlap ?? false}
          onCheckedChange={(checked) =>
            updateAppliance(appliance.id, { ignoreOverlap: checked === true })
          }
          className="mt-0.5"
        />
        <span>
          Ignore overlap alerts for this item
          <br />
          <span className="text-xs text-muted-foreground">
            e.g. a chimney duct that's meant to run through a cabinet
          </span>
        </span>
      </Label>

      <div className="flex flex-col gap-1">
        <Button
          variant="link"
          size="sm"
          className="h-auto self-start p-0 text-xs"
          onClick={() => setIsEditingDimensions((open) => !open)}
        >
          {isEditingDimensions ? 'Hide dimensions' : 'Edit dimensions'}
        </Button>

        {isEditingDimensions && (
          // key forces fresh local state when the selection changes
          // while the form is open — otherwise it would keep showing
          // the previously selected appliance's numbers. Same reasoning
          // as DimensionsForm in CabinetInspector.
          <DimensionsForm
            key={appliance.id}
            widthMm={appliance.widthMm}
            depthMm={appliance.depthMm}
            heightMm={appliance.heightMm}
            onSubmit={(widthMm, depthMm, heightMm) => {
              // Keep the CENTRE where it is, then clamp, so resizing
              // doesn't shunt the appliance across the room — the same
              // rule lib/footprint.ts applies to rotation.
              const centerX = appliance.x + appliance.widthMm / 2;
              const centerY = appliance.y + appliance.depthMm / 2;
              const next = getFootprint(widthMm, depthMm, appliance.rotationDeg);
              const x = clamp(
                centerX - widthMm / 2,
                -(widthMm - next.footprintWidthMm) / 2,
                roomWidthMm - widthMm + (widthMm - next.footprintWidthMm) / 2
              );
              const y = clamp(
                centerY - depthMm / 2,
                -(depthMm - next.footprintHeightMm) / 2,
                roomDepthMm - depthMm + (depthMm - next.footprintHeightMm) / 2
              );
              updateAppliance(appliance.id, { widthMm, depthMm, heightMm, x, y });
              setIsEditingDimensions(false);
            }}
          />
        )}
      </div>

      <Button variant="destructive" size="sm" onClick={() => removeAppliance(appliance.id)}>
        Delete
      </Button>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function DimensionsForm({
  widthMm,
  depthMm,
  heightMm,
  onSubmit,
}: {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  onSubmit: (widthMm: number, depthMm: number, heightMm: number) => void;
}) {
  const [w, setW] = useState(String(widthMm));
  const [d, setD] = useState(String(depthMm));
  const [h, setH] = useState(String(heightMm));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Guard against an empty or garbage field committing a 0-size
        // appliance, which would divide by zero in the model fitter.
        const nw = Number(w);
        const nd = Number(d);
        const nh = Number(h);
        if (!(nw > 0 && nd > 0 && nh > 0)) return;
        onSubmit(nw, nd, nh);
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex gap-1">
        <Field label="W" value={w} onChange={setW} />
        <Field label="D" value={d} onChange={setD} />
        <Field label="H" value={h} onChange={setH} />
      </div>
      <Button type="submit" size="sm">
        Apply
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[10px] border border-input px-1 py-0.5 text-xs"
      />
    </label>
  );
}
