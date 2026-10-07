// src/lib/viewSnapshot.ts
//
// What the 3D view hands the image pipeline (lib/renderBrief.ts,
// lib/leonardo.ts): the camera's pose, and STRUCTURE renders of what
// that camera sees — never the textured preview itself.
//
// WHY NOT THE PREVIEW (§97 → §101). A still of the 3D view was tried
// first and didn't help: an image model copies its flat preview
// materials, sky-blue background and cut-away walls, and comes back
// looking like a better CG render rather than a photo. What a
// structure-guided model (Leonardo's Edge/Depth to Image, a ControlNet)
// needs is geometry with no look of its own:
//
//   'line'   every surface plain white, every edge black — a hidden-line
//            drawing from the camera. Cabinet door and drawer seams,
//            handles and the countertop edge all survive as lines, which
//            is what stops a model inventing a third drawer.
//   'depth'  near = white, far = black, linear in distance across the
//            room — for pipelines that take a depth map directly.
//
// Rendered at an exact size (the image model's own, e.g. 1024 × 576) by
// resizing the renderer for one frame and putting it back; render →
// toDataURL stays synchronous so the WebGL buffer is still there to
// read. Materials are swapped per mesh (not scene.overrideMaterial, which
// would also turn the edge lines white) and restored in `finally`.
//
// Editor furniture (camera markers, hotspots, the selection outline:
// HIDE_IN_SNAPSHOT) and the photo behind a window (HIDE_IN_STRUCTURE) are
// hidden for the shot.

import * as THREE from 'three';

export const HIDE_IN_SNAPSHOT = 'hideInSnapshot';
export const HIDE_IN_STRUCTURE = 'hideInStructure';

// Edges sharper than this become lines. Every carcass and front is a box
// (90°), so 25° keeps them all while ignoring the facets of a curved
// appliance model.
const EDGE_THRESHOLD_DEG = 25;

export interface CameraPose {
  // World metres, Y-up (lib/scene3d.ts).
  position: [number, number, number];
  direction: [number, number, number];
  verticalFovDeg: number;
  widthPx: number;
  heightPx: number;
}

export function cameraPose(gl: THREE.WebGLRenderer, camera: THREE.Camera): CameraPose {
  const p = camera.getWorldPosition(new THREE.Vector3());
  const d = camera.getWorldDirection(new THREE.Vector3());
  const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
  return {
    position: [p.x, p.y, p.z],
    direction: [d.x, d.y, d.z],
    verticalFovDeg: fov,
    widthPx: gl.domElement.width,
    heightPx: gl.domElement.height,
  };
}

export type StructureKind = 'line' | 'depth';

export interface StructureOptions {
  widthPx: number;
  heightPx: number;
  // Depth only: distances (m) mapped to white and black. The caller
  // knows the room, so it sets `far` to the farthest corner.
  nearM?: number;
  farM?: number;
}

const DEPTH_VERTEX = /* glsl */ `
  varying vec3 vViewPos;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
// Written raw: a ShaderMaterial gets no tone mapping or colour-space
// conversion unless its shader includes those chunks, so the grey level
// IS the distance.
const DEPTH_FRAGMENT = /* glsl */ `
  uniform float uNear;
  uniform float uFar;
  varying vec3 vViewPos;
  void main() {
    float v = 1.0 - clamp((length(vViewPos) - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(vec3(v), 1.0);
  }
`;

export function renderStructure(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  kind: StructureKind,
  opts: StructureOptions
): string {
  const restores: (() => void)[] = [];
  const disposables: { dispose(): void }[] = [];
  try {
    // Hide editor furniture and window backdrops.
    scene.traverse((o) => {
      if ((o.userData[HIDE_IN_SNAPSHOT] || o.userData[HIDE_IN_STRUCTURE]) && o.visible) {
        o.visible = false;
        restores.push(() => (o.visible = true));
      }
    });

    // One material per face side, so single-sided walls stay single-sided
    // (they're drawn to be seen from inside).
    const bySide = new Map<THREE.Side, THREE.Material>();
    const surfaceFor = (side: THREE.Side) => {
      let m = bySide.get(side);
      if (!m) {
        m =
          kind === 'line'
            ? new THREE.MeshBasicMaterial({
                color: 0xffffff,
                side,
                toneMapped: false,
                // Pushed back a touch so the edge lines on a surface win
                // the depth test instead of flickering into it.
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1,
              })
            : new THREE.ShaderMaterial({
                vertexShader: DEPTH_VERTEX,
                fragmentShader: DEPTH_FRAGMENT,
                uniforms: { uNear: { value: opts.nearM ?? 0.2 }, uFar: { value: opts.farM ?? 8 } },
                side,
              });
        bySide.set(side, m);
        disposables.push(m);
      }
      return m;
    };
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000, toneMapped: false });
    disposables.push(lineMaterial);

    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      // Existing lines and points (outlines, sprites) aren't geometry.
      else if (((o as THREE.Line).isLine || (o as THREE.Points).isPoints) && o.visible) {
        o.visible = false;
        restores.push(() => (o.visible = true));
      }
    });
    for (const mesh of meshes) {
      const original = mesh.material;
      const side = Array.isArray(original) ? original[0]?.side ?? THREE.FrontSide : original.side;
      // An invisible material (a hit box, the selection outline's carrier)
      // stays invisible.
      const visible = Array.isArray(original) ? original.some((m) => m.visible) : original.visible;
      if (!visible) continue;
      mesh.material = surfaceFor(side);
      restores.push(() => (mesh.material = original));
      if (kind === 'line' && mesh.geometry) {
        const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG);
        const lines = new THREE.LineSegments(edges, lineMaterial);
        mesh.add(lines);
        disposables.push(edges);
        restores.push(() => mesh.remove(lines));
      }
    }

    const previousBackground = scene.background;
    scene.background = new THREE.Color(kind === 'line' ? 0xffffff : 0x000000);
    restores.push(() => (scene.background = previousBackground));

    // The exact output size, for this one frame.
    const size = gl.getSize(new THREE.Vector2());
    const ratio = gl.getPixelRatio();
    gl.setPixelRatio(1);
    gl.setSize(opts.widthPx, opts.heightPx, false);
    restores.push(() => {
      gl.setPixelRatio(ratio);
      gl.setSize(size.x, size.y, false);
    });
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    if (perspective) {
      const aspect = perspective.aspect;
      perspective.aspect = opts.widthPx / opts.heightPx;
      perspective.updateProjectionMatrix();
      restores.push(() => {
        perspective.aspect = aspect;
        perspective.updateProjectionMatrix();
      });
    }

    gl.render(scene, camera);
    return gl.domElement.toDataURL('image/png');
  } finally {
    for (const undo of restores.reverse()) undo();
    for (const d of disposables) d.dispose();
  }
}
