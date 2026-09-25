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

import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
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

  function handleAdd(item: ApplianceCatalogItem) {
    const newAppliance: PlacedApplianceItem = {
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
    addAppliance(newAppliance);
  }

  return (
    <div className="flex w-64 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Add Appliance</h3>
        <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onManageInventory}>
          Manage
        </Button>
      </div>

      {isInventoryLoading && <p className="text-xs text-gray-400">Loading your pieces...</p>}

      {!isInventoryLoading && applianceCatalog.length === 0 && (
        <p className="text-xs text-gray-400">
          No appliances yet.{' '}
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onManageInventory}>
            Add your first one
          </Button>
          .
        </p>
      )}

      {groups.map(([applianceType, items]) => (
        <div key={applianceType} className="flex flex-col gap-1">
          <span className="rounded bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-700">
            {APPLIANCE_TYPE_LABELS[applianceType]}
          </span>
          <div className="flex flex-col gap-1 pl-1">
            {items.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                onClick={() => handleAdd(item)}
                className="h-auto min-h-8 justify-between py-1 text-left text-xs font-normal whitespace-normal"
              >
                <span>{item.label}</span>
                <span className="shrink-0 text-gray-400">+</span>
              </Button>
            ))}
          </div>
        </div>
      ))}

      {appliances.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
          <h4 className="text-xs font-semibold text-gray-700">Current Appliances</h4>
          <ul className="flex flex-col gap-1">
            {appliances.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs text-gray-600"
              >
                <span>
                  {APPLIANCE_TYPE_LABELS[a.applianceType]} — {a.widthMm}×{a.depthMm}mm
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeAppliance(a.id)}
                  aria-label={`Remove ${APPLIANCE_TYPE_LABELS[a.applianceType]}`}
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
