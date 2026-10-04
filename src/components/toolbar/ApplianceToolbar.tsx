// src/components/toolbar/ApplianceToolbar.tsx
//
// Sidebar for adding NEW appliances (stove, chimney, oven, OTG,
// toaster) to the layout. Reads the layout store's applianceCatalog —
// the business's OWN editable inventory, managed from InventoryManager
// and backed by Supabase (see lib/inventory.ts) — grouping items by
// applianceType, same pattern CabinetToolbar uses for cabinetCatalog's
// category field. Clicking a button instantiates a new
// PlacedApplianceItem at the center of the room, using the catalog
// row's own defaultElevationMm (see the note on that field in types/
// catalog.ts), with a fresh id via crypto.randomUUID().
//
// Also lists currently-placed appliances with a delete action, same as
// ObstacleToolbar — there's no dedicated ApplianceInspector today, so
// this list is the only way to remove one short of dragging it off
// the canvas edge (which the room-bounds clamp doesn't actually allow).

import { useState } from 'react';
import { toast } from 'sonner';
import { Box, CookingPot, Droplets, Flame, GlassWater, Microwave, Refrigerator, WashingMachine, Wind, X } from 'lucide-react';
import { Chips } from '../inventory/CatalogueKit';
import { startPlaceGesture, type DragPayload } from '../editor/placeDrag';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { ApplianceCatalogItem } from '../../types/Catalog';
import { APPLIANCE_TYPE_LABELS } from '../../types/appliance';
import type { ApplianceType, PlacedApplianceItem } from '../../types/appliance';

// Mirrors the fallback used in App.tsx/CabinetToolbar — only matters
// before any project/layout has loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

export interface ApplianceToolbarProps {
  onManageInventory: () => void;
}

export function ApplianceToolbar({ onManageInventory }: ApplianceToolbarProps) {
  const addAppliance = useLayoutStore((state) => state.addAppliance);
  const removeAppliance = useLayoutStore((state) => state.removeAppliance);
  const appliances = useLayoutStore((state) => state.appliances);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const applianceCatalog = useLayoutStore((state) => state.applianceCatalog);
  const isInventoryLoading = useLayoutStore((state) => state.isInventoryLoading);

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
  const layoutId = currentLayout?.id ?? '';

  const groups = groupByApplianceType(applianceCatalog);

  const [type, setType] = useState('All');

  function buildAppliance(item: ApplianceCatalogItem): PlacedApplianceItem {
    return {
      id: crypto.randomUUID(),
      layoutId,
      applianceType: item.applianceType,
      // Centered using the NEW appliance's own footprint, so it doesn't
      // spawn straddling a wall on a small room.
      x: Math.max(0, (roomWidthMm - item.widthMm) / 2),
      y: Math.max(0, (roomDepthMm - item.depthMm) / 2),
      widthMm: item.widthMm,
      depthMm: item.depthMm,
      heightMm: item.heightMm,
      elevationMm: item.defaultElevationMm,
      // Facing the default direction — front toward +y, which is into
      // the room for a unit against the north wall. Double-click on the
      // canvas turns it from there.
      rotationDeg: 0,
      unitPrice: item.unitPrice,
      quantity: 1,
      // WHICH catalogue row this came from, so model + orientation
      // resolve from the same one. Without it, resolution falls back to
      // matching on applianceType, which takes the first row of that
      // type — fine with one chimney in the catalogue, wrong with two.
      catalogItemId: item.id,
      // modelUrl deliberately NOT copied here. Room3DCanvas resolves
      // it from the appliance catalogue at render time, so pointing a
      // catalogue row at a new .glb updates every placement of it
      // rather than only ones added afterwards.
    };
  }

  function handleAdd(item: ApplianceCatalogItem) {
    addAppliance(buildAppliance(item));
    toast.success(`Added ${item.label}`, { description: 'It’s in the middle of the room. Next time, drag the tile straight to where it goes.' });
  }

  // Drag onto the plan (§91); appliances turn to face the room against
  // a wall like cabinets, but don't magnet-snap to them.
  function dragPayload(item: ApplianceCatalogItem): DragPayload {
    const appliance = buildAppliance(item);
    return {
      label: item.label,
      widthMm: appliance.widthMm,
      depthMm: appliance.depthMm,
      autoTurn: true,
      commit: ({ x, y, rotationDeg }) => addAppliance({ ...appliance, x, y, rotationDeg }),
    };
  }

  // Picture tiles with a type filter (§85), as in the Cabinets panel.
  const shown = applianceCatalog.filter((a) => type === 'All' || APPLIANCE_TYPE_LABELS[a.applianceType] === type);

  return (
    <div className="flex flex-col gap-3">
      {groups.length > 1 && (
        <Chips options={['All', ...groups.map(([t]) => APPLIANCE_TYPE_LABELS[t])]} value={type} onChange={setType} />
      )}

      {isInventoryLoading && (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      {!isInventoryLoading && applianceCatalog.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No appliances in your catalogue yet.{' '}
          <Button variant="link" className="h-auto p-0 text-sm font-semibold" onClick={onManageInventory}>
            Add your first one
          </Button>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {shown.map((item) => {
          const Icon = APPLIANCE_ICONS[item.applianceType] ?? Box;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAdd(item)}
              onPointerDown={(e) => startPlaceGesture(e, () => dragPayload(item))}
              title={`Drag onto the plan, or click to add ${item.label} in the middle`}
              className="flex touch-pan-y flex-col gap-1.5 rounded-xl select-none border border-border bg-card p-2 text-left transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="flex h-16 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <Icon className="size-7" strokeWidth={1.5} />
              </div>
              <span className="line-clamp-2 text-[13px] font-semibold leading-tight">{item.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {item.widthMm} × {item.depthMm} × {item.heightMm}
              </span>
            </button>
          );
        })}
      </div>

      {appliances.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-[13px] font-semibold text-muted-foreground">In this kitchen</span>
          {appliances.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <span className="truncate">
                {APPLIANCE_TYPE_LABELS[a.applianceType]} <span className="font-mono text-xs text-muted-foreground">{a.widthMm}×{a.depthMm}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeAppliance(a.id)}
                aria-label={`Remove ${APPLIANCE_TYPE_LABELS[a.applianceType]}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="ghost" size="touch" className="self-start text-primary" onClick={onManageInventory}>
        Manage catalogue
      </Button>
    </div>
  );
}

const APPLIANCE_ICONS: Partial<Record<ApplianceType, typeof Box>> = {
  sink: Droplets,
  stove: Flame,
  chimney: Wind,
  oven: CookingPot,
  otg: CookingPot,
  fridge: Refrigerator,
  microwave: Microwave,
  dishwasher: WashingMachine,
  'water-purifier': GlassWater,
};

function groupByApplianceType(
  items: ApplianceCatalogItem[]
): [ApplianceType, ApplianceCatalogItem[]][] {
  const map = new Map<ApplianceType, ApplianceCatalogItem[]>();
  for (const item of items) {
    const bucket = map.get(item.applianceType);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(item.applianceType, [item]);
    }
  }
  return Array.from(map.entries());
}
