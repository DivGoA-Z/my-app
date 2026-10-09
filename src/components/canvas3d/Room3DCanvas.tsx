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

import { BACKDROP_LIGHT, contrastingBackdrop, surfaceLightness } from '../../lib/backdrop';
import { cn } from '@/lib/utils';
import { Camera as CameraIcon, ChevronDown, Download, Eye, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePhysicalCabinets } from '../../hooks/usePhysicalCabinets';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  Lightformer,
  PerspectiveCamera,
  OrthographicCamera,
  Edges,
} from '@react-three/drei';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { useSelectedCabinetId } from '../../hooks/useSelection';
import { resolveMaterial } from '../../lib/materials3d';
import {
  useSurfaceTextures,
  useFinishTextures,
  textureSetKey,
  useOpeningBackdrop,
  useMetalHardwareTextures,
} from '../../lib/textures3d';
import { resolveFinish } from '../../types/finish';
import { finishForTiling, tilingMode, type SurfaceTiling } from '../../lib/tiling';
import { GroutOverlay } from './GroutOverlay';
import { sinkModelBaseMm } from '../../lib/sinkPlacement';
import {
  hasCountertop,
  COUNTERTOP_THICKNESS_MM,
  COUNTERTOP_OVERHANG_MM,
} from '../../lib/cabinetGeometry';
import { currentFootprintRect } from '../../lib/footprint';
import type { FootprintRect } from '../../lib/footprint';
import type { ApplianceCatalogItem } from '../../types/Catalog';
import { mmToWorld, groundPosition, clockwiseDegToThreeY, lookAnglesFromDirection, MM_TO_M } from '../../lib/scene3d';
import { lightingEnvironmentFor, clampExposure, DEFAULT_EXPOSURE, FIXTURE_LUMEN_SCALE, FIXTURE_ORIGIN_STANDOFF_M, FIXTURE_LIGHT_DECAY, DAYLIGHT_DECAY, LINEAR_SAMPLES_BY_QUALITY, LINEAR_SAMPLE_MIN_LENGTH_MM, DIFFUSE_ORIGIN_STANDOFF_MM, FIXTURE_LIGHT_DISTANCE_MM, FIXTURE_EMISSIVE_INTENSITY, DAYLIGHT_BASE_INTENSITY, BACKDROP_DISTANCE_M, BACKDROP_OVERSIZE, kelvinToColor, DAYLIGHT_STANDOFF_MM, DAYLIGHT_THROW_MM, DAYLIGHT_CONE_ANGLE_RAD, DOOR_HANDLE_PROJECTION_MM, DOOR_HANDLE_HEIGHT_MM, DOOR_HANDLE_EDGE_INSET_MM } from '../../lib/lighting3d';
import { capturePanorama, DEFAULT_CAPTURE_ORIENTATION } from '../../lib/panoramaCapture';
import type { CapturePanoramaOptions } from '../../lib/panoramaCapture';
import { PanoramaViewerModal } from '../panorama/PanoramaViewerModal';
import { buildRenderBrief, renderBriefFileStem, viewFromWorldCamera, withoutRefs, type BriefStyling } from '../../lib/renderBrief';
import type { ReferenceImage } from '../../lib/renderBrief';
import { elevationSheetSvg } from '../../lib/elevationSheet';
import { svgToPng } from '../../lib/svgToPng';
import { HIDE_IN_SNAPSHOT, HIDE_IN_STRUCTURE, GUIDE_IMAGE_SIZE, cameraPose, renderColour, renderStructure } from '../../lib/viewSnapshot';
import type { CameraPose, StructureOptions } from '../../lib/viewSnapshot';
import { downloadBlob } from '../../lib/downloadBlob';
import { useRenderBriefInput } from '../../hooks/useRenderBriefInput';
import { CameraMovePad } from '../toolbar/CameraMovePad';
import { applyOrbitStep, type CameraMove } from '../../lib/cameraMove';
import { Cabinet3DInspector } from './Cabinet3DInspector';
import { ApplianceModel } from './ApplianceModel';
import { FixtureModel } from './FixtureModel';
import { resolveApplianceModel, resolveSinkCutout, applianceFootprint } from '../../lib/applianceGeometry';
import { wallSegments } from '../../lib/openings';
import { resolveAllFixtures, selectRealLights, maxLightsFor } from '../../lib/fixtures';
import { useLightQuality } from '../../hooks/useLightQuality';
import type { FixturePlacement } from '../../lib/fixtures';
import { isLinear, isVisibleWhenClosed, isDirectional, defaultThrowFor } from '../../types/fixture';
import type { FixtureMount } from '../../types/fixture';
import type { WallOpening } from '../../types/opening';
import { cabinetFrontBreakdown, carcassBands } from '../../lib/fronts';
import { frontThicknessMm } from '../../lib/physicalDepth';
import type { HandlePlacement } from '../../lib/fronts';
import { defaultFrontLayout, resolveHandle } from '../../types/front';
import type { GlassTint } from '../../types/front';
import { DEFAULT_CAMERA_HEIGHT_MM } from '../../types/Camera';
import type { CameraNode } from '../../types/Camera';
import type { PlacedCabinetItem } from '../../types/cabinet';
import type { Obstacle, WallOrientation } from '../../types/layout';
import { wallViewRoles } from '../../lib/wallView';
import type { PlacedApplianceItem, ApplianceType } from '../../types/appliance';

export interface Room3DCanvasProps {
  widthMm: number;
  depthMm: number;
  // The 3D wall view: one wall and the units against it, seen straight
  // on (§84, §92). Hides the walkthrough and capture controls. (This
  // comment described §82's camera across the room with the near wall
  // removed; §84 replaced that with the wall taken apart.)
  wallView?: WallOrientation;
  // The floating cabinet panel over the 3D view when a cabinet is
  // clicked (§92). Only Present mode wants it; the editor shows the
  // same selection in its right-hand inspector, and the two at once
  // were one too many.
  inspectorOverlay?: boolean;
  // The room from straight above (the elevation tab's "Top"): every
  // item, no ceiling, north at the top like the 2D plan. Separate from
  // wallView rather than a fifth value of it, because everything keyed
  // on wallView means "one wall and what's against it".
  topView?: boolean;
  // False while the view is kept mounted but hidden (the editor's 3D tab
  // when another tab is showing, §108): draws nothing, but keeps its
  // compiled shaders and loaded textures for when it's shown again.
  // display:none alone wouldn't stop the frame loop.
  active?: boolean;
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
// Where the ease counts as arrived and frames stop being requested
// (§108): half a millimetre and a hundredth of a degree, below anything
// visible.
const EASE_DONE_M = 0.0005;
const EASE_DONE_RAD = (0.01 * Math.PI) / 180;
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
// How long the active hotspot pulses after you step onto it (§108).
const HOTSPOT_PULSE_SECONDS = 3;
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

export function Room3DCanvas({ widthMm, depthMm, wallView, inspectorOverlay = false, topView = false, active = true }: Room3DCanvasProps) {
  // Either fixed-camera drawing view: no walkthrough controls, no
  // camera markers, fills the editor's height.
  const drawingView = !!wallView || topView;
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
  const obstacles = useLayoutStore((state) => state.obstacles);
  // Every lighting decision in this canvas reads from here, so a mode
  // can't be applied half-way (fixtures neutralised but a warm window
  // still tinting the room — the exact failure that made three modes
  // necessary instead of an on/off toggle).
  const appliances = useLayoutStore((state) => state.appliances);
  const cameras = useLayoutStore((state) => state.cameras);
  // Wall view (§84): which items stand against the chosen wall ("full"),
  // which are corner pieces of the neighbouring wall ("ghost"); the rest
  // aren't drawn. Same "against a wall" test as the 2D elevation.
  const wallRoles = wallView
    ? wallViewRoles(wallView, [...cabinets, ...appliances, ...obstacles.map((o) => ({ ...o, rotationDeg: 0 as const }))], widthMm, depthMm)
    : null;
  const shownCabinets = wallRoles ? cabinets.filter((c) => wallRoles.get(c.id) === 'full') : cabinets;
  const shownAppliances = wallRoles ? appliances.filter((a) => wallRoles.get(a.id) === 'full') : appliances;
  const shownObstacles = wallRoles ? obstacles.filter((o) => wallRoles.has(o.id)) : obstacles;
  // Wall view backdrop, contrasting with the wall and its units (§93):
  // each unit weighted by its front area, the wall by what's left
  // uncovered, so a big plaster wall can't outvote the fronts.
  const allFinishes = useLayoutStore((state) => state.finishes);
  let wallViewBackdrop = BACKDROP_LIGHT;
  if (wallView) {
    const unitSamples = shownCabinets.map((c) => ({
      lightness: surfaceLightness(c.finishId ? resolveFinish(allFinishes, c.finishId) : undefined, c.colorOverride),
      weight: c.widthMm * c.heightMm,
    }));
    const wallFinishId = currentLayout?.walls?.find((w) => w.orientation === wallView)?.finishId;
    const wallLengthMm = wallView === 'north' || wallView === 'south' ? widthMm : depthMm;
    const wallAreaMm2 = wallLengthMm * (currentLayout?.dimensions.ceilingHeightMm ?? 2700);
    const covered = unitSamples.reduce((t, u) => t + u.weight, 0);
    wallViewBackdrop = contrastingBackdrop([
      ...unitSamples,
      { lightness: surfaceLightness(wallFinishId ? resolveFinish(allFinishes, wallFinishId) : undefined), weight: Math.max(0, wallAreaMm2 - covered) },
    ]);
  }
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

  // False until the scene's shaders are compiled (§108, ShaderWarmup).
  // No frames are drawn until then: the first frame is what used to
  // compile them, blocking the whole app for up to 4 s on a cold cache.
  const [shadersReady, setShadersReady] = useState(false);
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
  // The inspector shows and edits the STORED cabinet (§61) — the drawn
  // one is physical, and under "carcass only" its depth would read 618
  // where the business typed 600.
  const storedCabinets = useLayoutStore((state) => state.cabinets);
  const selectedCabinet = storedCabinets.find((c) => c.id === selectedCabinetId) ?? null;

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
  // The walkthrough lens. Declared here, above the lock sync below, which
  // loads a camera's saved lens into it (§102).
  const [firstPersonFovDeg, setFirstPersonFovDeg] = useState(DEFAULT_FIRST_PERSON_FOV_DEG);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [prevLockedCameraId, setPrevLockedCameraId] = useState(lockedCameraId);
  if (lockedCameraId !== prevLockedCameraId) {
    setPrevLockedCameraId(lockedCameraId);
    if (lockedCameraId) {
      setSelectedCameraId(lockedCameraId);
      // A camera with a saved lens (§102) brings it with it, so its view
      // is the one that was framed and saved.
      const saved = cameras.find((c) => c.id === lockedCameraId)?.fovDeg;
      if (saved) setFirstPersonFovDeg(saved);
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

  // The image brief (lib/renderBrief.ts): the JSON that says what every
  // shape is, plus ONE picture of the geometry (§105):
  //   standing at a camera → a line drawing of exactly what that camera
  //     sees (lib/viewSnapshot.ts). With the JSON, this is what kept the
  //     layout in the first real tests.
  //   free orbit → the plan + four-wall sheet (lib/elevationSheet.ts),
  //     since a cut-away orbit view would be painted as a dollhouse.
  // No model is named anywhere: which image service to use is still open.
  const viewFnsRef = useRef<ViewFns | null>(null);
  const briefInput = useRenderBriefInput();

  // The brief's styling (§127): a session choice, Bare by default.
  const [briefStyling, setBriefStyling] = useState<BriefStyling>('bare');

  // §128: ONE image from the main camera — always the FIRST camera
  // (Camera 1), wherever you're standing when you press the button (the
  // user's call: one fixed rule, no surprises) — with every other
  // camera's colour view attached as context.
  async function handleContextBrief() {
    const fns = viewFnsRef.current;
    if (!currentLayout || !briefInput || !fns || cameras.length < 2) return;
    try {
      const main = cameras[0];
      const others = cameras.filter((c) => c.id !== main.id);
      const stem = renderBriefFileStem(currentLayout.name);
      const { widthPx, heightPx } = GUIDE_IMAGE_SIZE;
      const shot = fns.fromCamera(main, { widthPx, heightPx });
      const ctx = others.map((c) => ({ node: c, img: fns.fromCamera(c, { widthPx, heightPx }) }));
      const images: ReferenceImage[] = [
        { kind: 'line-render', file: `${stem}-guide.png`, widthPx, heightPx },
        { kind: 'colour-render', file: `${stem}-colour.png`, widthPx, heightPx },
        ...ctx.map(({ node }) => ({
          kind: 'context-view' as const,
          file: `${stem}-context-${renderBriefFileStem(node.label)}.png`,
          widthPx,
          heightPx,
          cameraLabel: node.label,
        })),
      ];
      const brief = buildRenderBrief({
        ...briefInput,
        view: viewFromWorldCamera({
          mode: 'walkthrough',
          cameraLabel: main.label,
          position: shot.pose.position,
          direction: shot.pose.direction,
          verticalFovDeg: shot.pose.verticalFovDeg,
          imageWidthPx: widthPx,
          imageHeightPx: heightPx,
        }),
        assetOrigin: window.location.origin,
        generatedAt: new Date().toISOString(),
        referenceImages: images,
        refs: false,
        styling: briefStyling,
      });
      const files: [string, string][] = [
        [shot.line, images[0].file],
        [shot.colour, images[1].file],
        ...ctx.map(({ img }, k): [string, string] => [img.colour, images[2 + k].file]),
      ];
      for (const [url, name] of files) {
        downloadBlob(await (await fetch(url)).blob(), name);
        // Browsers drop rapid-fire downloads; a short gap keeps them.
        await new Promise((r) => setTimeout(r, 300));
      }
      downloadBlob(new Blob([JSON.stringify(withoutRefs(brief), null, 2)], { type: 'application/json' }), `${stem}-render-brief.json`);
      toast.success(`Image brief for ${main.label}, with ${others.length} other ${others.length === 1 ? 'view' : 'views'} as context.`, {
        description: 'Give the model all the files: it makes ONE photo from the main camera and uses the rest only to understand the kitchen.',
        duration: 10000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? `Image brief failed: ${err.message}` : 'Image brief failed.');
    }
  }

  async function handleRenderBrief() {
    const fns = viewFnsRef.current;
    if (!currentLayout || !briefInput || !fns) return;
    try {
      const pose = fns.pose();
      const stem = renderBriefFileStem(currentLayout.name);
      const base = {
        ...briefInput,
        view: viewFromWorldCamera({
          mode: lockedCamera ? 'walkthrough' : 'orbit',
          cameraLabel: lockedCamera?.label,
          position: pose.position,
          direction: pose.direction,
          verticalFovDeg: pose.verticalFovDeg,
          imageWidthPx: pose.widthPx,
          imageHeightPx: pose.heightPx,
        }),
        assetOrigin: window.location.origin,
        generatedAt: new Date().toISOString(),
      };
      const json = (data: unknown, file: string) =>
        downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), file);

      if (lockedCamera) {
        const { widthPx, heightPx } = GUIDE_IMAGE_SIZE;
        const line = fns.structure({ widthPx, heightPx });
        // Same camera and size, so it lines up with the guide (§113).
        const colour = fns.colour({ widthPx, heightPx });
        const images: ReferenceImage[] = [
          { kind: 'line-render', file: `${stem}-guide.png`, widthPx, heightPx },
          { kind: 'colour-render', file: `${stem}-colour.png`, widthPx, heightPx },
        ];
        // No codes in this route (§114): the images carry no labels, and a
        // model given "C3" in the text painted it onto the cabinet.
        const brief = buildRenderBrief({ ...base, referenceImages: images, refs: false, styling: briefStyling });
        downloadBlob(await (await fetch(line)).blob(), images[0].file);
        downloadBlob(await (await fetch(colour)).blob(), images[1].file);
        json(withoutRefs(brief), `${stem}-render-brief.json`);
        toast.success(`Image brief downloaded: what ${lockedCamera.label} sees as a line drawing and in colour, and the brief (JSON).`);
      } else {
        // Drawn from a first pass of the brief, so the sheet and the JSON
        // share refs; the second pass only adds the image list.
        const sheet = elevationSheetSvg(buildRenderBrief({ ...base, referenceImages: [] }));
        const sheetScale = 2;
        const images: ReferenceImage[] = [
          { kind: 'elevations', file: `${stem}-elevations.png`, widthPx: sheet.widthPx * sheetScale, heightPx: sheet.heightPx * sheetScale },
        ];
        const brief = buildRenderBrief({ ...base, referenceImages: images, styling: briefStyling });
        downloadBlob(await svgToPng(sheet.svg, sheet.widthPx, sheet.heightPx, sheetScale), images[0].file);
        json(brief, `${stem}-render-brief.json`);
        toast.success('Image brief downloaded: plan and walls, and the brief (JSON). Stand at a camera for a picture of that view instead.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? `Image brief failed: ${err.message}` : 'Image brief failed.');
    }
  }

  // Saves where you're looking now (after dragging to look around) as
  // this camera's view: heading, tilt and lens (§102). The image brief
  // renders exactly that, so framing by eye here is how you set up the
  // shot for a photo-realistic render.
  const updateCamera = useLayoutStore((state) => state.updateCamera);
  function handleSaveView() {
    const fns = viewFnsRef.current;
    if (!lockedCamera || !fns) return;
    const { headingDeg, pitchDeg } = lookAnglesFromDirection(fns.pose().direction);
    updateCamera(lockedCamera.id, { viewAngleDeg: headingDeg, pitchDeg, fovDeg: firstPersonFovDeg });
    toast.success(`Saved as ${lockedCamera.label}'s view: ${Math.round(headingDeg)}° heading, ${pitchDeg > 0 ? 'up' : pitchDeg < 0 ? 'down' : 'level'}${pitchDeg ? ` ${Math.abs(Math.round(pitchDeg))}°` : ''}, ${firstPersonFovDeg}° lens.`);
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
    <div className={cn('flex flex-col gap-3', drawingView && 'h-full')}>
      {!drawingView && (
        <>
      {/* §90: restyled to the app's tokens and touch sizes. Where you're
          looking from stays in view; the 360° photo tools and their
          calibration share one fold, since capturing is occasional and
          they took half a phone screen. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Look from
          <select
            value={lockedCameraId ?? ''}
            onChange={(e) => setLockedCameraId(e.target.value || null)}
            className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px] min-w-44"
          >
            <option value="">Free orbit (drag to turn)</option>
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.label}
              </option>
            ))}
          </select>
        </label>
        {lockedCamera && (
          <Button variant="outline" size="touch" onClick={handleSaveView}>
            <Save /> Save this view
          </Button>
        )}
        {/* §127: Bare = only what's designed; Styled = a few neutral counter
            props and a soft view outside, for a showroom-style photo. */}
        <select
          aria-label="Image brief styling"
          value={briefStyling}
          onChange={(e) => setBriefStyling(e.target.value as BriefStyling)}
          className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px]"
        >
          <option value="bare">Bare (only what&rsquo;s designed)</option>
          <option value="styled">Styled (a few counter props)</option>
        </select>
        <Button variant="outline" size="touch" onClick={handleRenderBrief} disabled={!currentLayout}>
          <Download /> Image brief
        </Button>
        {cameras.length >= 2 && (
          <Button variant="outline" size="touch" onClick={handleContextBrief} disabled={!currentLayout}>
            <Download /> Brief + other views ({cameras.length - 1})
          </Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {lockedCamera
          ? `Standing at ${lockedCamera.label}: drag to look around, then "Save this view" to keep it as this camera's view. Tap another glowing floor marker to step there.`
          : cameras.length > 0
            ? 'Tap a glowing floor marker to step into the room at that camera.'
            : 'Drag to turn the room; pinch or scroll to zoom.'}
        {selectedCamera?.panoramaCapturedAt &&
          !captureError &&
          ` 360° photo taken ${new Date(selectedCamera.panoramaCapturedAt).toLocaleString()}.`}
        {' '}Image brief saves what this camera sees as a line drawing and in colour, plus a description of everything in it, for a photo-realistic render; without a camera it saves the plan and all four walls instead.
      </p>
      {captureError && <p className="text-[13px] font-medium text-destructive">Capture failed: {captureError}</p>}

      {/* Calibration knobs — see panoramaCapture.ts's header for why
          orientation/exposure can't just be hardcoded correctly up
          front. Capture, look at the result, flip whichever of these is
          wrong, re-capture. Once the right combination is known these
          values can become the defaults and this panel can go away. */}
      <details className="group self-start rounded-xl border border-border bg-card">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-semibold text-muted-foreground">
          360° photos
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-3 text-sm">
          {cameras.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              360° photo for
              <select
                value={selectedCameraId ?? ''}
                onChange={(e) => setSelectedCameraId(e.target.value || null)}
                className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px] min-w-40"
              >
                <option value="" disabled>
                  Choose a camera…
                </option>
                {cameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.label}
                  </option>
                ))}
              </select>
            </label>
            {/* Works whether or not the viewport is locked to this node —
                capturePanorama only needs a world position, the on-screen
                camera doesn't need to actually be sitting there. */}
            <Button variant="outline" size="touch" onClick={handleCapture} disabled={!selectedCamera || isCapturing}>
              <CameraIcon /> {isCapturing ? 'Capturing…' : selectedCamera?.panoramaUrl ? 'Capture again' : 'Capture 360°'}
            </Button>
            {selectedCamera?.panoramaUrl && (
              <>
                <Button variant="outline" size="touch" onClick={() => setIsViewerOpen(true)}>
                  <Eye /> View 360°
                </Button>
                <Button variant="ghost" size="icon-touch" aria-label="Delete 360° photo" className="text-muted-foreground hover:text-destructive" onClick={handleDeletePanorama}>
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
                  ) : (
            <p className="text-[13px] text-muted-foreground">Add a camera (Cameras panel) to take a 360° photo from it.</p>
          )}
          <span className="pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Capture settings</span>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-primary" checked={mirrorX} onChange={(e) => setMirrorX(e.target.checked)} />
            Mirror horizontally
            <span className="text-xs text-muted-foreground">turn off if the photo is left-right flipped</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-primary" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} />
            Flip vertically
            <span className="text-xs text-muted-foreground">turn on if the photo is upside down</span>
          </label>
          <label className="flex flex-wrap items-center gap-2.5">
            Exposure
            <input type="range" className="accent-primary" min={0.5} max={2} step={0.05} value={exposure} onChange={(e) => setExposure(Number(e.target.value))} />
            <span className="w-10 font-mono text-xs tabular-nums">{exposure.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">raise if photos look too dark</span>
          </label>
          <label className="flex flex-wrap items-center gap-2.5">
            Walkthrough lens
            <input type="range" className="accent-primary" min={40} max={90} step={1} value={firstPersonFovDeg} onChange={(e) => setFirstPersonFovDeg(Number(e.target.value))} />
            <span className="w-10 font-mono text-xs tabular-nums">{firstPersonFovDeg}°</span>
            <span className="text-xs text-muted-foreground">lower = less stretching at the edges</span>
          </label>
        </div>
      </details>

        </>
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
        className={cn(
          'relative w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-secondary shadow-card',
          // A wall is nearer square than 16:9, so on a phone the wall
          // view fills the height that's left instead (§92), and
          // WallViewCamera fits to the frame's real shape. (A fixed 4:5
          // was tried first and ran under the phone's tool strip.) The
          // room view keeps 16:9 for the FOV reason above.
          drawingView ? 'min-h-[240px] flex-1 sm:flex-none sm:aspect-video' : 'aspect-video'
        )}
        onPointerDown={(e) => {
          pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        <Canvas
          shadows
          // Draw only when something changed (§108). A kitchen is still
          // unless the camera moves, and the default "always" loop
          // redrew the whole room, shadows included, 60 times a second:
          // a quarter of the main thread with nothing on screen moving.
          // R3F redraws on its own after any React change to the scene
          // and drei's OrbitControls asks on every move; the rest
          // (camera easing, the hotspot pulse, exposure, textures that
          // finish loading) call invalidate() themselves.
          frameloop={shadersReady && active ? 'demand' : 'never'}
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
          {/* Wall view: a plain sheet behind the wall, not sky blue (§92),
              dark behind a light wall of units and light behind a dark
              one (§93), so the outline always reads. */}
          <color attach="background" args={[drawingView ? wallViewBackdrop : '#dbeafe']} />

          {/* Lighting environment: a self-hosted HDRI PLUS the emissive
              Lightformer panels, composited together, not one instead
              of the other.
              WAS preset="apartment", which fetched a stock HDR photo
              from drei's CDN — bad because it needed network access at
              runtime, and because that specific photo (someone's
              apartment hallway, wooden door and all) showed up
              mirrored in every glossy surface, which read as wrong
              rather than as light. Lightformer rectangles replaced it
              with nothing to download and reflections that read as
              generic light panels — correct for a kitchen, but flat:
              a Lightformer rect has no depth of glare and no gradient,
              so polished chrome and quartz still looked closer to grey
              paint than a mirror.
              A real HDRI (public/hdri/studio-small-09.hdr, CC0 from
              Poly Haven, self-hosted — see public/hdri/CREDITS.md) is
              layered back in via the `files` prop below, which is safe
              to combine with Lightformer children: passing `files`
              alongside `children` puts drei into its EnvironmentPortal
              path (confirmed by reading node_modules/@react-three/drei/
              core/Environment.js directly, not assumed from the docs) —
              the HDRI is set as that portal's OWN virtual scene's
              background, the Lightformer rects are placed as objects
              inside that same virtual scene, and a single CubeCamera
              capture bakes both together into the one texture that
              becomes the room's real environment map. So a reflective
              surface now shows genuine directional variation from the
              HDRI (the bright/dark gradient a flat rect can't produce)
              AND still catches the tuned Lightformer highlights. No new
              runtime CDN dependency either way — the file is served
              from public/, same as every texture/model here.
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
          <Environment
            files="/hdri/studio-small-09.hdr"
            resolution={256}
            frames={1}
            background={false}
          >
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
          <PlacedFixtures
            keep={
              wallView
                ? // Wall view (§92): only lights on the units shown or on
                  // this wall. Ceiling pendants hung in front of the
                  // units and hid them.
                  (m) => (m.kind === 'cabinet' ? wallRoles?.get(m.cabinetId) === 'full' : m.kind === 'wall' && m.wallId === wallView)
                : topView
                  ? // Seen from above, ceiling fittings would hide the room.
                    (m) => m.kind !== 'ceiling'
                  : undefined
            }
          />

          <RoomFloor widthM={roomWidthM} depthM={roomDepthM} />

          {/* Wall view (§84): the room taken apart — only the chosen wall,
              no ceiling — like an elevation, not a camera across the room. */}
          <RoomWalls widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} only={wallView} />

          {!drawingView && <RoomCeiling widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} />}

          {/* Corner pieces that belong to the neighbouring wall: the
              corner they occupy, in plain grey (§92). */}
          {wallView &&
            [...cabinets, ...appliances]
              .filter((item) => wallRoles?.get(item.id) === 'ghost')
              .map((item) => (
                <GhostBlock key={`ghost-${item.id}`} item={item} wall={wallView} roomWidthMm={widthMm} roomDepthMm={depthMm} />
              ))}

          {shownCabinets.map((item) => (
            <CabinetMesh
              key={item.id}
              item={item}
              isSelected={item.id === selectedCabinetId}
              onSelect={(clientX, clientY) => {
                if (!wasDrag(clientX, clientY)) selectCabinet(item.id);
              }}
            />
          ))}

          {/* Worktops over every base-height module — priced and
              finish-selectable now, see hasCountertop in
              lib/cabinetGeometry.ts. */}
          {shownCabinets
            .filter((item) => hasCountertop(item.moduleType) && item.elevationMm === 0)
            .map((item) => (
              <CountertopMesh
                key={`counter-${item.id}`}
                item={item}
                cabinets={shownCabinets}
                obstacles={obstacles}
                appliances={appliances}
              />
            ))}

          {shownObstacles.map((obstacle) => (
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
          {shownAppliances.map((item) => {
            // Resolution moved into lib/applianceGeometry because it
            // now yields TWO things that must come from the SAME
            // catalogue row — the model file and that file's
            // orientation correction. Matching on applianceType here
            // and orientation somewhere else would eventually pair one
            // chimney's model with another chimney's correction.
            const { modelUrl, orientation } = resolveApplianceModel(item, applianceCatalog);
            // A sink with a countertop cutout previously had its
            // rendered position dropped here, to avoid a z-fight with
            // the cut edge — reverted. Every offset tried (10mm, then
            // 2mm, anchored either to the sink's own elevationMm or to
            // the host cabinet's geometry) made the sink render fully
            // black/invisible instead, worse than the original
            // flicker it was meant to fix. See DECISIONS.md's "Sink
            // cutout" entry — this needs real numbers (the sink's
            // actual elevationMm/heightMm and its cabinet's heightMm)
            // before trying again, not another guess.
            return (
              <ApplianceModel
                key={item.id}
                item={item}
                modelUrl={modelUrl}
                orientation={orientation}
                // A sink resting on a counter drops in, rim at the counter
                // top (§126). The fallback box is unchanged.
                baseMm={item.applianceType === 'sink' ? sinkModelBaseMm(item, cabinets) : undefined}
                fallback={<ApplianceMesh item={item} />}
              />
            );
          })}

          {/* Tagged so the image brief's snapshot leaves them out
              (lib/viewSnapshot.ts) — they're editor furniture, not
              part of the kitchen. */}
          <group userData={{ [HIDE_IN_SNAPSHOT]: true }}>
          {!drawingView && cameras.map((camera) => (
            <CameraMarker key={camera.id} camera={camera} />
          ))}

          {/* Clickable "step into the room" floor targets — always
              rendered (not just while locked) so a hotspot click from
              free orbit is how you first enter walkthrough mode, same
              as picking a node from the Viewpoint dropdown above. */}
          {/* Not in the wall view, where there's no walkthrough to enter. */}
          {!drawingView && cameras.map((camera) => (
            <HotspotMarker
              key={camera.id}
              camera={camera}
              isActive={camera.id === lockedCameraId}
              onSelect={() => setLockedCameraId(camera.id)}
            />
          ))}
          </group>

          {wallView ? (
            <WallViewCamera key={wallView} wall={wallView} widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} />
          ) : topView ? (
            <TopViewCamera widthM={roomWidthM} depthM={roomDepthM} heightM={ceilingHeightM} />
          ) : lockedCamera ? (
            <AnimatedFirstPersonCamera camera={lockedCamera} fovDeg={firstPersonFovDeg} />
          ) : (
            // makeDefault: the on-view move pad (§110) reaches these
            // controls through the scene's state to glide the view.
            <OrbitControls makeDefault target={[roomWidthM / 2, ceilingHeightM / 3, roomDepthM / 2]} />
          )}

          {/* Invisible — just hands the live renderer+scene up to
              handleCapture above via captureFnRef (see its comment). */}
          <PanoramaCaptureBridge captureFnRef={captureFnRef} />
          <ViewSnapshotBridge viewFnsRef={viewFnsRef} />
          <ShaderWarmup onReady={setShadersReady} />
          <RedrawOn value={shadersReady} />
          <RedrawOn value={active} />
        </Canvas>

        {/* Overlays the canvas (the wrapper is position:relative) rather
            than sitting beside it — a side panel would squeeze the 3D
            view, which is the thing you're trying to look at. */}
        {!shadersReady && (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-muted-foreground">
            Preparing 3D…
          </div>
        )}

        {inspectorOverlay && selectedCabinet && <Cabinet3DInspector cabinet={selectedCabinet} />}

        {/* Hold-to-move pad on the view itself (§110): standing at a camera
            it moves that camera (as the Cameras panel's pad does); in free
            orbit it glides the view. Bottom-right, clear of the inspector. */}
        {!drawingView && (
          <div className="absolute bottom-3 right-3 rounded-xl border border-border bg-card/90 p-1.5 shadow-card backdrop-blur-sm">
            {lockedCamera ? (
              <CameraMovePad compact cameraId={lockedCamera.id} />
            ) : (
              <CameraMovePad compact onStep={(move, seconds) => viewFnsRef.current?.orbitStep(move, seconds)} />
            )}
          </div>
        )}
      </div>

      <PanoramaViewerModal
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        cameraLabel={selectedCamera?.label ?? ''}
        panoramaUrl={selectedCamera?.panoramaUrl}
        headingDeg={selectedCamera?.viewAngleDeg}
        pitchDeg={selectedCamera?.pitchDeg}
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

// Compiles every shader the scene needs BEFORE the first frame, without
// blocking the app (§108). Measured on a real kitchen: drawing the first
// frame used to stall the main thread ~4 s on a cold shader cache (and
// 0.2–0.7 s on a warm one), almost all of it three.js waiting for the
// GPU driver to finish compiling and linking programs (`onFirstUse`).
// compileAsync hands the same work to the driver and polls with
// KHR_parallel_shader_compile, so the page stays responsive meanwhile.
//
// Mounted inside the scene, so it runs only after the scene's suspended
// parts (the HDRI) have arrived and the materials it compiles are the
// real ones. Appliance models load later behind their own Suspense and
// compile on first use; they're few. The timeout means a driver that
// never reports back can't leave "Preparing 3D…" up for good.
const SHADER_WARMUP_TIMEOUT_MS = 10_000;
// `onReady` is a state setter: its identity never changes, so the effect
// runs once per mount instead of restarting (and abandoning the compile)
// on every re-render of the parent while the scene loads.
function ShaderWarmup({ onReady }: { onReady: (ready: true) => void }) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    let cancelled = false;
    const { gl, scene, camera } = get();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHADER_WARMUP_TIMEOUT_MS));
    Promise.race([gl.compileAsync(scene, camera).catch(() => {}), timeout]).then(() => {
      if (!cancelled) onReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [get, onReady]);
  return null;
}

// Asks for one frame whenever `value` changes: switching from "never" to
// "demand" doesn't draw by itself (§108).
function RedrawOn({ value }: { value: unknown }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [value, invalidate]);
  return null;
}

// Same idea as PanoramaCaptureBridge, for the image brief: the camera's
// pose and structure renders of what it sees (lib/viewSnapshot.ts).
// Reads the camera at click time through get() rather than closing over
// it: the walkthrough swaps the default camera, and a stale one would
// render the wrong view.
interface ViewFns {
  pose: () => CameraPose;
  // One step of the free-orbit move pad (§110); no-op without orbit controls.
  orbitStep: (move: CameraMove, seconds: number) => void;
  structure: (opts: StructureOptions) => string;
  // The 3D view itself at the same size (§113).
  colour: (opts: StructureOptions) => string;
  // §128: what a camera node sees, without moving the live view: the
  // same pose the walkthrough would give it, rendered off-screen.
  fromCamera: (node: CameraNode, opts: StructureOptions) => { line: string; colour: string; pose: CameraPose };
}

function ViewSnapshotBridge({ viewFnsRef }: { viewFnsRef: { current: ViewFns | null } }) {
  const get = useThree((state) => state.get);

  useEffect(() => {
    viewFnsRef.current = {
      orbitStep: (move, seconds) => {
        const { camera, controls, invalidate } = get();
        const orbit = controls as unknown as Parameters<typeof applyOrbitStep>[1] | null;
        if (orbit && 'target' in orbit) applyOrbitStep(camera, orbit, move, seconds, invalidate);
      },
      pose: () => {
        const { gl, camera } = get();
        return cameraPose(gl, camera);
      },
      structure: (opts) => {
        const { gl, scene, camera } = get();
        return renderStructure(gl, scene, camera, opts);
      },
      colour: (opts) => {
        const { gl, scene, camera } = get();
        return renderColour(gl, scene, camera, opts);
      },
      fromCamera: (node, opts) => {
        const { gl, scene, invalidate } = get();
        const cam = new THREE.PerspectiveCamera(node.fovDeg ?? DEFAULT_FIRST_PERSON_FOV_DEG, opts.widthPx / opts.heightPx, 0.05, 100);
        const [x, z] = groundPosition(node.x, node.y);
        cam.position.set(x, mmToWorld(node.heightMm || DEFAULT_CAMERA_HEIGHT_MM), z);
        // Same 'YXZ' heading-then-tilt as AnimatedFirstPersonCamera.
        cam.quaternion.setFromEuler(
          new THREE.Euler(THREE.MathUtils.degToRad(node.pitchDeg ?? 0), clockwiseDegToThreeY(node.viewAngleDeg), 0, 'YXZ')
        );
        cam.updateMatrixWorld(true);
        const line = renderStructure(gl, scene, cam, opts);
        const colour = renderColour(gl, scene, cam, opts);
        // The on-screen view is redrawn from the real camera afterwards.
        invalidate();
        return { line, colour, pose: { ...cameraPose(gl, cam), widthPx: opts.widthPx, heightPx: opts.heightPx } };
      },
    };
    return () => {
      viewFnsRef.current = null;
    };
  }, [get, viewFnsRef]);

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
  // Demand rendering (§108): a new target or a drag asks for a frame;
  // the frame loop below keeps asking until the ease has arrived.
  const invalidate = useThree((s) => s.invalidate);
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

  // Position and view are two effects (§103): gliding the camera with
  // the Cameras panel's move pad changes x/y/height many times a second,
  // and must not throw away a look-around you haven't saved yet. Only a
  // new VIEW (another node, or a saved heading/tilt) resets free-look.
  useEffect(() => {
    const [worldX, worldZ] = groundPosition(camera.x, camera.y);
    const worldY = mmToWorld(camera.heightMm || DEFAULT_CAMERA_HEIGHT_MM);
    targetPositionRef.current.set(worldX, worldY, worldZ);
    invalidate();
  }, [camera.x, camera.y, camera.heightMm, invalidate]);

  useEffect(() => {
    // Heading and the saved tilt (§102), in the same 'YXZ' order the
    // drag-look uses, so a view saved from a drag comes back exactly.
    targetQuaternionRef.current.setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(camera.pitchDeg ?? 0), clockwiseDegToThreeY(camera.viewAngleDeg), 0, 'YXZ')
    );

    // A (possibly different) node always resets free-look — stepping
    // to a new spot shows what THAT node was aimed at, not wherever a
    // drag left the previous one.
    freeLookActiveRef.current = false;

    // First activation snaps rather than flying in from the origin. Runs
    // after the position effect above (declaration order), so the target
    // position is already set.
    if (cameraRef.current && !hasPositionedRef.current) {
      cameraRef.current.position.copy(targetPositionRef.current);
      cameraRef.current.quaternion.copy(targetQuaternionRef.current);
      hasPositionedRef.current = true;
    }
    invalidate();
  }, [camera.id, camera.viewAngleDeg, camera.pitchDeg, invalidate]);

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
      invalidate();
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
  }, [gl, invalidate]);

  useFrame((state, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    // 1 - e^(-delta * damping): converges toward the target smoothly
    // regardless of frame rate (a plain `delta * speed` lerp factor
    // would overshoot/oscillate at low FPS since it can exceed 1).
    // Capped at one 30fps frame: with demand rendering (§108) the first
    // frame after an idle spell sees the whole idle time as `delta`,
    // which would make the ease jump straight to its target.
    const t = 1 - Math.exp(-Math.min(delta, 1 / 30) * CAMERA_TRANSITION_DAMPING);
    cam.position.lerp(targetPositionRef.current, t);

    if (freeLookActiveRef.current) {
      cam.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'));
    } else {
      cam.quaternion.slerp(targetQuaternionRef.current, t);
    }

    // Keep drawing until the ease has visibly arrived, then stop.
    const moving =
      cam.position.distanceToSquared(targetPositionRef.current) > EASE_DONE_M * EASE_DONE_M ||
      (!freeLookActiveRef.current && cam.quaternion.angleTo(targetQuaternionRef.current) > EASE_DONE_RAD);
    if (moving) state.invalidate();
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
  // When this marker became the active one (clock seconds), or null.
  const activeSinceRef = useRef<number | null>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    // Gentle pulse on the active marker only, so "you are standing
    // here" is easy to spot at a glance without every hotspot
    // distractingly animating at once.
    //
    // It pulses for HOTSPOT_PULSE_SECONDS after you arrive, then rests
    // (§108). A pulse that never stops would keep the whole room
    // redrawing at 60fps for as long as you stand at a camera — the
    // most common way the 3D view is used — undoing demand rendering for
    // a two-pixel animation.
    if (!isActive) {
      activeSinceRef.current = null;
      meshRef.current.scale.set(1, 1, 1);
      return;
    }
    const now = state.clock.elapsedTime;
    activeSinceRef.current ??= now;
    const t = now - activeSinceRef.current;
    const pulse = t < HOTSPOT_PULSE_SECONDS ? 1 + Math.sin(t * 3) * 0.08 : 1;
    meshRef.current.scale.set(pulse, pulse, 1);
    if (t < HOTSPOT_PULSE_SECONDS) state.invalidate();
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
  // Hex tint on the finish (§120); null/undefined = its own colour.
  tint?: string | null;
  // Laid as tiles (§122): rescales a tile photo to the chosen tile size.
  tiling?: SurfaceTiling | null;
}

const PLASTER_COLOR = '#f5f3ef';

// Approximate colours for a glass-doored open-shelf front's tint
// options (types/front.ts's GlassTint) — a business browsing tint
// SAMPLES would recognise these, not a physically-measured spectral
// tint. Opacity is per-tint too: clear glass should read as mostly
// see-through (the whole point of it), while the coloured tints need
// enough opacity that the colour actually reads rather than washing
// out to grey.
const GLASS_TINT_COLORS: Record<GlassTint, string> = {
  clear: '#dce6ea',
  black: '#1c1c1e',
  brown: '#4a2f1f',
  yellow: '#8a6a10',
};
const GLASS_TINT_OPACITY: Record<GlassTint, number> = {
  clear: 0.25,
  black: 0.65,
  brown: 0.55,
  yellow: 0.5,
};

function FinishedSurface({
  finishId,
  widthM,
  heightM,
  children,
  position,
  rotation,
  side,
  tint,
  tiling,
}: FinishedSurfaceProps) {
  const finishes = useLayoutStore((state) => state.finishes);
  const resolved = finishId ? resolveFinish(finishes, finishId) : undefined;
  // A tile photo laid at another tile size is the same photo, rescaled
  // (§122); a seamless finish is unchanged (its grout is drawn on top).
  const finish = resolved ? finishForTiling(resolved, tiling) : undefined;
  // A surface's tint (§120): a paint shade, or a photo stained another tone.
  const material = resolveMaterial(finish, tint ?? undefined);
  const textures = useFinishTextures(finish, widthM, heightM);

  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      {children}
      <meshStandardMaterial
        // New material when the set of maps changes (§121, textureSetKey).
        key={textureSetKey(textures)}
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
  // Wall view: draw only this wall (§84).
  only?: WallOrientation;
}

// Geometry still comes from the room's dimensions (which are always
// correct) while the FINISH comes from layout.walls, matched by
// orientation. Keeping those separate means a layout whose walls array
// is missing or stale still renders a correct room — it just renders it
// in plaster.
function RoomWalls({ widthM, depthM, heightM, only }: RoomWallsProps) {
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
  const allFinishes = useLayoutStore((state) => state.finishes);
  const wallFinishes = new Map(
    walls.map((w) => [w.orientation, w.finishId ? resolveFinish(allFinishes, w.finishId) : undefined] as const)
  );
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
      {(['north', 'south', 'west', 'east'] as WallOrientation[]).filter((o) => !only || o === only).map((orientation) => {
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

              // Drawn grout for a seamless finish laid as tiles (§122), on
              // the wall's inside face, carried on from the corner.
              const groutOn = tilingMode(wallFinishes.get(orientation), wall?.tiling).kind === 'overlay';
              const inside = WALL_THICKNESS_M / 2 + 0.001;
              const facePos: [number, number, number] =
                orientation === 'north'
                  ? [position[0], position[1], inside]
                  : orientation === 'south'
                    ? [position[0], position[1], depthM - inside]
                    : orientation === 'west'
                      ? [inside, position[1], position[2]]
                      : [widthM - inside, position[1], position[2]];
              const faceRot: [number, number, number] =
                orientation === 'north' ? [0, 0, 0] : orientation === 'south' ? [0, Math.PI, 0] : orientation === 'west' ? [0, Math.PI / 2, 0] : [0, -Math.PI / 2, 0];

              return (
                <Fragment key={`${orientation}-${i}`}>
                {groutOn && wall?.tiling && (
                  <GroutOverlay
                    tiling={wall.tiling}
                    widthMm={seg.widthMm}
                    heightMm={seg.heightMm}
                    startAlongMm={seg.alongMm}
                    startUpMm={seg.bottomMm}
                    reversed={orientation === 'south' || orientation === 'west'}
                    position={facePos}
                    rotation={faceRot}
                  />
                )}
                <FinishedSurface
                  finishId={wall?.finishId}
                  tint={wall?.colorOverride}
                  tiling={wall?.tiling}
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
                </Fragment>
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
        // The photo outside the window: not part of the room, so the
        // structure render (lib/viewSnapshot.ts) leaves it out and the
        // window reads as an opening.
        <mesh position={at(BACKDROP_DISTANCE_M)} rotation={faceRotation} userData={{ [HIDE_IN_STRUCTURE]: true }}>
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

  const floorFinish = useLayoutStore((s) => (floorFinishId ? resolveFinish(s.finishes, floorFinishId) : undefined));
  const floorTiling = currentLayout?.floorTiling;
  if (floorFinishId) {
    return (
      <>
      {floorTiling && tilingMode(floorFinish, floorTiling).kind === 'overlay' && (
        // Lined up from the north-west corner (§122): the plane's V runs
        // south to north, hence the start at minus the room's depth.
        <GroutOverlay
          tiling={floorTiling}
          widthMm={widthM * 1000}
          heightMm={depthM * 1000}
          startAlongMm={0}
          startUpMm={-depthM * 1000}
          reversed={false}
          position={[widthM / 2, 0.001, depthM / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )}
      <FinishedSurface
        finishId={floorFinishId}
        tint={currentLayout?.floorColorOverride}
        tiling={floorTiling}
        widthM={widthM}
        heightM={depthM}
        position={[widthM / 2, 0, depthM / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[widthM, depthM]} />
      </FinishedSurface>
      </>
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
  // Drawn even with no finish chosen (plain plaster, like the walls), §109.
  // It used to be skipped, so looking up in the walkthrough, and the top
  // half of every 360° photo, showed empty space (black in the photo).
  // Being single-sided, it still vanishes from the bird's-eye orbit view.
  const ceilingFinishId = currentLayout?.ceilingFinishId;

  return (
    <FinishedSurface
      finishId={ceilingFinishId}
      tint={currentLayout?.ceilingColorOverride}
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

  // With demand rendering (§108) the frame above only runs when one is
  // requested, and nothing in the scene graph changes when only the
  // slider moves, so ask for one.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [exposure, invalidate]);

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
function PlacedFixtures({ keep }: { keep?: (mount: FixtureMount) => boolean } = {}) {
  const currentLayout = useLayoutStore((state) => state.currentLayout);
  const cabinets = usePhysicalCabinets();
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

  const placements = resolveAllFixtures(currentLayout, cabinets, fixtureCatalog).filter((p) => !keep || keep(p.fixture.mount));
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

// Real-world size a placed fixture's GLB model is fitted to — see the
// comment where these are used in FixtureInScene for why this can't
// just reuse the primitive's own bodySize.
const FIXTURE_MODEL_FIT_WIDTH_MM = 260;
const FIXTURE_MODEL_FIT_HEIGHT_MM = 280;
const FIXTURE_MODEL_FIT_DEPTH_MM = 260;

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

  const primitiveBody = (
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
  );

  return (
    <group position={position}>
      {stemHeightM > 0 && (
        <mesh position={[0, stemHeightM / 2, 0]}>
          <cylinderGeometry args={[mmToWorld(6), mmToWorld(6), stemHeightM, 8]} />
          <meshStandardMaterial color="#3f3f46" roughness={0.6} metalness={0.3} />
        </mesh>
      )}

      {/* Real GLB body when the catalogue row has one (e.g. the
          industrial pendant), falling back to the primitive above
          when unset or on load failure — FixtureModel handles both
          cases itself. BODY ONLY: the glow/light below stays driven by
          item.lumens/colorTempK regardless of which body renders, per
          FixtureModel's own header comment on why a model must never
          carry its own light. Fitted to a fixed decorative size, NOT
          bodySize — bodySize is the primitive's generic thin disc/bar
          marker shared by every fixture kind, and fitting a real
          pendant shade into a 90x14x90mm box would squash it flat, the
          same "smear the shutter" failure ApplianceModel's header warns
          about for cabinets. Unverified in a browser: this fixed size
          is a plausible guess for an industrial pendant shade, not
          something I've been able to eyeball. */}
      <FixtureModel
        modelUrl={item.modelUrl}
        orientation={{
          xDeg: item.modelRotationXDeg ?? 0,
          yDeg: item.modelRotationYDeg ?? 0,
          zDeg: item.modelRotationZDeg ?? 0,
        }}
        widthMm={FIXTURE_MODEL_FIT_WIDTH_MM}
        heightMm={FIXTURE_MODEL_FIT_HEIGHT_MM}
        depthMm={FIXTURE_MODEL_FIT_DEPTH_MM}
        fallback={primitiveBody}
      />

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

// A tambour is a garage-style roll-up shutter, not a flat door — a
// single flat box in its place would just look like a plain false
// front with no handle, which reads as "the modeller forgot the
// handle" rather than "this is a different kind of front on purpose".
// Slats are the cheapest way to make that reading obvious without
// building a real curved-track mechanism nobody asked for: a handful
// of thin boxes stacked with a small reveal between them, same
// material as a flat panel would use, so the assigned finish still
// shows correctly.
const TAMBOUR_SLAT_HEIGHT_MM = 45;
const TAMBOUR_SLAT_GAP_MM = 3;

interface TambourSlat {
  centerYMm: number;
  heightMm: number;
}

function tambourSlats(panelHeightMm: number): TambourSlat[] {
  const slatCount = Math.max(
    4,
    Math.round(panelHeightMm / (TAMBOUR_SLAT_HEIGHT_MM + TAMBOUR_SLAT_GAP_MM))
  );
  const bandHeight = panelHeightMm / slatCount;
  const slatHeight = Math.max(1, bandHeight - TAMBOUR_SLAT_GAP_MM);
  const slats: TambourSlat[] = [];
  let cursorY = panelHeightMm / 2; // top edge, walking down
  for (let i = 0; i < slatCount; i++) {
    slats.push({ centerYMm: cursorY - bandHeight / 2, heightMm: slatHeight });
    cursorY -= bandHeight;
  }
  return slats;
}

// The carousel corner unit's diagonal cut, in the SAME proportion
// CabinetLayer.tsx's 2D plan uses (cornerCarouselPoints,
// CORNER_CAROUSEL_CUT_FRACTION) — the two must agree, or the plan and
// the walkthrough would show two different-looking cabinets for the
// same placed item.
const CORNER_CAROUSEL_CUT_FRACTION = 0.4;

// All the geometry a carousel corner band needs, computed once in the
// cabinet's own local frame (X = width axis, Z = depth axis, both
// centred on the cabinet — same convention every other mesh below
// uses). The cut corner is the local (+X, +Z) one, matching
// cornerCarouselPoints' local bottom-right convention in 2D (room x/y
// increasing maps to local +X/+Z here — see groundPosition's comment
// in lib/scene3d.ts): rotationDeg spins the whole group, so this
// stays fixed regardless of which real corner the cabinet sits in.
interface CornerCarouselGeometry {
  // Carcass footprint, INSET along the diagonal edge by frontThicknessM
  // — same reason a normal closed band's box is shortened by
  // frontThicknessM: the door panel fills that gap, flush with the
  // carcass rather than floating in front of or sinking into it.
  carcassPoints: [number, number][]; // (x, z) pairs, five vertices
  // Diagonal door panel: centre (x, z), full length along the edge,
  // and the Y rotation that points its thickness axis along the
  // edge's outward normal.
  doorCenterX: number;
  doorCenterZ: number;
  doorLengthM: number;
  doorRotationY: number;
  // A representative handle position, near one end of the panel,
  // inset the same amount a normal door's handle is from its edge.
  handleX: number;
  handleZ: number;
}

function cornerCarouselGeometry(
  widthM: number,
  depthM: number,
  frontThicknessM: number
): CornerCarouselGeometry {
  const cutW = widthM * CORNER_CAROUSEL_CUT_FRACTION;
  const cutD = depthM * CORNER_CAROUSEL_CUT_FRACTION;
  const halfW = widthM / 2;
  const halfD = depthM / 2;

  // The five OUTER vertices, local (x, z), walking the same order
  // cornerCarouselPoints does: wall corner, along-width, cut start,
  // cut end, along-depth.
  const p1: [number, number] = [-halfW, -halfD];
  const p2: [number, number] = [halfW, -halfD];
  const p3: [number, number] = [halfW, halfD - cutD]; // cut edge start
  const p4: [number, number] = [halfW - cutW, halfD]; // cut edge end
  const p5: [number, number] = [-halfW, halfD];

  // Outward unit normal of the P3->P4 edge. Edge direction is
  // (p4x-p3x, p4z-p3z) = (-cutW, cutD); rotating that -90° gives
  // (cutD, cutW), which points away from the cabinet's interior
  // (toward larger x AND larger z) exactly when the cut is in the
  // +x/+z corner, as it always is in this local frame.
  const edgeLen = Math.hypot(cutW, cutD);
  const nx = cutD / edgeLen;
  const nz = cutW / edgeLen;

  // Carcass vertices: only the cut edge moves, pulled inward by the
  // front thickness along its own normal. The two neighbouring edges
  // (p2-p3, p4-p5) tilt by a fraction of a degree as a result, which
  // is invisible at real cabinet scale (frontThicknessM is ~18mm
  // against a ~900mm unit) — the same order of approximation a mitred
  // carcass corner already carries.
  const p3carcass: [number, number] = [p3[0] - nx * frontThicknessM, p3[1] - nz * frontThicknessM];
  const p4carcass: [number, number] = [p4[0] - nx * frontThicknessM, p4[1] - nz * frontThicknessM];

  const doorCenterX = (p3[0] + p4[0]) / 2 + (nx * frontThicknessM) / 2;
  const doorCenterZ = (p3[1] + p4[1]) / 2 + (nz * frontThicknessM) / 2;
  // atan2(nx, nz): the rotation that sends local +Z to the outward
  // normal (nx, nz) — see the comment on the door mesh's rotation
  // below for the derivation.
  const doorRotationY = Math.atan2(nx, nz);

  // Same inset a normal door's handle sits at (HANDLE_EDGE_INSET_MM in
  // lib/fronts.ts) — kept as its own literal here rather than imported,
  // since that constant is private to fronts.ts and this is a one-off
  // approximation, not a shared rule the two need to stay in sync on.
  const handleInsetM = mmToWorld(45);
  const t = Math.min(0.5, handleInsetM / edgeLen);
  return {
    carcassPoints: [p1, p2, p3carcass, p4carcass, p5],
    doorCenterX,
    doorCenterZ,
    doorLengthM: edgeLen,
    doorRotationY,
    handleX: p3[0] + (p4[0] - p3[0]) * t,
    handleZ: p3[1] + (p4[1] - p3[1]) * t,
  };
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
  // Only reached for the tambour-occupancy check below — every other
  // use of appliances in this file (sink cutouts, the render loop
  // itself) already has its own copy at the scene level.
  const appliances = useLayoutStore((state) => state.appliances);
  const frontLayout = item.frontLayout ?? defaultFrontLayout(item.moduleType, item.widthMm);
  const fronts = useMemo(
    () => cabinetFrontBreakdown(item, frontLayout, handle, rateCard.hardware),
    [item, frontLayout, handle, rateCard]
  );

  // A closed band's carcass is SHORTENED by the front thickness and
  // pushed back, so its panel occupies the front 18mm of the cabinet's
  // STATED depth rather than protruding past it. Two reasons that
  // matters: the depth is what the client is charged against and what
  // collision tests, so silently growing it would be a quote error;
  // and a panel sitting exactly on the carcass's own front face would
  // z-fight with it. An open band skips this — there's no panel to
  // clear, and the carcass there is thin walls, not a sealed slab.
  // The shutter's real thickness — this cabinet's fronts board (§65), so
  // a 25mm shutter draws as 25mm and the carcass behind it shortens to
  // match. 18mm only when no fronts board is set.
  const frontThicknessM = mmToWorld(frontThicknessMm(item, rateCard));
  // Front face of the finished cabinet, in the group's local frame.
  const faceZ = depthM / 2;

  // One band per row for a 'mixed' front, one band spanning the whole
  // cabinet otherwise — see carcassBands (lib/fronts.ts) for why this
  // needs its own reveal-free split rather than reusing the front
  // panels'.
  const bands = useMemo(
    () => carcassBands(frontLayout, item.heightMm),
    [frontLayout, item.heightMm]
  );

  // A tambour is a closed shutter by default — same sealed treatment
  // any other door gets — but "put an appliance in the garage and see
  // it" only means anything if the shutter gets out of the way once
  // something is actually placed behind it. Checked the same
  // footprint-center-inside way sinkRestsOnCabinet already does for a
  // sink, plus a genuine Z-RANGE overlap (not closeness to one plane
  // — a tambour compartment has real height, unlike a countertop's
  // single reference surface) against the specific band/panel's own
  // absolute height range, since a mixed front's tambour row might
  // not be the whole cabinet.
  const cabinetFootprint = useMemo(() => currentFootprintRect(item), [item]);
  function occupyingAppliance(centerYMm: number, heightMm: number) {
    const bandMidAbsMm = item.elevationMm + item.heightMm / 2 + centerYMm;
    const bandBottomMm = bandMidAbsMm - heightMm / 2;
    const bandTopMm = bandMidAbsMm + heightMm / 2;
    return appliances.find((a) => {
      const aFootprint = applianceFootprint(a);
      const centerX = aFootprint.x + aFootprint.widthMm / 2;
      const centerZ = aFootprint.y + aFootprint.depthMm / 2;
      const insideFootprint =
        centerX >= cabinetFootprint.x &&
        centerX <= cabinetFootprint.x + cabinetFootprint.widthMm &&
        centerZ >= cabinetFootprint.y &&
        centerZ <= cabinetFootprint.y + cabinetFootprint.depthMm;
      if (!insideFootprint) return false;
      return a.elevationMm < bandTopMm && a.elevationMm + a.heightMm > bandBottomMm;
    });
  }

  /* MeshPhysicalMaterial rather than MeshStandardMaterial so glossy
     finishes can carry a clearcoat layer — for matte finishes
     clearcoat is 0, which renders identically to MeshStandardMaterial,
     so one material type covers everything. resolveMaterial
     (materials3d.ts) already worked out whether `color` should be a
     real colour or plain white to leave a texture untinted, so nothing
     needs deciding here.
     A FUNCTION, not a stored element — three.js materials are objects,
     and JSX can't mount the same element in several places, so every
     closed band's mesh (there can be more than one now, for a mixed
     front) needs its own fresh instance. */
  function renderFinishMaterial() {
    return (
      <meshPhysicalMaterial
        // New material when the set of maps changes (§121, textureSetKey).
        key={textureSetKey(textures)}
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
  }

  // The inside of an open band — plain and fixed, not the exterior
  // finish. A real cabinet interior is a light, cheap laminate, not
  // whatever the outside is finished in; showing the exterior finish
  // (a dark wood grain, say) lining the inside of an open shelf was
  // exactly the "half-built" look CLAUDE.md flagged. Same simple
  // convention as PLASTER_COLOR elsewhere in this file for an
  // unfinished wall — a fixed rendering default, not a priced,
  // business-editable SurfaceFinish row. Also a function, same reason
  // as renderFinishMaterial: up to 5 panels per open band each need
  // their own material instance.
  function renderInteriorMaterial() {
    return <meshStandardMaterial color={PLASTER_COLOR} roughness={0.9} metalness={0} />;
  }

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
      {item.moduleType === 'corner-carousel' ? (
        // Diagonal carcass + a single diagonal door, per band (in
        // practice always one — a carousel realistically never gets a
        // mixed front). Every OTHER module type keeps the exact
        // rectangular path below untouched; this is the only place
        // that reads cornerCarouselGeometry. Interior geometry (the
        // actual rotating shelf) is deliberately not built yet — see
        // DECISIONS.md's "Three corner solutions" entry — so an open
        // band here still gets the same solid pentagon prism as a
        // closed one rather than a bespoke open-shell treatment nobody
        // can see the point of yet.
        <>
          {bands.map((band, bandIndex) => {
            const bandHeightM = mmToWorld(band.heightMm);
            const bandCenterYM = mmToWorld(band.centerYMm);
            const geo = cornerCarouselGeometry(widthM, depthM, frontThicknessM);
            const shape = new THREE.Shape(
              geo.carcassPoints.map(([x, z]) => new THREE.Vector2(x, -z))
            );

            return (
              <group key={bandIndex}>
                <mesh
                  position={[0, bandCenterYM - bandHeightM / 2, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                >
                  <extrudeGeometry
                    args={[shape, { depth: bandHeightM, bevelEnabled: false }]}
                  />
                  {renderFinishMaterial()}
                </mesh>
                <group
                  position={[geo.doorCenterX, bandCenterYM, geo.doorCenterZ]}
                  rotation={[0, geo.doorRotationY, 0]}
                >
                  <mesh castShadow receiveShadow>
                    <boxGeometry args={[geo.doorLengthM, bandHeightM, frontThicknessM]} />
                    <meshPhysicalMaterial
                      // New material when the set of maps changes (§121, textureSetKey).
                      key={textureSetKey(textures)}
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
                {/* A representative bar handle — the generic
                    HandleMesh assumes a flat face perpendicular to Z,
                    which doesn't hold for a diagonal panel, so this is
                    placed directly rather than through that shared
                    path. */}
                <mesh
                  position={[
                    // sin/cos of doorRotationY recover the same
                    // (nx, nz) outward normal cornerCarouselGeometry
                    // computed the rotation FROM — pushing the handle
                    // proud of the door's outer face, same idea as a
                    // knob's faceZ + radiusM offset elsewhere in this
                    // file.
                    geo.handleX + Math.sin(geo.doorRotationY) * (frontThicknessM / 2 + mmToWorld(20)),
                    bandCenterYM,
                    geo.handleZ + Math.cos(geo.doorRotationY) * (frontThicknessM / 2 + mmToWorld(20)),
                  ]}
                  rotation={[0, geo.doorRotationY, 0]}
                  castShadow
                >
                  <boxGeometry args={[mmToWorld(18), mmToWorld(120), mmToWorld(18)]} />
                  <meshStandardMaterial color="#c0c0c0" metalness={0.6} roughness={0.4} />
                </mesh>
              </group>
            );
          })}
        </>
      ) : (
        <>
          {bands.map((band, bandIndex) => {
            const bandHeightM = mmToWorld(band.heightMm);
            const bandCenterYM = mmToWorld(band.centerYMm);

            // A tambour band with a matching appliance behind it opens
            // up exactly like open-shelf/appliance-housing already do
            // — there's no shutter panel left to clear (skipped below,
            // in the panels loop), so the same full-depth thin-wall
            // treatment applies unchanged.
            const isOccupiedTambour =
              band.kind === 'tambour' && occupyingAppliance(band.centerYMm, band.heightMm) !== undefined;

            if (!band.open && !isOccupiedTambour) {
              return (
                <mesh
                  key={bandIndex}
                  position={[0, bandCenterYM, -frontThicknessM / 2]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[widthM, bandHeightM, depthM - frontThicknessM]} />
                  {renderFinishMaterial()}
                </mesh>
              );
            }

            // An open band: a real opening, built as 5 thin panels (both
            // sides, top, bottom, back) rather than a sealed box — the fix
            // for open-shelf/appliance-housing previously rendering inside
            // a fully closed carcass with nothing to actually see into.
            // Full depthM throughout (no front-thickness shortening —
            // there's no panel here to clear), walls the same thickness as
            // a front panel (wallM, reusing FRONT_THICKNESS_MM as a
            // reasonable carcass board thickness too). Slight overlap at
            // the corners between side/top/bottom panels is invisible
            // (opaque boxes meeting at a corner), so nothing here miters
            // them.
            const wallM = frontThicknessM;
            return (
              <group key={bandIndex}>
                <mesh position={[-widthM / 2 + wallM / 2, bandCenterYM, 0]} castShadow receiveShadow>
                  <boxGeometry args={[wallM, bandHeightM, depthM]} />
                  {renderInteriorMaterial()}
                </mesh>
                <mesh position={[widthM / 2 - wallM / 2, bandCenterYM, 0]} castShadow receiveShadow>
                  <boxGeometry args={[wallM, bandHeightM, depthM]} />
                  {renderInteriorMaterial()}
                </mesh>
                <mesh
                  position={[0, bandCenterYM + bandHeightM / 2 - wallM / 2, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[widthM, wallM, depthM]} />
                  {renderInteriorMaterial()}
                </mesh>
                <mesh
                  position={[0, bandCenterYM - bandHeightM / 2 + wallM / 2, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[widthM, wallM, depthM]} />
                  {renderInteriorMaterial()}
                </mesh>
                <mesh position={[0, bandCenterYM, -depthM / 2 + wallM / 2]} castShadow receiveShadow>
                  <boxGeometry args={[widthM, bandHeightM, wallM]} />
                  {renderInteriorMaterial()}
                </mesh>
              </group>
            );
          })}

          {/* Panels get their own material element rather than sharing one
              instance: three.js materials are objects, and JSX can't mount
              the same element in several places. They read from the same
              resolved values, so they stay identical by construction. */}
          {fronts.panels.map((panel) => {
            // A tambour with an appliance sitting behind it, per
            // occupyingAppliance above — skip the shutter entirely
            // (matches the carcass band opening up in the loop above)
            // rather than drawing slats in front of the very thing
            // this feature exists to let a business see.
            if (
              panel.kind === 'tambour' &&
              occupyingAppliance(panel.centerYMm, panel.heightMm) !== undefined
            ) {
              return null;
            }
            return panel.kind === 'tambour' ? (
              // Ridged shutter: a stack of thin slats instead of one flat
              // box, each getting its OWN material element for the same
              // reason every other panel does — see the comment above this
              // block.
              <group
                key={panel.index}
                position={[
                  mmToWorld(panel.centerXMm),
                  mmToWorld(panel.centerYMm),
                  faceZ - frontThicknessM / 2,
                ]}
              >
                {tambourSlats(panel.heightMm).map((slat, slatIndex) => (
                  <mesh
                    key={slatIndex}
                    position={[0, mmToWorld(slat.centerYMm), 0]}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry
                      args={[mmToWorld(panel.widthMm), mmToWorld(slat.heightMm), frontThicknessM]}
                    />
                    <meshPhysicalMaterial
                      // New material when the set of maps changes (§121, textureSetKey).
                      key={textureSetKey(textures)}
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
                ))}
              </group>
            ) : panel.glassTint ? (
              // A glass door over open shelves — transparent/tinted
              // rather than the cabinet's own finish, so the shelves
              // (and whatever's on them) stay visible through it. See
              // GLASS_TINT_COLORS/GLASS_TINT_OPACITY above.
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
                    color={GLASS_TINT_COLORS[panel.glassTint]}
                    transparent
                    opacity={GLASS_TINT_OPACITY[panel.glassTint]}
                    roughness={0.05}
                    metalness={0}
                    clearcoat={1}
                    clearcoatRoughness={0.05}
                  />
                </mesh>
              </group>
            ) : (
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
                    // New material when the set of maps changes (§121, textureSetKey).
                    key={textureSetKey(textures)}
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
            );
          })}

          {/* Handles are positioned relative to the FINISHED face, not the
              panel, so they project out of the cabinet rather than being
              buried in the shutter. */}
          {fronts.panels.map((panel) =>
            panel.handle ? (
              <HandleMesh key={`handle-${panel.index}`} placement={panel.handle} faceZ={faceZ} />
            ) : null
          )}

          {/* Open-shelf units only. Boards sit centred in the FULL depth —
              an open band's carcass is thin walls now, not a shortened
              slab, so there's no front-thickness offset to match. Slightly
              inset from full depth (0.92) so a board doesn't poke through
              the front/back wall panels. Interior liner material, same as
              the walls around it — a shelf board is part of the interior,
              not the exterior finish. */}
          {fronts.shelves.map((shelf, i) => (
            <mesh
              key={`shelf-${i}`}
              position={[mmToWorld(shelf.centerXMm), mmToWorld(shelf.centerYMm), 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[mmToWorld(shelf.widthMm), mmToWorld(shelf.heightMm), depthM * 0.92]} />
              {renderInteriorMaterial()}
            </mesh>
          ))}
        </>
      )}

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
        <mesh position={[0, 0, 0]} userData={{ [HIDE_IN_SNAPSHOT]: true }}>
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

// How close two edges have to be to count as "flush" when deciding
// whether a countertop's overhang would poke into a neighbour — a
// tolerance rather than requiring an exact match, since a dragged
// item's snapped position is rarely off by more than a rounding error
// (see the ObstacleLayer grid-snap note in ISSUES-FIXED.md, which is a
// much bigger gap than this covers).
const COUNTERTOP_NEIGHBOR_GAP_TOLERANCE_MM = 5;

function isFlush(a: number, b: number): boolean {
  return Math.abs(a - b) <= COUNTERTOP_NEIGHBOR_GAP_TOLERANCE_MM;
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && aMax > bMin;
}

// How far a countertop slab overhangs its own cabinet's footprint on
// each of the four sides, in mm. Normally COUNTERTOP_OVERHANG_MM
// everywhere (see cabinetGeometry.ts) — but suppressed on any side
// where another cabinet or obstacle is flush against that edge AND
// reaches higher than this cabinet's own carcass top (a tall unit, a
// wall-height pillar, anything the slab can't legitimately run over).
// Without this, that side's overhang draws straight through the
// neighbour's face rather than stopping at the seam — reported after
// the countertop finish work made the slab visually distinct enough
// from the cabinets for the overlap to actually show.
//
// A neighbour that's ITSELF a countertop-bearing base unit is
// deliberately not checked here: two adjacent worktops overhanging
// into each other at the same height is a continuous run, which is
// what a real slab is anyway.
function countertopOverhangs(
  item: PlacedCabinetItem,
  cabinets: PlacedCabinetItem[],
  obstacles: Obstacle[]
): { left: number; right: number; front: number; back: number } {
  const footprint = currentFootprintRect(item);
  const minX = footprint.x;
  const maxX = footprint.x + footprint.widthMm;
  const minY = footprint.y;
  const maxY = footprint.y + footprint.depthMm;
  // The overhang itself is a thin slab from counterTopMm up to
  // counterTopMm + thickness — a neighbour only actually collides with
  // it if their vertical spans overlap. A wall cabinet mounted well
  // above the counter (the normal case) has a bottom face far above
  // this range and should NOT suppress the overhang beneath it; a tall
  // unit or a floor-to-ceiling obstacle spans right through it and
  // should.
  const counterTopMm = item.elevationMm + item.heightMm;
  const overhangTopMm = counterTopMm + COUNTERTOP_THICKNESS_MM;

  const tallNeighbourFootprints = [
    ...cabinets
      .filter(
        (c) =>
          c.id !== item.id &&
          c.elevationMm < overhangTopMm &&
          c.elevationMm + c.heightMm > counterTopMm
      )
      .map((c) => currentFootprintRect(c)),
    ...obstacles
      .filter((o) => {
        const bottomMm = o.floorToCeiling ? 0 : o.elevationMm;
        const topMm = o.floorToCeiling ? Number.POSITIVE_INFINITY : o.elevationMm + o.heightMm;
        return bottomMm < overhangTopMm && topMm > counterTopMm;
      })
      .map((o) => currentFootprintRect(o)),
  ];

  let left = COUNTERTOP_OVERHANG_MM;
  let right = COUNTERTOP_OVERHANG_MM;
  let front = COUNTERTOP_OVERHANG_MM;
  let back = COUNTERTOP_OVERHANG_MM;

  for (const n of tallNeighbourFootprints) {
    const nMinX = n.x;
    const nMaxX = n.x + n.widthMm;
    const nMinY = n.y;
    const nMaxY = n.y + n.depthMm;

    if (isFlush(nMaxX, minX) && rangesOverlap(nMinY, nMaxY, minY, maxY)) left = 0;
    if (isFlush(nMinX, maxX) && rangesOverlap(nMinY, nMaxY, minY, maxY)) right = 0;
    if (isFlush(nMaxY, minY) && rangesOverlap(nMinX, nMaxX, minX, maxX)) front = 0;
    if (isFlush(nMinY, maxY) && rangesOverlap(nMinX, nMaxX, minX, maxX)) back = 0;
  }

  return { left, right, front, back };
}

type MmRect = { minX: number; maxX: number; minY: number; maxY: number };

// How close a sink's own elevationMm has to be to a cabinet's top face
// to count as "resting on this counter" — generous enough to absorb
// ordinary rounding, tight enough to exclude anything actually mounted
// elsewhere (a wall-height placement is hundreds of mm off, not tens).
const SINK_COUNTER_ELEVATION_TOLERANCE_MM = 100;

// Used by sinkCutoutRectMm below to decide whether a placed sink
// belongs to a given cabinet's countertop: X/Y footprint-center
// overlap AND elevationMm close to that cabinet's own top — not X/Y
// alone, since a sink placed at some unrelated height could still
// share X/Y with a base cabinet underneath it (the same reason
// collision.ts is Z-aware).
function sinkRestsOnCabinet(
  sink: PlacedApplianceItem,
  cabinetFootprint: FootprintRect,
  counterTopMm: number
): boolean {
  if (Math.abs(sink.elevationMm - counterTopMm) > SINK_COUNTER_ELEVATION_TOLERANCE_MM) {
    return false;
  }
  const sinkFootprint = applianceFootprint(sink);
  const sinkCenterX = sinkFootprint.x + sinkFootprint.widthMm / 2;
  const sinkCenterY = sinkFootprint.y + sinkFootprint.depthMm / 2;
  return (
    sinkCenterX >= cabinetFootprint.x &&
    sinkCenterX <= cabinetFootprint.x + cabinetFootprint.widthMm &&
    sinkCenterY >= cabinetFootprint.y &&
    sinkCenterY <= cabinetFootprint.y + cabinetFootprint.depthMm
  );
}

// The hole to cut in THIS cabinet's slab, if a placed sink whose
// catalogue row has a configured cutout sits on it — see
// sinkRestsOnCabinet above for what "sits on it" means. The cutout's
// own width/depth get the same quarter-turn swap the sink's footprint
// does, so turning the sink turns its hole with it.
function sinkCutoutRectMm(
  cabinetFootprint: FootprintRect,
  counterTopMm: number,
  appliances: PlacedApplianceItem[],
  applianceCatalog: ApplianceCatalogItem[]
): MmRect | null {
  for (const appliance of appliances) {
    if (appliance.applianceType !== 'sink') continue;
    if (!sinkRestsOnCabinet(appliance, cabinetFootprint, counterTopMm)) continue;

    const sinkFootprint = applianceFootprint(appliance);
    const sinkCenterX = sinkFootprint.x + sinkFootprint.widthMm / 2;
    const sinkCenterY = sinkFootprint.y + sinkFootprint.depthMm / 2;

    const cutout = resolveSinkCutout(appliance, applianceCatalog);
    if (!cutout) continue;

    const isQuarterTurn = appliance.rotationDeg === 90 || appliance.rotationDeg === 270;
    const cutoutWidthMm = isQuarterTurn ? cutout.depthMm : cutout.widthMm;
    const cutoutDepthMm = isQuarterTurn ? cutout.widthMm : cutout.depthMm;

    return {
      minX: sinkCenterX - cutoutWidthMm / 2,
      maxX: sinkCenterX + cutoutWidthMm / 2,
      minY: sinkCenterY - cutoutDepthMm / 2,
      maxY: sinkCenterY + cutoutDepthMm / 2,
    };
  }

  return null;
}

// Splits the slab into up to 4 boxes framing the cutout — left,
// right, and the strips above/below the cutout between them — rather
// than one box with a boolean-subtracted hole. Plain box geometry,
// consistent with how every other mesh in this file is built, and
// avoids a CSG library this project doesn't otherwise need. Clamps the
// cutout to the slab first: a sink whose configured cutout is larger
// than the slab it sits on (bad catalogue data, or an oversized
// cutout near the slab's own edge) degrades to "no cutout" rather than
// producing an inverted or negative-size segment.
function countertopSegments(slab: MmRect, cutout: MmRect | null): MmRect[] {
  if (!cutout) return [slab];

  const cMinX = Math.min(Math.max(cutout.minX, slab.minX), slab.maxX);
  const cMaxX = Math.min(Math.max(cutout.maxX, slab.minX), slab.maxX);
  const cMinY = Math.min(Math.max(cutout.minY, slab.minY), slab.maxY);
  const cMaxY = Math.min(Math.max(cutout.maxY, slab.minY), slab.maxY);

  if (cMaxX <= cMinX || cMaxY <= cMinY) return [slab];

  const segments: MmRect[] = [];
  if (cMinX > slab.minX) segments.push({ minX: slab.minX, maxX: cMinX, minY: slab.minY, maxY: slab.maxY });
  if (cMaxX < slab.maxX) segments.push({ minX: cMaxX, maxX: slab.maxX, minY: slab.minY, maxY: slab.maxY });
  if (cMinY > slab.minY) segments.push({ minX: cMinX, maxX: cMaxX, minY: slab.minY, maxY: cMinY });
  if (cMaxY < slab.maxY) segments.push({ minX: cMinX, maxX: cMaxX, minY: cMaxY, maxY: slab.maxY });

  return segments;
}

// Which corner of a cabinet's room-space AABB its diagonal cut lands
// on, for a given rotationDeg — the countertop equivalent of
// cornerCarouselGeometry's local convention (Room3DCanvas's cabinet
// meshes work in the item's own rotated LOCAL frame; CountertopMesh
// builds everything directly in room/world space, via groundPosition,
// so it needs the cut corner's ROOM-space identity instead).
//
// Derived once, algebraically, rather than by trial: CabinetLayer's 2D
// plan cuts the LOCAL bottom-right corner and spins the whole shape by
// rotationDeg using Konva's clockwise convention. Applying that same
// clockwise rotation (x' = x cosθ - y sinθ, y' = x sinθ + y cosθ, which
// reads as visually clockwise because room Y already points "down")
// to the bottom-right corner (+h, +h) of a square centred at the
// origin gives: 0°→(+h,+h) itself, 90°→(-h,+h), 180°→(-h,-h),
// 270°→(+h,-h) — i.e. the cut corner cycles bottom-right, bottom-left,
// top-left, top-right as rotationDeg increases. signX/signY below say
// which side (max/min) of the room-space AABB that corner sits on.
function cornerCutSign(rotationDeg: number): { signX: 1 | -1; signY: 1 | -1 } {
  switch (rotationDeg) {
    case 0:
      return { signX: 1, signY: 1 };
    case 90:
      return { signX: -1, signY: 1 };
    case 180:
      return { signX: -1, signY: -1 };
    case 270:
    default:
      return { signX: 1, signY: -1 };
  }
}

// The countertop's own diagonal pentagon, in room-space mm — same
// CORNER_CAROUSEL_CUT_FRACTION as the carcass below it, applied to the
// ALREADY-overhung rect so the cut scales with the slab rather than
// leaving the carcass's proportion stranded inside a now-larger
// rectangle. Flush-neighbour overhang suppression (countertopOverhangs)
// still applies to the two STRAIGHT edges; the diagonal edge always
// gets the plain overhang, since a corner unit's diagonal face
// practically never sits flush against another tall cabinet the way
// its two wall-facing edges do.
function cornerCarouselSlabPointsMm(
  footprint: FootprintRect,
  rotationDeg: number,
  overhang: { left: number; right: number; front: number; back: number }
): { x: number; y: number }[] {
  const minX = footprint.x - overhang.left;
  const maxX = footprint.x + footprint.widthMm + overhang.right;
  const minY = footprint.y - overhang.front;
  const maxY = footprint.y + footprint.depthMm + overhang.back;

  const { signX, signY } = cornerCutSign(rotationDeg);
  const cutW = (maxX - minX) * CORNER_CAROUSEL_CUT_FRACTION;
  const cutD = (maxY - minY) * CORNER_CAROUSEL_CUT_FRACTION;

  const xCut = signX > 0 ? maxX : minX;
  const xOther = signX > 0 ? minX : maxX;
  const yCut = signY > 0 ? maxY : minY;
  const yOther = signY > 0 ? minY : maxY;

  return [
    { x: xOther, y: yOther },
    { x: xCut, y: yOther },
    { x: xCut, y: yCut - signY * cutD },
    { x: xCut - signX * cutW, y: yCut },
    { x: xOther, y: yCut },
  ];
}

// The worktop slab sitting on top of a base-height cabinet. Purely
// presentational — it isn't a PlacedCabinetItem, isn't selectable, and
// doesn't participate in collision detection, since it's derived
// geometry rather than something the user placed.
//
// Rendered from layout.countertopFinishId when the business has
// actually chosen one (RoomSurfacesPanel), through the SAME
// resolveMaterial/useFinishTextures pipeline CabinetMesh's shutters
// use, so a countertop finish looks and costs consistently with every
// other finish in the catalogue. Falls back to the built-in procedural
// quartz look — unchanged from before this was choosable — when no
// finish has been assigned yet, same "sensible default before anyone
// visits the surfaces panel" treatment RoomFloor gives an unset floor.
//
// Cut for a sink (sinkCutoutRectMm/countertopSegments above) when one
// sits on this cabinet and its catalogue row has cutout dimensions —
// see the LIMITATION note on ApplianceType in types/appliance.ts this
// replaces. Rendered as up to 4 boxes framing the hole rather than one
// box with a boolean-subtracted hole; see countertopSegments for why.
function CountertopMesh({
  item,
  cabinets,
  obstacles,
  appliances,
}: {
  item: PlacedCabinetItem;
  cabinets: PlacedCabinetItem[];
  obstacles: Obstacle[];
  appliances: PlacedApplianceItem[];
}) {
  // The slab's real room-space extent, ALREADY rotation-aware (footprint
  // is the rotated AABB) and already overhang-aware per side — so
  // unlike most meshes here, no further mesh `rotation` is applied
  // below; rotating an already-axis-aligned box would double-rotate it.
  const footprint = currentFootprintRect(item);
  const overhang = countertopOverhangs(item, cabinets, obstacles);
  const slab: MmRect = {
    minX: footprint.x - overhang.left,
    maxX: footprint.x + footprint.widthMm + overhang.right,
    minY: footprint.y - overhang.front,
    maxY: footprint.y + footprint.depthMm + overhang.back,
  };

  const applianceCatalog = useLayoutStore((s) => s.applianceCatalog);
  const cutout = sinkCutoutRectMm(
    footprint,
    item.elevationMm + item.heightMm,
    appliances,
    applianceCatalog
  );
  const segments = countertopSegments(slab, cutout);

  // Texture tiling is scaled off the FULL slab, not each segment — a
  // cut stone slab's veining still reads as one continuous piece, not
  // as separately-tiled fragments either side of the sink.
  const widthM = mmToWorld(slab.maxX - slab.minX);
  const depthM = mmToWorld(slab.maxY - slab.minY);
  const thicknessM = mmToWorld(COUNTERTOP_THICKNESS_MM);
  const cabinetTopM = mmToWorld(item.elevationMm + item.heightMm);
  const centerY = cabinetTopM + thicknessM / 2;

  const countertopFinishId = useLayoutStore((s) => s.currentLayout?.countertopFinishId);
  const finishes = useLayoutStore((s) => s.finishes);
  const chosenFinish = resolveFinish(finishes, countertopFinishId);
  // The slab's tint (§119), applied exactly as a cabinet's colour is.
  const countertopTint = useLayoutStore((s) => s.currentLayout?.countertopColorOverride ?? undefined);
  const material = resolveMaterial(chosenFinish, countertopTint);
  // Both called unconditionally, every render — hooks can't be
  // conditional — and only the one the JSX below actually needs gets
  // used. Scaled off the horizontal face, since that's the one anyone
  // actually looks at on a worktop.
  const finishTextures = useFinishTextures(chosenFinish, widthM, depthM);
  const proceduralTextures = useSurfaceTextures('quartz', widthM, depthM);

  // A closure, not a component: it reads already-resolved values from
  // above rather than calling its own hooks, so it's safe to call once
  // per segment. Each mesh needs its OWN material element regardless —
  // three.js materials are objects, and JSX can't mount the same one
  // in several places (same reason CabinetMesh's panels each get their
  // own <meshPhysicalMaterial>).
  function countertopMaterial() {
    return countertopFinishId ? (
      // A real catalogue finish — same material assembly CabinetMesh
      // uses for shutters, so a laminate or acrylic countertop looks
      // like the same product as the cabinet it sits on.
      <meshPhysicalMaterial
        // New material when the set of maps changes (§121, textureSetKey).
        key={`finish-${textureSetKey(finishTextures)}`}
        color={material.color}
        map={finishTextures?.map ?? null}
        normalMap={finishTextures?.normalMap ?? null}
        normalScale={[material.normalScale, material.normalScale]}
        roughnessMap={finishTextures?.roughnessMap ?? null}
        roughness={material.roughness}
        metalness={material.metalness}
        clearcoat={material.clearcoat}
        clearcoatRoughness={material.clearcoatRoughness}
      />
    ) : (
      /* Polished stone default: low roughness plus a light clearcoat,
         the same way materials3d.ts models glossy cabinet finishes. */
      <meshPhysicalMaterial
        // New material when the set of maps changes (§121, textureSetKey).
        key="procedural-quartz"
        map={proceduralTextures.map}
        normalMap={proceduralTextures.normalMap}
        roughnessMap={proceduralTextures.roughnessMap}
        // Same as the floor: 1 lets the quartz map's own low
        // roughness (~0.16-0.23, a polished slab) come through
        // unscaled.
        roughness={1}
        metalness={0.02}
        clearcoat={0.35}
        clearcoatRoughness={0.25}
      />
    );
  }

  // A rectangular slab over a diagonal-cut carousel carcass would
  // overhang past the cut corner into thin air — reported directly as
  // "the countertop is still rectangular and protruding." The pentagon
  // below matches CabinetMesh's carcass shape exactly (same
  // CORNER_CAROUSEL_CUT_FRACTION), just built in room-space mm instead
  // of the item's local frame, since CountertopMesh has no rotation
  // wrapper to do that for it. No sink-cutout handling here — a
  // carousel unit is never a sink cabinet in practice, and intersecting
  // a rectangular cutout with a pentagon isn't a problem worth solving
  // speculatively.
  if (item.moduleType === 'corner-carousel') {
    const points = cornerCarouselSlabPointsMm(footprint, item.rotationDeg, overhang);
    const shape = new THREE.Shape(
      points.map((p) => {
        const [x, z] = groundPosition(p.x, p.y);
        return new THREE.Vector2(x, -z);
      })
    );
    return (
      <mesh
        position={[0, centerY - thicknessM / 2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow
        receiveShadow
      >
        <extrudeGeometry args={[shape, { depth: thicknessM, bevelEnabled: false }]} />
        {countertopMaterial()}
      </mesh>
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        const [segWorldX, segWorldZ] = groundPosition(
          (seg.minX + seg.maxX) / 2,
          (seg.minY + seg.maxY) / 2
        );
        return (
          <mesh key={i} position={[segWorldX, centerY, segWorldZ]} castShadow receiveShadow>
            <boxGeometry
              args={[mmToWorld(seg.maxX - seg.minX), thicknessM, mmToWorld(seg.maxY - seg.minY)]}
            />
            {countertopMaterial()}
          </mesh>
        );
      })}
    </>
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
    <mesh
      position={[worldX, centerY, worldZ]}
      rotation={[0, clockwiseDegToThreeY(obstacle.rotationDeg), 0]}
      castShadow
      receiveShadow
    >
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
  fridge: '#e4e4e7',
  microwave: '#27272a',
  dishwasher: '#a1a1aa',
  'water-purifier': '#f4f4f5',
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

  // Real brushed-steel maps for the two appliance types where the box
  // fallback IS the product's visible material (a sink basin, a
  // chimney's steel body) rather than a stand-in for painted plastic.
  // Called unconditionally (hooks can't be conditional) but only
  // applied to the material below for sink/chimney — cheap for every
  // other type since useMetalHardwareTextures' useMemo just recomputes
  // on a box size that never gets read. Sized off the front face
  // (width x height); the same single repeat pair is reused on every
  // box face, same simplification useMetalHardwareTextures' own
  // "box-FALLBACK geometry" comment already accepts.
  const metalTextures = useMetalHardwareTextures(widthM, heightM);
  const isMetalHardware = item.applianceType === 'sink' || item.applianceType === 'chimney';

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
        map={isMetalHardware ? metalTextures.map : null}
        normalMap={isMetalHardware ? metalTextures.normalMap : null}
        roughnessMap={isMetalHardware ? metalTextures.roughnessMap : null}
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

// ---- 3D wall view (§82, §84) ----


// Faces `wall` square-on from in front of it, pulled back so the whole
// wall fits the 16:9 frame with a small margin. A narrow 28° lens keeps
// it close to a flat elevation while the shading still reads as 3D. The
// other walls aren't drawn (§84), so nothing stands in the way. Orbit and
// zoom still work, around the wall's centre. Room x/y → world x/z:
// north is the z = 0 wall, south z = depth, west x = 0, east x = width.
function WallViewCamera({
  wall,
  widthM,
  depthM,
  heightM,
}: {
  wall: WallOrientation;
  widthM: number;
  depthM: number;
  heightM: number;
}) {
  // §92: 20° (was 28°) — closer to a true elevation, so units standing
  // 600mm proud of the wall don't loom over the frame edges — and a
  // wider margin, since those units sit nearer the camera than the wall
  // the fit is measured on (the top was being cut off).
  const fovDeg = 20;
  const { width: frameW, height: frameH } = useThree((state) => state.size);
  const aspect = frameH > 0 ? frameW / frameH : 16 / 9;
  const halfV = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const along = wall === 'north' || wall === 'south' ? widthM : depthM;
  const dist = Math.max(heightM / (2 * halfV), along / (2 * halfV * aspect)) * 1.22 + 0.6;
  const y = heightM / 2;
  const target: [number, number, number] =
    wall === 'north' ? [widthM / 2, y, 0] : wall === 'south' ? [widthM / 2, y, depthM] : wall === 'west' ? [0, y, depthM / 2] : [widthM, y, depthM / 2];
  const position: [number, number, number] =
    wall === 'north'
      ? [widthM / 2, y, dist]
      : wall === 'south'
        ? [widthM / 2, y, depthM - dist]
        : wall === 'west'
          ? [dist, y, depthM / 2]
          : [widthM - dist, y, depthM / 2];
  const [keyTarget] = useState(() => new THREE.Object3D());
  // Up and to the viewer's left of the wall's centre, 2.5m out from it.
  const left = along * 0.35 + 0.8;
  const keyPosition: [number, number, number] =
    wall === 'north'
      ? [widthM / 2 - left, heightM * 1.5, 2.5]
      : wall === 'south'
        ? [widthM / 2 + left, heightM * 1.5, depthM - 2.5]
        : wall === 'west'
          ? [2.5, heightM * 1.5, depthM / 2 + left]
          : [widthM - 2.5, heightM * 1.5, depthM / 2 - left];
  return (
    <>
      <PerspectiveCamera makeDefault fov={fovDeg} position={position} />
      {/* A key light from high on the viewer's left, casting the units'
          shadows onto the wall (§92). A flat light from the camera was
          tried first and washed white fronts out against a pale wall;
          the shadow is what gives the view depth. Aimed at the wall's
          centre through its own target object (a light's target only
          moves if it's in the scene). */}
      <primitive object={keyTarget} position={target} />
      <directionalLight
        target={keyTarget}
        position={keyPosition}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-far={20}
        shadow-bias={-0.0004}
      />
      <OrbitControls target={target} maxPolarAngle={Math.PI * 0.62} minDistance={0.5} maxDistance={dist * 2.5} />
    </>
  );
}

// Straight down on the room, north at the top (the 2D plan's way up).
// Orthographic, so it reads as a plan with shading rather than a
// perspective that shrinks the floor. camera.up is −Z: looking down the
// Y axis, the default up (+Y) is parallel to the view and undefined.
// Pan and zoom work; rotating is off so north stays up.
function TopViewCamera({ widthM, depthM, heightM }: { widthM: number; depthM: number; heightM: number }) {
  const { width: frameW, height: frameH } = useThree((state) => state.size);
  const margin = 1.15;
  const zoom = Math.max(1, Math.min(frameW / ((widthM + 0.2) * margin), frameH / ((depthM + 0.2) * margin)));
  const center: [number, number, number] = [widthM / 2, 0, depthM / 2];
  return (
    <>
      <OrthographicCamera makeDefault position={[widthM / 2, heightM + 5, depthM / 2]} up={[0, 0, -1]} zoom={zoom} near={0.1} far={heightM + 20} />
      <directionalLight position={[widthM / 2 - 1.5, heightM * 2, depthM / 2 + 1]} intensity={0.6} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <OrbitControls target={center} enableRotate={false} />
    </>
  );
}

// A corner piece that belongs to the neighbouring wall, in the wall view
// (§84, §92). Only the part within GHOST_BAND_MM of the chosen wall is
// drawn: that's the corner it actually occupies as seen from in front.
// §84 drew the whole piece as a translucent volume; running along the
// other wall towards the camera, it spilled over this wall's own units
// in perspective. Opaque matte grey now, so it reads as "something is
// here" without competing with the real finishes.
const GHOST_BAND_MM = 650;
function GhostBlock({
  item,
  wall,
  roomWidthMm,
  roomDepthMm,
}: {
  item: { x: number; y: number; widthMm: number; depthMm: number; heightMm: number; elevationMm: number; rotationDeg: 0 | 90 | 180 | 270 };
  wall: WallOrientation;
  roomWidthMm: number;
  roomDepthMm: number;
}) {
  const r = currentFootprintRect(item);
  let x0 = r.x;
  let x1 = r.x + r.widthMm;
  let y0 = r.y;
  let y1 = r.y + r.depthMm;
  if (wall === 'north') y1 = Math.min(y1, GHOST_BAND_MM);
  if (wall === 'south') y0 = Math.max(y0, roomDepthMm - GHOST_BAND_MM);
  if (wall === 'west') x1 = Math.min(x1, GHOST_BAND_MM);
  if (wall === 'east') x0 = Math.max(x0, roomWidthMm - GHOST_BAND_MM);
  if (x1 <= x0 || y1 <= y0) return null;
  return (
    <mesh
      position={[mmToWorld((x0 + x1) / 2), mmToWorld(item.elevationMm + item.heightMm / 2), mmToWorld((y0 + y1) / 2)]}
      raycast={() => null}
    >
      <boxGeometry args={[mmToWorld(x1 - x0), mmToWorld(item.heightMm), mmToWorld(y1 - y0)]} />
      <meshStandardMaterial color="#d3cfc7" roughness={1} />
    </mesh>
  );
}
