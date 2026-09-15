// src/components/canvas3d/Room3DCanvas.tsx
//
// PASS 2 of the 3D visualization work — rendering polish, on top of
// Pass 1's geometry (room shell, cabinet/obstacle boxes, camera
// markers), which is unchanged here (appliance boxes are new since
// then, added the same way obstacles were). Reads the exact same
// layout data the 2D canvas uses (RoomCanvas/CabinetLayer/
// ObstacleLayer/ApplianceLayer/CameraLayer, all driven by
// useLayoutStore).
//
// What's new in this pass:
// - PBR materials: cabinets now use MeshPhysicalMaterial with a
//   clearcoat layer for glossy Acrylic/PU finishes (lib/materials3d.ts)
//   instead of a flat MeshStandardMaterial.
// - Lighting: a 3-light rig — ambient fill, a directional "sun" that
//   casts soft shadows, and a warm point light under every elevated
//   (wall/tall) cabinet standing in for an LED strip
//   (lib/lighting3d.ts).
// - HDRI + tone mapping: drei's <Environment> supplies realistic
//   reflections on glossy surfaces (background={false} — see the note
//   on that below), and the Canvas's WebGL context is configured for
//   ACES Filmic tone mapping, same as most physically-lit three.js
//   scenes, so highlights roll off naturally instead of clipping.
// - First-person camera lock: a small "Viewpoint" dropdown lets you
//   pick a saved Camera Node instead of free-orbiting — locks the
//   camera to that node's x/y/heightMm and points it in
//   viewAngleDeg's direction, both taken from the exact same 2D data
//   CameraLayer.tsx authors.
//
// Step 1 of the walkthrough architecture (in-canvas hotspot
// teleportation), added on top of Pass 2 above:
// - Glowing floor hotspots: a clickable disc on the floor at every
//   saved Camera Node's X/Z (HotspotMarker below) — click one to "step
//   into" the room at that node, same destination the Viewpoint
//   dropdown picks, just reachable straight from the 3D view. The
//   currently-active node's hotspot renders brighter and gently pulses
//   so it reads as a "you are here" marker.
// - Smooth transitions: FirstPersonCamera (Pass 2, instant snap) was
//   replaced by AnimatedFirstPersonCamera, which slides/turns toward
//   the target node every frame instead of jumping — whether the node
//   changed via a hotspot click or the Viewpoint dropdown. The very
//   first activation (free orbit -> locked) still snaps instantly
//   rather than flying in from wherever the orbit camera happened to
//   be; every switch after that animates.
//
// Added after Step 1: free-look drag while locked. Until now a locked
// camera only ever looked dead level in its saved viewAngleDeg
// direction — there was no way to tilt down and see the floor, or up
// at the ceiling. AnimatedFirstPersonCamera now also listens for
// click-drag on the canvas (see its own comment) and lets you look
// around freely from the node's fixed standing position — position
// never moves, only the look direction — reverting to the node's
// saved level angle the next time you teleport anywhere. This is
// intentionally NOT stored on CameraNode: it's a live viewing aid, not
// authored data.
//
// Install: npm install three @react-three/fiber @react-three/drei

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  Lightformer,
  PerspectiveCamera,
  Edges,
} from '@react-three/drei';
import { useLayoutStore } from '../../store/layoutStore';
import { useSelectedCabinetId } from '../../hooks/useSelection';
import { resolveMaterial } from '../../lib/materials3d';
import { useSurfaceTextures, useFinishTextures, useOpeningBackdrop } from '../../lib/textures3d';
import { resolveFinish } from '../../types/finish';
import {
  hasCountertop,
  COUNTERTOP_THICKNESS_MM,
  COUNTERTOP_OVERHANG_MM,
} from '../../lib/cabinetGeometry';
import { mmToWorld, groundPosition, clockwiseDegToThreeY, MM_TO_M } from '../../lib/scene3d';
import { lightingEnvironmentFor, clampExposure, DEFAULT_EXPOSURE, FIXTURE_LUMEN_SCALE, FIXTURE_ORIGIN_STANDOFF_M, FIXTURE_LIGHT_DECAY, DAYLIGHT_DECAY, LINEAR_SAMPLES_BY_QUALITY, LINEAR_SAMPLE_MIN_LENGTH_MM, DIFFUSE_ORIGIN_STANDOFF_MM, FIXTURE_LIGHT_DISTANCE_MM, FIXTURE_EMISSIVE_INTENSITY, DAYLIGHT_BASE_INTENSITY, BACKDROP_DISTANCE_M, BACKDROP_OVERSIZE, kelvinToColor, DAYLIGHT_STANDOFF_MM, DAYLIGHT_THROW_MM, DAYLIGHT_CONE_ANGLE_RAD, DOOR_HANDLE_PROJECTION_MM, DOOR_HANDLE_HEIGHT_MM, DOOR_HANDLE_EDGE_INSET_MM } from '../../lib/lighting3d';
import { capturePanorama, DEFAULT_CAPTURE_ORIENTATION } from '../../lib/panoramaCapture';
import type { CapturePanoramaOptions } from '../../lib/panoramaCapture';
import { PanoramaViewerModal } from '../panorama/PanoramaViewerModal';
import { Cabinet3DInspector } from './Cabinet3DInspector';
import { ApplianceModel } from './ApplianceModel';
import { resolveApplianceModel } from '../../lib/applianceGeometry';
import { wallSegments } from '../../lib/openings';
import { resolveAllFixtures, selectRealLights, maxLightsFor } from '../../lib/fixtures';
import { useLightQuality } from '../../hooks/useLightQuality';
import type { FixturePlacement } from '../../lib/fixtures';
import { isLinear, isVisibleWhenClosed, isDirectional, defaultThrowFor } from '../../types/fixture';
import type { WallOpening } from '../../types/opening';
import { cabinetFrontBreakdown, FRONT_THICKNESS_MM } from '../../lib/fronts';
import type { HandlePlacement } from '../../lib/fronts';
import { defaultFrontLayout, resolveHandle } from '../../types/front';
import { DEFAULT_CAMERA_HEIGHT_MM } from '../../types/Camera';
import type { CameraNode } from '../../types/Camera';
import type { PlacedCabinetItem } from '../../types/cabinet';
import type { Obstacle, WallOrientation } from '../../types/layout';
import type { PlacedApplianceItem, ApplianceType } from '../../types/appliance';

export interface Room3DCanvasProps {
  widthMm: number;
  depthMm: number;
}

const DEFAULT_CEILING_HEIGHT_MM = 2700;
const WALL_THICKNESS_M = 0.05;
// Starting vertical FOV for the walkthrough camera, now adjustable at
// runtime (see the fov slider in "Capture settings" below). Some edge
// stretching is INHERENT to any flat/rectilinear projection — it isn't
// a bug and can't be fully removed, only traded off: a wide FOV shows
// more of a small kitchen at once but stretches things near the frame
// edges as you pan past them, a narrow FOV looks geometrically calmer
// but feels more zoomed-in. 60 is a reasonable middle; the slider is
// there because the right answer depends on the room and on taste.
const DEFAULT_FIRST_PERSON_FOV_DEG = 60;
// Exponential-decay damping factor for AnimatedFirstPersonCamera's
// position/rotation lerp — see the comment on its useFrame for why this
// (rather than a plain delta*speed lerp) is frame-rate independent.
const CAMERA_TRANSITION_DAMPING = 6;
// Radians of look rotation per pixel dragged — tuned for a "natural"
// mouse feel at typical drag distances; easy single-number retune if
// it reads too sensitive/sluggish once tried for real.
const DRAG_LOOK_SENSITIVITY = 0.005;
// Clamped shy of straight up/down (90deg) so the view can never flip
// past vertical mid-drag.
const MAX_PITCH_RAD = (85 * Math.PI) / 180;
// Pointer travel beyond this between down and up counts as a drag,
// not a click — see wasDrag in Room3DCanvas.
const CLICK_DRAG_TOLERANCE_PX = 5;
const HOTSPOT_RADIUS_M = 0.35;
// Selection is shown as an edge outline AROUND the cabinet, never as
// a change to its surface. An emissive tint was tried first and was
// wrong: emissive ADDS light to the material, which shifts the
// perceived colour and washes out the specular highlight — i.e. it
// obscured the finish that the whole click-to-inspect feature exists
// to let you judge. An outline sits outside the geometry and touches
// none of its pixels.
const SELECTION_OUTLINE_COLOR = '#2563eb'; // matches the 2D canvas selection stroke
// Just enough to clear the surface without reading as a gap.
const SELECTION_OUTLINE_SCALE = 1.012;
const HOTSPOT_COLOR = '#2dd4bf'; // teal-400 — matches CameraMarker's teal family
const HOTSPOT_ACTIVE_COLOR = '#facc15'; // amber-400 — deliberately distinct so "you are here" stands out

export function Room3DCanvas({ widthMm, depthMm }: Room3DCanvasProps) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const obstacles = useLayoutStore((state) => state.obstacles);
  // Every lighting decision in this canvas reads from here, so a mode
  // can't be applied half-way (fixtures neutralised but a warm window
  // still tinting the room — the exact failure that made three modes
  // necessary instead of an on/off toggle).
  const appliances = useLayoutStore((state) => state.appliances);
  const cameras = useLayoutStore((state) => state.cameras);
  const capturePanoramaForCamera = useLayoutStore((state) => state.capturePanoramaForCamera);
  const fixtureCatalogForEnv = useLayoutStore((state) => state.fixtureCatalog);

  // Whether ANY real light source exists — a switched-on fixture whose
  // catalogue row still resolves, or a window with daylight enabled.
  //
  // This is what lets the base viewing light recede: it's a floor for a
  // room with nothing in it, and once the designer has placed real
  // light it should get out of the way so their fixtures are what you
  // see. See BASE_LIGHT_RECESSION in lib/lighting3d.ts.
  const hasPlacedLight =
    (currentLayout?.fixtures ?? []).some(
      (f) => f.enabled && fixtureCatalogForEnv.some((c) => c.id === f.catalogItemId)
    ) ||
    (currentLayout?.walls ?? []).some((w) =>
      (w.openings ?? []).some((o) => o.daylight?.enabled)
    );

  const lightEnv = lightingEnvironmentFor(
    currentLayout?.lightingMode ?? 'designed',
    hasPlacedLight
  );
  // Named sceneExposure rather than `exposure`, which is already taken
  // by the PANORAMA CAPTURE's own knob a few lines below. They are
  // genuinely different things — one is how bright the live view is,
  // the other compensates the captured cubemap — and collapsing them
  // into one name would guarantee someone wires the wrong one.
  const sceneExposure = clampExposure(currentLayout?.exposure ?? DEFAULT_EXPOSURE);
  const deletePanoramaForCamera = useLayoutStore((state) => state.deletePanoramaForCamera);
  const selectedCabinetId = useSelectedCabinetId();
  const selectCabinet = useLayoutStore((state) => state.selectCabinet);
  const applianceCatalog = useLayoutStore((state) => state.applianceCatalog);

  // null = free orbit (Pass 1's behavior). Otherwise, the id of a
  // saved Camera Node to lock the view to.
  const [lockedCameraId, setLockedCameraId] = useState<string | null>(null);
  const lockedCamera = cameras.find((c) => c.id === lockedCameraId) ?? null;

  const ceilingHeightMm = currentLayout?.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;

  const roomWidthM = mmToWorld(widthMm);
  const roomDepthM = mmToWorld(depthMm);
  const ceilingHeightM = mmToWorld(ceilingHeightMm);


  // Click-to-select has to coexist with drag-to-look and drag-to-orbit,
  // which both END on whatever mesh the pointer happens to be over.
  // React Three Fiber fires onClick on pointerup regardless of how far
  // the pointer travelled, so without this a look-drag that finishes
  // over a cabinet would select it. Comparing the down and up positions
  // and ignoring anything past a few pixels separates a real click from
  // the tail of a drag.
  const pointerDownAtRef = useRef<{ x: number; y: number } | null>(null);
  const selectedCabinet = cabinets.find((c) => c.id === selectedCabinetId) ?? null;

  function wasDrag(clientX: number, clientY: number): boolean {
    const down = pointerDownAtRef.current;
    if (!down) return false;
    return Math.hypot(clientX - down.x, clientY - down.y) > CLICK_DRAG_TOLERANCE_PX;
  }

  // Which node "Capture 360°"/"View 360°"/"Delete 360°" act on — kept
  // DELIBERATELY separate from lockedCameraId so capturing/viewing
  // works during free orbit too, not just while locked to that exact
  // node. capturePanorama (lib/panoramaCapture.ts) only ever needs a
  // world position, not the on-screen camera to actually be sitting
  // there, so there's no technical reason to require a lock. One-way
  // sync below: locking to a node also selects it here for
  // convenience (so the old "lock then capture" flow still needs zero
  // extra clicks), but picking a DIFFERENT node from the selector below
  // never touches the lock/viewport.
  //
  // This sync deliberately happens INLINE during render (React's
  // "adjusting state when a prop changes" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect), not inside
  // a useEffect: an effect would run one render late (mount, THEN
  // fire, THEN a second re-render), which is exactly the "cascading
  // renders" React warns against for this case. Comparing against a
  // tracked "previous" value and calling setState mid-render instead
  // lets React fold the update into the SAME render pass.
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [prevLockedCameraId, setPrevLockedCameraId] = useState(lockedCameraId);
  if (lockedCameraId !== prevLockedCameraId) {
    setPrevLockedCameraId(lockedCameraId);
    if (lockedCameraId) {
      setSelectedCameraId(lockedCameraId);
    }
  }
  const selectedCamera = cameras.find((c) => c.id === selectedCameraId) ?? null;

  // Step 2/3: capturing needs the LIVE renderer+scene, which only
  // exist inside <Canvas> — PanoramaCaptureBridge (rendered below,
  // inside the Canvas) reaches them via useThree() and hands a bound
  // capture(position) function up through this ref, since a plain
  // React prop can't cross that boundary the other direction.
  const captureFnRef = useRef<
    ((position: THREE.Vector3, options: CapturePanoramaOptions) => Promise<Blob>) | null
  >(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Orientation/exposure knobs for the capture, plus the walkthrough
  // FOV — all live here rather than as constants in panoramaCapture.ts
  // because the correct values can only be judged by looking at a real
  // capture (see that file's header for why the conventions involved
  // aren't knowable from the code alone).
  const [firstPersonFovDeg, setFirstPersonFovDeg] = useState(DEFAULT_FIRST_PERSON_FOV_DEG);
  const [mirrorX, setMirrorX] = useState(DEFAULT_CAPTURE_ORIENTATION.mirrorX);
  const [flipY, setFlipY] = useState(DEFAULT_CAPTURE_ORIENTATION.flipY);
  // Seeded from the SCENE exposure so a captured panorama comes out
  // looking like the walkthrough it was taken from — a capture that
  // silently differed from what was on screen would be worse than no
  // default at all. Still adjustable on its own afterwards, because the
  // equirect projection genuinely needs its own compensation.
  const [exposure, setExposure] = useState(
    clampExposure(currentLayout?.exposure ?? DEFAULT_CAPTURE_ORIENTATION.exposure)
  );

  async function handleCapture() {
    if (!selectedCamera || !captureFnRef.current) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      const [worldX, worldZ] = groundPosition(selectedCamera.x, selectedCamera.y);
      const worldY = mmToWorld(selectedCamera.heightMm || DEFAULT_CAMERA_HEIGHT_MM);
      const blob = await captureFnRef.current(new THREE.Vector3(worldX, worldY, worldZ), {
        mirrorX,
        flipY,
        exposure,
      });
      await capturePanoramaForCamera(selectedCamera.id, blob);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Failed to capture panorama.');
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleDeletePanorama() {
    if (!selectedCamera) return;
    setCaptureError(null);
    try {
      await deletePanoramaForCamera(selectedCamera.id);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Failed to delete panorama.');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 self-start text-xs text-gray-600">
        Viewpoint
        <select
          value={lockedCameraId ?? ''}
          onChange={(e) => setLockedCameraId(e.target.value || null)}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Free orbit</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.label}
            </option>
          ))}
        </select>
        {lockedCamera ? (
          <span className="text-[10px] text-gray-400">
            Locked to {lockedCamera.label} — drag to look around (position stays put). Click
            another glowing floor marker to step there instead.
          </span>
        ) : (
          <span className="text-[10px] text-gray-400">
            Or click a glowing floor marker to step into the room at that camera.
          </span>
        )}
      </label>

      {cameras.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 self-start text-xs text-gray-600">
          360° for
          <select
            value={selectedCameraId ?? ''}
            onChange={(e) => setSelectedCameraId(e.target.value || null)}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="" disabled>
              Choose a camera...
            </option>
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.label}
              </option>
            ))}
          </select>
          {/* Works whether or not the viewport is locked to this node —
              capturePanorama only needs a world position, the on-screen
              camera doesn't need to actually be sitting there. */}
          <button
            onClick={handleCapture}
            disabled={!selectedCamera || isCapturing}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isCapturing ? 'Capturing...' : 'Capture 360°'}
          </button>
          {selectedCamera?.panoramaUrl && (
            <>
              <button
                onClick={() => setIsViewerOpen(true)}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                View 360° Street View
              </button>
              <button
                onClick={handleDeletePanorama}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Delete 360°
              </button>
            </>
          )}
        </label>
      )}

      {/* Calibration knobs — see panoramaCapture.ts's header for why
          orientation/exposure can't just be hardcoded correctly up
          front. Capture, look at the result, flip whichever of these is
          wrong, re-capture. Once the right combination is known these
          values can become the defaults and this panel can go away. */}
      <details className="self-start rounded border border-gray-200 px-3 py-2 text-xs text-gray-600">
        <summary className="cursor-pointer select-none text-gray-500">Capture settings</summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={mirrorX}
              onChange={(e) => setMirrorX(e.target.checked)}
            />
            Mirror horizontally
            <span className="text-[10px] text-gray-400">
              (turn off if the capture is left-right flipped)
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} />
            Flip vertically
            <span className="text-[10px] text-gray-400">(turn on if the capture is upside down)</span>
          </label>

          <label className="flex items-center gap-2">
            Exposure
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={exposure}
              onChange={(e) => setExposure(Number(e.target.value))}
            />
            <span className="w-8 tabular-nums text-[10px] text-gray-400">
              {exposure.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-400">(raise if captures look too dark)</span>
          </label>

          <label className="flex items-center gap-2">
            Walkthrough FOV
            <input
              type="range"
              min={40}
              max={90}
              step={1}
              value={firstPersonFovDeg}
              onChange={(e) => setFirstPersonFovDeg(Number(e.target.value))}
            />
            <span className="w-8 tabular-nums text-[10px] text-gray-400">{firstPersonFovDeg}°</span>
            <span className="text-[10px] text-gray-400">
              (lower = less edge stretching when panning)
            </span>
          </label>
        </div>
      </details>

      {captureError && (
        <p className="text-xs text-red-600">Capture failed: {captureError}</p>
      )}
      {selectedCamera?.panoramaCapturedAt && !captureError && (
        <p className="text-[10px] text-gray-400">
          Last captured {new Date(selectedCamera.panoramaCapturedAt).toLocaleString()}.
        </p>
      )}

      {/* aspect-video (16:9) + max-w instead of a fixed height on a
          w-full container — the old h-150/w-full combo let the canvas
          stretch to an extreme aspect ratio on a wide screen (well
          past 3:1 in testing), and since fov below is a VERTICAL fov,
          an extreme aspect ratio blows up the resulting HORIZONTAL fov
          enormously — that's what was causing the pronounced
          stretching of things like a wall cabinet near the edge of
          frame as the view rotated past it. A fixed, sane aspect ratio
          keeps the effective FOV consistent regardless of window
          width. */}
      <div
        className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
        onPointerDown={(e) => {
          pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        <Canvas
          shadows
          // Fires when a click hits no mesh at all — clicking the
          // floor or empty space clears the selection, matching how
          // the 2D canvas behaves.
          onPointerMissed={(e) => {
            if (!wasDrag(e.clientX, e.clientY)) selectCabinet(null);
          }}
          camera={{ position: [roomWidthM * 1.3, ceilingHeightM * 1.8, roomDepthM * 1.6], fov: 50 }}
          gl={{
            toneMapping: THREE.ACESFilmicToneMapping,
            // Creation-time value only; SceneExposure keeps it in sync
            // after that. Set from the same default so the first frame
            // isn't at a different exposure from every frame after it.
            toneMappingExposure: DEFAULT_EXPOSURE,
          }}
        >
          <color attach="background" args={['#dbeafe']} />

          {/* Lighting environment, built from emissive panels instead of
              an HDR image.
              WAS preset="apartment", which fetched a stock HDR photo
              from drei's CDN. Two problems with that: it needed network
              access at runtime, and any glossy surface REFLECTED it —
              so a photo of someone's apartment hallway, wooden door and
              all, showed up mirrored in the kitchen floor. A few
              Lightformer rectangles give the same soft highlights on
              acrylic and stone with nothing to download, and their
              reflections read as generic light panels, which is what a
              real kitchen reflects anyway.
              frames={1} bakes it once rather than re-rendering the
              environment every frame — nothing here moves.
              background={false} keeps our own flat backdrop, since an
              enclosed room with no ceiling mesh would otherwise show
              the environment floating above the walls. */}
          {/* Panel intensities and colours are now driven by the
              lighting mode (see lightingEnvironmentFor). They used to
              be fixed, which meant the environment lit the room at full
              strength while everything else receded for placed
              fixtures — and kept its blue/cream tint in the mode that
              promises no tint at all. Note an environment map is NOT
              occluded by geometry: these panels sit outside the walls
              and light straight through them, so their strength is the
              only control there is. */}
          <Environment resolution={256} frames={1} background={false}>
            {/* Broad ceiling softbox — the main source of the sheen on
                horizontal surfaces. */}
            <Lightformer
              form="rect"
              intensity={1.5 * lightEnv.envIntensityScale}
              color="#ffffff"
              position={[0, 4, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[9, 9, 1]}
            />
            {/* Cool daylight from one side, standing in for a window. */}
            <Lightformer
              form="rect"
              intensity={1.1 * lightEnv.envIntensityScale}
              color={lightEnv.envTinted ? '#dce9f5' : '#ffffff'}
              position={[-4.5, 1.6, 0]}
              rotation={[0, Math.PI / 2, 0]}
              scale={[7, 3.5, 1]}
            />
            {/* Warm, weaker bounce off the opposite wall, so highlights
                aren't identical on both sides of a glossy shutter. */}
            <Lightformer
              form="rect"
              intensity={0.55 * lightEnv.envIntensityScale}
              color={lightEnv.envTinted ? '#f6e8d8' : '#ffffff'}
              position={[4.5, 1.6, 0]}
              rotation={[0, -Math.PI / 2, 0]}
              scale={[7, 3.5, 1]}
            />
            {/* Dark ground panel. Without something dim below, every
                reflection is uniformly bright and gloss stops reading as
                gloss — contrast is what makes a surface look polished. */}
            <Lightformer
              form="rect"
              intensity={0.18 * lightEnv.envIntensityScale}
              color="#3a3a3a"
              position={[0, -2.5, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={[9, 9, 1]}
            />
          </Environment>

          {/* Base rig, driven by the layout's lighting mode rather
              than by fixed constants — see lightingEnvironmentFor. In
              'true colour' this becomes a flat white wash with no
              shadows, which is deliberately unpretty: anything
              atmospheric there would reintroduce the colour bias the
              mode exists to remove. */}
          <SceneExposure exposure={sceneExposure} />

          <ambientLight intensity={lightEnv.ambientIntensity} />
          {/* VIEWING light — castShadow deliberately absent.
              It used to cast, which meant an empty room with no windows
              and no fixtures still had a hard-shadowed sun raking
              across it, from a source nobody had placed and nobody
              could switch off. Shadows imply a real directional source;
              this isn't one, it's just so a dark room is reviewable.
              Directional SHADING stays (one face of a box brighter than
              another, which is what makes geometry read) — only cast
              shadows go, and they now come from window daylight
              instead. */}
          <directionalLight
            position={[roomWidthM * 0.6, ceilingHeightM * 2.2, roomDepthM * 0.4]}
            intensity={lightEnv.viewLightIntensity}
            color={lightEnv.viewLightColor}
          />

          {/* PLACED light fixtures — strips, spots, cove runs, plinth
              lights. This replaced an automatic warm light under every
              elevated cabinet, which nobody had asked for and nobody
              could switch off; see the note in lib/lighting3d.ts. */}
          <PlacedFixtures />

          <RoomFloor widthM={roomWidthM} depthM={roomDepthM} />

          <RoomWalls widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} />

          <RoomCeiling widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} />

          {cabinets.map((item) => (
            <CabinetMesh
              key={item.id}
              item={item}
              isSelected={item.id === selectedCabinetId}
              onSelect={(clientX, clientY) => {
                if (!wasDrag(clientX, clientY)) selectCabinet(item.id);
              }}
            />
          ))}

          {/* Quartz worktops over every base-height module. Visual only
              — see the note on hasCountertop in lib/cabinetGeometry.ts
              about this not being priced into the quote yet. */}
          {cabinets
            .filter((item) => hasCountertop(item.moduleType) && item.elevationMm === 0)
            .map((item) => (
              <CountertopMesh key={`counter-${item.id}`} item={item} />
            ))}

          {obstacles.map((obstacle) => (
            <ObstacleMesh key={obstacle.id} obstacle={obstacle} ceilingHeightMm={ceilingHeightMm} />
          ))}

          {/* A real model where one is available, the original box
              otherwise — and the box is also what shows while the model
              loads or if it fails, so this degrades instead of leaving a
              gap.
              The model is resolved from the CATALOGUE at render time,
              not read off the placed item. Originally the url was
              snapshotted onto each appliance when it was placed, on the
              reasoning that a quoted layout should keep rendering what
              the client saw. In practice that meant setting the
              catalogue field did nothing for anything already on the
              plan — appliances placed before the field existed stayed
              boxes forever, with no UI to fix them. Live resolution is
              what people expect while building a catalogue out; the
              item's own modelUrl still wins if set, leaving room for a
              per-placement override later. */}
          {appliances.map((item) => {
            // Resolution moved into lib/applianceGeometry because it
            // now yields TWO things that must come from the SAME
            // catalogue row — the model file and that file's
            // orientation correction. Matching on applianceType here
            // and orientation somewhere else would eventually pair one
            // chimney's model with another chimney's correction.
            const { modelUrl, orientation } = resolveApplianceModel(item, applianceCatalog);
            return (
              <ApplianceModel
                key={item.id}
                item={item}
                modelUrl={modelUrl}
                orientation={orientation}
                fallback={<ApplianceMesh item={item} />}
              />
            );
          })}

          {cameras.map((camera) => (
            <CameraMarker key={camera.id} camera={camera} />
          ))}

          {/* Clickable "step into the room" floor targets — always
              rendered (not just while locked) so a hotspot click from
              free orbit is how you first enter walkthrough mode, same
              as picking a node from the Viewpoint dropdown above. */}
          {cameras.map((camera) => (
            <HotspotMarker
              key={camera.id}
              camera={camera}
              isActive={camera.id === lockedCameraId}
              onSelect={() => setLockedCameraId(camera.id)}
            />
          ))}

          {lockedCamera ? (
            <AnimatedFirstPersonCamera camera={lockedCamera} fovDeg={firstPersonFovDeg} />
          ) : (
            <OrbitControls target={[roomWidthM / 2, ceilingHeightM / 3, roomDepthM / 2]} />
          )}

          {/* Invisible — just hands the live renderer+scene up to
              handleCapture above via captureFnRef (see its comment). */}
          <PanoramaCaptureBridge captureFnRef={captureFnRef} />
        </Canvas>

        {/* Overlays the canvas (the wrapper is position:relative) rather
            than sitting beside it — a side panel would squeeze the 3D
            view, which is the thing you're trying to look at. */}
        {selectedCabinet && <Cabinet3DInspector cabinet={selectedCabinet} />}
      </div>

      <PanoramaViewerModal
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        cameraLabel={selectedCamera?.label ?? ''}
        panoramaUrl={selectedCamera?.panoramaUrl}
      />
    </div>
  );
}

// See the comment on captureFnRef in Room3DCanvas above — this is the
// ONLY way to reach the live THREE.WebGLRenderer/THREE.Scene that
// capturePanorama (lib/panoramaCapture.ts) needs, since useThree() only
// works for components rendered inside <Canvas>, while the "Capture
// 360°" button lives in the surrounding plain-React toolbar above it.
// Renders nothing — purely a bridge.
function PanoramaCaptureBridge({
  captureFnRef,
}: {
  captureFnRef: {
    current:
      | ((position: THREE.Vector3, options: CapturePanoramaOptions) => Promise<Blob>)
      | null;
  };
}) {
  const { gl, scene } = useThree();

  useEffect(() => {
    captureFnRef.current = (position, options) => capturePanorama(gl, scene, position, options);
    return () => {
      captureFnRef.current = null;
    };
  }, [gl, scene, captureFnRef]);

  return null;
}

// Locks the scene's active camera to a saved Camera Node's exact
// position (x/y/heightMm) and look direction (viewAngleDeg) — the
// SAME clockwiseDegToThreeY conversion CabinetMesh uses for rotation,
// so a camera and a cabinet drawn facing "the same way" in 2D can never
// drift apart in 3D. No OrbitControls here on purpose: this is meant
// to reproduce what a fixed panorama node would actually see, not a
// free-roam view of it.
//
// Renders once per "locked" session (Room3DCanvas doesn't key this by
// camera.id — see its usage above), so the SAME component instance
// persists across a hotspot click that switches to a different node.
// That's what makes the transition animate rather than snap: position/
// rotation are never passed as React props after mount (that would
// fight the imperative updates below, the same class of bug the
// CameraLayer.tsx drag handle hit with Konva's event bubbling — see
// its comment); instead every node change just updates a target ref in
// useEffect, and useFrame eases the actual camera toward it every
// frame. Only the very first activation (mount) snaps straight to the
// target instead of easing in from the camera's uninitialized (0,0,0)
// starting point, which would otherwise read as a jarring fly-in.
//
// Also owns free-look: click-and-drag on the canvas tilts/pans the
// view in real time while position stays anchored to the node. Two
// DISTINCT orientation sources feed the camera, never both at once:
//   - Before any drag at this node: eases toward targetQuaternionRef
//     (the node's saved level angle) exactly as Step 1 always did.
//   - From the first drag onward (freeLookActiveRef): rendered
//     directly from yawRef/pitchRef every frame, no easing, so
//     mouse-look feels immediate rather than laggy.
// freeLookActiveRef resets on every node change (the effect below), so
// teleporting anywhere always starts level and un-panned again.
function AnimatedFirstPersonCamera({ camera, fovDeg }: { camera: CameraNode; fovDeg: number }) {
  const { gl } = useThree();
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const targetPositionRef = useRef(new THREE.Vector3());
  const targetQuaternionRef = useRef(new THREE.Quaternion());
  const hasPositionedRef = useRef(false);

  const freeLookActiveRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; startYaw: number; startPitch: number } | null>(
    null
  );

  useEffect(() => {
    const [worldX, worldZ] = groundPosition(camera.x, camera.y);
    const worldY = mmToWorld(camera.heightMm || DEFAULT_CAMERA_HEIGHT_MM);
    targetPositionRef.current.set(worldX, worldY, worldZ);
    targetQuaternionRef.current.setFromEuler(
      new THREE.Euler(0, clockwiseDegToThreeY(camera.viewAngleDeg), 0)
    );

    // A (possibly different) node always resets free-look — stepping
    // to a new spot shows what THAT node was aimed at, not wherever a
    // drag left the previous one.
    freeLookActiveRef.current = false;

    if (cameraRef.current && !hasPositionedRef.current) {
      cameraRef.current.position.copy(targetPositionRef.current);
      cameraRef.current.quaternion.copy(targetQuaternionRef.current);
      hasPositionedRef.current = true;
    }
  }, [camera.id, camera.x, camera.y, camera.heightMm, camera.viewAngleDeg]);

  // Native pointer listeners on the canvas's own DOM element (not R3F
  // synthetic events) so dragging keeps tracking via setPointerCapture
  // even if the cursor leaves the canvas mid-drag — standard FPS-style
  // mouselook behavior. This coexists fine with HotspotMarker's R3F
  // onClick on the SAME element: both sets of listeners receive the
  // same native events independently, and a stray sub-pixel "drag"
  // from clicking a hotspot is harmless since teleporting resets
  // freeLookActiveRef right back to false anyway.
  useEffect(() => {
    const el = gl.domElement;

    function handlePointerDown(e: PointerEvent) {
      if (e.button !== 0) return; // left-drag only
      const cam = cameraRef.current;
      if (!cam) return;
      el.setPointerCapture(e.pointerId);
      // Seed the drag from whatever the camera is ACTUALLY showing
      // right now (mid-ease or fully arrived, doesn't matter) so
      // starting to drag never causes a jump.
      const euler = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      dragRef.current = { startX: e.clientX, startY: e.clientY, startYaw: euler.y, startPitch: euler.x };
    }

    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;
      // Drag right -> look right, drag up -> look up. If this reads
      // inverted once tried for real, flip the sign on the matching
      // line — the rest of the math doesn't change.
      yawRef.current = drag.startYaw - deltaX * DRAG_LOOK_SENSITIVITY;
      pitchRef.current = THREE.MathUtils.clamp(
        drag.startPitch + deltaY * DRAG_LOOK_SENSITIVITY,
        -MAX_PITCH_RAD,
        MAX_PITCH_RAD
      );
      freeLookActiveRef.current = true;
    }

    function handlePointerUp(e: PointerEvent) {
      if (dragRef.current && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      dragRef.current = null;
      // Deliberately NOT resetting freeLookActiveRef here — the view
      // stays wherever you left it until the next teleport, per the
      // "look around from where you're standing" design.
    }

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [gl]);

  useFrame((_state, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    // 1 - e^(-delta * damping): converges toward the target smoothly
    // regardless of frame rate (a plain `delta * speed` lerp factor
    // would overshoot/oscillate at low FPS since it can exceed 1).
    const t = 1 - Math.exp(-delta * CAMERA_TRANSITION_DAMPING);
    cam.position.lerp(targetPositionRef.current, t);

    if (freeLookActiveRef.current) {
      cam.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'));
    } else {
      cam.quaternion.slerp(targetQuaternionRef.current, t);
    }
  });

  // fov is safe to pass declaratively (unlike position/quaternion,
  // which are driven imperatively above) — it isn't touched per-frame,
  // so React updating it can't fight the animation loop.
  return <PerspectiveCamera ref={cameraRef} makeDefault fov={fovDeg} />;
}

interface HotspotMarkerProps {
  camera: CameraNode;
  isActive: boolean;
  onSelect: () => void;
}

// A clickable glowing disc on the floor at a saved Camera Node's X/Z —
// clicking it calls onSelect (Room3DCanvas wires this to
// setLockedCameraId), which both enters/updates walkthrough mode AND
// is what AnimatedFirstPersonCamera above animates toward. Rendered
// slightly above y=0 to avoid z-fighting with the floor mesh.
function HotspotMarker({ camera, isActive, onSelect }: HotspotMarkerProps) {
  const [worldX, worldZ] = groundPosition(camera.x, camera.y);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    // Gentle pulse on the active marker only, so "you are standing
    // here" is easy to spot at a glance without every hotspot
    // distractingly animating at once.
    const pulse = isActive ? 1 + Math.sin(clock.elapsedTime * 3) * 0.08 : 1;
    meshRef.current.scale.set(pulse, pulse, 1);
  });

  return (
    <mesh
      ref={meshRef}
      position={[worldX, 0.02, worldZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      <circleGeometry args={[HOTSPOT_RADIUS_M, 32]} />
      <meshBasicMaterial
        color={isActive ? HOTSPOT_ACTIVE_COLOR : HOTSPOT_COLOR}
        transparent
        opacity={isActive ? 0.55 : 0.35}
      />
    </mesh>
  );
}

// One flat room surface — a wall panel, the floor, or the ceiling —
// finished from an assigned SurfaceFinish.
//
// Its own component so each surface can call the texture hooks
// independently (hooks can't be conditional, and useSurfaceTextures /
// useFinishTextures both call useThree, which only works inside
// <Canvas>). A surface with no finish assigned falls back to plain
// plaster rather than rendering nothing.
interface FinishedSurfaceProps {
  finishId?: string;
  // Real extents of the surface, used to tile the pattern at its true
  // physical scale — a 3m wall shows five 600mm tiles, not one
  // stretched one.
  widthM: number;
  heightM: number;
  children: ReactNode; // the geometry
  position: [number, number, number];
  rotation?: [number, number, number];
  side?: THREE.Side;
}

const PLASTER_COLOR = '#f5f3ef';

function FinishedSurface({
  finishId,
  widthM,
  heightM,
  children,
  position,
  rotation,
  side,
}: FinishedSurfaceProps) {
  const finishes = useLayoutStore((state) => state.finishes);
  const finish = finishId ? resolveFinish(finishes, finishId) : undefined;
  const material = resolveMaterial(finish);
  const textures = useFinishTextures(finish, widthM, heightM);

  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      {children}
      <meshStandardMaterial
        color={finish ? material.color : PLASTER_COLOR}
        map={textures?.map ?? null}
        normalMap={textures?.normalMap ?? null}
        normalScale={[material.normalScale, material.normalScale]}
        roughnessMap={textures?.roughnessMap ?? null}
        // An unfinished surface is bare plaster: matte, non-metallic.
        roughness={finish ? material.roughness : 0.95}
        metalness={finish ? material.metalness : 0}
        side={side}
      />
    </mesh>
  );
}

interface RoomWallsProps {
  widthM: number;
  depthM: number;
  heightM: number;
}

// Geometry still comes from the room's dimensions (which are always
// correct) while the FINISH comes from layout.walls, matched by
// orientation. Keeping those separate means a layout whose walls array
// is missing or stale still renders a correct room — it just renders it
// in plaster.
function RoomWalls({ widthM, depthM, heightM }: RoomWallsProps) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);

  // Walls are no longer one plane each. A single plane cannot have a
  // hole in it — so each wall is rebuilt from the rectangles that
  // REMAIN once its openings are subtracted (lib/openings.ts): full
  // height bands between openings, plus a sill strip below and a
  // header strip above each one. A wall with no openings decomposes to
  // exactly one rectangle, so the common case is unchanged.
  //
  // Verified elsewhere that those segments tile the wall exactly and
  // never overlap, which is what stops this from z-fighting or leaking
  // daylight through a seam.
  const walls = currentLayout?.walls ?? [];
  // Ceiling height comes from the heightM PROP, converted back to mm —
  // not re-read from the layout. The caller already resolved it (with
  // its own DEFAULT_CEILING_HEIGHT_MM fallback), so reading the store
  // again here would be a second source for one number: if the two
  // ever disagreed, the wall segments would be cut to a different
  // height than the wall boxes are drawn at, and the seam would show
  // as a gap under the ceiling.
  const ceilingHeightMm = heightM / MM_TO_M;

  return (
    <>
      {(['north', 'south', 'west', 'east'] as WallOrientation[]).map((orientation) => {
        const wall = walls.find((w) => w.orientation === orientation);
        const horizontal = orientation === 'north' || orientation === 'south';
        const wallLengthMm = (horizontal ? widthM : depthM) / MM_TO_M;
        const segments = wallSegments(wallLengthMm, ceilingHeightMm, wall?.openings ?? []);

        return (
          <group key={orientation}>
            {segments.map((seg, i) => {
              const segWidthM = mmToWorld(seg.widthMm);
              const segHeightM = mmToWorld(seg.heightMm);
              // Segment centre in the wall's own frame, then mapped to
              // room space. `alongMm` runs +x on north/south and +y on
              // west/east — the same convention openingToRoomRect uses,
              // and the reason that mapping lives in one place.
              const alongCentreM = mmToWorld(seg.alongMm + seg.widthMm / 2);
              const bottomCentreM = mmToWorld(seg.bottomMm + seg.heightMm / 2);

              const position: [number, number, number] = horizontal
                ? [alongCentreM, bottomCentreM, orientation === 'north' ? 0 : depthM]
                : [orientation === 'west' ? 0 : widthM, bottomCentreM, alongCentreM];

              const args: [number, number, number] = horizontal
                ? [segWidthM, segHeightM, WALL_THICKNESS_M]
                : [WALL_THICKNESS_M, segHeightM, segWidthM];

              return (
                <FinishedSurface
                  key={`${orientation}-${i}`}
                  finishId={wall?.finishId}
                  // Texture scale follows the SEGMENT, not the whole
                  // wall, so tile size stays physically consistent
                  // across the pieces either side of a window instead
                  // of each piece stretching its own copy.
                  widthM={segWidthM}
                  heightM={segHeightM}
                  position={position}
                >
                  <boxGeometry args={args} />
                </FinishedSurface>
              );
            })}

            {(wall?.openings ?? []).map((opening) => (
              <OpeningInWall
                key={opening.id}
                opening={opening}
                widthM={widthM}
                depthM={depthM}
              />
            ))}
          </group>
        );
      })}
    </>
  );
}

// What sits IN an opening: the view beyond it, the light it lets in,
// and — for a closed door — the leaf itself.
function OpeningInWall({
  opening,
  widthM,
  depthM,
}: {
  opening: WallOpening;
  widthM: number;
  depthM: number;
}) {
  const finishes = useLayoutStore((state) => state.finishes);
  const openingWidthM = mmToWorld(opening.widthMm);
  const openingHeightM = mmToWorld(opening.heightMm);
  const centreYM = mmToWorld(opening.sillMm + opening.heightMm / 2);

  const horizontal = opening.wallId === 'north' || opening.wallId === 'south';
  const alongM = mmToWorld(opening.offsetMm + opening.widthMm / 2);

  // Which way is OUT of the room through this wall.
  const outward: [number, number, number] =
    opening.wallId === 'north'
      ? [0, 0, -1]
      : opening.wallId === 'south'
        ? [0, 0, 1]
        : opening.wallId === 'west'
          ? [-1, 0, 0]
          : [1, 0, 0];

  const wallCentre: [number, number, number] = horizontal
    ? [alongM, centreYM, opening.wallId === 'north' ? 0 : depthM]
    : [opening.wallId === 'west' ? 0 : widthM, centreYM, alongM];

  const at = (distanceM: number): [number, number, number] => [
    wallCentre[0] + outward[0] * distanceM,
    wallCentre[1] + outward[1] * distanceM,
    wallCentre[2] + outward[2] * distanceM,
  ];

  // Unit vector running ALONG the wall, in the direction of increasing
  // offsetMm — needed to push the handle out to the swinging edge
  // rather than leaving it centred on the leaf.
  const lateral: [number, number, number] = horizontal ? [1, 0, 0] : [0, 0, 1];

  // Point on the leaf: `out` from the wall, `side` along it, at an
  // absolute height off the floor rather than relative to the opening's
  // centre.
  const onLeaf = (outM: number, sideM: number, heightM: number): [number, number, number] => [
    wallCentre[0] + outward[0] * outM + lateral[0] * sideM,
    heightM,
    wallCentre[2] + outward[2] * outM + lateral[2] * sideM,
  ];

  // Faces back into the room. A quarter turn about Y for the
  // east/west walls, since a plane's default normal is +Z.
  const faceRotation: [number, number, number] = horizontal
    ? [0, opening.wallId === 'north' ? 0 : Math.PI, 0]
    : [0, opening.wallId === 'west' ? Math.PI / 2 : -Math.PI / 2, 0];

  const backdrop = useOpeningBackdrop(opening.backdropUrl);
  const daylight = opening.daylight;
  const lightingMode = useLayoutStore((state) => state.currentLayout?.lightingMode);
  // Only reads daylightTinted / daylightScale / shadowsEnabled, none of
  // which the base-light recession touches — so the second argument is
  // irrelevant here and deliberately omitted rather than guessed at.
  const lightEnv = lightingEnvironmentFor(lightingMode ?? 'designed');
  const doorState = opening.doorState ?? 'closed';
  const showLeaf = opening.kind === 'door' && doorState === 'closed';
  const leafFinish = resolveFinish(finishes, opening.leafFinishId);
  // Same colour-override semantics cabinets use — replaces a solid
  // colour, tints a textured one.
  const leafMaterial = resolveMaterial(leafFinish, opening.leafColorOverride);
  const handles = useLayoutStore((state) => state.handles);
  const leafHandle = resolveHandle(handles, opening.leafHandleId);

  return (
    <group>
      {/* BACKDROP — set BEHIND the wall and deliberately OVERSIZED, so
          moving your head shows parallax through the opening instead of
          revealing the plane's edges.

          meshBasicMaterial, i.e. UNLIT, on purpose: this is a
          photograph of an already-lit world. A standard material would
          have the room's own lights darken it, which is the same class
          of mistake as the panorama colour-space bug — the image
          arrives correct and gets wrongly re-processed. */}
      {backdrop && (
        <mesh position={at(BACKDROP_DISTANCE_M)} rotation={faceRotation}>
          <planeGeometry
            args={[openingWidthM * BACKDROP_OVERSIZE, openingHeightM * BACKDROP_OVERSIZE]}
          />
          <meshBasicMaterial map={backdrop} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* DAYLIGHT.
          FIXED — this used to set `target-position` declaratively, which
          silently did nothing useful. three.js only updates a
          SpotLight's target if that target object is actually IN the
          scene graph; a bare `target-position` prop moves an object
          that never gets its world matrix updated, so its transform
          stays identity and every window ended up aimed at the world
          origin — i.e. one corner of the room — which read as light
          leaking sideways out of the opening rather than entering it.

          The fix is a real Object3D mounted via <primitive>, so it's a
          scene child and gets updated each frame, with the light
          assigned to it. The target sits WELL INSIDE the room, not on
          the wall plane: aiming at the plane converges the cone on the
          wall itself and almost nothing reaches the floor.

          decay={0} disables physical inverse-square falloff, so
          intensity behaves as an artistic value regardless of whether
          the renderer is in physically-correct mode — otherwise the
          same number looks blinding or invisible depending on a
          renderer flag set elsewhere. */}
      {daylight?.enabled && (
        <DaylightThroughOpening
          fromPosition={at(mmToWorld(DAYLIGHT_STANDOFF_MM))}
          toPosition={at(-mmToWorld(DAYLIGHT_THROW_MM))}
          // Scaled and de-tinted by the lighting mode. 'true colour'
          // has to neutralise the WINDOW as well as the fixtures:
          // switching fixtures off while a 3000K window still throws
          // orange across the floor would leave the finishes tinted,
          // which is precisely what the mode is for.
          intensity={DAYLIGHT_BASE_INTENSITY * daylight.intensity * lightEnv.daylightScale}
          color={lightEnv.daylightTinted ? kelvinToColor(daylight.colorTempK) : '#ffffff'}
          castShadow={lightEnv.shadowsEnabled && daylight.mode === 'sunlight'}
        />
      )}

      {/* CLOSED DOOR LEAF. A closed door is a finished SURFACE, not a
          hole — a flush laminated door takes a finish like anything
          else. Rendering it as an empty aperture is why a kitchen with
          a door in it looked like it opened onto nothing. */}
      {showLeaf && (
        <>
          <mesh position={at(-mmToWorld(15))} rotation={faceRotation} castShadow receiveShadow>
            <boxGeometry args={[openingWidthM, openingHeightM, mmToWorld(35)]} />
            <meshPhysicalMaterial
              color={leafMaterial.color}
              roughness={leafMaterial.roughness}
              metalness={leafMaterial.metalness}
              clearcoat={leafMaterial.clearcoat}
              clearcoatRoughness={leafMaterial.clearcoatRoughness}
            />
          </mesh>

          {/* Handle or knob on the leaf, from the same catalogue
              cabinets draw from. Placed on the edge OPPOSITE the
              hinge — the edge that actually swings — and at real door
              handle height rather than centred, which is what makes it
              read as a door instead of a decorated panel.

              'handleless' resolves to no geometry, which is also the
              right rendering for an open doorway with a plain leaf. */}
          {leafHandle && leafHandle.kind !== 'handleless' && (
            <mesh
              position={onLeaf(
                -mmToWorld(35 + DOOR_HANDLE_PROJECTION_MM / 2),
                // Hinge on the LEFT means the handle goes to the far
                // end of the opening, and vice versa — the handle is
                // always on the edge that swings.
                (opening.swing === 'in-left' ? 1 : -1) *
                  mmToWorld(opening.widthMm / 2 - DOOR_HANDLE_EDGE_INSET_MM),
                mmToWorld(
                  // Clamped inside the leaf, so a short pass-through
                  // door doesn't get a handle floating above it.
                  Math.min(
                    opening.sillMm + opening.heightMm - DOOR_HANDLE_EDGE_INSET_MM,
                    Math.max(opening.sillMm + DOOR_HANDLE_EDGE_INSET_MM, DOOR_HANDLE_HEIGHT_MM)
                  )
                )
              )}
              rotation={faceRotation}
              castShadow
            >
              {/* A door handle is a horizontal LEVER, unlike a cabinet
                  bar handle which hangs vertically — so length runs
                  across the leaf here rather than up it. A knob is
                  square in both. */}
              <boxGeometry
                args={
                  leafHandle.kind === 'knob'
                    ? [
                        mmToWorld(leafHandle.lengthMm),
                        mmToWorld(leafHandle.lengthMm),
                        mmToWorld(DOOR_HANDLE_PROJECTION_MM),
                      ]
                    : [
                        mmToWorld(Math.max(90, leafHandle.lengthMm)),
                        mmToWorld(18),
                        mmToWorld(DOOR_HANDLE_PROJECTION_MM),
                      ]
                }
              />
              <meshStandardMaterial
                color={leafHandle.colorHex}
                metalness={leafHandle.metalness}
                roughness={leafHandle.roughness}
              />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}

// The floor, finished from layout.floorFinishId. Falls back to the
// built-in procedural tile when nothing is assigned, so an existing
// project still looks like a kitchen before anyone visits the surfaces
// panel.
function RoomFloor({ widthM, depthM }: { widthM: number; depthM: number }) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const floorFinishId = currentLayout?.floorFinishId;

  const proceduralTile = useSurfaceTextures('tile', widthM, depthM);

  if (floorFinishId) {
    return (
      <FinishedSurface
        finishId={floorFinishId}
        widthM={widthM}
        heightM={depthM}
        position={[widthM / 2, 0, depthM / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[widthM, depthM]} />
      </FinishedSurface>
    );
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[widthM / 2, 0, depthM / 2]} receiveShadow>
      <planeGeometry args={[widthM, depthM]} />
      <meshStandardMaterial
        map={proceduralTile.map}
        normalMap={proceduralTile.normalMap}
        roughnessMap={proceduralTile.roughnessMap}
        // roughness stays 1 so the map's own values pass through
        // unscaled — three.js multiplies the two, and the procedural
        // maps store absolute roughness (tile face ~0.6, grout ~0.9).
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

// Single-sided so it's only visible from INSIDE the room. A
// double-sided ceiling would close the box and make the free-orbit
// view useless — you'd be looking at a lid instead of into a kitchen.
//
// FIXED: this said BackSide, which produced the exact opposite of what
// the comment claimed — the ceiling appeared when orbiting from above
// and vanished once you stepped into the room. A plane's default normal
// is +Z, and the rotation below (+90° about X) sends +Z to -Y, so
// FrontSide is the DOWN-facing side. The rotation and the side have to
// be read together: flipping either one alone inverts the result, so
// don't "fix" the rotation to -PI/2 without also putting the side back.
function RoomCeiling({
  widthM,
  depthM,
  heightM,
}: {
  widthM: number;
  depthM: number;
  heightM: number;
}) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const ceilingFinishId = currentLayout?.ceilingFinishId;
  if (!ceilingFinishId) return null;

  return (
    <FinishedSurface
      finishId={ceilingFinishId}
      widthM={widthM}
      heightM={depthM}
      position={[widthM / 2, heightM, depthM / 2]}
      rotation={[Math.PI / 2, 0, 0]}
      side={THREE.FrontSide}
    >
      <planeGeometry args={[widthM, depthM]} />
    </FinishedSurface>
  );
}

// Keeps the renderer's tone-mapping exposure in sync with the layout.
//
// Has to be a component INSIDE the Canvas rather than a prop on it: the
// `gl={{ toneMappingExposure }}` object is only read when the renderer
// is constructed, so changing it later does nothing. Reaching for the
// live gl through useThree is what makes the slider actually move the
// picture.
//
// Nothing about the design changes here — no lumens, no colour
// temperature, no price. It is purely how bright the image is.
function SceneExposure({ exposure }: { exposure: number }) {
  // Applied inside useFrame rather than in an effect over useThree().gl.
  //
  // The obvious version — `const gl = useThree(s => s.gl)` then
  // `gl.toneMappingExposure = ...` in an effect — is what the R3F docs
  // show, but React Compiler rejects it, and correctly: `gl` is a value
  // returned from a hook, the compiler memoises around it, and mutating
  // it breaks the assumptions that memoisation rests on.
  //
  // useFrame hands `gl` in as a CALLBACK PARAMETER instead. Same
  // renderer, but it never becomes a hook return value in this
  // component, so there is nothing being mutated behind the compiler's
  // back — and no suppression comment pretending the rule doesn't
  // apply.
  //
  // The equality guard makes this effectively free: one float compare
  // per frame, and a write only when the slider actually moved.
  useFrame(({ gl }) => {
    const wanted = clampExposure(exposure);
    if (gl.toneMappingExposure !== wanted) {
      gl.toneMappingExposure = wanted;
    }
  });

  return null;
}

// Placed light fixtures: an emissive body for every one, and a real
// three.js light for only the brightest few.
//
// That split IS the feature. A realistic kitchen has a dozen fixtures
// and a dozen dynamic lights will not hold a frame rate on a mid-range
// Android phone, which this app is explicitly meant to work on. So the
// glowing body — free, it's just a surface with an emissive colour and
// no lighting calculation — is what guarantees you always SEE every
// fixture you placed and paid for, while the room is actually lit by
// the ones that contribute most (see selectRealLights).
function PlacedFixtures() {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = useLayoutStore((state) => state.cabinets);
  const fixtureCatalog = useLayoutStore((state) => state.fixtureCatalog);
  const [quality] = useLightQuality();

  // Recomputed here rather than passed down: PlacedFixtures only needs
  // the two booleans, and threading lightEnv through RoomWalls and the
  // scene tree would mean every intermediate component carrying a prop
  // it doesn't use. Derived from the same state, so it can't disagree.
  const hasPlacedLight =
    (currentLayout?.fixtures ?? []).some(
      (f) => f.enabled && fixtureCatalog.some((c) => c.id === f.catalogItemId)
    ) ||
    (currentLayout?.walls ?? []).some((w) =>
      (w.openings ?? []).some((o) => o.daylight?.enabled)
    );
  const lightEnv = lightingEnvironmentFor(
    currentLayout?.lightingMode ?? 'designed',
    hasPlacedLight
  );

  if (!currentLayout) return null;

  const placements = resolveAllFixtures(currentLayout, cabinets, fixtureCatalog);
  // Same device preference the toolbar sets, so what the panel says is
  // lit and what actually lights the room can't disagree.
  const { lit } = selectRealLights(placements, maxLightsFor(quality));
  const litIds = new Set(lit.map((p) => p.fixture.id));

  return (
    <>
      {placements.map((placement) => (
        <FixtureInScene
          key={placement.fixture.id}
          placement={placement}
          isLit={litIds.has(placement.fixture.id) && lightEnv.fixtureLightsOn}
          emissiveOn={lightEnv.fixtureEmissiveOn && placement.fixture.enabled}
          castShadow={false}
          quality={quality}
        />
      ))}
    </>
  );
}

function FixtureInScene({
  placement,
  isLit,
  emissiveOn,
  quality,
}: {
  placement: FixturePlacement;
  isLit: boolean;
  emissiveOn: boolean;
  castShadow: boolean;
  quality: string;
}) {
  const { item, fixture } = placement;

  // An in-drawer light is only visible with the drawer open, and
  // drawers are modelled shut — so it has no geometry and no light. It
  // is still a real quoted item; this is the one fixture kind that
  // legitimately renders as nothing.
  if (!isVisibleWhenClosed(item.kind)) return null;

  const colour = kelvinToColor(item.colorTempK);
  const directional = isDirectional(fixture.throwDirection ?? defaultThrowFor(item.kind));
  const position: [number, number, number] = [
    mmToWorld(placement.xMm) - 0, // room x maps straight to world x
    mmToWorld(placement.zMm),     // height off the floor is world Y
    mmToWorld(placement.yMm),     // room y (plan depth) maps to world Z
  ];

  // The visible body. A linear fixture is a thin bar along its run; a
  // spot or pendant is a small disc.
  const linear = isLinear(item.kind);
  const runM = mmToWorld(placement.runLengthMm);
  const thicknessM = mmToWorld(14);
  const discM = mmToWorld(90);

  // A non-linear body is oriented by its THROW rather than always being
  // a horizontal plate.
  //
  // It used to be [80, 14, 80] unconditionally — a flat horizontal disc.
  // Correct for a ceiling downlight, wrong for anything on a wall,
  // where it read as a plate lying flat against nothing. A light that
  // throws sideways presents its face sideways.
  const throwsHorizontally = Math.abs(placement.dirZ) < 0.5;
  const nonLinearSize: [number, number, number] = !throwsHorizontally
    ? [discM, thicknessM, discM]
    : Math.abs(placement.dirX) > Math.abs(placement.dirY)
      ? [thicknessM, discM, discM]
      : [discM, discM, thicknessM];

  const bodySize: [number, number, number] = !linear
    ? nonLinearSize
    : placement.runAxis === 'x'
      ? [runM, thicknessM, thicknessM]
      : placement.runAxis === 'y'
        ? [thicknessM, thicknessM, runM]
        : [thicknessM, runM, thicknessM]; // side-mounted, running vertically

  // A pendant hangs, so it needs a visible cord back up to whatever it
  // hangs from. Without it the shade floats in mid-air, which is what
  // made a ceiling pendant look detached from the ceiling.
  // A run is sampled along its own local axis. bodySize already
  // encodes which axis that is, so this mirrors it rather than
  // re-deriving from runAxis and risking the two disagreeing.
  const sampleAxis: 'x' | 'y' | 'z' | null = !linear
    ? null
    : placement.runAxis === 'x'
      ? 'x'
      : placement.runAxis === 'y'
        ? 'z' // room plan-y maps to three.js z
        : 'y'; // side-mounted, running vertically
  const sampleCount =
    linear && placement.runLengthMm >= LINEAR_SAMPLE_MIN_LENGTH_MM
      ? (LINEAR_SAMPLES_BY_QUALITY[quality] ?? 1)
      : 1;

  const stemHeightM =
    placement.suspendedFromMm !== undefined
      ? Math.max(0, mmToWorld(placement.suspendedFromMm - placement.zMm))
      : 0;

  return (
    <group position={position}>
      {stemHeightM > 0 && (
        <mesh position={[0, stemHeightM / 2, 0]}>
          <cylinderGeometry args={[mmToWorld(6), mmToWorld(6), stemHeightM, 8]} />
          <meshStandardMaterial color="#3f3f46" roughness={0.6} metalness={0.3} />
        </mesh>
      )}

      <mesh>
        <boxGeometry args={bodySize} />
        {/* meshStandardMaterial with emissive rather than
            meshBasicMaterial: basic would ignore the room's light
            entirely and the fitting would look like a flat cut-out when
            switched off. This way the body is a real lit object that
            ALSO glows when on. */}
        <meshStandardMaterial
          color={emissiveOn ? colour : '#3f3f46'}
          emissive={emissiveOn ? colour : '#000000'}
          emissiveIntensity={emissiveOn ? FIXTURE_EMISSIVE_INTENSITY : 0}
          roughness={0.5}
          metalness={0.2}
          // TONE MAPPED, unlike before. toneMapped={false} exempted the
          // body from the scene's exposure curve, so it displayed at
          // full brightness however dark or bright the room was — the
          // mechanical reason a fixture could look blazing while
          // contributing nothing. Now it passes through the same
          // exposure as the light it casts.
          toneMapped
        />
      </mesh>

      {/* The real light, for the budgeted few — AIMED.
          This was a pointLight, which is omnidirectional, so an
          under-cabinet strip lit the wall unit above it as brightly as
          the counter below. A light fixed to the underside of a cabinet
          throws in ONE direction; that's what the placement's throw
          vector is for, and a spot light is what can honour it.

          Aimed via a real target object mounted with <primitive>,
          because that is the only reliable way — see the note on
          DaylightThroughOpening for the trap.

          Real inverse-square falloff now (FIXTURE_LIGHT_DECAY). It was
          0, which removed attenuation entirely — every surface in
          reach lit identically, so light had no shape and a placed
          fixture never read as lighting anything. Still no shadows: a
          dozen shadow-casting lights is exactly the cost the budget
          exists to avoid. */}
      {isLit && fixture.enabled && (
        directional ? (
          <AimedFixtureLight
            colour={colour}
            intensity={item.lumens * FIXTURE_LUMEN_SCALE}
            direction={[placement.dirX, placement.dirZ, placement.dirY]}
            samples={sampleCount}
            sampleAxis={sampleAxis}
            runLengthM={runM}
          />
        ) : (
          /* DIFFUSE — radiates, so point lights and no aiming.
             This is what a pendant with a shade, a bare bulb or an opal
             ceiling fitting actually does.

             SPREAD ALONG THE RUN, which it was not before: this was a
             single pointLight, so a 2.4m strip set to "all directions"
             lit only from its centre. A pendant is unaffected (one
             sample is correct for a point fitting); the bug only ever
             showed on linear kinds. */
          <DiffuseFixtureLight
            colour={colour}
            intensity={item.lumens * FIXTURE_LUMEN_SCALE}
            samples={sampleCount}
            sampleAxis={sampleAxis}
            runLengthM={runM}
            hostNormal={{ x: placement.hostNormalX, y: placement.hostNormalY }}
          />
        )
      )}
    </group>
  );
}

// One fixture's light, pointed along its throw direction.
//
// Local to the fixture's own group, so the target is expressed as a
// direction rather than a world point — which means it keeps aiming
// correctly when the host cabinet moves and the group moves with it.
//
// Note the direction arrives already mapped from room space (x, y-plan,
// z-up) into three.js space (x, y-up, z-plan) by the caller; getting
// that swap wrong is how a downward light ends up pointing sideways.
// Offsets along a linear run, centred: 1 sample -> [0], 2 -> [-1/4,
// +1/4], 3 -> [-1/3, 0, +1/3] of the length.
//
// Lifted out of AimedFixtureLight because the DIFFUSE branch needed it
// too and didn't have it — a 2.4m strip set to "all directions" emitted
// from a single point at its centre, so it hotspotted the middle and
// left both ends dark. That was a real omission when diffuse was added:
// the run sampling was wired into the aimed path only, as though
// "diffuse" implied "point source". It doesn't. A diffused strip is
// still a LINE of light; what makes it diffuse is that it radiates in
// every direction, not that it collapses to a point.
function runSampleOffsets(
  samples: number,
  sampleAxis: 'x' | 'y' | 'z' | null,
  runLengthM: number
): number[] {
  if (!sampleAxis || samples <= 1 || runLengthM <= 0) return [0];
  // 0.9 of the length, not 0.7. The tighter figure bunched the samples
  // toward the middle and left both ends of a run visibly dark, which
  // on a strip reads as the ends being broken.
  return Array.from(
    { length: samples },
    (_, i) => (i / (samples - 1) - 0.5) * runLengthM * 0.9
  );
}

// Turns an offset along the run into a local position vector.
function offsetVector(
  sampleAxis: 'x' | 'y' | 'z' | null,
  offset: number
): [number, number, number] {
  switch (sampleAxis) {
    case 'x': return [offset, 0, 0];
    case 'y': return [0, offset, 0];
    case 'z': return [0, 0, offset];
    default: return [0, 0, 0];
  }
}

// A DIFFUSE fixture's light: point lights, spread along the run.
//
// Point rather than spot because diffuse means it radiates — there is
// no cone and no aiming. Spread rather than single because the run has
// length. Intensity is divided between samples, so lengthening a strip
// spreads its output rather than multiplying it, exactly as the aimed
// path does.
function DiffuseFixtureLight({
  colour,
  intensity,
  samples,
  sampleAxis,
  runLengthM,
  hostNormal,
}: {
  colour: string;
  intensity: number;
  samples: number;
  sampleAxis: 'x' | 'y' | 'z' | null;
  runLengthM: number;
  // Outward normal of the surface this is fixed to, in ROOM x/y (zero
  // for ceiling and free mounts). Not the throw — a diffuse fixture has
  // no throw; see FixturePlacement.hostNormalX.
  hostNormal: { x: number; y: number };
}) {
  const offsets = runSampleOffsets(samples, sampleAxis, runLengthM);
  const perSample = intensity / offsets.length;

  // Sample origins stand off the host surface so their pools are wide
  // enough to overlap into one band. Room x/y maps to world x/z.
  const standoffM = mmToWorld(DIFFUSE_ORIGIN_STANDOFF_MM);
  const nx = hostNormal.x * standoffM;
  const nz = hostNormal.y * standoffM;

  return (
    <>
      {offsets.map((offset, i) => {
        const along = offsetVector(sampleAxis, offset);
        return (
        <pointLight
          key={i}
          position={[along[0] + nx, along[1], along[2] + nz]}
          color={colour}
          intensity={perSample}
          distance={mmToWorld(FIXTURE_LIGHT_DISTANCE_MM)}
          // Real falloff, so a pendant lights what's below it more than
          // the far corner — both true, and what makes a room read as
          // lit rather than uniformly filled.
          decay={FIXTURE_LIGHT_DECAY}
        />
        );
      })}
    </>
  );
}

function AimedFixtureLight({
  colour,
  intensity,
  direction,
  samples,
  sampleAxis,
  runLengthM,
}: {
  colour: string;
  intensity: number;
  direction: [number, number, number];
  // How many point lights to spread along the run. A strip is a LINE
  // source; one point in the middle of a 2.4m run hotspots the centre
  // and leaves the ends dark once light actually falls off.
  samples: number;
  // Local axis the run lies along, or null for a point fixture.
  sampleAxis: 'x' | 'y' | 'z' | null;
  runLengthM: number;
}) {
  const reachM = mmToWorld(FIXTURE_LIGHT_DISTANCE_MM);
  const offsets = runSampleOffsets(samples, sampleAxis, runLengthM);

  // Intensity is DIVIDED between samples, so sampling a run spreads the
  // same output along it rather than multiplying it.
  const perSample = intensity / offsets.length;

  return (
    <>
      {offsets.map((offset, i) => (
        <SpotSample
          key={i}
          colour={colour}
          intensity={perSample}
          direction={direction}
          reachM={reachM}
          offset={offsetVector(sampleAxis, offset)}
        />
      ))}
    </>
  );
}

// One aimed sample. Its own target object, because a SpotLight can only
// be aimed by one — see the note on DaylightThroughOpening.
function SpotSample({
  colour,
  intensity,
  direction,
  reachM,
  offset,
}: {
  colour: string;
  intensity: number;
  direction: [number, number, number];
  reachM: number;
  offset: [number, number, number];
}) {
  const target = useMemo(() => new THREE.Object3D(), []);

  const from: [number, number, number] = [
    offset[0] + direction[0] * FIXTURE_ORIGIN_STANDOFF_M,
    offset[1] + direction[1] * FIXTURE_ORIGIN_STANDOFF_M,
    offset[2] + direction[2] * FIXTURE_ORIGIN_STANDOFF_M,
  ];
  const aimAt: [number, number, number] = [
    offset[0] + direction[0] * reachM,
    offset[1] + direction[1] * reachM,
    offset[2] + direction[2] * reachM,
  ];

  return (
    <>
      <primitive object={target} position={aimAt} />
      <spotLight
        // Stood off along the throw rather than sat at the body, so a
        // strip 12mm from a carcass has room for its cone to open.
        position={from}
        color={colour}
        intensity={intensity}
        target={target}
        // 60 degrees with a moderate penumbra. The penumbra was 0.95,
        // which pushes nearly the whole cone into the soft falloff
        // region — less catastrophic than it sounds (still 0.97 gain at
        // 20 degrees off axis) but it does thin out the edges of a
        // wash for no benefit.
        angle={Math.PI / 3}
        penumbra={0.5}
        distance={reachM * 1.4}
        // REAL inverse-square falloff. See FIXTURE_LIGHT_DECAY — this
        // being 0 is why placed lights never appeared to light
        // anything: with no attenuation every surface in reach gets
        // identical illumination, so light has no shape and nothing
        // reads as a pool.
        decay={FIXTURE_LIGHT_DECAY}
      />
    </>
  );
}

// A spot light with a REAL target object, because that is the only way
// a three.js SpotLight can be aimed reliably.
//
// SpotLight.target is an Object3D whose world matrix is used to compute
// the light's direction — and world matrices are only refreshed for
// objects that are part of the scene. A target that is merely assigned,
// or positioned through a `target-position` prop without ever being
// mounted, keeps an identity matrix and the light points at the world
// origin. Mounting it with <primitive> makes it a scene child, so R3F
// updates it every frame like anything else.
function DaylightThroughOpening({
  fromPosition,
  toPosition,
  intensity,
  color,
  castShadow,
}: {
  fromPosition: [number, number, number];
  toPosition: [number, number, number];
  intensity: number;
  color: string;
  castShadow: boolean;
}) {
  // One Object3D per light, created once. Recreating it each render
  // would detach and reattach the target every frame.
  const target = useMemo(() => new THREE.Object3D(), []);

  return (
    <>
      <primitive object={target} position={toPosition} />
      <spotLight
        position={fromPosition}
        target={target}
        angle={DAYLIGHT_CONE_ANGLE_RAD}
        penumbra={0.9}
        intensity={intensity}
        color={color}
        // NO falloff here, and that is a deliberate difference from
        // placed fixtures, which use inverse-square.
        //
        // Sunlight has no meaningful inverse-square attenuation across
        // a four-metre room — the source is 150 million kilometres
        // away, so the near wall and the far wall receive essentially
        // the same irradiance. A five-watt LED strip 300mm from a
        // counter is the opposite case entirely. Modelling both with
        // one falloff law would make one of them wrong. See
        // DAYLIGHT_DECAY vs FIXTURE_LIGHT_DECAY.
        decay={DAYLIGHT_DECAY}
        distance={mmToWorld(9000)}
        castShadow={castShadow}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
      />
    </>
  );
}

interface CabinetMeshProps {
  item: PlacedCabinetItem;
  isSelected: boolean;
  // Given the raw pointer position so the caller can tell a real click
  // from the end of a look/orbit drag — see wasDrag in Room3DCanvas.
  onSelect: (clientX: number, clientY: number) => void;
}

function CabinetMesh({ item, isSelected, onSelect }: CabinetMeshProps) {
  const widthM = mmToWorld(item.widthMm);
  const heightM = mmToWorld(item.heightMm);
  const depthM = mmToWorld(item.depthMm);
  // item.x/y is the UNROTATED top-left corner (same convention as
  // getCabinetBounds in lib/collision.ts) — center it the same way.
  const [worldX, worldZ] = groundPosition(item.x + item.widthMm / 2, item.y + item.depthMm / 2);
  // elevationMm is the same field lib/collision.ts uses for Z-aware
  // collision — using it here too means the 3D preview and the
  // collision system can never silently disagree about where a
  // cabinet actually sits vertically.
  const centerY = mmToWorld(item.elevationMm) + heightM / 2;
  // Appearance comes entirely from the referenced finish now — the
  // substrate (item.material) is a costing input and is never visible.
  // resolveFinish degrades gracefully if the finish was deleted from the
  // catalogue after this cabinet was placed.
  const finishes = useLayoutStore((state) => state.finishes);
  const finish = resolveFinish(finishes, item.finishId);
  const material = resolveMaterial(finish, item.colorOverride);

  // Scaled off the front face so the pattern holds a consistent physical
  // size whatever the module's width. Returns null for solid-colour
  // finishes, in which case no maps are attached and material.color does
  // all the work.
  const textures = useFinishTextures(finish, widthM, heightM);

  // Doors, drawer fronts, the trolley face, shelf boards — and the
  // hardware counts the quote charges, from the same call, so the
  // picture and the price can't disagree (see lib/fronts.ts).
  // Handle resolved from the SAME store array bom.ts prices from, so a
  // cabinet can't be drawn with one handle and charged for another.
  const handles = useLayoutStore((state) => state.handles);
  const handle = resolveHandle(handles, item.handleId);
  // Rates reach a RENDER path only because panels and hardware come out
  // of one subdivision pass, which is the invariant that stops the
  // picture and the price disagreeing. Nothing drawn below depends on a
  // rupee value; if this coupling ever gets in the way, the fix is to
  // split geometry from costing in lib/fronts.ts rather than to pass a
  // placeholder rate card here.
  const rateCard = useLayoutStore((state) => state.rateCard);
  const fronts = useMemo(
    () =>
      cabinetFrontBreakdown(
        item,
        item.frontLayout ?? defaultFrontLayout(item.moduleType, item.widthMm),
        handle,
        rateCard.hardware
      ),
    [item, handle, rateCard]
  );

  // The carcass is SHORTENED by the front thickness and pushed back, so
  // the panels occupy the front 18mm of the cabinet's STATED depth
  // rather than protruding past it. Two reasons that matters: the depth
  // is what the client is charged against and what collision tests, so
  // silently growing it would be a quote error; and a panel sitting
  // exactly on the carcass's own front face would z-fight with it.
  const frontThicknessM = mmToWorld(FRONT_THICKNESS_MM);
  const hasPanels = fronts.panels.length > 0;
  const carcassDepthM = hasPanels ? depthM - frontThicknessM : depthM;
  const carcassOffsetZ = hasPanels ? -frontThicknessM / 2 : 0;
  // Front face of the finished cabinet, in the group's local frame.
  const faceZ = depthM / 2;

  const finishMaterial = (
    /* MeshPhysicalMaterial rather than MeshStandardMaterial so glossy
       finishes can carry a clearcoat layer — for matte finishes
       clearcoat is 0, which renders identically to
       MeshStandardMaterial, so one material type covers everything.
       resolveMaterial (materials3d.ts) already worked out whether
       `color` should be a real colour or plain white to leave a
       texture untinted, so nothing needs deciding here. */
    <meshPhysicalMaterial
      color={material.color}
      map={textures?.map ?? null}
      normalMap={textures?.normalMap ?? null}
      // Drives the finish's relief slider — the normal map itself is
      // baked at a fixed depth and scaled here (materials3d.ts).
      normalScale={[material.normalScale, material.normalScale]}
      roughnessMap={textures?.roughnessMap ?? null}
      roughness={material.roughness}
      metalness={material.metalness}
      clearcoat={material.clearcoat}
      clearcoatRoughness={material.clearcoatRoughness}
    />
  );

  return (
    <group
      position={[worldX, centerY, worldZ]}
      rotation={[0, clockwiseDegToThreeY(item.rotationDeg), 0]}
      onClick={(e) => {
        // Without stopPropagation the ray keeps going and every cabinet
        // behind this one would also fire, selecting whichever rendered
        // last rather than the one actually clicked. On the group now
        // rather than the single mesh, so clicking a DOOR selects the
        // cabinet too — otherwise the panels would shield the carcass
        // and most of the cabinet would become unclickable.
        e.stopPropagation();
        onSelect(e.clientX, e.clientY);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      <mesh position={[0, 0, carcassOffsetZ]} castShadow receiveShadow>
        <boxGeometry args={[widthM, heightM, carcassDepthM]} />
        {finishMaterial}
      </mesh>

      {/* Panels get their own material element rather than sharing one
          instance: three.js materials are objects, and JSX can't mount
          the same element in several places. They read from the same
          resolved values, so they stay identical by construction. */}
      {fronts.panels.map((panel) => (
        <group
          key={panel.index}
          position={[
            mmToWorld(panel.centerXMm),
            mmToWorld(panel.centerYMm),
            faceZ - frontThicknessM / 2,
          ]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry
              args={[mmToWorld(panel.widthMm), mmToWorld(panel.heightMm), frontThicknessM]}
            />
            <meshPhysicalMaterial
              color={material.color}
              map={textures?.map ?? null}
              normalMap={textures?.normalMap ?? null}
              normalScale={[material.normalScale, material.normalScale]}
              roughnessMap={textures?.roughnessMap ?? null}
              roughness={material.roughness}
              metalness={material.metalness}
              clearcoat={material.clearcoat}
              clearcoatRoughness={material.clearcoatRoughness}
            />
          </mesh>
        </group>
      ))}

      {/* Handles are positioned relative to the FINISHED face, not the
          panel, so they project out of the cabinet rather than being
          buried in the shutter. */}
      {fronts.panels.map((panel) =>
        panel.handle ? (
          <HandleMesh key={`handle-${panel.index}`} placement={panel.handle} faceZ={faceZ} />
        ) : null
      )}

      {/* Open-shelf units only. Boards sit inside the carcass depth so
          they read as shelving rather than as a protruding ledge. */}
      {fronts.shelves.map((shelf, i) => (
        <mesh
          key={`shelf-${i}`}
          position={[mmToWorld(shelf.centerXMm), mmToWorld(shelf.centerYMm), carcassOffsetZ]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[mmToWorld(shelf.widthMm), mmToWorld(shelf.heightMm), carcassDepthM * 0.92]}
          />
          <meshPhysicalMaterial
            color={material.color}
            map={textures?.map ?? null}
            roughness={material.roughness}
            metalness={material.metalness}
          />
        </mesh>
      ))}

      {/* drei's Edges derives line segments from the parent geometry, so
          it tracks any resize automatically and handles its own
          disposal. toneMapped={false} keeps the outline a flat, legible
          blue instead of being rolled off by the scene's ACES tone
          mapping along with everything else.
          Deliberately outlining the WHOLE cabinet rather than each
          panel — a per-panel outline would draw a grid over the doors
          and obscure exactly the finish the selection exists to let you
          judge (the same reason emissive highlighting was rejected). */}
      {isSelected && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[widthM, heightM, depthM]} />
          <meshBasicMaterial visible={false} />
          <Edges
            scale={SELECTION_OUTLINE_SCALE}
            color={SELECTION_OUTLINE_COLOR}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

// Bar handles, knobs and profiles. Each is a simple primitive rather
// than a model: at the size a handle occupies on screen the silhouette
// is all that reads, and a per-handle .glb would mean an asset pipeline
// for the least visually significant part of the cabinet.
function HandleMesh({
  placement,
  faceZ,
}: {
  placement: HandlePlacement;
  faceZ: number;
}) {
  const { handle, orientation, lengthMm, centerXMm, centerYMm } = placement;
  const lengthM = mmToWorld(lengthMm);

  const metalMaterial = (
    <meshStandardMaterial
      color={handle.colorHex}
      metalness={handle.metalness}
      roughness={handle.roughness}
    />
  );

  if (handle.kind === 'knob') {
    const radiusM = mmToWorld(handle.lengthMm) / 2;
    return (
      <mesh
        position={[mmToWorld(centerXMm), mmToWorld(centerYMm), faceZ + radiusM]}
        // A cylinder's axis is Y by default; a knob points OUT of the
        // door, so it's tipped onto the Z axis.
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[radiusM, radiusM, radiusM * 1.6, 16]} />
        {metalMaterial}
      </mesh>
    );
  }

  // Profiles hug the panel edge; bar handles stand off it on two legs,
  // which at this scale reads adequately as a single projecting bar.
  const isProfile = handle.kind === 'gola' || handle.kind === 'edge-profile';
  const thicknessM = mmToWorld(isProfile ? 20 : 14);
  const projectionM = mmToWorld(isProfile ? 12 : 32);

  const size: [number, number, number] =
    orientation === 'vertical'
      ? [thicknessM, lengthM, projectionM]
      : [lengthM, thicknessM, projectionM];

  return (
    <mesh
      position={[mmToWorld(centerXMm), mmToWorld(centerYMm), faceZ + projectionM / 2]}
      castShadow
    >
      <boxGeometry args={size} />
      {metalMaterial}
    </mesh>
  );
}

// A quartz worktop slab sitting on top of a base-height cabinet.
// Purely presentational — it isn't a PlacedCabinetItem, isn't
// selectable, and doesn't participate in collision detection, since
// it's derived geometry rather than something the user placed.
function CountertopMesh({ item }: { item: PlacedCabinetItem }) {
  const widthM = mmToWorld(item.widthMm + COUNTERTOP_OVERHANG_MM * 2);
  const depthM = mmToWorld(item.depthMm + COUNTERTOP_OVERHANG_MM * 2);
  const thicknessM = mmToWorld(COUNTERTOP_THICKNESS_MM);

  // Same center convention as CabinetMesh, raised to sit on the
  // cabinet's top face.
  const [worldX, worldZ] = groundPosition(item.x + item.widthMm / 2, item.y + item.depthMm / 2);
  const cabinetTopM = mmToWorld(item.elevationMm + item.heightMm);
  const centerY = cabinetTopM + thicknessM / 2;

  // Scaled off the horizontal face — that's the one anyone actually
  // looks at on a worktop.
  const textures = useSurfaceTextures('quartz', widthM, depthM);

  return (
    <mesh
      position={[worldX, centerY, worldZ]}
      rotation={[0, clockwiseDegToThreeY(item.rotationDeg), 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[widthM, thicknessM, depthM]} />
      {/* Polished stone: low roughness plus a light clearcoat, the same
          way materials3d.ts models glossy cabinet finishes. */}
      <meshPhysicalMaterial
        map={textures.map}
        normalMap={textures.normalMap}
        roughnessMap={textures.roughnessMap}
        // Same as the floor: 1 lets the quartz map's own low roughness
        // (~0.16-0.23, a polished slab) come through unscaled.
        roughness={1}
        metalness={0.02}
        clearcoat={0.35}
        clearcoatRoughness={0.25}
      />
    </mesh>
  );
}

interface ObstacleMeshProps {
  obstacle: Obstacle;
  ceilingHeightMm: number;
}

function ObstacleMesh({ obstacle, ceilingHeightMm }: ObstacleMeshProps) {
  const widthM = mmToWorld(obstacle.widthMm);
  const depthM = mmToWorld(obstacle.depthMm);
  // Same source of truth lib/collision.ts uses: a floor-to-ceiling
  // obstacle always starts at the floor and its real height tracks the
  // room; a partial one instead uses its own editable elevationMm/
  // heightMm — so the 3D preview and collision detection can never
  // silently disagree about where an obstacle actually sits vertically
  // (e.g. a mid-wall electrical fixture with nothing below it).
  const heightMm = obstacle.floorToCeiling ? ceilingHeightMm : obstacle.heightMm;
  const heightM = mmToWorld(heightMm);
  const elevationM = obstacle.floorToCeiling ? 0 : mmToWorld(obstacle.elevationMm);
  const centerY = elevationM + heightM / 2;
  const [worldX, worldZ] = groundPosition(
    obstacle.x + obstacle.widthMm / 2,
    obstacle.y + obstacle.depthMm / 2
  );

  return (
    <mesh position={[worldX, centerY, worldZ]} castShadow receiveShadow>
      <boxGeometry args={[widthM, heightM, depthM]} />
      <meshStandardMaterial color="#9ca3af" roughness={0.9} metalness={0} />
    </mesh>
  );
}

// Flat solid colors (not the translucent rgba ApplianceLayer.tsx uses
// for its 2D top-down view) — in 3D, elevationMm already separates a
// stove from the chimney mounted above it in actual space, so there's
// no overlapping-labels problem translucency needs to solve here.
// Stoves get a slight metalness (burner grates read as part-metallic);
// everything else stays fully non-metallic like the cabinet materials.
const APPLIANCE_MESH_COLORS: Record<ApplianceType, string> = {
  // Brushed stainless, and given a real metalness below — a sink is
  // the one appliance where the material IS the product.
  sink: '#b8bfc4',
  stove: '#3f3f46',
  chimney: '#94a3b8',
  oven: '#52525b',
  otg: '#71717a',
  toaster: '#d4d4d8',
};

function ApplianceMesh({ item }: { item: PlacedApplianceItem }) {
  const widthM = mmToWorld(item.widthMm);
  const heightM = mmToWorld(item.heightMm);
  const depthM = mmToWorld(item.depthMm);
  // Same UNROTATED-top-left-corner convention as CabinetMesh/
  // getApplianceBounds (lib/collision.ts). The centre is what stays
  // fixed under rotation, so the box is placed at the centre and then
  // turned about it — the geometry keeps the unrotated widthM/depthM
  // and the group's rotation does the rest, exactly as CabinetMesh
  // does.
  const [worldX, worldZ] = groundPosition(item.x + item.widthMm / 2, item.y + item.depthMm / 2);
  const centerY = mmToWorld(item.elevationMm) + heightM / 2;

  return (
    <mesh
      position={[worldX, centerY, worldZ]}
      rotation={[0, clockwiseDegToThreeY(item.rotationDeg), 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[widthM, heightM, depthM]} />
      <meshStandardMaterial
        color={APPLIANCE_MESH_COLORS[item.applianceType]}
        roughness={0.4}
        metalness={
          item.applianceType === 'sink' ? 0.75 : item.applianceType === 'stove' ? 0.4 : 0.1
        }
      />
    </mesh>
  );
}

// Just a placement reference — a small glowing marker at each saved
// Camera Node's position, whether or not the view is currently locked
// to it.
function CameraMarker({ camera }: { camera: CameraNode }) {
  const [worldX, worldZ] = groundPosition(camera.x, camera.y);
  const heightM = mmToWorld(camera.heightMm || DEFAULT_CAMERA_HEIGHT_MM);

  return (
    <mesh position={[worldX, heightM, worldZ]}>
      <sphereGeometry args={[0.06, 16, 16]} />
      <meshStandardMaterial color="#0f766e" emissive="#0f766e" emissiveIntensity={0.4} />
    </mesh>
  );
}
