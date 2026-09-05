// src/lib/textures3d.ts
//
// PBR texture maps (albedo + normal + roughness) for the three surfaces
// that make the 3D preview read as a finished kitchen rather than a box
// diagram: wood grain (cabinet fronts), quartz (countertops), and floor
// tile. This is the pass materials3d.ts's "EXTENSION POINT" comment
// anticipated.
//
// WHY THESE ARE GENERATED, NOT LOADED (for now)
// There are no texture image files in this project yet — the plan per
// TEXTURE_CAPTURE_GUIDE.md is to photograph real material swatches. So
// every map here is generated procedurally into a <canvas> at runtime
// and wrapped in a THREE.CanvasTexture. That means the preview looks
// finished today with zero asset downloads and zero bytes shipped, and
// switching to real photos later is a one-line change per surface: fill
// in TEXTURE_FILE_SOURCES below and the loader path takes over, with
// every consumer (Room3DCanvas) untouched.
//
// Three details that are easy to get wrong and matter a lot here:
//
// 1. COLOR SPACE. The albedo map holds *colors* and must be tagged
//    SRGBColorSpace; the normal and roughness maps hold *data* (vectors
//    and scalars) and must stay linear. Tagging a data map as sRGB
//    silently bends its values through a gamma curve, which shows up as
//    weirdly flat lighting rather than an obvious error.
//
// 2. SEAMLESS TILING. These repeat across a whole floor, so the noise
//    below is periodic — the value-noise lattice wraps modulo a period
//    that doubles per octave, so the left edge matches the right edge
//    exactly. Non-periodic noise would put a visible seam grid on the
//    floor.
//
// 3. WORLD-SIZE SCALING. A texture is meaningless without a physical
//    size. Each surface declares how many metres of real space one tile
//    of its texture covers (SURFACE_WORLD_SIZE_M), and useSurfaceTextures
//    converts a mesh's real extent into a repeat count — so a 600mm
//    cabinet and a 3m floor show grain/tiles at the same physical scale
//    instead of the same count.

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { GENERATED_TEXTURE_FILES } from './textureManifest';

export type SurfaceKind = 'wood' | 'quartz' | 'tile';

export interface TextureSet {
  map: THREE.Texture; // albedo / base color
  // Null when a source supplies colour but no data maps — currently
  // uploaded swatches, which are a photo and nothing else. Passing null
  // through to the material is correct (three.js just doesn't use that
  // slot); substituting the albedo would be actively wrong, since a
  // colour image is not a valid normal vector field or roughness scalar.
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

// Disposes the GPU-side resource of a per-mesh TextureSet CLONE only.
//
// This is safe to call on the sets returned by useSurfaceTextures,
// useFinishTextures and useMetalHardwareTextures specifically because
// every map in those sets is produced by `.clone()` (see the "clones
// matter here" comment on useSurfaceTextures below): THREE.Texture.clone()
// makes a new Texture wrapper around the SAME shared `.image`/`source`
// object rather than copying pixels, and Texture.dispose() only frees
// that wrapper's own GPU upload (its WebGLTexture), not the shared
// source data — so disposing a clone never pulls the image out from
// under the cached original or any other mesh's clone of it. It must
// NEVER be called on the cached originals themselves (the ones stored
// in textureSetCache / urlTextureCache) — only on a set this hook
// itself received as "the previous render's clones."
function disposeTextureSetClone(set: TextureSet | null | undefined): void {
  if (!set) return;
  set.map?.dispose();
  set.normalMap?.dispose();
  set.roughnessMap?.dispose();
}

// Disposes the PREVIOUS per-mesh clone set whenever a hook produces a
// new one (finish switched, face resized, component unmounted).
//
// Without this, every recomputation of useMemo in useSurfaceTextures /
// useFinishTextures / useMetalHardwareTextures allocates a fresh set of
// GPU-uploaded clones and simply drops the reference to the old one —
// three.js has no automatic GC for abandoned Textures, so the old
// clone's WebGLTexture stays resident until the page reloads. Switching
// a cabinet's finish repeatedly (a normal thing to do while shopping
// finishes in the UI) would then grow WebGLRenderer.info.memory.textures
// without bound: N switches -> N clones uploaded, 0 disposed, steady
// climb. With this hook: exactly one "current" set is alive per mounted
// surface at a time, since the previous set is disposed synchronously
// (via the effect cleanup) before/as the next one takes over, so the
// live clone count is bounded by the number of currently-mounted
// surfaces rather than the number of switches that have ever happened.
//
// useMemo itself has no cleanup callback (only useEffect does), which is
// why this needs to be a separate effect keyed off the memoized value.
function useDisposeTextureSetOnChange(set: TextureSet | null): void {
  useEffect(() => {
    return () => disposeTextureSetClone(set);
  }, [set]);
}

export interface SurfaceFileSet {
  map: string;
  normalMap: string;
  roughnessMap: string;
}

// Where real texture files come from, when there are any.
//
// This is NOT hand-edited: scripts/fetch_textures.py downloads CC0 PBR
// maps into public/textures/<surface>/ and regenerates
// textureManifest.ts to point at them, so downloading a texture is all
// it takes to switch that surface over — no code change, no rebuild of
// this file. A surface with no downloaded files stays null and keeps
// using the procedural generator below, so the two can coexist
// indefinitely and surfaces can migrate one at a time.
//
// To override manually (e.g. your own photographed swatches from
// TEXTURE_CAPTURE_GUIDE.md rather than a downloaded asset), drop the
// three files into public/textures/<surface>/ as color.jpg /
// normal.jpg / roughness.jpg and run `python3
// scripts/fetch_textures.py sync` — it picks up whatever is on disk
// regardless of how it got there.
export const TEXTURE_FILE_SOURCES: Record<SurfaceKind, SurfaceFileSet | null> =
  GENERATED_TEXTURE_FILES;

// How many metres of real-world surface one repeat of each texture
// covers. Change these to rescale a pattern physically (e.g. bump tile
// to 1.8 for 900mm tiles instead of 600mm).
export const SURFACE_WORLD_SIZE_M: Record<SurfaceKind, number> = {
  wood: 1.0,
  quartz: 1.0,
  tile: 1.2, // texture holds a 2x2 grid, so this is 600mm tiles
};

// 512 is the sweet spot here: sharp enough that grain and grout hold up
// at arm's length in the walkthrough, small enough that generating all
// three surfaces stays well under a second on a mid-range laptop. Each
// surface is generated lazily on first use (see the cache below), so a
// session that never opens the 3D view pays nothing.
const TEXTURE_PIXELS = 512;

// Normal-map strength per surface — how pronounced the derived bumps
// are. Tile needs a lot (grout lines are real, deep grooves); quartz
// needs almost none (a polished slab is flat).
const NORMAL_STRENGTH: Record<SurfaceKind, number> = {
  wood: 22,
  quartz: 6,
  tile: 90,
};

// ---- Periodic value noise ----

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// `period` is the lattice wrap distance — this is what makes the result
// tile seamlessly (see note 2 in the header).
function valueNoise(x: number, y: number, seed: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const n00 = hash2(wrap(x0, period), wrap(y0, period), seed);
  const n10 = hash2(wrap(x0 + 1, period), wrap(y0, period), seed);
  const n01 = hash2(wrap(x0, period), wrap(y0 + 1, period), seed);
  const n11 = hash2(wrap(x0 + 1, period), wrap(y0 + 1, period), seed);

  return (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy;
}

function fbm(x: number, y: number, seed: number, basePeriod: number, octaves = 4): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Period scales with frequency so every octave wraps on the same
    // physical boundary — otherwise the higher octaves would seam.
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + i, basePeriod * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

// ---- Per-surface pixel shading ----

interface Sample {
  r: number; // 0-255
  g: number;
  b: number;
  roughness: number; // 0-1
  height: number; // 0-1, used to derive the normal map
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleWood(u: number, v: number): Sample {
  // Broad growth-ring bands running along U, warped by low-frequency
  // turbulence so they wander like real grain instead of reading as
  // stripes...
  const turbulence = fbm(u * 4, v * 4, 11, 4);
  const bands = Math.sin((v * 9 + turbulence * 2.6) * Math.PI * 2) * 0.5 + 0.5;
  // ...plus fine streaks stretched hard along the grain direction.
  const streaks = fbm(u * 6, v * 120, 23, 6, 3);

  const t = bands * 0.62 + streaks * 0.38;
  return {
    r: mix(196, 124, t),
    g: mix(154, 84, t),
    b: mix(103, 47, t),
    // Darker grain lines are slightly more open/porous, so rougher.
    roughness: 0.5 + t * 0.22,
    height: 1 - t,
  };
}

function sampleQuartz(u: number, v: number): Sample {
  // Engineered quartz is a near-uniform light slab: dense fine speckle,
  // very subtle large-scale veining, and a polished (low-roughness)
  // surface that's essentially flat.
  const speckle = fbm(u * 70, v * 70, 5, 70, 3);
  const vein = fbm(u * 2.2, v * 2.2, 91, 3, 4);
  const veinMask = smoothstep(Math.max(0, Math.min(1, (vein - 0.58) * 6)));

  const base = 236 + (speckle - 0.5) * 26;
  return {
    r: mix(base, 206, veinMask * 0.5),
    g: mix(base - 2, 204, veinMask * 0.5),
    b: mix(base - 6, 200, veinMask * 0.5),
    roughness: 0.16 + speckle * 0.07,
    height: speckle * 0.25,
  };
}

function sampleTile(u: number, v: number): Sample {
  const tilesPerSide = 2;
  const gu = u * tilesPerSide;
  const gv = v * tilesPerSide;
  const tileU = gu - Math.floor(gu);
  const tileV = gv - Math.floor(gv);

  const groutWidth = 0.022;
  const inGrout =
    tileU < groutWidth ||
    tileU > 1 - groutWidth ||
    tileV < groutWidth ||
    tileV > 1 - groutWidth;

  if (inGrout) {
    return { r: 152, g: 147, b: 139, roughness: 0.92, height: 0.45 };
  }

  // Per-tile tonal variation so a tiled floor doesn't read as one flat
  // sheet, plus gentle within-tile marbling.
  const tileSeed = hash2(Math.floor(gu), Math.floor(gv), 31);
  const marble = fbm(u * 9, v * 9, 47, 9, 4);
  const shade = (tileSeed - 0.5) * 14 + (marble - 0.5) * 18;

  return {
    r: 224 + shade,
    g: 220 + shade,
    b: 212 + shade,
    // Was 0.26 — glossy enough that the floor mirrored the environment
    // map, and what it mirrored was the stock apartment HDR, so a
    // stranger's hallway door appeared on the kitchen floor. Polished
    // vitrified tile really is that reflective, but a legible reflection
    // of the lighting environment reads as a rendering fault rather than
    // as polish. Matte-satin keeps the tile believable and keeps
    // attention on the cabinetry.
    roughness: 0.62 + marble * 0.12,
    height: 1,
  };
}

const SAMPLERS: Record<SurfaceKind, (u: number, v: number) => Sample> = {
  wood: sampleWood,
  quartz: sampleQuartz,
  tile: sampleTile,
};

// ---- Canvas / texture assembly ----

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get a 2D canvas context to generate textures.');
  }
  return { canvas, ctx };
}

// Converts a height field into a tangent-space normal map by taking the
// slope at each texel. Neighbour lookups wrap so the normal map tiles
// as seamlessly as the albedo it came from.
function normalMapFromHeight(
  height: Float32Array,
  size: number,
  strength: number
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size);
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[wrap(y, size) * size + wrap(x, size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;

      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;
      image.data[idx] = ((nx / length) * 0.5 + 0.5) * 255;
      image.data[idx + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      image.data[idx + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      image.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, isColorData: boolean): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // See note 1 in the header — albedo is color, the rest is data.
  texture.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  return texture;
}

function generateTextureSet(kind: SurfaceKind): TextureSet {
  const size = TEXTURE_PIXELS;
  const sampler = SAMPLERS[kind];

  const { canvas: albedoCanvas, ctx: albedoCtx } = createCanvas(size);
  const { canvas: roughCanvas, ctx: roughCtx } = createCanvas(size);
  const albedoImage = albedoCtx.createImageData(size, size);
  const roughImage = roughCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  // Single pass fills all three outputs — the noise is by far the
  // expensive part, so it's evaluated once per texel rather than once
  // per map.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sample = sampler(x / size, y / size);
      const idx = (y * size + x) * 4;

      albedoImage.data[idx] = sample.r;
      albedoImage.data[idx + 1] = sample.g;
      albedoImage.data[idx + 2] = sample.b;
      albedoImage.data[idx + 3] = 255;

      const roughByte = Math.max(0, Math.min(1, sample.roughness)) * 255;
      roughImage.data[idx] = roughByte;
      roughImage.data[idx + 1] = roughByte;
      roughImage.data[idx + 2] = roughByte;
      roughImage.data[idx + 3] = 255;

      height[y * size + x] = sample.height;
    }
  }

  albedoCtx.putImageData(albedoImage, 0, 0);
  roughCtx.putImageData(roughImage, 0, 0);

  return {
    map: toTexture(albedoCanvas, true),
    normalMap: toTexture(normalMapFromHeight(height, size, NORMAL_STRENGTH[kind]), false),
    roughnessMap: toTexture(roughCanvas, false),
  };
}

function loadTextureSet(files: SurfaceFileSet): TextureSet {
  // TextureLoader returns the Texture synchronously and fills in the
  // image when the request finishes, so callers don't need to handle a
  // loading state — the surface just pops in.
  const loader = new THREE.TextureLoader();
  const load = (url: string, isColorData: boolean) => {
    const texture = loader.load(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    return texture;
  };

  return {
    map: load(files.map, true),
    normalMap: load(files.normalMap, false),
    roughnessMap: load(files.roughnessMap, false),
  };
}

// Generated/loaded once per surface, then shared. Keyed lazily so a
// surface that never appears on screen is never built.
const textureSetCache = new Map<SurfaceKind, TextureSet>();

export function getSurfaceTextureSet(kind: SurfaceKind): TextureSet {
  const cached = textureSetCache.get(kind);
  if (cached) return cached;

  const files = TEXTURE_FILE_SOURCES[kind];
  const set = files ? loadTextureSet(files) : generateTextureSet(kind);
  textureSetCache.set(kind, set);
  return set;
}

// Returns a per-mesh view of a surface's textures, tiled to match that
// mesh's real-world size.
//
// Clones matter here: `repeat` lives on the Texture object, so meshes of
// different sizes sharing one Texture would fight over it and all end up
// with whichever set it last. Cloning gives each mesh its own repeat
// while three.js keeps sharing the underlying image `source`, so the
// pixels are still uploaded to the GPU exactly once no matter how many
// cabinets are on screen. The shared SOURCE (the cached original in
// textureSetCache/urlTextureCache) is deliberately never disposed —
// disposing it would pull the image out from under every other mesh's
// clone of it. The per-mesh CLONES themselves are a different matter:
// see disposeTextureSetClone/useDisposeTextureSetOnChange below, which
// this hook (and useFinishTextures/useMetalHardwareTextures) uses to
// free each clone's own GPU upload once it's replaced or the mesh
// unmounts.
export function useSurfaceTextures(
  kind: SurfaceKind,
  extentAlongUM: number,
  extentAlongVM: number
): TextureSet {
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());

  const textures = useMemo(() => {
    const base = getSurfaceTextureSet(kind);
    const worldSize = SURFACE_WORLD_SIZE_M[kind];
    const repeatU = Math.max(0.25, extentAlongUM / worldSize);
    const repeatV = Math.max(0.25, extentAlongVM / worldSize);

    const cloneTexture = (texture: THREE.Texture) => {
      const clone = texture.clone();
      clone.wrapS = THREE.RepeatWrapping;
      clone.wrapT = THREE.RepeatWrapping;
      clone.repeat.set(repeatU, repeatV);
      // Without anisotropy a tiled floor turns into a shimmering mess
      // at grazing angles — which is exactly the angle you view a floor
      // from while standing in the room at eye height.
      clone.anisotropy = maxAnisotropy;
      return clone;
    };
    // normalMap/roughnessMap are nullable on TextureSet (uploaded
    // swatches have no data maps), so cloning has to tolerate null even
    // though the procedural sets always populate all three.
    const cloneOptional = (texture: THREE.Texture | null) =>
      texture ? cloneTexture(texture) : null;

    return {
      map: cloneTexture(base.map),
      normalMap: cloneOptional(base.normalMap),
      roughnessMap: cloneOptional(base.roughnessMap),
    };
  }, [kind, extentAlongUM, extentAlongVM, maxAnisotropy]);

  // Disposes the PREVIOUS clone set (not the shared cached source — see
  // disposeTextureSetClone above) whenever this recomputes or unmounts.
  useDisposeTextureSetOnChange(textures);

  return textures;
}

// ---- Finish-driven textures ----

// Loaded once per URL and shared, same reasoning as the procedural
// cache above. Keyed by url + colour space because the same file could
// legitimately be used as both a colour map and a data map.
const urlTextureCache = new Map<string, THREE.Texture>();

function getUrlTexture(url: string, isColorData: boolean): THREE.Texture {
  const key = `${url}|${isColorData ? 'srgb' : 'linear'}`;
  const cached = urlTextureCache.get(key);
  if (cached) return cached;

  const texture = new THREE.TextureLoader().load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Same rule as note 1 in the header, and the most common way to get a
  // downloaded PBR set subtly wrong: the albedo is colour and must be
  // sRGB, while normal and roughness are data and must stay linear.
  texture.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  urlTextureCache.set(key, texture);
  return texture;
}

// ---- Relief derived from an uploaded swatch ----

// An uploaded swatch is a photograph: colour and nothing else. This
// recovers a plausible surface relief from it by treating image
// LUMINANCE as a height field — dark pixels read as recessed — and then
// reusing the same slope-based normal derivation the procedural
// textures use.
//
// That heuristic is only valid for some materials, which is exactly why
// reliefStrength is per-finish and seeded from pattern category (see
// PATTERN_RELIEF_PRESET in types/finish.ts): wood pores and fabric weave
// genuinely are recessed where they're dark, while a polished marble's
// dark veins are perfectly flush — deriving relief there carves grooves
// that don't exist. Strength 0 skips this entirely.
// Relief is baked at ONE fixed reference strength and then scaled at
// render time via the material's normalScale (see RELIEF_REFERENCE in
// lib/materials3d.ts). Baking the slider's value into the map instead
// would mean re-decoding the image and caching a whole new texture on
// every 0.05 step of the slider — and it wouldn't help the procedural
// finishes at all, whose maps are generated once and shared.
const UPLOADED_RELIEF_REFERENCE = 42;
const DERIVED_NORMAL_PIXELS = 512;

const derivedNormalCache = new Map<string, THREE.Texture | null>();

async function deriveNormalMap(url: string): Promise<THREE.Texture | null> {
  const cached = derivedNormalCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      // Required to read pixels back out of the canvas: without it the
      // canvas is tainted by the cross-origin image and getImageData
      // throws. Supabase public buckets do send permissive CORS headers,
      // so this succeeds for our own swatches.
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load swatch: ${url}`));
      img.src = url;
    });

    const size = DERIVED_NORMAL_PIXELS;
    const { canvas, ctx } = createCanvas(size);
    ctx.drawImage(image, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;

    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const o = i * 4;
      // Rec. 709 luma — matches how the eye weights the channels, so
      // the derived relief tracks perceived light and shade rather than
      // raw channel averages.
      height[i] = (0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255;
    }

    const texture = toTexture(
      normalMapFromHeight(height, size, UPLOADED_RELIEF_REFERENCE),
      false
    );
    void canvas; // retained by the CanvasTexture
    derivedNormalCache.set(url, texture);
    return texture;
  } catch {
    // A tainted canvas or a failed load should degrade to a flat
    // surface, not break the whole 3D view.
    derivedNormalCache.set(url, null);
    return null;
  }
}

// Async because the image has to decode before its pixels can be read.
// Returns null until ready, so the cabinet renders flat for a frame or
// two and then gains relief — better than blocking the scene.
//
// reliefStrength is only a GATE here (skip the decode entirely when
// relief is off), never part of the cache key — the actual depth is
// applied as normalScale at render time, so moving the slider costs
// nothing and reuses the one cached map.
//
// The result is stored WITH the url it came from and re-checked at
// render time. Two reasons, one a real fix rather than style:
//   - No setState in the effect body, which triggers React's
//     cascading-render warning. setState happens only in the async
//     callback, which is the pattern the rule permits.
//   - No stale frame when the swatch changes: a finish that just
//     switched images shows nothing rather than briefly showing the
//     PREVIOUS swatch's relief while the new one decodes.
function useDerivedNormalMap(url: string | undefined, reliefStrength: number): THREE.Texture | null {
  const enabled = Boolean(url) && reliefStrength > 0;
  const [entry, setEntry] = useState<{ url: string; texture: THREE.Texture | null } | null>(null);

  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    deriveNormalMap(url).then((texture) => {
      if (!cancelled) setEntry({ url, texture });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  if (!enabled || !url) return null;
  return entry?.url === url ? entry.texture : null;
}

// Textures for a cabinet face rendered from a SurfaceFinish.
//
// Three sources, in priority order:
//   albedoUrl       a photographed/downloaded swatch
//   proceduralKind  one of the built-in generated sets
//   neither         solid colour, no maps at all
//
// Returns null when the finish is a solid colour, so the caller simply
// doesn't attach maps and lets ResolvedMaterial.color do the work.
//
// SCALE: a swatch photo declares the real-world area it covers
// (swatchWidthMm/HeightMm), so repeat is derived from the cabinet face's
// actual size. Without that a 300mm swatch on a 900mm shutter would show
// the pattern once instead of three times.
//
// RELIEF: uploaded swatches get a normal map derived from their own
// luminance, scaled by the finish's reliefStrength — see
// deriveNormalMap above for why that heuristic suits wood and fabric
// but not polished stone. Procedural finishes carry a real normal map
// already. Roughness stays a scalar from the finish either way, since
// a photo can't distinguish matte from gloss.
export function useFinishTextures(
  finish:
    | {
        albedoUrl?: string;
        normalMapUrl?: string;
        roughnessMapUrl?: string;
        proceduralKind?: SurfaceKind;
        reliefStrength: number;
        swatchWidthMm: number;
        swatchHeightMm: number;
        tilingMode: 'repeat' | 'mirror';
      }
    | undefined,
  faceWidthM: number,
  faceHeightM: number
): TextureSet | null {
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());

  // Destructured up front so the memo below closes over PRIMITIVES
  // only, never the finish object itself. Listing an object's fields in
  // a dependency array while the body reads the object is something the
  // exhaustive-deps lint can't verify — and it would be wrong to just
  // silence it, because a finish edited in place would then not
  // re-render. Pulling the values out makes the dependencies exactly
  // what the body actually uses.
  const albedoUrl = finish?.albedoUrl;
  const normalMapUrl = finish?.normalMapUrl;
  const roughnessMapUrl = finish?.roughnessMapUrl;
  const proceduralKind = finish?.proceduralKind;
  const reliefStrength = finish?.reliefStrength ?? 0;
  const swatchWidthMm = finish?.swatchWidthMm ?? 300;
  const swatchHeightMm = finish?.swatchHeightMm ?? 300;
  const tilingMode = finish?.tilingMode ?? 'mirror';

  // Hooks can't be conditional, so this runs even for procedural/solid
  // finishes — it returns null immediately when there's no albedoUrl.
  // Skipped entirely when a REAL normal map is supplied: guessing relief
  // from brightness is strictly worse than a map encoding actual surface
  // direction, and decoding the image for nothing wastes work.
  const derivedNormal = useDerivedNormalMap(
    normalMapUrl ? undefined : albedoUrl,
    reliefStrength
  );

  const result = useMemo(() => {
    const wrapMode =
      tilingMode === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;

    if (albedoUrl) {
      const swatchWidthM = Math.max(0.01, swatchWidthMm / 1000);
      const swatchHeightM = Math.max(0.01, swatchHeightMm / 1000);

      const repeatU = faceWidthM / swatchWidthM;
      const repeatV = faceHeightM / swatchHeightM;

      // Every map in the set must tile IDENTICALLY, or the relief and
      // sheen slide out of register with the pattern they belong to.
      const fit = (texture: THREE.Texture) => {
        const clone = texture.clone();
        clone.wrapS = wrapMode;
        clone.wrapT = wrapMode;
        clone.repeat.set(repeatU, repeatV);
        clone.anisotropy = maxAnisotropy;
        return clone;
      };

      const albedo = fit(getUrlTexture(albedoUrl, true));

      // Real normal map wins; the luminance-derived one is the fallback
      // for a business that only has a phone photo of a swatch.
      const normalSource = normalMapUrl ? getUrlTexture(normalMapUrl, false) : derivedNormal;
      const normalMap = normalSource ? fit(normalSource) : null;

      // A photo alone can't distinguish matte from gloss, so without a
      // real roughness map this stays null and the finish's single
      // roughness value does the job (applied as a scalar in
      // materials3d.ts). A real map is the bigger of the two upgrades:
      // it's what expresses glossy tile against matte grout.
      const roughnessMap = roughnessMapUrl ? fit(getUrlTexture(roughnessMapUrl, false)) : null;

      return { map: albedo, normalMap, roughnessMap };
    }

    if (proceduralKind) {
      const base = getSurfaceTextureSet(proceduralKind);
      const worldSize = SURFACE_WORLD_SIZE_M[proceduralKind];
      const cloneTexture = (texture: THREE.Texture) => {
        const clone = texture.clone();
        clone.wrapS = wrapMode;
        clone.wrapT = wrapMode;
        clone.repeat.set(
          Math.max(0.25, faceWidthM / worldSize),
          Math.max(0.25, faceHeightM / worldSize)
        );
        clone.anisotropy = maxAnisotropy;
        return clone;
      };
      const cloneOptional = (texture: THREE.Texture | null) =>
        texture ? cloneTexture(texture) : null;
      return {
        map: cloneTexture(base.map),
        normalMap: cloneOptional(base.normalMap),
        // Deliberately NO roughness map on a cabinet finish, even though
        // the procedural set has one. three.js MULTIPLIES
        // material.roughness by the map, and the procedural maps store
        // ABSOLUTE roughness (wood ~0.5-0.72) — so attaching it here
        // would silently scale whatever the user sets in the finish
        // editor. A finish set to 0.45 rendered as ~0.27, and the
        // slider could never reach the "1 = fully matte" its label
        // promises. The finish owns roughness for cabinets; the maps
        // stay for the floor and countertop, which set no roughness of
        // their own (see useSurfaceTextures' callers).
        roughnessMap: null,
      };
    }

    // No image and no procedural kind — a solid colour finish, or no
    // finish at all. Either way there are no maps to attach and
    // ResolvedMaterial.color does the work.
    return null;
  }, [
    albedoUrl,
    normalMapUrl,
    roughnessMapUrl,
    proceduralKind,
    swatchWidthMm,
    swatchHeightMm,
    tilingMode,
    faceWidthM,
    faceHeightM,
    maxAnisotropy,
    derivedNormal,
  ]);

  // Disposes the PREVIOUS clone set (never the shared cached source —
  // see disposeTextureSetClone above) whenever this recomputes or
  // unmounts. A no-op on the `null` branch (solid-colour finish), since
  // there's nothing to dispose there.
  useDisposeTextureSetOnChange(result);

  return result;
}

// ---- Fixed-path hardware/appliance metal textures ----
//
// Brushed-steel maps for the box-FALLBACK geometry of the sink and
// chimney/range-hood appliances (see ApplianceMesh in Room3DCanvas.tsx —
// the real .glb models carry their own baked materials and never reach
// this path). These are NOT SurfaceFinish rows: there's no swatch
// picker, no tiling-mode toggle, just three fixed files on disk reused
// everywhere they're needed, so this is the same "load once, clone
// per-mesh, scale repeat to real size" shape as useSurfaceTextures above
// but keyed by a literal URL instead of a SurfaceKind/finish id.
const METAL_HARDWARE_FILES = {
  map: '/textures/metal-brushed-steel/color.jpg',
  normalMap: '/textures/metal-brushed-steel/normal.jpg',
  roughnessMap: '/textures/metal-brushed-steel/roughness.jpg',
};

// Real-world size the swatch photo covers, matching the
// finish_metal_brushed_steel row's swatch_width_mm/swatch_height_mm in
// scripts/seed_finishes_and_appliances.sql (500x500 as seeded). Kept as
// a local constant rather than reading the seed row here — this path
// has no SurfaceFinish/DB dependency at all, on purpose.
const METAL_HARDWARE_SWATCH_M = 0.5;

// Returns a per-mesh clone of the shared brushed-steel set, scaled so
// `repeatU`x`repeatV` metres of real face show the 500x500mm swatch at
// its actual physical size rather than one stretched copy.
export function useMetalHardwareTextures(faceWidthM: number, faceHeightM: number): TextureSet {
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());

  const textures = useMemo(() => {
    const repeatU = Math.max(0.25, faceWidthM / METAL_HARDWARE_SWATCH_M);
    const repeatV = Math.max(0.25, faceHeightM / METAL_HARDWARE_SWATCH_M);

    const fit = (texture: THREE.Texture) => {
      const clone = texture.clone();
      clone.wrapS = THREE.RepeatWrapping;
      clone.wrapT = THREE.RepeatWrapping;
      clone.repeat.set(repeatU, repeatV);
      clone.anisotropy = maxAnisotropy;
      return clone;
    };

    return {
      map: fit(getUrlTexture(METAL_HARDWARE_FILES.map, true)),
      normalMap: fit(getUrlTexture(METAL_HARDWARE_FILES.normalMap, false)),
      roughnessMap: fit(getUrlTexture(METAL_HARDWARE_FILES.roughnessMap, false)),
    };
  }, [faceWidthM, faceHeightM, maxAnisotropy]);

  // Disposes the PREVIOUS clone set (never the shared cached source —
  // see disposeTextureSetClone above) whenever this recomputes or
  // unmounts.
  useDisposeTextureSetOnChange(textures);

  return textures;
}

// ---- Opening backdrops ----

// The image seen THROUGH a door or window.
//
// Loaded as plain colour data in sRGB — this is a photograph, so it is
// albedo, not a data map. Getting that wrong is the same class of
// mistake as the panorama colour-space bug: the image arrives correct
// and gets wrongly re-interpreted, coming out dark or washed.
//
// Deliberately NOT tiled (ClampToEdge): a view repeats nowhere in
// reality, and a wrapped sky reads instantly as a texture rather than
// as outside.
//
// State is stored as { url, texture } and gated at render time rather
// than being set in an effect — the same pattern useDerivedNormalMap
// uses here, which is what avoids both the setState-in-effect cascade
// and the one-frame flash of a stale image after the URL changes.
export function useOpeningBackdrop(url: string | undefined): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture } | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        setLoaded({ url, texture });
      },
      undefined,
      () => {
        // A missing backdrop leaves the opening dark rather than
        // breaking the scene — a wrong path shouldn't cost the whole
        // walkthrough, same reasoning as ApplianceModel's error
        // boundary.
        console.warn('[openings] backdrop failed to load:', url);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Gate on the URL matching, so switching backdrops never shows the
  // previous image for a frame.
  return loaded && loaded.url === url ? loaded.texture : null;
}
