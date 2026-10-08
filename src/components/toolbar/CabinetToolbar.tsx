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

import { useState } from 'react';
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import { CabinetThumb } from '../editor/CabinetThumb';
import { startPlaceGesture, type DragPayload } from '../editor/placeDrag';
import { Chips, SearchBox } from '../inventory/CatalogueKit';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { getDefaultElevationMm } from '../../lib/cabinetGeometry';
import { useFitCornerPanel } from '../../hooks/useFitCornerPanel';
import { effectiveStyleDefaults, withStyleDefaults } from '../../lib/styleDefaults';
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
  // A blind/magic corner gets its fixed panel fitted where it lands (§116).
  const fitCornerPanel = useFitCornerPanel();
  // And this kitchen's style defaults for its group (§117) on top of the
  // catalogue item's own finish/handle/board.
  const styleDefaults = useLayoutStore((s) => effectiveStyleDefaults(s.businessStyleDefaults ?? undefined, s.projectStyleDefaults ?? undefined));
  const place = (cabinet: PlacedCabinetItem) => {
    const styled = withStyleDefaults(cabinet, styleDefaults);
    // A wall cabinet gets one only where another wall run meets its end.
    addCabinet({ ...styled, ...fitCornerPanel(styled, { onlyWhereRunMeets: styled.moduleType === 'wall-cabinet' }) });
  };

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
  const layoutId = currentLayout?.id ?? '';

  const categories = groupByCategory(cabinetCatalog);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  // The unit as it will be placed: centred in the room, unless a drag
  // (§91) puts it somewhere else.
  function buildCabinet(item: CatalogItem): PlacedCabinetItem {
    return {
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
      carcassBoardId: item.carcassBoardId,
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
      // Snapshotted for the same reason frontLayout is (see above), and
      // deep-copied so editing this cabinet's panels can never reach
      // back into the catalogue row's object.
      panels: item.panels ? structuredClone(item.panels) : undefined,
      extraParts: item.extraParts ? structuredClone(item.extraParts) : undefined,
      unitPrice: item.unitPrice,
      quantity: 1,
    };
  }

  function handleAdd(item: CatalogItem) {
    place(buildCabinet(item));
    toast.success(`Added ${item.label}`, { description: 'It’s in the middle of the room. Next time, drag the tile straight to where it goes.' });
  }

  function dragPayload(item: CatalogItem): DragPayload {
    const cabinet = buildCabinet(item);
    return {
      label: item.label,
      widthMm: cabinet.widthMm,
      depthMm: cabinet.depthMm,
      autoTurn: true,
      cabinet,
      commit: ({ x, y, rotationDeg }) => place({ ...cabinet, x, y, rotationDeg }),
    };
  }

  // Search and a category filter over picture tiles (§85).
  const q = query.trim().toLowerCase();
  const shown = cabinetCatalog.filter(
    (c) => (category === 'All' || c.category === category) && (!q || c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search cabinets" />
      </div>
      {categories.length > 1 && <Chips options={['All', ...categories.map(([c]) => c)]} value={category} onChange={setCategory} />}

      {isInventoryLoading && (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}
      {!isInventoryLoading && cabinetCatalog.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No cabinets in your catalogue yet.{' '}
          <Button variant="link" className="h-auto p-0 text-sm font-semibold" onClick={onManageInventory}>
            Add your first one
          </Button>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleAdd(item)}
            onPointerDown={(e) => startPlaceGesture(e, () => dragPayload(item))}
            title={`Drag onto the plan, or click to add ${item.label} in the middle`}
            className="group flex touch-pan-y flex-col gap-1.5 rounded-xl border border-border bg-card p-2 text-left transition-colors select-none hover:border-primary hover:bg-accent/40"
          >
            <div className="flex h-20 items-center justify-center rounded-lg bg-secondary">
              <CabinetThumb
                moduleType={item.moduleType}
                widthMm={item.widthMm}
                heightMm={item.heightMm}
                frontLayout={item.frontLayout}
                finishId={item.finishId}
                className="h-16 w-20"
              />
            </div>
            <span className="line-clamp-2 text-[13px] font-semibold leading-tight">{item.label}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {item.widthMm} × {item.depthMm} × {item.heightMm}
            </span>
          </button>
        ))}
      </div>
      {!isInventoryLoading && cabinetCatalog.length > 0 && shown.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing matches.</p>
      )}

      <Button variant="ghost" size="touch" className="self-start text-primary" onClick={onManageInventory}>
        Manage catalogue
      </Button>
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
