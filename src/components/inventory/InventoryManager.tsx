// src/components/inventory/InventoryManager.tsx
//
// Where a business builds and maintains its OWN set of favorite
// pieces — cabinet catalog items (what shows up as "add" buttons in
// CabinetToolbar), obstacle presets (quick-add buttons in
// ObstacleToolbar), and appliance catalog items (add buttons in
// ApplianceToolbar) — instead of being stuck with one fixed, shared
// catalog. Every save/delete here goes straight to Supabase via the
// layoutStore's upsert/remove actions (lib/Inventory.ts underneath),
// and all three toolbars read the SAME store state, so a change made
// here shows up next time any toolbar renders — no separate refresh
// step.
//
// Not tied to any one client/project — this is business-level data, so
// it's reachable from the dashboard as well as from inside a layout
// (see App.tsx).

import { useEffect } from 'react';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { useLayoutStore } from '../../store/layoutStore';
import { CatalogueSection } from './CatalogueSection';
import { catalogueSectionElementId, type CatalogueSectionId } from './catalogueSections';
import { CabinetList, ApplianceList, ObstacleList } from './CatalogueLists';
import { FinishManager } from './FinishManager';
import { HandleManager } from './HandleManager';
import { FixtureManager } from './FixtureManager';
import { CabinetCatalogImportExport } from './CabinetCatalogImportExport';
import { ObstaclePresetImportExport } from './ObstaclePresetImportExport';
import { ApplianceCatalogImportExport } from './ApplianceCatalogImportExport';

// The rows themselves (read-only lists + an edit panel per item) live in
// CatalogueLists.tsx since §76; they replaced inline-editable table rows.
export type InventorySection = CatalogueSectionId;

export function InventoryManager({
  initialSection,
  onOpenDesigner,
}: {
  initialSection?: InventorySection;
  // Opens the Cabinet Designer on a catalogue row (App.tsx owns views).
  onOpenDesigner?: (itemId: string) => void;
} = {}) {
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const obstaclePresets = useLayoutStore((s) => s.obstaclePresets);
  const applianceCatalog = useLayoutStore((s) => s.applianceCatalog);
  const finishCount = useLayoutStore((s) => s.finishes.length);
  const handleCount = useLayoutStore((s) => s.handles.length);
  const fixtureCount = useLayoutStore((s) => s.fixtureCatalog.length);
  const isInventoryLoading = useLayoutStore((s) => s.isInventoryLoading);
  const inventoryError = useLayoutStore((s) => s.inventoryError);

  // Re-runs once loading finishes too, in case initialSection's element
  // wasn't in the DOM yet on the first render.
  useEffect(() => {
    if (!initialSection) return;
    document.getElementById(catalogueSectionElementId(initialSection))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [initialSection, isInventoryLoading]);

  return (
    <div className="flex flex-col gap-6">
      {inventoryError && (
        <Alert variant="destructive">
          <AlertDescription>{inventoryError}</AlertDescription>
        </Alert>
      )}

      {/* The rate card moved to Settings → Rate card (§70): this page is
          what you pick from when designing; Settings is how the business
          prices and builds. Its placeholder banner went with it, and Home
          shows the same warning until the rates are replaced, so the
          disclosure is still the first thing a business sees.

          Section order changed in §71 from "dependency order" (finishes
          and handles before the cabinets that reference them) to "most
          used first": cabinets are what a designer opens this page for,
          and nothing breaks if a finish is added after a cabinet. */}
      {isInventoryLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <CatalogueSection
            id="cabinets"
            count={cabinetCatalog.length}
            description="Your modules, as they appear in the design editor. Changes apply to designs started from now on."
            help={
              <p>
                Each row is one module you sell. Tap it to edit; "Panels & boards" in the editor opens
                the Cabinet Designer for the row's default panels, which every cabinet added from it
                starts with. Bulk-edit the whole list in Excel with the panel below.
              </p>
            }
          >
            <CabinetList onOpenDesigner={onOpenDesigner} />
            <CabinetCatalogImportExport />
          </CatalogueSection>

          <CatalogueSection
            id="appliances"
            count={applianceCatalog.length}
            description="Hobs, chimneys, sinks, fridges. Usually customer-supplied; their size drives the cabinets around them."
            help={
              <>
                <p>
                  <strong className="text-foreground">Elevation</strong> is how high off the floor the
                  appliance's bottom sits when placed: about 850mm for something on the counter, higher
                  for a chimney above a hob.
                </p>
                <p>
                  <strong className="text-foreground">Model orientation</strong> corrects a 3D model that
                  was exported the wrong way up or facing the wrong way. Set it once here. To turn an
                  appliance in one kitchen, rotate it on the plan instead.
                </p>
                <p>
                  <strong className="text-foreground">Sink cutout</strong> is the hole cut into the
                  countertop for a sink, a little smaller than the sink by its rim. Leave both at 0 for
                  a sink that sits on an uncut slab. Shown for sinks only.
                </p>
              </>
            }
          >
            <ApplianceList />
            <ApplianceCatalogImportExport />
          </CatalogueSection>

          <CatalogueSection
            id="finishes"
            count={finishCount}
            description="The shutter and laminate materials you stock. Each one's price per m² feeds the quote."
          >
            <FinishManager />
          </CatalogueSection>

          <CatalogueSection
            id="handles"
            count={handleCount}
            description="Hardware for cabinet fronts, priced per piece or per running metre."
            help={
              <p>
                <strong className="text-foreground">Priced by</strong> is the one to get right: bar
                handles and knobs are per piece; gola and edge profiles are cut to length and billed per
                running metre. Cabinets using a handle you delete fall back to the default, so they keep
                a hardware cost.
              </p>
            }
          >
            <HandleManager />
          </CatalogueSection>

          <CatalogueSection
            id="fixtures"
            count={fixtureCount}
            description="Strips, spots, cove and plinth runs for the lighting design."
            help={
              <p>
                Runs are priced per metre, spots and pendants per piece.{' '}
                <strong className="text-foreground">Lumens</strong> sets how bright a fixture looks in 3D,
                and decides which fixtures get a real light when a kitchen has more than the 3D view can
                draw.
              </p>
            }
          >
            <FixtureManager />
          </CatalogueSection>

          <CatalogueSection
            id="obstacles"
            count={obstaclePresets.length}
            description="Quick-add sizes for the columns, ducts and shafts you meet on site."
            help={
              <p>
                Height and "off floor" only apply when floor-to-ceiling is off; otherwise the obstacle runs
                the room's full height from the floor. "Off floor" lets a preset, such as a mid-wall
                electrical box, start above the floor.
              </p>
            }
          >
            <ObstacleList />
            <ObstaclePresetImportExport />
          </CatalogueSection>
        </>
      )}
    </div>
  );
}
