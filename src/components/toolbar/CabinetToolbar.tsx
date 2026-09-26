// src/components/toolbar/CabinetToolbar.tsx
//
// Sidebar for adding NEW cabinets to the layout (as opposed to
// ObstacleToolbar, which adds pillars/shafts). Reads the layout store's
// cabinetCatalog — the business's OWN editable inventory, managed from
// InventoryManager and backed by Supabase (see lib/inventory.ts) —
// grouping items by their category on the fly. Clicking a button
// instantiates a new PlacedCabinetItem at the center of the room, with
// a fresh id via crypto.randomUUID().
//
// No props besides onManageInventory: room dimensions and the active
// layout id are read straight from the store (same self-contained
// pattern as ObstacleToolbar), so it drops in next to it in App.tsx
// with minimal wiring.
//
// Note: if you add several cabinets in a row without moving them, they
// stack on the exact same center point — the collision system (already
// live) will immediately flag them red. That's expected, not a bug:
// drag them apart same as any other overlap.

import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { getDefaultElevationMm } from '../../lib/cabinetGeometry';
import type { CatalogItem } from '../../types/Catalog';
import type { PlacedCabinetItem } from '../../types/cabinet';

// Mirrors the fallback used in App.tsx — only matters before any
// project/layout has loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

export interface CabinetToolbarProps {
  onManageInventory: () => void;
}

export function CabinetToolbar({ onManageInventory }: CabinetToolbarProps) {
  const addCabinet = useLayoutStore((state) => state.addCabinet);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinetCatalog = useLayoutStore((state) => state.cabinetCatalog);
  const isInventoryLoading = useLayoutStore((state) => state.isInventoryLoading);

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
  const layoutId = currentLayout?.id ?? '';

  const categories = groupByCategory(cabinetCatalog);

  function handleAdd(item: CatalogItem) {
    const newCabinet: PlacedCabinetItem = {
      id: crypto.randomUUID(),
      layoutId,
      moduleType: item.moduleType,
      // Centered using the NEW cabinet's own footprint, so it doesn't
      // spawn straddling a wall on a small room.
      x: Math.max(0, (roomWidthMm - item.widthMm) / 2),
      y: Math.max(0, (roomDepthMm - item.depthMm) / 2),
      widthMm: item.widthMm,
      depthMm: item.depthMm,
      heightMm: item.heightMm,
      elevationMm: getDefaultElevationMm(item.moduleType),
      rotationDeg: 0,
      material: item.material,
      finishId: item.finishId,
      // Front configuration is SNAPSHOTTED from the catalogue rather
      // than resolved live at render time — the opposite of how
      // appliance models work, and deliberately so. A model is an asset
      // reference the business improves centrally; a front is a design
      // decision made per cabinet, and the designer changes it on
      // individual units all the time. Re-reading the catalogue would
      // silently undo those edits whenever the row changed.
      //
      // Left undefined when the catalogue row has no default, so it
      // falls through to defaultFrontLayout(moduleType, widthMm) at
      // read time — which keeps improving as that rule improves.
      frontLayout: item.frontLayout,
      handleId: item.handleId,
      unitPrice: item.unitPrice,
      quantity: 1,
    };
    addCabinet(newCabinet);
  }

  return (
    <div className="flex w-64 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Add Cabinet</h3>
        <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onManageInventory}>
          Manage
        </Button>
      </div>

      {isInventoryLoading && (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {!isInventoryLoading && cabinetCatalog.length === 0 && (
        <p className="text-xs text-gray-400">
          No cabinet pieces yet.{' '}
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onManageInventory}>
            Add your first one
          </Button>
          .
        </p>
      )}

      {categories.map(([category, items]) => (
        <div key={category} className="flex flex-col gap-1">
          <span className="rounded bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-700">
            {category}
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
    </div>
  );
}

function groupByCategory(items: CatalogItem[]): [string, CatalogItem[]][] {
  const map = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const bucket = map.get(item.category);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(item.category, [item]);
    }
  }
  return Array.from(map.entries());
}
