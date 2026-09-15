// src/lib/panoramaCapture.ts
//
// Step 2 of the walkthrough architecture: bakes a live three.js scene,
// viewed from one exact world position, into a flat 2:1 equirectangular
// JPEG — the format @photo-sphere-viewer/core (PanoramaViewerModal.tsx)
// expects. Three.js has no built-in cube-map -> equirectangular
// exporter, so this does it in two GPU passes:
//
//   1. A THREE.CubeCamera parked at the capture position renders all 6
//      cube faces of the scene in one `.update()` call.
//   2. A fullscreen-quad shader pass reprojects that cube map onto a
//      flat equirectangular render target — for every output pixel,
//      the fragment shader converts its UV into a spherical direction
//      and samples the cube map along it.
//
// The result is read back via readRenderTargetPixels into a 2D canvas
// and exported as a JPEG blob.
//
// ---------------------------------------------------------------
// WHY ORIENTATION/EXPOSURE ARE RUNTIME OPTIONS RATHER THAN CONSTANTS
//
// The cube-map -> equirect mapping has three conventions that all
// differ between three.js versions, GPU drivers, and whether you count
// a cube map as "viewed from inside" or "from outside":
//   - horizontal handedness (mirrored or not),
//   - vertical direction (upside-down or not),
//   - and how far along the encode chain the renderer already took the
//     colors before we read them back.
// Getting any one wrong is invisible from the code and only shows up in
// the finished image. Hardcoding a guess means one blind round-trip per
// wrong guess, so instead every one of them is a uniform driven by
// CapturePanoramaOptions, surfaced in Room3DCanvas's "Capture settings"
// panel. Dial them in once against a real capture, then set the values
// you landed on as the defaults below and the panel becomes optional.
//
// IMPORTANT when testing changes here: the same panorama URL is reused
// per camera node, so a stale browser/CDN cache will happily show you
// the PREVIOUS capture and make a correct fix look like it did nothing
// — see the cache-busting note in lib/panoramaStorage.ts.
// ---------------------------------------------------------------
//
// No React/Supabase knowledge here on purpose — purely a three.js
// utility function, callable from anywhere a renderer+scene are
// available (see PanoramaCaptureBridge in Room3DCanvas.tsx for how the
// UI reaches it). Uploading the result belongs to lib/panoramaStorage.ts.

import * as THREE from 'three';

// Bumped up from the initial 1024/2048 defaults — those looked visibly
// soft next to the live 3D view. Makes sense: the live view only fills
// a ~65deg FOV at screen resolution, while this one image covers the
// FULL 360x180deg sphere, so its pixels-per-degree is far lower at the
// same nominal resolution. 4096x2048 matches typical real-estate
// virtual-tour panorama resolution.
export const DEFAULT_CUBE_FACE_SIZE = 2048;
export const DEFAULT_EQUIRECT_WIDTH = 4096; // height = width / 2
export const PANORAMA_JPEG_QUALITY = 0.9;

export interface CapturePanoramaOptions {
  cubeFaceSize?: number;
  equirectWidth?: number;
  jpegQuality?: number;
  // Mirror the panorama left-to-right. Cube maps are sampled with the
  // opposite handedness from the "standing at the center looking out"
  // convention the longitude math below assumes, so this is normally
  // needed — but which way it lands depends on the three.js version.
  mirrorX?: boolean;
  // Flip the panorama vertically. Interacts with the bottom-up ->
  // top-down row flip during readback (see the loop near the end).
  flipY?: boolean;
  // Linear multiplier applied before sRGB encoding. 1.0 = untouched.
  // Raise if captures look darker than the live view, lower if they
  // look blown out.
  exposure?: number;
}

export const DEFAULT_CAPTURE_ORIENTATION = {
  mirrorX: true,
  flipY: false,
  exposure: 1.0,
};

const EQUIRECT_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// textureCube/samplerCube is WebGL1-style GLSL, which is what
// THREE.ShaderMaterial emits by default (glslVersion: THREE.GLSL1).
const EQUIRECT_FRAGMENT_SHADER = /* glsl */ `
  uniform samplerCube uCubeMap;
  uniform float uMirrorX;
  uniform float uFlipY;
  uniform float uExposure;
  varying vec2 vUv;
  #define PI 3.14159265359

  void main() {
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float lat = (vUv.y - 0.5) * PI;

    vec3 dir = vec3(
      cos(lat) * sin(lon),
      sin(lat),
      cos(lat) * cos(lon)
    );

    // uMirrorX / uFlipY are +1.0 or -1.0. Negating dir.x mirrors the
    // image horizontally; negating dir.y flips it vertically. Both are
    // driven from CapturePanoramaOptions so orientation can be fixed
    // without editing and redeploying this shader.
    dir.x *= uMirrorX;
    dir.y *= uFlipY;
    dir = normalize(dir);

    vec3 color = textureCube(uCubeMap, dir).rgb * uExposure;

    // Explicit linear -> sRGB encode. The cube render target is left in
    // three.js's DEFAULT (linear) color space on purpose: relying on
    // the render target's own colorSpace/encoding option is what makes
    // this fragile, since that option is named differently across
    // three.js versions (colorSpace vs the older encoding), is silently
    // ignored when unsupported, and — when it IS honored — can make the
    // GPU auto-linearize on sample so the value gets converted twice
    // and lands too dark. Doing the conversion here, by hand, on values
    // we know are linear, behaves identically on every three.js version.
    color = clamp(color, 0.0, 1.0);
    vec3 encoded = mix(
      color * 12.92,
      1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), color)
    );

    gl_FragColor = vec4(encoded, 1.0);
  }
`;

// Renders the scene from worldPosition in all directions and returns a
// JPEG Blob of the resulting equirectangular panorama. Caller owns the
// renderer/scene lifecycle — this only allocates and disposes its OWN
// temporary render targets/materials.
export async function capturePanorama(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  worldPosition: THREE.Vector3,
  options: CapturePanoramaOptions = {}
): Promise<Blob> {
  const cubeFaceSize = options.cubeFaceSize ?? DEFAULT_CUBE_FACE_SIZE;
  const equirectWidth = options.equirectWidth ?? DEFAULT_EQUIRECT_WIDTH;
  const equirectHeight = Math.round(equirectWidth / 2);
  const jpegQuality = options.jpegQuality ?? PANORAMA_JPEG_QUALITY;
  const mirrorX = options.mirrorX ?? DEFAULT_CAPTURE_ORIENTATION.mirrorX;
  const flipY = options.flipY ?? DEFAULT_CAPTURE_ORIENTATION.flipY;
  const exposure =
    typeof options.exposure === 'number' ? options.exposure : DEFAULT_CAPTURE_ORIENTATION.exposure;

  // --- Pass 1: scene -> cube map, from worldPosition ---
  // Left in the default LINEAR color space deliberately — the pass-2
  // shader does the sRGB encode explicitly. See its comment.
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(cubeFaceSize, {
    format: THREE.RGBAFormat,
    generateMipmaps: false,
  });
  const cubeCamera = new THREE.CubeCamera(0.05, 1000, cubeRenderTarget);
  cubeCamera.position.copy(worldPosition);
  cubeCamera.update(renderer, scene);

  // --- Pass 2: cube map -> flat equirectangular render target ---
  const equirectTarget = new THREE.WebGLRenderTarget(equirectWidth, equirectHeight, {
    format: THREE.RGBAFormat,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCubeMap: { value: cubeRenderTarget.texture },
      uMirrorX: { value: mirrorX ? -1.0 : 1.0 },
      uFlipY: { value: flipY ? -1.0 : 1.0 },
      uExposure: { value: exposure },
    },
    vertexShader: EQUIRECT_VERTEX_SHADER,
    fragmentShader: EQUIRECT_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeometry, material);
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // NDC-space orthographic camera — the quad's vertex shader already
  // outputs clip-space positions, so this only satisfies the API.
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const previousRenderTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(equirectTarget);
  renderer.render(quadScene, quadCamera);
  renderer.setRenderTarget(previousRenderTarget);

  // --- Read back, flip to top-down, export as JPEG ---
  const pixelBuffer = new Uint8Array(equirectWidth * equirectHeight * 4);
  renderer.readRenderTargetPixels(equirectTarget, 0, 0, equirectWidth, equirectHeight, pixelBuffer);

  const canvas = document.createElement('canvas');
  canvas.width = equirectWidth;
  canvas.height = equirectHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get a 2D canvas context to export the captured panorama.');
  }
  const imageData = ctx.createImageData(equirectWidth, equirectHeight);
  const rowBytes = equirectWidth * 4;
  // WebGL render targets are bottom-up (row 0 = bottom); canvas
  // ImageData is top-down — flip while copying.
  for (let y = 0; y < equirectHeight; y++) {
    const srcStart = (equirectHeight - 1 - y) * rowBytes;
    const destStart = y * rowBytes;
    imageData.data.set(pixelBuffer.subarray(srcStart, srcStart + rowBytes), destStart);
  }
  ctx.putImageData(imageData, 0, 0);

  cubeRenderTarget.dispose();
  equirectTarget.dispose();
  material.dispose();
  quadGeometry.dispose();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode the panorama as JPEG.'))),
      'image/jpeg',
      jpegQuality
    );
  });
}
