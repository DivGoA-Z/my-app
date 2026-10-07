// src/lib/renderBrief.ts
//
// The "render brief": everything an image model needs to turn this
// design into ONE photorealistic picture without inventing anything.
// Downloaded from the 3D view (Room3DCanvas's "Image brief" button) as
// a JSON file next to a PNG of the current view.
//
// WHY BOTH FILES. Text alone can't pin geometry: no image model places
// a 600mm drawer unit 1,200mm from a corner because a sentence said so.
// The PNG is the geometry (for img2img, a ControlNet, or a multimodal
// model's "edit this image"); the JSON is the truth about what each
// shape IS — finish, handle, front layout, sizes — and the explicit
// list of what is NOT in the room, which is where hallucination comes
// from. The prompt text is generated from the same data, so the three
// can't disagree.
//
// WHAT IS LEFT OUT ON PURPOSE. No customer name, phone or address, and
// no prices: this file is meant to be sent to an outside model, and
// nothing in it helps draw the kitchen.
//
// GEOMETRY is the PHYSICAL cabinet (§61) — the caller passes
// usePhysicalCabinets(), the same cabinets the 3D view draws, so the
// numbers describe the picture, not the cutting list.
//
// COORDINATES are restated in the file itself (`coordinateSystem`),
// because the reader is a model that has never seen this codebase: mm,
// origin at the floor of the north-west corner, +x east along the north
// wall, +y south into the room, +z up. Every item gets an axis-aligned
// box (quarter turns only, so it always is one) plus "which wall, how
// far from the left corner as you face that wall" — the second form is
// what a person (or a model) actually composes a picture with.

import type { PlacedCabinetItem, ModuleType } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import { APPLIANCE_TYPE_LABELS } from '../types/appliance';
import type { Obstacle, RoomLayout, WallOrientation } from '../types/layout';
import { OBSTACLE_TYPE_LABELS } from '../types/layout';
import type { SurfaceFinish } from '../types/finish';
import { findFinish, resolveFinish, PATTERN_CATEGORY_LABELS } from '../types/finish';
import type { HandleSpec, FrontRowKind } from '../types/front';
import { defaultFrontLayout, resolveHandle, GLASS_TINT_LABELS } from '../types/front';
import type { ApplianceCatalogItem } from '../types/Catalog';
import type { FixtureCatalogItem } from '../types/fixture';
import { FIXTURE_KIND_LABELS, LIGHTING_MODE_LABELS } from '../types/fixture';
import { DOOR_STATE_LABELS, DOOR_SWING_LABELS, OPENING_KIND_LABELS, DAYLIGHT_MODE_LABELS } from '../types/opening';
import type { HardwareRates } from '../types/rates';
import { currentFootprintRect } from './footprint';
import type { FootprintRect } from './footprint';
import { frontDirection } from './physicalDepth';
import { backWall } from './wallView';
import { isAgainstWall } from './surfaceAreas';
import { cabinetFrontBreakdown } from './fronts';
import { hasCountertop, COUNTERTOP_THICKNESS_MM, COUNTERTOP_OVERHANG_MM } from './cabinetGeometry';
import { resolveSinkCutout } from './applianceGeometry';
import { lookAnglesFromDirection } from './scene3d';
import { resolveAllFixtures } from './fixtures';

export const RENDER_BRIEF_SCHEMA = 'kitchen-render-brief/v1';

const DEFAULT_CEILING_HEIGHT_MM = 2700;
// What the 3D preview paints a surface with no finish (Room3DCanvas's
// PLASTER_COLOR). Stated so "not specified" has one honest meaning: the
// plain surface the reference image already shows, not a free choice.
const PLAIN_PLASTER_HEX = '#f5f3ef';
// An appliance whose bottom is within this of a cabinet's top (or the
// countertop's) is sitting ON it rather than floating above it.
const RESTS_ON_TOLERANCE_MM = COUNTERTOP_THICKNESS_MM + 60;

const WALL_ORDER: WallOrientation[] = ['north', 'east', 'south', 'west'];

const MODULE_LABELS: Record<ModuleType, string> = {
  'base-cabinet': 'base cabinet',
  'wall-cabinet': 'wall-hung upper cabinet',
  'tall-unit': 'tall unit',
  'sink-unit': 'sink base unit',
  'cylinder-trolley': 'gas-cylinder pull-out base unit',
  'drawer-unit': 'drawer base unit',
  'corner-blind': 'blind corner base unit',
  'corner-magic': 'magic-corner base unit',
  'corner-carousel': 'carousel corner base unit',
  'pantry-unit': 'tall pantry pull-out unit',
};

// ---- Output shape ----

export interface BoxMm {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface WallPlacement {
  wall: WallOrientation;
  // Distance from the LEFT corner of that wall, as you stand in the room
  // facing it, to the item's left edge.
  fromLeftMm: number;
}

export interface FinishDescription {
  id: string;
  name: string;
  brand?: string;
  code?: string;
  type: string;
  pattern: string;
  sheen: string;
  colourHex?: string;
  colourName?: string;
  // A per-item tint on top of the finish (PlacedCabinetItem.colorOverride).
  tintHex?: string;
  // The real swatch photo, when there is one — attach it to a multimodal
  // model as a material reference rather than describing wood in words.
  swatchImageUrl?: string;
  swatchRepeatMm?: { width: number; height: number };
}

export interface FrontPanelDescription {
  kind: string;
  widthMm: number;
  heightMm: number;
  // As seen standing in front of the cabinet, from its left and bottom edges.
  fromLeftMm: number;
  fromBottomMm: number;
  // Centre of the handle, in the same left/bottom frame as the panel's.
  handle?: {
    kind: string;
    orientation: 'vertical' | 'horizontal';
    lengthMm: number;
    centerFromLeftMm: number;
    centerFromBottomMm: number;
  };
  glass?: string;
}

export interface CabinetEntry {
  ref: string;
  type: string;
  sizeMm: { width: number; depth: number; height: number };
  box: BoxMm;
  facing: WallOrientation;
  against: WallPlacement | null;
  finish: FinishDescription | null;
  // shelvesFromBottomMm: visible open-shelf boards (their underside).
  fronts: { summary: string; panels: FrontPanelDescription[]; openShelves: number; shelvesFromBottomMm: number[] };
  handle: { name: string; kind: string; colourHex: string; colourName: string; finish: string } | null;
  countertop: boolean;
}

export interface ApplianceEntry {
  ref: string;
  type: string;
  model?: string;
  sizeMm: { width: number; depth: number; height: number };
  box: BoxMm;
  facing: WallOrientation;
  against: WallPlacement | null;
  relation?: string;
  sinkCutoutMm?: { width: number; depth: number };
}

export interface ObstacleEntry {
  ref: string;
  type: string;
  sizeMm: { width: number; depth: number; height: number };
  box: BoxMm;
  floorToCeiling: boolean;
  against: WallOrientation[];
}

export interface OpeningEntry {
  ref: string;
  kind: string;
  wall: WallOrientation;
  fromLeftMm: number;
  widthMm: number;
  heightMm: number;
  sillMm: number;
  door?: {
    state: string;
    swing: string;
    // Swings into the kitchen (sweeps floor), and which end the hinge is
    // at as you face the wall from inside the room. NOT the same as the
    // stored 'in-left': that means the wall's START, which is your right
    // on the south and west walls (OpeningLayer.tsx's swingGeometry).
    opensIn: boolean;
    hingeSide: 'left' | 'right' | null;
    leafFinish: FinishDescription | null;
    leafTintHex?: string;
  };
  outside: string;
  outsideImageUrl?: string;
  daylight?: { mode: string; colourTempK: number; intensity: number };
}

export interface LightEntry {
  ref: string;
  kind: string;
  product: string;
  colourTempK: number;
  lumens: number;
  on: boolean;
  positionMm: { x: number; y: number; z: number };
  throws: string;
  runLengthMm?: number;
  runAxis?: string;
  quantity: number;
}

export interface WallElement {
  ref: string;
  what: string;
  fromLeftMm: number;
  widthMm: number;
  bottomMm: number;
  topMm: number;
}

export interface RenderBriefView {
  // 'walkthrough' = standing at a saved camera; 'orbit' = the free
  // bird's-eye/cutaway view.
  mode: 'walkthrough' | 'orbit';
  cameraLabel?: string;
  positionMm: { x: number; y: number; z: number };
  // Clockwise from north, like CameraNode.viewAngleDeg.
  headingDeg: number;
  // + looks up, − looks down.
  pitchDeg: number;
  facingWall: WallOrientation;
  verticalFovDeg: number;
  imageWidthPx: number;
  imageHeightPx: number;
}

export interface RenderBrief {
  schema: typeof RENDER_BRIEF_SCHEMA;
  generatedAt: string;
  designName: string;
  referenceImages: (ReferenceImage & { whatItIs: string })[];
  coordinateSystem: Record<string, string>;
  room: {
    widthMm: number;
    depthMm: number;
    ceilingHeightMm: number;
    floor: FinishDescription | null;
    ceiling: FinishDescription | null;
    walls: {
      wall: WallOrientation;
      lengthMm: number;
      leftCorner: string;
      finish: FinishDescription | null;
      elementsLeftToRight: WallElement[];
    }[];
    notSpecifiedMeans: string;
  };
  countertop: {
    finish: FinishDescription | null;
    thicknessMm: number;
    overhangMm: number;
    topHeightsMm: number[];
    covers: string[];
  } | null;
  cabinets: CabinetEntry[];
  appliances: ApplianceEntry[];
  obstacles: ObstacleEntry[];
  openings: OpeningEntry[];
  lighting: { mode: string; fixtures: LightEntry[] };
  view: RenderBriefView | null;
  inventory: Record<string, number>;
  notInThisRoom: string[];
  // imagePrompt: every item, in order, with sizes and refs — for a
  // chat-style model that reads it alongside the JSON and the sheet.
  // imagePromptCondensed: ≤ CONDENSED_MAX_WORDS of visual description,
  // most important first, for a diffusion model's text encoder, which
  // truncates (CLIP at 77 tokens) and can't use millimetres or refs.
  // imagePromptShort / negativePromptShort: ≤ SHORT_PROMPT_MAX_CHARS /
  // SHORT_NEGATIVE_MAX_CHARS, colours first, for a tool with a prompt-
  // length limit (§104–§105). Paste these rather than shortening a longer
  // one elsewhere, which loses the grounding.
  prompt: {
    instructions: string;
    imagePrompt: string;
    imagePromptCondensed: string;
    imagePromptShort: string;
    negativePrompt: string;
    negativePromptShort: string;
  };
}

// 'line-render' = a line drawing of exactly what the chosen camera sees
// (lib/viewSnapshot.ts); 'colour-render' = the 3D view from the same
// camera, for which finish goes where (§113); 'elevations' = the plan +
// four-wall sheet (lib/elevationSheet.ts), when no camera is chosen. A
// textured still was dropped in §101 when it was the ONLY image an
// image-to-image model got; §113 brings it back as a second reference,
// explained, beside the line render.
export interface ReferenceImage {
  kind: 'elevations' | 'line-render' | 'colour-render';
  file: string;
  widthPx: number;
  heightPx: number;
}

const REFERENCE_IMAGE_MEANING: Record<ReferenceImage['kind'], string> = {
  elevations:
    'Line drawing of all four walls, each seen straight on from inside the room, to one common scale. It shows exactly what stands against each wall: every cabinet split into its real doors and drawers with handle marks, the countertop, sink, hob and chimney, windows, doors and pillars. Labels (C1, A1, O1, P1) match this file. Grey blocks at a wall\'s ends are the sides of units on the neighbouring wall. It is a diagram of geometry only; colours and materials come from this file.',
  'colour-render':
    'The app\'s 3D preview from the SAME camera and at the same size as the line render, so the two line up exactly. Use it to see which finish and colour goes on which surface (e.g. a dark wood ceiling, a ridged roll-up tambour shutter, white gloss fronts). Its lighting and materials are a simplified computer render: do NOT copy its look, colours as lit, or flatness; produce a real photograph.',
  'line-render':
    'Hidden-line drawing of this design from the camera in `view`: every surface white, every edge black. It fixes the camera, the composition and every edge (cabinet outlines, door and drawer seams, handles, the countertop). It has no materials or light of its own.',
};

export interface RenderBriefInput {
  layout: RoomLayout;
  // PHYSICAL cabinets (usePhysicalCabinets) — see the header.
  cabinets: PlacedCabinetItem[];
  appliances: PlacedApplianceItem[];
  obstacles: Obstacle[];
  finishes: SurfaceFinish[];
  handles: HandleSpec[];
  applianceCatalog: ApplianceCatalogItem[];
  fixtureCatalog: FixtureCatalogItem[];
  hardwareRates: HardwareRates;
  view: RenderBriefView | null;
  // The images saved next to this file. Described here rather than by
  // the caller so every brief explains them the same way.
  referenceImages: ReferenceImage[];
  // Relative asset URLs (/textures/…) are made absolute against this, so
  // the file still points somewhere once it leaves the browser.
  assetOrigin: string;
  generatedAt: string;
}

// ---- Small, tested helpers ----

const r = (n: number) => Math.round(n);

// The wall's left corner as you stand in the room facing it.
const LEFT_CORNER: Record<WallOrientation, string> = {
  north: 'north-west',
  east: 'north-east',
  south: 'south-east',
  west: 'south-west',
};

export function wallLengthMm(wall: WallOrientation, roomWidthMm: number, roomDepthMm: number): number {
  return wall === 'north' || wall === 'south' ? roomWidthMm : roomDepthMm;
}

// Standing in the room facing a wall, left is: west on the north wall,
// north on the east wall, east on the south wall, south on the west
// wall. North/east run with the axis (x, y); south/west against it.
export function fromLeftOnWall(
  wall: WallOrientation,
  rect: FootprintRect,
  roomWidthMm: number,
  roomDepthMm: number
): number {
  switch (wall) {
    case 'north':
      return rect.x;
    case 'east':
      return rect.y;
    case 'south':
      return roomWidthMm - (rect.x + rect.widthMm);
    case 'west':
      return roomDepthMm - (rect.y + rect.depthMm);
  }
}

// The stored swing names the hinge by the wall's along-axis: 'in-left'
// = hinge at the START (low x or y). Facing the wall from inside, the
// start is your left on north/east and your right on south/west. Only
// in-swinging doors record a side.
export function hingeSideFacingWall(wall: WallOrientation, swing: string): 'left' | 'right' | null {
  if (swing !== 'in-left' && swing !== 'in-right') return null;
  const atStart = swing === 'in-left';
  const startIsLeft = wall === 'north' || wall === 'east';
  return atStart === startIsLeft ? 'left' : 'right';
}

// Which way the item's front faces, as a compass point. frontDirection's
// +y is south (plan y grows away from the north wall).
export function facingOf(rotationDeg: number): WallOrientation {
  const f = frontDirection(rotationDeg);
  if (f.y === 1) return 'south';
  if (f.y === -1) return 'north';
  return f.x === 1 ? 'east' : 'west';
}

// Coarse, deterministic colour words from a hex. An image model reads
// "dark warm grey" far more reliably than "#5a5550"; the hex stays next
// to it for anything that can use it.
export function colourName(hex: string | undefined): string | undefined {
  const m = hex?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const rr = ((n >> 16) & 255) / 255;
  const gg = ((n >> 8) & 255) / 255;
  const bb = (n & 255) / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = (h * 60 + 360) % 360;
  }

  if (s < 0.12 || d < 0.06) {
    if (l > 0.97) return 'white';
    if (l > 0.8) return 'off-white';
    if (l > 0.6) return 'light grey';
    if (l > 0.35) return 'mid grey';
    if (l > 0.12) return 'charcoal grey';
    return 'black';
  }
  const hue =
    h < 15 || h >= 345 ? 'red'
    : h < 40 ? (l < 0.45 ? 'brown' : 'orange')
    : h < 65 ? (l < 0.4 ? 'olive brown' : 'yellow')
    : h < 160 ? 'green'
    : h < 200 ? 'teal'
    : h < 255 ? 'blue'
    : h < 290 ? 'purple'
    : 'pink';
  // Warm, desaturated light colours are what the trade calls beige/cream.
  if ((hue === 'orange' || hue === 'yellow') && s < 0.45 && l > 0.7) return l > 0.85 ? 'cream' : 'beige';
  const tone = l > 0.8 ? 'pale ' : l > 0.62 ? 'light ' : l < 0.18 ? 'very dark ' : l < 0.4 ? 'dark ' : '';
  const muted = s < 0.3 ? 'muted ' : '';
  return `${tone}${muted}${hue}`.trim();
}

// Word for the finish's optical numbers (types/finish.ts) — the same
// numbers the 3D material is built from.
export function sheenOf(f: Pick<SurfaceFinish, 'roughness' | 'clearcoat' | 'metalness'>): string {
  if (f.metalness >= 0.6) return f.roughness <= 0.3 ? 'polished metal' : 'brushed metal';
  if (f.clearcoat >= 0.5 || f.roughness <= 0.2) return 'high gloss';
  if (f.roughness <= 0.35) return 'gloss';
  if (f.roughness <= 0.5) return 'satin / soft sheen';
  return 'matte';
}

function absoluteUrl(url: string | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

export function describeFinish(
  finish: SurfaceFinish | undefined,
  origin: string,
  tintHex?: string
): FinishDescription | null {
  if (!finish) return null;
  const colourHex = finish.solidColor ?? undefined;
  return {
    id: finish.id,
    name: finish.label,
    brand: finish.brand || undefined,
    code: finish.code || undefined,
    type: finish.finishTypeLabel,
    pattern: PATTERN_CATEGORY_LABELS[finish.patternCategory] ?? finish.patternCategory,
    sheen: sheenOf(finish),
    // A tint REPLACES a solid colour (PlacedCabinetItem.colorOverride),
    // so that is the colour actually seen.
    colourHex: finish.albedoUrl ? colourHex : (tintHex ?? colourHex),
    colourName: colourName(finish.albedoUrl ? colourHex : (tintHex ?? colourHex)),
    tintHex: finish.albedoUrl ? tintHex : undefined,
    swatchImageUrl: absoluteUrl(finish.albedoUrl, origin),
    swatchRepeatMm: finish.albedoUrl ? { width: finish.swatchWidthMm, height: finish.swatchHeightMm } : undefined,
  };
}

// What the 3D preview draws where nothing was chosen — said in those
// terms, so the image model keeps what the reference image shows
// instead of picking something.
const UNSET = {
  wall: 'plain matte off-white painted plaster (not chosen)',
  floor: 'plain light-grey ceramic floor tiles as in the reference image (not chosen)',
  ceiling: 'plain matte white painted ceiling (not chosen)',
  cabinet: 'finish not chosen: keep the plain colour of the reference image',
  door: 'plain painted flush door (not chosen)',
};

export function finishPhrase(f: FinishDescription | null, ifUnset: string = UNSET.wall): string {
  if (!f) return ifUnset;
  const colour = f.colourName ? `${f.colourName} ` : '';
  const pattern = f.pattern === PATTERN_CATEGORY_LABELS.solid ? '' : `${f.pattern.toLowerCase()} `;
  const brand = [f.brand, f.code].filter(Boolean).join(' ');
  const tint = f.tintHex ? `, tinted ${colourName(f.tintHex) ?? f.tintHex}` : '';
  return `${colour}${pattern}${f.type.toLowerCase()} in ${f.sheen} (${f.name}${brand && !f.name.includes(brand) ? `, ${brand}` : ''}${tint})`;
}

function boxOf(rect: FootprintRect, bottomMm: number, heightMm: number): BoxMm {
  return {
    minX: r(rect.x),
    maxX: r(rect.x + rect.widthMm),
    minY: r(rect.y),
    maxY: r(rect.y + rect.depthMm),
    minZ: r(bottomMm),
    maxZ: r(bottomMm + heightMm),
  };
}

// The wall an item stands against: the one its BACK faces, and only if
// it actually touches it (the same 60mm test the elevation uses).
// Anything else is freestanding (an island, or pulled off the wall).
function placementAgainstWall(
  item: { rotationDeg: number },
  rect: FootprintRect,
  roomW: number,
  roomD: number
): WallPlacement | null {
  const wall = backWall(item.rotationDeg);
  if (!isAgainstWall(wall, rect, roomW, roomD)) return null;
  return { wall, fromLeftMm: r(fromLeftOnWall(wall, rect, roomW, roomD)) };
}

const ROW_KIND_WORDS: Record<FrontRowKind, [string, string]> = {
  'single-door': ['hinged door', 'hinged doors'],
  'double-door': ['hinged door', 'hinged doors'],
  drawers: ['drawer', 'drawers'],
  trolley: ['pull-out front', 'pull-out fronts'],
  'open-shelf': ['glass door', 'glass doors'],
  'false-front': ['fixed false front', 'fixed false fronts'],
  'appliance-housing': ['open appliance niche', 'open appliance niches'],
  tambour: ['roll-up tambour shutter', 'roll-up tambour shutters'],
};

function plural(n: number, [one, many]: [string, string]) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- The brief ----

export function buildRenderBrief(input: RenderBriefInput): RenderBrief {
  const { layout, finishes, handles, assetOrigin: origin } = input;
  const roomW = layout.dimensions.widthMm;
  const roomD = layout.dimensions.depthMm;
  const ceilingMm = layout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
  const optionalFinish = (id: string | undefined) => describeFinish(findFinish(finishes, id), origin);

  // Sort key: wall order, then left to right, then bottom to top; the
  // freestanding ones last. Refs are numbered in this order so C1 is
  // the first thing on the north wall's left.
  const sortKey = (p: WallPlacement | null, bottom: number) =>
    [p ? WALL_ORDER.indexOf(p.wall) : WALL_ORDER.length, p?.fromLeftMm ?? 0, bottom] as const;
  const byKey = <T,>(items: T[], key: (t: T) => readonly number[]) =>
    [...items].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });

  // ---- Cabinets ----
  const placedCabinets = byKey(
    input.cabinets.map((c) => {
      const rect = currentFootprintRect(c);
      return { c, rect, against: placementAgainstWall(c, rect, roomW, roomD) };
    }),
    (p) => sortKey(p.against, p.c.elevationMm)
  );

  const cabinets: CabinetEntry[] = placedCabinets.map(({ c, rect, against }, i) => {
    const layoutForFronts = c.frontLayout ?? defaultFrontLayout(c.moduleType, c.widthMm);
    const handleSpec = resolveHandle(handles, c.handleId);
    const breakdown = cabinetFrontBreakdown(c, layoutForFronts, handleSpec, input.hardwareRates);
    const panels: FrontPanelDescription[] = breakdown.panels.map((p) => ({
      kind: p.glassTint ? `${p.kind} (glass)` : p.kind,
      widthMm: r(p.widthMm),
      heightMm: r(p.heightMm),
      // The front face frame is centred on the cabinet face (lib/fronts.ts).
      fromLeftMm: r(p.centerXMm - p.widthMm / 2 + c.widthMm / 2),
      fromBottomMm: r(p.centerYMm - p.heightMm / 2 + c.heightMm / 2),
      handle: p.handle
        ? {
            kind: p.handle.handle.kind,
            orientation: p.handle.orientation,
            lengthMm: r(p.handle.lengthMm),
            centerFromLeftMm: r(p.handle.centerXMm + c.widthMm / 2),
            centerFromBottomMm: r(p.handle.centerYMm + c.heightMm / 2),
          }
        : undefined,
      glass: p.glassTint ? GLASS_TINT_LABELS[p.glassTint] : undefined,
    }));

    const counts = new Map<FrontRowKind, number>();
    for (const p of breakdown.panels) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    const parts = [...counts].map(([kind, n]) => plural(n, ROW_KIND_WORDS[kind]));
    const housings = layoutForFronts.kind === 'appliance-housing'
      ? 1
      : (layoutForFronts.rows ?? []).filter((row) => row.kind === 'appliance-housing').length;
    if (housings) parts.push(plural(housings, ROW_KIND_WORDS['appliance-housing']));
    if (breakdown.shelves.length) parts.push(`${breakdown.shelves.length} open shelves`);
    const glassPanels = breakdown.panels.filter((p) => p.glassTint);
    if (glassPanels.length) parts.push(`${GLASS_TINT_LABELS[glassPanels[0].glassTint!].toLowerCase()} glass`);

    const handleOnFronts = breakdown.panels.some((p) => p.handle);
    return {
      ref: `C${i + 1}`,
      type: MODULE_LABELS[c.moduleType],
      sizeMm: { width: r(c.widthMm), depth: r(c.depthMm), height: r(c.heightMm) },
      box: boxOf(rect, c.elevationMm, c.heightMm),
      facing: facingOf(c.rotationDeg),
      against,
      finish: describeFinish(resolveFinish(finishes, c.finishId), origin, c.colorOverride),
      fronts: {
        summary: parts.join(', ') || 'no fronts',
        panels,
        openShelves: breakdown.shelves.length,
        shelvesFromBottomMm: breakdown.shelves.map((sh) => r(sh.centerYMm - sh.heightMm / 2 + c.heightMm / 2)),
      },
      handle:
        handleSpec && handleOnFronts
          ? {
              name: handleSpec.label,
              kind: handleSpec.kind,
              colourHex: handleSpec.colorHex,
              colourName: colourName(handleSpec.colorHex) ?? handleSpec.colorHex,
              finish: sheenOf({ roughness: handleSpec.roughness, clearcoat: 0, metalness: handleSpec.metalness }),
            }
          : handleSpec?.kind === 'handleless'
            ? { name: handleSpec.label, kind: 'handleless', colourHex: '', colourName: 'none', finish: 'push-to-open, nothing on the front' }
            : null,
      countertop: hasCountertop(c.moduleType),
    };
  });
  const cabinetRefById = new Map(placedCabinets.map((p, i) => [p.c.id, cabinets[i].ref]));

  // ---- Appliances ----
  const placedAppliances = byKey(
    input.appliances.map((a) => {
      const rect = currentFootprintRect(a);
      return { a, rect, against: placementAgainstWall(a, rect, roomW, roomD) };
    }),
    (p) => sortKey(p.against, p.a.elevationMm)
  );
  const appliances: ApplianceEntry[] = placedAppliances.map(({ a, rect, against }, i) => {
    const row =
      (a.catalogItemId ? input.applianceCatalog.find((c) => c.id === a.catalogItemId) : undefined) ??
      input.applianceCatalog.find((c) => c.applianceType === a.applianceType);
    const cutout = resolveSinkCutout(a, input.applianceCatalog);
    return {
      ref: `A${i + 1}`,
      type: APPLIANCE_TYPE_LABELS[a.applianceType],
      model: row?.label,
      sizeMm: { width: r(a.widthMm), depth: r(a.depthMm), height: r(a.heightMm) },
      box: boxOf(rect, a.elevationMm, a.heightMm),
      facing: facingOf(a.rotationDeg),
      against,
      relation: applianceRelation(a, rect, placedCabinets, cabinetRefById, placedAppliances),
      sinkCutoutMm: cutout ? { width: cutout.widthMm, depth: cutout.depthMm } : undefined,
    };
  });

  // ---- Obstacles ----
  const obstacleRows = byKey(
    input.obstacles.map((o) => {
      const rect = currentFootprintRect(o);
      const walls = WALL_ORDER.filter((w) => isAgainstWall(w, rect, roomW, roomD));
      const first = walls[0];
      return {
        o,
        rect,
        walls,
        against: first ? { wall: first, fromLeftMm: r(fromLeftOnWall(first, rect, roomW, roomD)) } : null,
      };
    }),
    (p) => sortKey(p.against, p.o.floorToCeiling ? 0 : p.o.elevationMm)
  );
  const obstacles: ObstacleEntry[] = obstacleRows.map(({ o, rect, walls }, i) => {
    const bottom = o.floorToCeiling ? 0 : o.elevationMm;
    const height = o.floorToCeiling ? ceilingMm : o.heightMm;
    return {
      ref: `P${i + 1}`,
      type: OBSTACLE_TYPE_LABELS[o.type],
      sizeMm: { width: r(rect.widthMm), depth: r(rect.depthMm), height: r(height) },
      box: boxOf(rect, bottom, height),
      floorToCeiling: !!o.floorToCeiling,
      against: walls,
    };
  });

  // ---- Openings ----
  const allOpenings = layout.walls.flatMap((w) => w.openings ?? []);
  const openingRows = byKey(
    allOpenings.map((op) => {
      const len = wallLengthMm(op.wallId, roomW, roomD);
      const fromLeft = op.wallId === 'north' || op.wallId === 'east' ? op.offsetMm : len - op.offsetMm - op.widthMm;
      return { op, fromLeft: r(fromLeft) };
    }),
    (p) => [WALL_ORDER.indexOf(p.op.wallId), p.fromLeft, p.op.sillMm]
  );
  const openings: OpeningEntry[] = openingRows.map(({ op, fromLeft }, i) => {
    const leaf = optionalFinish(op.leafFinishId);
    const isDoor = op.kind === 'door';
    const seeThrough = !isDoor || op.doorState !== 'closed';
    return {
      ref: `O${i + 1}`,
      kind: OPENING_KIND_LABELS[op.kind],
      wall: op.wallId,
      fromLeftMm: fromLeft,
      widthMm: r(op.widthMm),
      heightMm: r(op.heightMm),
      sillMm: r(op.sillMm),
      door: isDoor
        ? {
            state: DOOR_STATE_LABELS[op.doorState ?? 'closed'],
            swing: DOOR_SWING_LABELS[op.swing ?? 'in-right'],
            opensIn: op.swing === 'in-left' || op.swing === 'in-right' || op.swing === undefined,
            hingeSide: hingeSideFacingWall(op.wallId, op.swing ?? 'in-right'),
            leafFinish: op.doorState === 'doorway' ? null : leaf,
            leafTintHex: op.leafColorOverride,
          }
        : undefined,
      outside: !seeThrough
        ? 'nothing visible (closed door)'
        : op.backdropUrl
          ? 'use the supplied outside photo (outsideImageUrl)'
          : op.kind === 'window'
            ? 'not specified: soft, bright, slightly overexposed daylight; no invented scenery'
            : 'not specified: a plain, softly lit passage',
      outsideImageUrl: seeThrough ? absoluteUrl(op.backdropUrl, origin) : undefined,
      daylight: op.daylight?.enabled
        ? { mode: DAYLIGHT_MODE_LABELS[op.daylight.mode], colourTempK: op.daylight.colorTempK, intensity: op.daylight.intensity }
        : undefined,
    };
  });

  // ---- Walls: everything against each, left to right ----
  const walls = WALL_ORDER.map((wall) => {
    const elements: WallElement[] = [];
    placedCabinets.forEach(({ c, rect, against }, i) => {
      if (against?.wall !== wall) return;
      elements.push({
        ref: cabinets[i].ref,
        what: `${cabinets[i].type} (${cabinets[i].fronts.summary})`,
        fromLeftMm: against.fromLeftMm,
        widthMm: r(wall === 'north' || wall === 'south' ? rect.widthMm : rect.depthMm),
        bottomMm: r(c.elevationMm),
        topMm: r(c.elevationMm + c.heightMm),
      });
    });
    placedAppliances.forEach(({ a, rect, against }, i) => {
      if (against?.wall !== wall) return;
      elements.push({
        ref: appliances[i].ref,
        what: appliances[i].type,
        fromLeftMm: against.fromLeftMm,
        widthMm: r(wall === 'north' || wall === 'south' ? rect.widthMm : rect.depthMm),
        bottomMm: r(a.elevationMm),
        topMm: r(a.elevationMm + a.heightMm),
      });
    });
    obstacleRows.forEach(({ rect, walls: touching }, i) => {
      if (!touching.includes(wall)) return;
      elements.push({
        ref: obstacles[i].ref,
        what: obstacles[i].type,
        fromLeftMm: r(fromLeftOnWall(wall, rect, roomW, roomD)),
        widthMm: r(wall === 'north' || wall === 'south' ? rect.widthMm : rect.depthMm),
        bottomMm: obstacles[i].box.minZ,
        topMm: obstacles[i].box.maxZ,
      });
    });
    openings.forEach((op) => {
      if (op.wall !== wall) return;
      elements.push({
        ref: op.ref,
        what: op.kind,
        fromLeftMm: op.fromLeftMm,
        widthMm: op.widthMm,
        bottomMm: op.sillMm,
        topMm: op.sillMm + op.heightMm,
      });
    });
    elements.sort((a, b) => a.fromLeftMm - b.fromLeftMm || a.bottomMm - b.bottomMm);
    return {
      wall,
      lengthMm: wallLengthMm(wall, roomW, roomD),
      leftCorner: LEFT_CORNER[wall],
      finish: optionalFinish(layout.walls.find((w) => w.orientation === wall)?.finishId),
      elementsLeftToRight: elements,
    };
  });

  // ---- Countertop ----
  const slabCabinets = cabinets.filter((c) => c.countertop);
  const countertop = slabCabinets.length
    ? {
        finish: optionalFinish(layout.countertopFinishId),
        thicknessMm: COUNTERTOP_THICKNESS_MM,
        overhangMm: COUNTERTOP_OVERHANG_MM,
        topHeightsMm: [...new Set(slabCabinets.map((c) => c.box.maxZ + COUNTERTOP_THICKNESS_MM))].sort((a, b) => a - b),
        covers: slabCabinets.map((c) => c.ref),
      }
    : null;

  // ---- Lighting ----
  const fixtures: LightEntry[] = resolveAllFixtures(layout, input.cabinets, input.fixtureCatalog).map((p, i) => {
    const linear = p.item.kind === 'strip' || p.item.kind === 'cove' || p.item.kind === 'plinth';
    const host =
      p.fixture.mount.kind === 'cabinet' ? cabinetRefById.get(p.fixture.mount.cabinetId) : undefined;
    return {
      ref: `L${i + 1}`,
      kind: FIXTURE_KIND_LABELS[p.item.kind],
      product: p.item.label,
      colourTempK: p.item.colorTempK,
      lumens: p.item.lumens,
      on: p.fixture.enabled,
      positionMm: { x: r(p.xMm), y: r(p.yMm), z: r(p.zMm) },
      throws: `${p.fixture.throwDirection ?? (p.dirZ < -0.5 ? 'down' : p.dirZ > 0.5 ? 'up' : 'across')}${host ? `, mounted on ${host} (${p.fixture.mount.kind === 'cabinet' ? p.fixture.mount.face : ''})` : ''}`,
      runLengthMm: linear ? r(p.runLengthMm) : undefined,
      runAxis: linear ? p.runAxis : undefined,
      quantity: p.fixture.quantity,
    };
  });

  // ---- Inventory and absences ----
  const count = <T,>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length;
  const inventory: Record<string, number> = {
    'base cabinets (incl. sink, drawer, corner, trolley units)': count(input.cabinets, (c) => hasCountertop(c.moduleType)),
    'wall-hung upper cabinets': count(input.cabinets, (c) => c.moduleType === 'wall-cabinet'),
    'tall units (incl. pantry)': count(input.cabinets, (c) => c.moduleType === 'tall-unit' || c.moduleType === 'pantry-unit'),
    appliances: input.appliances.length,
    'pillars / shafts / pipes / panels': input.obstacles.length,
    doors: count(allOpenings, (o) => o.kind === 'door'),
    windows: count(allOpenings, (o) => o.kind === 'window'),
    'pass-throughs': count(allOpenings, (o) => o.kind === 'pass-through'),
    'light fixtures': fixtures.length,
  };
  const has = (t: PlacedApplianceItem['applianceType']) => input.appliances.some((a) => a.applianceType === t);
  const notInThisRoom: string[] = [];
  if (!inventory.windows) notInThisRoom.push('windows');
  if (!inventory.doors) notInThisRoom.push('doors (none visible)');
  if (!inventory['wall-hung upper cabinets']) notInThisRoom.push('upper / wall cabinets');
  if (!inventory['tall units (incl. pantry)']) notInThisRoom.push('tall units or pantry columns');
  if (!has('chimney')) notInThisRoom.push('range hood / chimney');
  if (!has('stove')) notInThisRoom.push('hob / cooktop / stove');
  if (!has('sink')) notInThisRoom.push('sink or tap');
  if (!has('fridge')) notInThisRoom.push('refrigerator');
  if (!has('microwave') && !has('oven') && !has('otg')) notInThisRoom.push('oven or microwave');
  if (!has('dishwasher')) notInThisRoom.push('dishwasher');
  if (!input.cabinets.some((c) => !placementAgainstWall(c, currentFootprintRect(c), roomW, roomD)))
    notInThisRoom.push('kitchen island or freestanding units');
  if (!fixtures.some((f) => f.kind === FIXTURE_KIND_LABELS.pendant)) notInThisRoom.push('pendant lights');
  if (!fixtures.length) notInThisRoom.push('decorative light fittings');
  // No commas inside a phrase: the negative prompt is a comma-separated
  // list, and a phrase with commas in it would split into fragments.
  notInThisRoom.push('dining furniture or stools', 'people or pets', 'decor or utensils on the counters');

  const brief: Omit<RenderBrief, 'prompt'> = {
    schema: RENDER_BRIEF_SCHEMA,
    generatedAt: input.generatedAt,
    designName: layout.name,
    referenceImages: input.referenceImages.map((img) => ({ ...img, whatItIs: REFERENCE_IMAGE_MEANING[img.kind] })),
    coordinateSystem: {
      units: 'millimetres',
      origin: 'floor level at the north-west inside corner of the room',
      x: 'east, along the north wall (0 … room.widthMm)',
      y: 'south, into the room away from the north wall (0 … room.depthMm)',
      z: 'up from the finished floor',
      box: 'axis-aligned outer bounds of the item, as physically built (shutters included)',
      fromLeftMm: 'distance from the left corner of the wall, standing in the room facing that wall, to the item’s left edge',
      facing: 'the compass direction the item’s front (doors, controls) faces',
      headingDeg: 'clockwise from north: 0 = looking at the north wall, 90 = east, 180 = south, 270 = west',
    },
    room: {
      widthMm: roomW,
      depthMm: roomD,
      ceilingHeightMm: ceilingMm,
      floor: optionalFinish(layout.floorFinishId),
      ceiling: optionalFinish(layout.ceilingFinishId),
      walls,
      notSpecifiedMeans: `A finish of null means nothing has been chosen yet, and the surface stays as plain as the reference image shows it: walls matte off-white plaster (${PLAIN_PLASTER_HEX}), the floor plain light-grey tiles, the ceiling plain white, the countertop plain polished light-grey stone. Do not invent tiles, wallpaper, backsplashes, paint colours or patterns.`,
    },
    countertop,
    cabinets,
    appliances,
    obstacles,
    openings,
    lighting: { mode: LIGHTING_MODE_LABELS[layout.lightingMode ?? 'designed'], fixtures },
    view: input.view,
    inventory,
    notInThisRoom,
  };

  return { ...brief, prompt: buildPrompt(brief) };
}

// What an appliance is doing relative to the cabinets: a hob ON the
// counter of C3, an oven BUILT INTO C7, a chimney ABOVE the hob A2.
function applianceRelation(
  a: PlacedApplianceItem,
  rect: FootprintRect,
  cabinets: { c: PlacedCabinetItem; rect: FootprintRect }[],
  refs: Map<string, string>,
  appliances: { a: PlacedApplianceItem; rect: FootprintRect }[]
): string | undefined {
  const cx = rect.x + rect.widthMm / 2;
  const cy = rect.y + rect.depthMm / 2;
  const contains = (o: FootprintRect) => cx >= o.x && cx <= o.x + o.widthMm && cy >= o.y && cy <= o.y + o.depthMm;
  const bottom = a.elevationMm;
  const top = a.elevationMm + a.heightMm;

  for (const { c, rect: cr } of cabinets) {
    if (!contains(cr)) continue;
    const cabTop = c.elevationMm + c.heightMm;
    const ref = refs.get(c.id);
    if (bottom >= c.elevationMm - 1 && top <= cabTop + 1) return `built into ${ref}`;
    if (bottom >= cabTop - 60 && bottom <= cabTop + RESTS_ON_TOLERANCE_MM) {
      return a.applianceType === 'sink' ? `set into the countertop over ${ref}` : `standing on the countertop over ${ref}`;
    }
  }
  if (a.applianceType === 'chimney') {
    const hob = appliances.find((o) => o.a.applianceType === 'stove' && contains(o.rect));
    if (hob) return `mounted above the hob`;
  }
  if (bottom <= 1) return 'standing on the floor';
  return undefined;
}

// ---- Prompt text ----

function mm(n: number) {
  return `${Math.round(n)} mm`;
}

function compass(deg: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function buildPrompt(b: Omit<RenderBrief, 'prompt'>): RenderBrief['prompt'] {
  const lines: string[] = [];
  const v = b.view;

  lines.push(
    `Photorealistic interior photograph of a real, compact modular kitchen in an Indian apartment. Room ${mm(b.room.widthMm)} wide (east–west) × ${mm(b.room.depthMm)} deep (north–south), ceiling ${mm(b.room.ceilingHeightMm)}.`
  );
  if (v) {
    lines.push(
      v.mode === 'walkthrough'
        ? `Camera: eye-level photo taken standing at x ${mm(v.positionMm.x)}, y ${mm(v.positionMm.y)}, lens height ${mm(v.positionMm.z)}, looking ${compass(v.headingDeg)} toward the ${v.facingWall} wall${Math.abs(v.pitchDeg) >= 5 ? `, tilted ${v.pitchDeg > 0 ? 'up' : 'down'} ${Math.abs(Math.round(v.pitchDeg))}°` : ''}, ${Math.round(v.verticalFovDeg)}° vertical field of view. Match the framing of the reference image exactly.`
        : `Camera: elevated three-quarter view looking ${compass(v.headingDeg)}, down ${Math.abs(Math.round(v.pitchDeg))}°, exactly as framed in the reference image (a cut-away view: walls nearest the camera are not shown).`
    );
  }

  const cabByRef = new Map(b.cabinets.map((c) => [c.ref, c]));
  const appByRef = new Map(b.appliances.map((a) => [a.ref, a]));
  for (const w of b.room.walls) {
    if (!w.elementsLeftToRight.length) continue;
    const parts = w.elementsLeftToRight.map((e) => {
      const cab = cabByRef.get(e.ref);
      if (cab) {
        const level = cab.box.minZ > 900 ? ` hung at ${mm(cab.box.minZ)}–${mm(cab.box.maxZ)}` : '';
        return `${e.ref} ${mm(cab.sizeMm.width)}-wide ${cab.type}${level} with ${cab.fronts.summary}`;
      }
      const app = appByRef.get(e.ref);
      if (app) {
        const name = app.model ? `${app.model} (${app.type.toLowerCase()})` : app.type.toLowerCase();
        return `${e.ref} ${name}, ${mm(app.sizeMm.width)} wide${app.relation ? `, ${app.relation}` : ''}`;
      }
      const op = b.openings.find((o) => o.ref === e.ref);
      if (op) {
        const extra = op.door ? `, ${op.door.state.toLowerCase()}` : `, sill at ${mm(op.sillMm)}`;
        return `${e.ref} ${op.kind.toLowerCase()} ${mm(op.widthMm)} wide × ${mm(op.heightMm)} high starting ${mm(op.fromLeftMm)} from the left corner${extra}`;
      }
      return `${e.ref} ${e.what.toLowerCase()} ${mm(e.widthMm)} wide, ${mm(e.fromLeftMm)} from the left corner, ${mm(e.bottomMm)}–${mm(e.topMm)} high`;
    });
    lines.push(`${cap(w.wall)} wall (${mm(w.lengthMm)}, left to right as you face it): ${parts.join('; ')}.`);
  }
  const freestanding = b.cabinets.filter((c) => !c.against);
  if (freestanding.length) {
    lines.push(
      `Freestanding, not against any wall: ${freestanding.map((c) => `${c.ref} ${c.type} ${mm(c.sizeMm.width)} × ${mm(c.sizeMm.depth)} at x ${mm(c.box.minX)}–${mm(c.box.maxX)}, y ${mm(c.box.minY)}–${mm(c.box.maxY)}`).join('; ')}.`
    );
  }

  // Finishes, grouped, so twelve identical cabinets are one sentence.
  const byFinish = new Map<string, string[]>();
  for (const c of b.cabinets) {
    const key = finishPhrase(c.finish, UNSET.cabinet);
    byFinish.set(key, [...(byFinish.get(key) ?? []), c.ref]);
  }
  for (const [phrase, refs] of byFinish) lines.push(`Shutters and visible cabinet sides of ${refs.join(', ')}: ${phrase}.`);

  const handleGroups = new Map<string, string[]>();
  for (const c of b.cabinets) {
    if (!c.handle) continue;
    const key =
      c.handle.kind === 'handleless'
        ? 'handleless push-to-open fronts, nothing on the shutters'
        : `${c.handle.colourName} ${c.handle.finish} ${c.handle.kind === 'gola' ? 'continuous gola (recessed aluminium channel) profile' : c.handle.kind === 'edge-profile' ? 'edge-profile handle along the top edge' : `${c.handle.kind} handles`} (${c.handle.name})`;
    handleGroups.set(key, [...(handleGroups.get(key) ?? []), c.ref]);
  }
  for (const [phrase, refs] of handleGroups) lines.push(`Handles on ${refs.join(', ')}: ${phrase}.`);

  if (b.countertop) {
    lines.push(
      `Countertop: one continuous ${mm(b.countertop.thicknessMm)} slab over ${b.countertop.covers.join(', ')}, top at ${b.countertop.topHeightsMm.map(mm).join(' / ')}, ${mm(b.countertop.overhangMm)} front overhang; ${b.countertop.finish ? finishPhrase(b.countertop.finish) : 'material not chosen yet: plain polished light-grey quartz, no veining'}.`
    );
  }
  for (const o of b.obstacles) {
    lines.push(`${o.ref}: ${o.type.toLowerCase()} ${mm(o.sizeMm.width)} × ${mm(o.sizeMm.depth)}, ${o.floorToCeiling ? 'floor to ceiling' : `${mm(o.box.minZ)}–${mm(o.box.maxZ)} high`}, finished like the wall it stands against.`);
  }
  for (const o of b.openings) {
    if (o.door && o.door.state !== DOOR_STATE_LABELS.doorway) lines.push(`Door ${o.ref} leaf: ${finishPhrase(o.door.leafFinish, UNSET.door)}.`);
    lines.push(`Through ${o.ref}: ${o.outside}.`);
  }

  // Grouped like the cabinets, so four plain walls are one clause.
  const wallsByFinish = new Map<string, string[]>();
  for (const w of b.room.walls) {
    const key = finishPhrase(w.finish, UNSET.wall);
    wallsByFinish.set(key, [...(wallsByFinish.get(key) ?? []), w.wall]);
  }
  const wallClauses = [...wallsByFinish].map(([phrase, ws]) =>
    ws.length === 4 ? `all four ${phrase}` : `${ws.join(' and ')} ${phrase}`
  );
  lines.push(`Walls: ${wallClauses.join('; ')}.`);
  lines.push(`Floor: ${finishPhrase(b.room.floor, UNSET.floor)}. Ceiling: ${finishPhrase(b.room.ceiling, UNSET.ceiling)}.`);

  const on = b.lighting.fixtures.filter((f) => f.on);
  const daylit = b.openings.filter((o) => o.daylight);
  const light: string[] = [];
  if (daylit.length) light.push(daylit.map((o) => `${o.daylight!.mode.toLowerCase()} (${o.daylight!.colourTempK} K) through ${o.ref}`).join(', '));
  if (on.length) light.push(on.map((f) => `${f.quantity > 1 ? `${f.quantity}× ` : ''}${f.kind.toLowerCase()} ${f.colourTempK} K at (${f.positionMm.x}, ${f.positionMm.y}, ${f.positionMm.z}) throwing ${f.throws}`).join('; '));
  lines.push(
    light.length
      ? `Lighting: ${light.join('; ')}. Keep colour temperatures as stated; they change how the finishes look.`
      : 'Lighting: soft, neutral (about 4000 K) ambient light only; no visible light fittings.'
  );

  const inv = Object.entries(b.inventory)
    .map(([k, n]) => `${k}: ${n}`)
    .join('; ');
  lines.push(`Exact counts — ${inv}. Nothing else.`);
  lines.push(`Not in this room: ${b.notInThisRoom.join(', ')}.`);
  lines.push('Style: natural, true-to-colour architectural interior photography, clean and uncluttered, sharp, realistic materials and soft shadows. No text, letters, numbers, labels or reference codes anywhere in the image, and no watermark.');

  const instructions = [
    'You are producing ONE photorealistic image of a real kitchen that has already been designed and measured. It is a specification, not inspiration: the customer will compare the photo with what gets built.',
    // §112: a lighter model painted "C3", "A4", "O1"… onto the cabinets.
    // Said first and in capitals because it is the one mistake that ruins
    // an image outright.
    'NEVER DRAW ANY TEXT. No letters, numbers, labels, reference codes (C1, A2, O1…), dimensions or captions anywhere in the image. The codes in this file are for your reasoning only.',
    geometryInstruction(b.referenceImages),
    '2. USE THE JSON AS THE SOURCE OF TRUTH for what each shape is: cabinet fronts (doors vs drawers, counts, handle positions), finishes, handles, appliances, openings and lights. Refs (C1, A2, O1…) tie the data to the attached drawings; they are never drawn.',
    '3. ADD NOTHING. No extra cabinets, appliances, windows, shelves, backsplash tiles, lights, decor, people or clutter. Everything in `notInThisRoom` must be absent.',
    `4. "Not specified" is not permission to invent: ${b.room.notSpecifiedMeans}`,
    '5. Finishes: when `swatchImageUrl` is given, match that photo (pattern, colour, scale from `swatchRepeatMm`); otherwise match `colourHex`/`colourName`, `pattern` and `sheen` exactly.',
    '6. Units are millimetres; `coordinateSystem` explains the axes. `fromLeftMm` is measured standing in the room facing that wall.',
    '7. If something cannot be honoured, leave it plain rather than guessing.',
    'Two prompts are generated from the same data: `imagePrompt` (complete, with refs and sizes; use it with this file and the attached images) and `imagePromptCondensed` (short and purely visual, for diffusion models), each with `negativePrompt`.',
  ].join('\n');

  const negativeTerms = [
    'extra cabinets',
    'extra appliances',
    'extra windows or doors',
    'wrong number of drawers or doors',
    'moved or resized cabinets',
    'clutter',
    'decor',
    'plants',
    'people',
    'text',
    'letters',
    'numbers',
    'labels',
    'reference codes',
    'watermark',
    'logo',
    'distorted perspective',
    'fisheye',
    'warped lines',
    'cartoon',
    'CGI look',
    'oversaturated',
    ...b.notInThisRoom,
  ];
  // Deduped: the generic terms and the absences overlap ("plants",
  // "people"), and a repeated term only costs tokens.
  const negativePrompt = [...new Set(negativeTerms)].join(', ');

  return {
    instructions,
    imagePrompt: lines.join('\n'),
    imagePromptCondensed: condensedPrompt(b),
    imagePromptShort: shortPrompt(b),
    negativePrompt,
    negativePromptShort: shortNegative(b),
  };
}

// ---- The condensed prompt ----
//
// For diffusion text encoders (CLIP/T5): no refs, no millimetres, no
// item-by-item list. Materials are grouped by what you SEE (base run,
// upper run, tall units, slab, walls, floor), and the order is fixed —
// room and camera, materials, appliances, light, style — so if a model
// truncates, it loses the style tags rather than the cabinets. Kept to
// CONDENSED_MAX_WORDS by dropping optional sentences in a set order
// (see dropRank), never by cutting mid-sentence.

export const CONDENSED_MAX_WORDS = 200;

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

// "dark brown wood-grain laminate, matte". No brand, code or hex: an
// encoder can't use them, and they cost tokens.
// Lower-case for prose, but keep trade acronyms (PU, RO, OTG, LED) —
// "pu" and "ro" read as nonsense words to an encoder and to a person.
export function proseCase(s: string): string {
  return s
    .split(/(\s+)/)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w.replace(/[^A-Za-z0-9]/g, '')) && /[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join('');
}

// Catalogue labels carry sizes ("4-Burner Hob (600mm)"); the condensed
// prompt has no millimetres, and a size reads as an object to paint.
export function withoutSizes(s: string): string {
  return s.replace(/\s*\(?\b\d+(\.\d+)?\s*(mm|cm|m)\b\)?/gi, '').replace(/\s+/g, ' ').trim();
}

// "a hob", "an RO purifier", "an under-sink purifier". An acronym goes by
// its first letter's SOUND: R is "ar", so "an RO".
export function withArticle(phrase: string): string {
  if (/^(a|an|the) /i.test(phrase)) return phrase;
  const first = phrase.split(/\s+/)[0] ?? '';
  const acronym = /^[A-Z0-9]{2,}$/.test(first);
  const an = acronym ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first);
  return `${an ? 'an' : 'a'} ${phrase}`;
}

const SHEEN_WORD: Record<string, string> = {
  'high gloss': 'high-gloss',
  gloss: 'glossy',
  'satin / soft sheen': 'satin',
  matte: 'matte',
  'polished metal': 'polished metal',
  'brushed metal': 'brushed metal',
};

// "off-white high-gloss acrylic", "teak wood-grain veneer". No brand,
// code, hex or internal comma (finishes are joined with "and", and the
// negative prompt is comma-separated). Words the name repeats from the
// type or pattern ("Teak Veneer" + veneer) are dropped.
export function shortFinish(f: FinishDescription | null, ifUnset: string): string {
  if (!f) return ifUnset;
  const type = proseCase(f.type);
  const pattern = f.pattern === PATTERN_CATEGORY_LABELS.solid ? '' : f.pattern.toLowerCase().replace(' / ', '-').replace(' grain', '-grain');
  const known = new Set(`${type} ${pattern}`.toLowerCase().split(/[\s-]+/));
  // A photographed finish has no stored colour; its name ("Walnut",
  // "Statuario") is then the only colour word there is. Codes dropped.
  const name = f.name
    .replace(/\b[A-Z]*\d[\w-]*\b/g, '')
    .split(/\s+/)
    .filter((w) => w && !known.has(w.toLowerCase()))
    .join(' ');
  const colour = f.colourName ?? (name ? proseCase(name) : '');
  const sheen = SHEEN_WORD[f.sheen] ?? f.sheen;
  return [colour, sheen, pattern, type].filter(Boolean).join(' ');
}

// Single-wall, L, parallel, U — from which walls carry a run of units.
export function kitchenShape(cabinets: CabinetEntry[]): string {
  const walls = new Set(cabinets.filter((c) => c.against && c.box.minZ < 900).map((c) => c.against!.wall));
  const island = cabinets.some((c) => !c.against);
  // No run against any wall yet: no shape word at all (it used to say
  // "modular modular kitchen").
  let shape: string;
  if (walls.size === 0) shape = '';
  else if (walls.size === 1) shape = 'single-wall';
  else if (walls.size === 2) {
    const [a, b] = [...walls];
    const opposite = (a === 'north' && b === 'south') || (a === 'south' && b === 'north') || (a === 'east' && b === 'west') || (a === 'west' && b === 'east');
    shape = opposite ? 'parallel galley' : 'L-shaped';
  } else shape = 'U-shaped';
  const kitchen = shape ? `${shape} modular kitchen` : 'modular kitchen';
  return island ? `${kitchen} with an island` : kitchen;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// A neutral metal reads as what the trade calls it — "brushed steel",
// "polished chrome", "matte black" — not "light grey polished metal".
export function metalColour(h: NonNullable<CabinetEntry['handle']>): string {
  const metal = h.finish.endsWith('metal');
  const neutral = /white|grey|black/.test(h.colourName);
  if (!metal || !neutral) return `${h.colourName} ${h.finish}`;
  if (h.colourName === 'black' || h.colourName === 'charcoal grey') return h.finish.startsWith('polished') ? 'gloss black metal' : 'matte black metal';
  return h.finish.startsWith('polished') ? 'polished chrome' : 'brushed steel';
}

// The run's finishes, most-used first, with its most-used handle.
function runPhrase(cabinets: CabinetEntry[]): string {
  const byFinish = new Map<string, number>();
  for (const c of cabinets) {
    const k = shortFinish(c.finish, 'a plain light finish');
    byFinish.set(k, (byFinish.get(k) ?? 0) + 1);
  }
  const finishes = [...byFinish].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const handles = new Map<string, number>();
  for (const c of cabinets) {
    if (!c.handle) continue;
    const k =
      c.handle.kind === 'handleless'
        ? 'handleless push-to-open fronts'
        : c.handle.kind === 'gola'
          ? `${c.handle.colourName} gola channel profiles`
          : c.handle.kind === 'edge-profile'
            ? `${c.handle.colourName} edge-profile handles`
            : `${metalColour(c.handle)} ${c.handle.kind} handles`;
    handles.set(k, (handles.get(k) ?? 0) + 1);
  }
  const handle = [...handles].sort((a, b) => b[1] - a[1])[0]?.[0];
  return `${joinAnd(finishes)}${handle ? `, with ${handle}` : ''}`;
}

// `maxWords` lets a caller reserve room for its own prefix.
export function condensedPrompt(b: Omit<RenderBrief, 'prompt'>, maxWords = CONDENSED_MAX_WORDS): string {
  // dropRank: 0 = never dropped; higher drops first.
  const parts: { text: string; dropRank: number }[] = [];
  const add = (text: string, dropRank = 0) => text && parts.push({ text, dropRank });

  // 1. Room and camera.
  const v = b.view;
  const camera = !v
    ? 'Eye-level photograph'
    : v.mode === 'walkthrough'
      ? `Eye-level photograph looking toward the ${v.facingWall} wall`
      : 'Elevated three-quarter view';
  const windows = b.openings.filter((o) => o.kind === 'Window').length;
  const doors = b.openings.filter((o) => o.kind === 'Door').length;
  const openingWords = [
    windows ? `${windows === 1 ? 'one window' : `${windows} windows`}` : '',
    doors ? `${doors === 1 ? 'one door' : `${doors} doors`}` : '',
  ].filter(Boolean);
  add(
    `${camera} of a compact ${kitchenShape(b.cabinets)} in an Indian apartment, about ${(b.room.widthMm / 1000).toFixed(1)} by ${(b.room.depthMm / 1000).toFixed(1)} m, ${(b.room.ceilingHeightMm / 1000).toFixed(1)} m ceiling${openingWords.length ? `, ${joinAnd(openingWords)}` : ''}.`
  );

  // 2. Materials, by visual group.
  const base = b.cabinets.filter((c) => c.countertop);
  const upper = b.cabinets.filter((c) => c.type === MODULE_LABELS['wall-cabinet']);
  const tall = b.cabinets.filter((c) => c.type === MODULE_LABELS['tall-unit'] || c.type === MODULE_LABELS['pantry-unit']);
  if (base.length) add(`Base cabinets in ${runPhrase(base)}.`);
  if (upper.length) add(`Upper wall cabinets in ${runPhrase(upper)}.`);
  if (tall.length) add(`Tall units in ${runPhrase(tall)}.`, 3);
  const hasSink = b.appliances.some((a) => a.type === APPLIANCE_TYPE_LABELS.sink);
  if (b.countertop) {
    add(`Continuous ${shortFinish(b.countertop.finish, 'plain polished light-grey stone')} countertop${hasSink ? ' with an inset sink and tap' : ''}.`);
  }
  const wallFinishes = [...new Set(b.room.walls.map((w) => shortFinish(w.finish, 'plain off-white matte paint')))];
  add(`Walls ${joinAnd(wallFinishes)}; no backsplash tiles unless stated.`, 2);
  add(`Floor ${shortFinish(b.room.floor, 'plain light-grey tiles')}.`, 2);

  // 3. Appliances and structure.
  const has = (label: string) => b.appliances.find((a) => a.type === label);
  const appl: string[] = [];
  const hob = has(APPLIANCE_TYPE_LABELS.stove);
  const chimney = has(APPLIANCE_TYPE_LABELS.chimney);
  if (hob) appl.push(`${proseCase(withoutSizes(hob.model ?? 'built-in hob'))}${chimney ? ' under a chimney hood' : ''}`);
  else if (chimney) appl.push('a chimney hood');
  for (const label of [APPLIANCE_TYPE_LABELS.fridge, APPLIANCE_TYPE_LABELS.microwave, APPLIANCE_TYPE_LABELS.oven, APPLIANCE_TYPE_LABELS.otg, APPLIANCE_TYPE_LABELS.dishwasher, APPLIANCE_TYPE_LABELS['water-purifier']]) {
    const a = has(label);
    if (a) appl.push(proseCase(withoutSizes(a.model ?? a.type)));
  }
  // One flowing paragraph, not a list of labelled fields: image models'
  // text encoders read prose better than "Key: value".
  if (appl.length) add(`It has ${joinAnd(appl.map(withArticle))}.`, 1);
  const pillars = b.obstacles.filter((o) => o.floorToCeiling);
  if (pillars.length) add(`${pillars.length === 1 ? 'A plastered floor-to-ceiling pillar' : `${pillars.length} plastered floor-to-ceiling pillars`} built into the walls.`, 4);

  // 4. Light.
  const light: string[] = [];
  for (const o of b.openings) if (o.daylight) light.push(`${o.daylight.mode.toLowerCase()} at ${o.daylight.colourTempK} K from the ${o.kind.toLowerCase()}`);
  const fixturesOn = new Map<string, number>();
  for (const f of b.lighting.fixtures.filter((x) => x.on)) {
    const k = `${f.colourTempK} K ${f.kind.toLowerCase()}`;
    fixturesOn.set(k, (fixturesOn.get(k) ?? 0) + f.quantity);
  }
  for (const [k] of fixturesOn) light.push(`${k} lighting`);
  add(light.length ? `Lit by ${joinAnd(light)}.` : 'Soft, even neutral daylight.', 1);

  // 5. Style.
  add('Uncluttered architectural photograph, true-to-colour, realistic materials and soft shadows, sharp focus.');

  // Drop optional sentences, highest rank first, until within the cap.
  let kept = parts;
  for (const rank of [4, 3, 2, 1]) {
    if (wordCount(kept.map((p) => p.text).join(' ')) <= maxWords) break;
    kept = kept.filter((p) => p.dropRank !== rank);
  }
  return kept.map((p) => p.text).join(' ');
}

// ---- The short prompt (§104–§105) ----
//
// For tools with a prompt-length limit. Colours and materials first (a
// short prompt's first words weigh most), then appliances and light, then
// style; whole clauses are dropped from the end of the optional list
// until it fits. No counts, sizes or refs.

export const SHORT_PROMPT_MAX_CHARS = 400;
export const SHORT_NEGATIVE_MAX_CHARS = 300;

// The finish most cabinets wear, with their most common handle: the one
// sentence a short prompt can afford about the units.
function mainCabinetLook(cabinets: CabinetEntry[]): string | null {
  if (!cabinets.length) return null;
  const tally = (keys: string[]) => {
    const n = new Map<string, number>();
    for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const finish = tally(cabinets.map((c) => shortFinish(c.finish, 'plain light')));
  const handle = tally(
    cabinets
      .filter((c) => c.handle)
      .map((c) => (c.handle!.kind === 'handleless' ? 'handleless fronts' : `${metalColour(c.handle!)} ${c.handle!.kind} handles`))
  );
  return `${finish} cabinets${handle ? ` with ${handle}` : ''}`;
}

const sentence = (t: string) => `${t}.`.replace(/^./, (c) => c.toUpperCase());

export function shortPrompt(b: Omit<RenderBrief, 'prompt'>, maxChars = SHORT_PROMPT_MAX_CHARS): string {
  const first = `Photorealistic interior photo of a compact ${kitchenShape(b.cabinets)} in an Indian apartment.`;
  const look: string[] = [];
  const cabinets = mainCabinetLook(b.cabinets);
  if (cabinets) look.push(cabinets);
  if (b.countertop) look.push(`${shortFinish(b.countertop.finish, 'polished light-grey stone')} countertop`);
  look.push(`${shortFinish(b.room.floor, 'light-grey tile')} floor`);
  const optional: string[] = [];
  const hob = b.appliances.find((a) => a.type === APPLIANCE_TYPE_LABELS.stove);
  const chimney = b.appliances.some((a) => a.type === APPLIANCE_TYPE_LABELS.chimney);
  const sink = b.appliances.some((a) => a.type === APPLIANCE_TYPE_LABELS.sink);
  const kit = [
    hob ? `${withArticle(proseCase(withoutSizes(hob.model ?? 'built-in hob')))}${chimney ? ' under a chimney hood' : ''}` : '',
    sink ? 'an inset sink' : '',
  ].filter(Boolean);
  if (kit.length) optional.push(sentence(kit.join(' and ')));
  const light = [
    b.openings.some((o) => o.daylight) ? 'soft daylight from a window' : '',
    // "Warm" only where it is: 3,500 K and below.
    ...[...new Set(b.lighting.fixtures.filter((f) => f.on).map((f) => `${f.colourTempK <= 3500 ? 'warm ' : ''}${f.colourTempK} K ${f.kind.toLowerCase()}`))].slice(0, 1),
  ].filter(Boolean);
  if (light.length) optional.push(sentence(light.join(' and ')));
  const style = 'True-to-colour, uncluttered, sharp.';

  const lookSentence = sentence(look.join(', '));
  for (let keep = optional.length; keep >= 0; keep--) {
    const text = [first, lookSentence, ...optional.slice(0, keep), style].join(' ');
    if (text.length <= maxChars) return text;
  }
  return [first, lookSentence, style].join(' ').slice(0, maxChars);
}

// Counter clutter first: a model with only a short negative still added
// a dish rack and towel when that term was the one cut off (§104). Then
// the generic guards, then what's absent.
export function shortNegative(b: Omit<RenderBrief, 'prompt'>, maxChars = SHORT_NEGATIVE_MAX_CHARS): string {
  const terms = [...new Set(['text or labels', 'decor or utensils on the counters', 'clutter', 'extra cabinets', 'extra appliances', 'people', 'watermark', 'CGI look', 'distorted perspective', ...b.notInThisRoom])];
  const out: string[] = [];
  for (const t of terms) {
    if ([...out, t].join(', ').length > maxChars) break;
    out.push(t);
  }
  return out.join(', ');
}

function geometryInstruction(images: RenderBrief['referenceImages']): string {
  const elevations = images.find((i) => i.kind === 'elevations');
  const perspective = images.find((i) => i.kind === 'line-render');
  const colour = images.find((i) => i.kind === 'colour-render');
  const parts = ['1. GEOMETRY IS FIXED.'];
  if (elevations) {
    parts.push(
      `The attached elevation sheet (${elevations.file}) shows each wall straight on, to scale: reproduce every wall exactly as drawn — the same units in the same order and proportions, the same number of doors and drawers with handles where marked, openings and pillars where shown. Do not draw its lines, labels or hatching; it is a plan, not a style.`
    );
  }
  if (perspective) {
    parts.push(
      `The attached line render (${perspective.file}) is this exact design from the exact camera: use it as edge/structure guidance, keep every line where it is, and add the materials and light from this file. Do not draw the lines themselves.`
    );
  }
  if (colour) {
    parts.push(
      `The attached colour preview (${colour.file}) is the same view in colour: use it only to see which finish goes on which surface (ceiling, walls, floor, each cabinet front, the tambour shutter). It is a simplified computer render; make the result look like a real photograph, not like it.`
    );
  }
  if (!elevations && !perspective) parts.push('Place every item where the JSON says; keep the stated sizes and counts.');
  return parts.join(' ');
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- The view, from the live three.js camera ----

// World (metres, Y-up; scene3d.ts) → the brief's room frame (mm, z up).
// Heading is clockwise from north, where north is world −Z (plan −y).
export function viewFromWorldCamera(args: {
  mode: 'walkthrough' | 'orbit';
  cameraLabel?: string;
  position: [number, number, number];
  direction: [number, number, number];
  verticalFovDeg: number;
  imageWidthPx: number;
  imageHeightPx: number;
}): RenderBriefView {
  const [px, py, pz] = args.position;
  const { headingDeg: heading, pitchDeg: pitch } = lookAnglesFromDirection(args.direction);
  const facingWall: WallOrientation = (['north', 'east', 'south', 'west'] as const)[Math.round(heading / 90) % 4];
  return {
    mode: args.mode,
    cameraLabel: args.cameraLabel,
    positionMm: { x: r(px * 1000), y: r(pz * 1000), z: r(py * 1000) },
    headingDeg: r(heading),
    pitchDeg: r(pitch),
    facingWall,
    verticalFovDeg: r(args.verticalFovDeg),
    imageWidthPx: args.imageWidthPx,
    imageHeightPx: args.imageHeightPx,
  };
}

export function renderBriefFileStem(designName: string): string {
  const slug = designName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'kitchen';
}
