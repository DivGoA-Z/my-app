// src/App.tsx

import { useEffect, useState } from 'react';
import { RoomCanvas } from './components/canvas/RoomCanvas';
import { CabinetLayer } from './components/canvas/CabinetLayer';
import { ObstacleLayer } from './components/canvas/ObstacleLayer';
import { ApplianceLayer } from './components/canvas/ApplianceLayer';
import { OpeningLayer } from './components/canvas/OpeningLayer';
import { FixtureLayer } from './components/canvas/FixtureLayer';
import { PickChooser } from './components/canvas/PickChooser';
import { CameraLayer } from './components/canvas/CameraLayer';
import { CollisionWarningBanner } from './components/canvas/CollisionWarningBanner';
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
import { InventoryManager } from './components/inventory/InventoryManager';
import { Room3DCanvas } from './components/canvas3d/Room3DCanvas';
import { QuoteSidebar } from './components/quote/QuoteSidebar';
import { CustomerDashboard } from './components/dashboard/CustomerDashboard';
import { useLayoutStore } from './store/layoutStore';

// Fallback room size shown only before any project has loaded — once a
// project loads, the room dimensions come from its saved layout instead
// (different clients' kitchens are different sizes).
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

type View = 'dashboard' | 'canvas' | 'inventory' | 'preview3d';

function App() {
  const [view, setView] = useState<View>('dashboard');
  // Where "Manage Inventory" returns to when closed — the dashboard, or
  // back into whichever client's layout was open.
  const [previousView, setPreviousView] = useState<View>('dashboard');

  const currentProject = useLayoutStore((s) => s.currentProject);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const isLoading = useLayoutStore((s) => s.isLoading);
  const loadError = useLayoutStore((s) => s.loadError);
  const isSaving = useLayoutStore((s) => s.isSaving);
  const saveError = useLayoutStore((s) => s.saveError);
  const loadProject = useLayoutStore((s) => s.loadProject);
  const saveProject = useLayoutStore((s) => s.saveProject);
  const loadInventory = useLayoutStore((s) => s.loadInventory);

  // Inventory (cabinet catalog + obstacle presets) is business-level,
  // not tied to any one client's layout — load it once up front so
  // it's already there whether the user opens a layout or the
  // Inventory screen first.
  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  function handleOpenCanvas(projectId: string) {
    setView('canvas');
    loadProject(projectId);
  }

  function handleManageInventory() {
    setPreviousView(view);
    setView('inventory');
  }

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  if (view === 'preview3d') {
    return (
      <div className="flex flex-col gap-4 p-8">
        <button
          onClick={() => setView('canvas')}
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← Back to 2D
        </button>
        <p className="text-xs text-gray-500">
          Drag to orbit, pick a saved camera under "Viewpoint", or click a glowing floor marker to
          smoothly step into the room at that Camera Node's exact position and direction. Once
          locked to a node, drag to look around (including down at the floor) without moving.
        </p>
        <Room3DCanvas widthMm={roomWidthMm} depthMm={roomDepthMm} />
      </div>
    );
  }

  if (view === 'inventory') {
    return (
      <div className="flex flex-col gap-4 p-8">
        <button
          onClick={() => setView(previousView)}
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← Back
        </button>
        <InventoryManager />
      </div>
    );
  }

  // CustomerDashboard now fetches its own list from Supabase (see
  // lib/customers.ts) — no more sample-data.json here at all.
  if (view === 'dashboard') {
    return (
      <div className="flex flex-col gap-4 p-8">
        <div className="flex justify-end">
          <button
            onClick={handleManageInventory}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Manage Inventory
          </button>
        </div>
        <CustomerDashboard onOpenCanvas={handleOpenCanvas} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setView('dashboard')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← Back to Pipeline
        </button>

        {currentProject && (
          <span className="text-xs text-gray-500">
            {currentProject.clientName} — {currentProject.locality}
          </span>
        )}

        <div className="ml-auto">
          <RoomSettingsPanel />
        </div>

        <button
          onClick={() => setView('preview3d')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          3D Preview
        </button>

        <button
          onClick={() => saveProject()}
          disabled={isSaving || !currentProject}
          className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Project'}
        </button>
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
            <CabinetToolbar onManageInventory={handleManageInventory} />
            <ObstacleToolbar onManageInventory={handleManageInventory} />
            <ApplianceToolbar onManageInventory={handleManageInventory} />
            <OpeningToolbar />
            <LightingToolbar />
            <CameraToolbar />
            <RoomSurfacesPanel />
          </div>

          <div className="relative flex flex-col gap-3">
            <CollisionWarningBanner />

            {/* The overlap chooser. Fixed-positioned itself, but it
                lives here so it unmounts with the canvas rather than
                lingering over the dashboard. */}
            <PickChooser />

            <RoomCanvas widthMm={roomWidthMm} depthMm={roomDepthMm}>
              <CabinetLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              <ObstacleLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              <ApplianceLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              {/* After appliances so swing arcs and openings draw over
                  the items they may conflict with. */}
              <OpeningLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              {/* Last, so fixture markers sit above everything they
                  might be mounted to. */}
              <FixtureLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
              <CameraLayer widthMm={roomWidthMm} depthMm={roomDepthMm} />
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

export default App;
