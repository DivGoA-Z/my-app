// src/components/toolbar/CameraToolbar.tsx
//
// Sidebar control for the Phase 2 bridge: drop "Camera Nodes" onto the
// current layout to mark future 360° panorama viewpoints. Placement,
// dragging, and aiming (the direction handle) all happen on the canvas
// via CameraLayer — this toolbar just adds new ones and lets you rename
// or remove existing ones from a plain list. Typing an exact angle
// isn't offered here on purpose: dragging the handle on the canvas is
// the more natural way to aim a camera than entering degrees by hand.
//
// Also surfaces "View 360°"/"Delete 360°" per node once it's been
// captured (CameraNode.panoramaUrl set — see Room3DCanvas.tsx's
// "Capture 360°", the only place a capture can actually happen, since
// it needs the live 3D scene). Capturing itself isn't offered from
// here. Delete removes the image from Supabase Storage too (not just
// clearing the URL) — see layoutStore.deletePanoramaForCamera — so
// re-captures/cleanup don't leave orphaned files piling up.

import { useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { DEFAULT_CAMERA_HEIGHT_MM } from '../../types/Camera';
import { PanoramaViewerModal } from '../panorama/PanoramaViewerModal';

const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

export function CameraToolbar() {
  const cameras = useLayoutStore((state) => state.cameras);
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const addCamera = useLayoutStore((state) => state.addCamera);
  const updateCamera = useLayoutStore((state) => state.updateCamera);
  const removeCamera = useLayoutStore((state) => state.removeCamera);
  const deletePanoramaForCamera = useLayoutStore((state) => state.deletePanoramaForCamera);
  const [panoramaDeleteError, setPanoramaDeleteError] = useState<string | null>(null);

  async function handleDeletePanorama(cameraId: string) {
    setPanoramaDeleteError(null);
    try {
      await deletePanoramaForCamera(cameraId);
    } catch (err) {
      setPanoramaDeleteError(err instanceof Error ? err.message : 'Failed to delete panorama.');
    }
  }

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
  const layoutId = currentLayout?.id ?? '';

  // Which camera's panorama modal is open, if any — null closes it.
  const [viewingCameraId, setViewingCameraId] = useState<string | null>(null);
  const viewingCamera = cameras.find((c) => c.id === viewingCameraId) ?? null;

  function handleAdd() {
    const now = new Date().toISOString();
    addCamera({
      id: crypto.randomUUID(),
      layoutId,
      label: `Camera ${cameras.length + 1}`,
      x: roomWidthMm / 2,
      y: roomDepthMm / 2,
      viewAngleDeg: 0,
      heightMm: DEFAULT_CAMERA_HEIGHT_MM,
      createdAt: now,
      updatedAt: now,
    });
  }

  return (
    <div className="flex w-64 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Camera Nodes</h3>
        <Button size="xs" onClick={handleAdd}>
          + Add
        </Button>
      </div>

      <p className="text-xs text-gray-500">
        Drag a camera to reposition it; drag the small circle on its arrow to aim it. Saved for
        the Phase 2 panorama viewer at {DEFAULT_CAMERA_HEIGHT_MM}mm eye height.
      </p>

      {panoramaDeleteError && (
        <Alert variant="destructive">
          <AlertDescription>{panoramaDeleteError}</AlertDescription>
        </Alert>
      )}

      {cameras.length === 0 ? (
        <p className="text-xs text-gray-400">No camera nodes yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {cameras.map((camera) => (
            <li key={camera.id} className="flex items-center gap-1 rounded bg-gray-50 px-2 py-1">
              <input
                value={camera.label}
                onChange={(e) => updateCamera(camera.id, { label: e.target.value })}
                className="w-28 flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs"
              />
              <span className="text-[10px] text-gray-400">{Math.round(camera.viewAngleDeg)}°</span>
              {camera.panoramaUrl && (
                <>
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto whitespace-nowrap p-0 text-[10px]"
                    onClick={() => setViewingCameraId(camera.id)}
                  >
                    View 360°
                  </Button>
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto whitespace-nowrap p-0 text-[10px] text-destructive"
                    onClick={() => handleDeletePanorama(camera.id)}
                  >
                    Delete 360°
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeCamera(camera.id)}
                aria-label={`Remove ${camera.label}`}
                className="text-red-500 hover:text-red-700"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}

      <PanoramaViewerModal
        isOpen={viewingCamera !== null}
        onClose={() => setViewingCameraId(null)}
        cameraLabel={viewingCamera?.label ?? ''}
        panoramaUrl={viewingCamera?.panoramaUrl}
      />
    </div>
  );
}
