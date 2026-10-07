// src/components/toolbar/CameraToolbar.tsx
//
// Sidebar control for the Phase 2 bridge: drop "Camera Nodes" onto the
// current layout to mark future 360° panorama viewpoints. Placement,
// dragging, and aiming (the direction handle) all happen on the canvas
// via CameraLayer — this toolbar just adds new ones and lets you rename
// or remove existing ones from a plain list. Typing an exact heading
// isn't offered here on purpose: dragging the handle on the canvas is
// the more natural way to aim a camera than entering degrees by hand.
// Height and tilt ARE typed here (§102): a flat plan has no way to drag
// either, and both decide what the image brief's render sees. The other
// way to set tilt is to look around in the 3D walkthrough and press
// "Save this view".
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
import { CameraMovePad } from './CameraMovePad';

const DEFAULT_ROOM_WIDTH_MM = 3000;
// Kneeling-height floor and a ±60° tilt: past either, a "kitchen photo"
// is mostly floor, ceiling or a cabinet side.
const MIN_EYE_HEIGHT_MM = 300;
const MAX_TILT_DEG = 60;
const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
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
  const ceilingMm = (currentLayout?.dimensions.ceilingHeightMm ?? 2700) - 100;
  const layoutId = currentLayout?.id ?? '';

  // Which camera the move pad drives (§103). Cameras aren't selectable
  // items, so the pad has its own picker; a deleted pick falls back to
  // the first camera.
  const [movePick, setMovePick] = useState<string | null>(null);
  const moveCamera = cameras.find((c) => c.id === movePick) ?? cameras[0] ?? null;

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-foreground">Camera Nodes</h3>
        <Button size="sm" onClick={handleAdd}>
          + Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a camera to reposition it; drag the small circle on its arrow to aim it. Set its eye
        height and tilt below (tilt: + looks up, − looks down), or frame it by eye in the 3D view
        and press "Save this view".
      </p>

      {panoramaDeleteError && (
        <Alert variant="destructive">
          <AlertDescription>{panoramaDeleteError}</AlertDescription>
        </Alert>
      )}

      {cameras.length === 0 ? (
        <p className="text-xs text-muted-foreground">No camera nodes yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {cameras.map((camera) => (
            <li key={camera.id} className="flex flex-wrap items-center gap-1 rounded bg-secondary px-2 py-1">
              <input
                value={camera.label}
                onChange={(e) => updateCamera(camera.id, { label: e.target.value })}
                className="w-28 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">{Math.round(camera.viewAngleDeg)}°</span>
              {camera.panoramaUrl && (
                <>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto whitespace-nowrap p-0 text-xs"
                    onClick={() => setViewingCameraId(camera.id)}
                  >
                    View 360°
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto whitespace-nowrap p-0 text-xs text-destructive"
                    onClick={() => handleDeletePanorama(camera.id)}
                  >
                    Delete 360°
                  </Button>
                </>
              )}
              <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-xs text-muted-foreground">
                <label className="flex items-center gap-1">
                  Height
                  <input
                    type="number"
                    min={MIN_EYE_HEIGHT_MM}
                    max={ceilingMm}
                    step={50}
                    // Uncommitted while typing (clamping each keystroke would
                    // turn the "1" of "1600" into 300); committed and clamped
                    // on Enter or leaving the box. The key resets the box
                    // when the saved value changes elsewhere.
                    key={`h-${camera.heightMm}`}
                    defaultValue={camera.heightMm || DEFAULT_CAMERA_HEIGHT_MM}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && e.target.value !== '') updateCamera(camera.id, { heightMm: clampNumber(v, MIN_EYE_HEIGHT_MM, ceilingMm) });
                      else e.target.value = String(camera.heightMm || DEFAULT_CAMERA_HEIGHT_MM);
                    }}
                    aria-label={`${camera.label} eye height in mm`}
                    className="w-16 rounded border border-border bg-white px-1 py-0.5 text-xs text-foreground"
                  />
                  mm
                </label>
                <label className="flex items-center gap-1">
                  Tilt
                  <input
                    type="number"
                    min={-MAX_TILT_DEG}
                    max={MAX_TILT_DEG}
                    step={1}
                    key={`t-${camera.pitchDeg ?? 0}`}
                    defaultValue={Math.round(camera.pitchDeg ?? 0)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && e.target.value !== '') updateCamera(camera.id, { pitchDeg: clampNumber(v, -MAX_TILT_DEG, MAX_TILT_DEG) });
                      else e.target.value = String(Math.round(camera.pitchDeg ?? 0));
                    }}
                    aria-label={`${camera.label} tilt in degrees`}
                    className="w-12 rounded border border-border bg-white px-1 py-0.5 text-xs text-foreground"
                  />
                  °
                </label>
                {camera.fovDeg ? <span>Lens {Math.round(camera.fovDeg)}°</span> : null}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeCamera(camera.id)}
                aria-label={`Remove ${camera.label}`}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}

      {moveCamera && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
            Move
            <select
              value={moveCamera.id}
              onChange={(e) => setMovePick(e.target.value)}
              className="h-8 flex-1 rounded border border-border bg-white px-1.5 text-xs"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <CameraMovePad cameraId={moveCamera.id} />
          <p className="text-[11px] text-muted-foreground">
            Hold an arrow to glide the camera the way it faces; let go to stop. Watch the 3D view while
            you do it.
          </p>
        </div>
      )}

      <PanoramaViewerModal
        isOpen={viewingCamera !== null}
        onClose={() => setViewingCameraId(null)}
        cameraLabel={viewingCamera?.label ?? ''}
        panoramaUrl={viewingCamera?.panoramaUrl}
        headingDeg={viewingCamera?.viewAngleDeg}
        pitchDeg={viewingCamera?.pitchDeg}
      />
    </div>
  );
}
