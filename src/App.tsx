// src/App.tsx

import { useEffect, useState } from 'react';
import { RoomCanvas } from './components/canvas/RoomCanvas';
import { CabinetLayer } from './components/canvas/CabinetLayer';
import { ObstacleLayer } from './components/canvas/ObstacleLayer';
import { ApplianceLayer } from './components/canvas/ApplianceLayer';
import { OpeningLayer } from './components/canvas/OpeningLayer';
import { FixtureLayer } from './components/canvas/FixtureLayer';
import { RemainingSpaceLayer } from './components/canvas/RemainingSpaceLayer';
import { PickChooser } from './components/canvas/PickChooser';
import { CameraLayer } from './components/canvas/CameraLayer';
import { CollisionWarningBanner } from './components/canvas/CollisionWarningBanner';
import { CabinetClearanceWarningBanner } from './components/canvas/CabinetClearanceWarningBanner';
import { KitchenChecksBanner } from './components/canvas/KitchenChecksBanner';
import { ObstacleToolbar } from './components/toolbar/ObstacleToolbar';
import { CabinetToolbar } from './components/toolbar/CabinetToolbar';
import { ApplianceToolbar } from './components/toolbar/ApplianceToolbar';
import { OpeningToolbar } from './components/toolbar/OpeningToolbar';
import { LightingToolbar } from './components/toolbar/LightingToolbar';
import { CameraToolbar } from './components/toolbar/CameraToolbar';
import { RoomSettingsPanel } from './components/toolbar/RoomSettingsPanel';
import { RoomSurfacesPanel } from './components/toolbar/RoomSurfacesPanel';
import { CabinetInspector } from './components/inspector/CabinetInspector';
import { ObstacleInspector } from './components/inspector/ObstacleInspector';
import { ApplianceInspector } from './components/inspector/ApplianceInspector';
import { OpeningInspector } from './components/inspector/OpeningInspector';
import { FixtureInspector } from './components/inspector/FixtureInspector';
import { InventoryManager, type InventorySection } from './components/inventory/InventoryManager';
import { Room3DCanvas } from './components/canvas3d/Room3DCanvas';
import { WallElevationView } from './components/elevation/WallElevationView';
import { QuoteSidebar } from './components/quote/QuoteSidebar';
import { CustomerDashboard } from './components/dashboard/CustomerDashboard';
import { useLayoutStore } from './store/layoutStore';
import { useAuthStore } from './store/authStore';
import { LoginScreen } from './components/auth/LoginScreen';
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts';
import { useSelectionShortcuts } from './hooks/useSelectionShortcuts';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import { Label } from './components/ui/label';

// Fallback room size shown only before any project has loaded — once a
// project loads, the room dimensions come from its saved layout instead
// (different clients' kitchens are different sizes).
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

type View = 'dashboard' | 'canvas' | 'inventory' | 'preview3d' | 'elevation';

function App() {
  const [view, setView] = useState<View>('dashboard');
  // Where "Manage Inventory" returns to when closed — the dashboard, or
  // back into whichever client's layout was open.
  const [previousView, setPreviousView] = useState<View>('dashboard');
  // Which catalog section to scroll to when the inventory screen opens —
  // set by whichever toolbar's "Manage" button was clicked, undefined
  // for the dashboard's generic "Manage Inventory" button.
  const [manageSection, setManageSection] = useState<InventorySection | undefined>(undefined);
  // Purely a display preference for the 2D plan — cabinet width×depth×
  // height labels and the remaining-space gap labels both get dense on
  // a busy layout. Not persisted: this is about decluttering THIS
  // session's screen, not a property of the layout itself.
  const [showDimensions, setShowDimensions] = useState(true);
  // Same session-only shape as showDimensions, for the red overlap
  // highlight and the amber clearance highlight/zones — a GLOBAL
  // master on top of each item's own ignoreOverlap/ignoreClearance
  // (CabinetInspector). The global only ever hides MORE: turning it
  // off suppresses the warning everywhere regardless of any item's
  // own setting, but turning it back on doesn't override an
  // individual item's mute — that per-item choice still applies
  // underneath. See CabinetLayerProps' own comment for exactly what
  // "off" hides.
  const [showOverlapWarnings, setShowOverlapWarnings] = useState(true);
  const [showClearanceWarnings, setShowClearanceWarnings] = useState(true);
  // Third, independent toggle for the trade-ergonomics banner
  // (aisle width, sink-hob distance, etc — lib/kitchenChecks.ts) —
  // same "visible by default, hideable on a busy layout" shape as the
  // other two, since a kitchen with a genuinely tight aisle will keep
  // showing that finding on every render otherwise.
  const [showKitchenChecks, setShowKitchenChecks] = useState(true);

  const currentProject = useLayoutStore((s) => s.currentProject);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const isLoading = useLayoutStore((s) => s.isLoading);
  const loadError = useLayoutStore((s) => s.loadError);
  const isSaving = useLayoutStore((s) => s.isSaving);
  const saveError = useLayoutStore((s) => s.saveError);
  const lastAutosaveAt = useLayoutStore((s) => s.lastAutosaveAt);
  const loadProject = useLayoutStore((s) => s.loadProject);
  const saveProject = useLayoutStore((s) => s.saveProject);
  const loadInventory = useLayoutStore((s) => s.loadInventory);
  const undo = useLayoutStore((s) => s.undo);
  const redo = useLayoutStore((s) => s.redo);
  const canUndo = useLayoutStore((s) => s.undoStack.length > 0);
  const canRedo = useLayoutStore((s) => s.redoStack.length > 0);

  const session = useAuthStore((s) => s.session);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const authInit = useAuthStore((s) => s.init);
  const signOut = useAuthStore((s) => s.signOut);

  // Cmd+Z / Cmd+Shift+Z, app-wide (skipped while a text field has
  // focus — see the hook's own comment).
  useUndoRedoShortcuts();

  // Delete/Backspace, Escape, arrow-key nudge for whatever's selected —
  // only while the 2D canvas is the active view (see the hook's own
  // comment on why a stale selection from another screen must not act).
  useSelectionShortcuts(view === 'canvas');

  // Restores an existing session (persisted across reloads — see
  // Supabaseclient.ts) or confirms there isn't one. init() is a no-op
  // past its first call, so this is safe even under StrictMode's
  // double-invoke in dev.
  useEffect(() => {
    authInit();
  }, [authInit]);

  // Inventory (cabinet catalog + obstacle presets) is business-level,
  // not tied to any one client's layout — load it once up front so
  // it's already there whether the user opens a layout or the
  // Inventory screen first. Gated on `session`: this reaches Supabase,
  // and RLS now requires being signed in for that to return anything.
  useEffect(() => {
    if (session) loadInventory();
  }, [loadInventory, session]);

  if (isAuthLoading) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  if (!session) {
    return <LoginScreen />;
  }

  function handleOpenCanvas(projectId: string) {
    setView('canvas');
    loadProject(projectId);
  }

  function handleManageInventory(section?: InventorySection) {
    setPreviousView(view);
    setManageSection(section);
    setView('inventory');
  }

  // The manual "Save Project" button, distinct from autosave — autosave
  // stays silent by design (the user asked for exactly that: only the
  // "Auto saved HH:MM:SS" text updates, no button-state flicker), but a
  // deliberate click deserves a toast either way, per PRINCIPLES.md's
  // "feedback on every action" rule. Reads saveError straight from the
  // store right after the awaited call rather than through the `saveError`
  // hook value above, which is one render behind at this point.
  async function handleManualSave() {
    await saveProject();
    const error = useLayoutStore.getState().saveError;
    if (error) {
      toast.error('Failed to save project', { description: error });
    } else {
      toast.success('Project saved');
    }
  }

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  // A single `content` variable rather than an early `return` per
  // branch, so <Toaster/> below only has to be mounted once and stays
  // mounted across every view switch instead of unmounting and losing
  // any in-flight toast each time `view` changes.
  let content: React.ReactNode;

  if (view === 'elevation') {
    content = <WallElevationView onClose={() => setView('canvas')} />;
  } else if (view === 'preview3d') {
    content = (
      <div className="flex flex-col gap-4 p-8">
        <Button variant="outline" size="sm" className="self-start" onClick={() => setView('canvas')}>
          ← Back to 2D
        </Button>
        <p className="text-xs text-gray-500">
          Drag to orbit, pick a saved camera under "Viewpoint", or click a glowing floor marker to
          smoothly step into the room at that Camera Node's exact position and direction. Once
          locked to a node, drag to look around (including down at the floor) without moving.
        </p>
        <Room3DCanvas widthMm={roomWidthMm} depthMm={roomDepthMm} />
      </div>
    );
  } else if (view === 'inventory') {
    content = (
      <div className="flex flex-col gap-4 p-8">
        <Button variant="outline" size="sm" className="self-start" onClick={() => setView(previousView)}>
          ← Back
        </Button>
        <InventoryManager initialSection={manageSection} />
      </div>
    );
  } else if (view === 'dashboard') {
    // CustomerDashboard now fetches its own list from Supabase (see
    // lib/customers.ts) — no more sample-data.json here at all.
    content = (
      <div className="flex flex-col gap-4 p-8">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => handleManageInventory()}>
            Manage Inventory
          </Button>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
        <CustomerDashboard onOpenCanvas={handleOpenCanvas} onManageInventory={handleManageInventory} />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4 p-8">
        <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setView('dashboard')}>
          ← Back to Pipeline
        </Button>

        {currentProject && (
          <span className="text-xs text-gray-500">
            {currentProject.clientName} — {currentProject.locality}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
            ↶ Undo
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
            ↷ Redo
          </Button>
        </div>

        <RoomSettingsPanel />

        <Button variant="outline" size="sm" onClick={() => setView('elevation')}>
          Wall Elevation
        </Button>

        <Button variant="outline" size="sm" onClick={() => setView('preview3d')}>
          3D Preview
        </Button>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleManualSave} disabled={isSaving || !currentProject}>
            {isSaving ? 'Saving...' : 'Save Project'}
          </Button>
          {/* Everything here autosaves a couple of seconds after you
              stop editing — this button is for "save right now before
              I close the tab", not the only way anything gets kept. */}
          {!isSaving && !saveError && lastAutosaveAt && (
            <span className="text-[11px] text-gray-400">
              Auto saved {new Date(lastAutosaveAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load: {loadError}
        </p>
      )}
      {saveError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to save: {saveError}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading layout...</p>
      ) : (
        <div className="flex gap-6">
          <div className="flex flex-col gap-4">
            <CabinetToolbar onManageInventory={() => handleManageInventory('cabinets')} />
            <ObstacleToolbar onManageInventory={() => handleManageInventory('obstacles')} />
            <ApplianceToolbar onManageInventory={() => handleManageInventory('appliances')} />
            <OpeningToolbar />
            <LightingToolbar />
            <CameraToolbar />
            <RoomSurfacesPanel />
          </div>

          <div className="relative flex flex-col gap-3">
            {showOverlapWarnings && <CollisionWarningBanner />}
            {showClearanceWarnings && <CabinetClearanceWarningBanner />}
            {showKitchenChecks && <KitchenChecksBanner />}

            <div className="flex w-fit flex-col gap-1.5">
              <Label className="flex items-center gap-2 text-xs font-normal text-gray-600">
                <Checkbox
                  checked={showDimensions}
                  onCheckedChange={(checked) => setShowDimensions(checked === true)}
                />
                Show dimensions
              </Label>
              <Label className="flex items-center gap-2 text-xs font-normal text-gray-600">
                <Checkbox
                  checked={showOverlapWarnings}
                  onCheckedChange={(checked) => setShowOverlapWarnings(checked === true)}
                />
                Show overlap warnings
              </Label>
              <Label className="flex items-center gap-2 text-xs font-normal text-gray-600">
                <Checkbox
                  checked={showClearanceWarnings}
                  onCheckedChange={(checked) => setShowClearanceWarnings(checked === true)}
                />
                Show clearance warnings
              </Label>
              <Label className="flex items-center gap-2 text-xs font-normal text-gray-600">
                <Checkbox
                  checked={showKitchenChecks}
                  onCheckedChange={(checked) => setShowKitchenChecks(checked === true)}
                />
                Show kitchen ergonomics checks
              </Label>
            </div>

            {/* The overlap chooser. Fixed-positioned itself, but it
                lives here so it unmounts with the canvas rather than
                lingering over the dashboard. */}
            <PickChooser />

            <RoomCanvas widthMm={roomWidthMm} depthMm={roomDepthMm}>
              <CabinetLayer
                widthMm={roomWidthMm}
                depthMm={roomDepthMm}
                showDimensions={showDimensions}
                showOverlapWarnings={showOverlapWarnings}
                showClearanceWarnings={showClearanceWarnings}
              />
              <ObstacleLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              <ApplianceLayer
                widthMm={roomWidthMm}
                depthMm={roomDepthMm}
                showOverlapWarnings={showOverlapWarnings}
              />
              {/* After appliances so swing arcs and openings draw over
                  the items they may conflict with. */}
              <OpeningLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              {/* Last, so fixture markers sit above everything they
                  might be mounted to. */}
              <FixtureLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              <CameraLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              {/* Last, purely a readout (listening=false), so its
                  labels are never hidden under anything else. */}
              <RemainingSpaceLayer
                widthMm={roomWidthMm}
                depthMm={roomDepthMm}
                visible={showDimensions}
              />
            </RoomCanvas>
          </div>

          <CabinetInspector />
          <ObstacleInspector />
          <ApplianceInspector />
          <OpeningInspector />
          <FixtureInspector />

          <QuoteSidebar />
        </div>
      )}
      </div>
    );
  }

  return (
    <>
      {content}
      <Toaster />
      <ConfirmDialog />
    </>
  );
}

export default App;
