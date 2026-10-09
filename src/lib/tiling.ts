// src/lib/tiling.ts
//
// Laying a floor or wall as tiles (§122): tile size, straight or offset
// rows, and grout. Two cases, decided by the finish:
//
//   - A photo that ALREADY shows tiles (a vitrified, ceramic, wall or
//     mosaic tile photo, or any finish with its tile size recorded): the
//     grout is part of the photo, so a tile size RESCALES the photo until
//     its tiles are that size. Needs the photo's own tile size
//     (SurfaceFinish.tileWidthMm/HeightMm); without it the size can't be
//     changed, and the picker says where to set it.
//   - Anything seamless (marble, granite, terrazzo, microcement, paint, a
//     plain colour): the app DRAWS a grout grid over the surface at the
//     chosen size, width and colour (GroutOverlay in the 3D view).
//
// Pure maths only; the 3D view and the picker read it.

import type { SurfaceFinish } from '../types/finish';

export type TilePattern = 'straight' | 'offset';

export interface SurfaceTiling {
  tileWidthMm: number;
  tileHeightMm: number;
  pattern: TilePattern;
  groutMm: number;
  groutColor: string; // hex
}

export const TILE_SIZE_PRESETS: [number, number][] = [
  [300, 300],
  [600, 600],
  [600, 1200],
  [800, 800],
  [800, 1600],
  [1200, 1200],
  [75, 150],
  [75, 300],
];

export const GROUT_COLOURS: { label: string; hex: string }[] = [
  { label: 'White', hex: '#f2f0eb' },
  { label: 'Light grey', hex: '#c9c7c2' },
  { label: 'Grey', hex: '#8f8d88' },
  { label: 'Beige', hex: '#cdbfa6' },
  { label: 'Charcoal', hex: '#3b3a38' },
];

export const DEFAULT_TILING: SurfaceTiling = {
  tileWidthMm: 600,
  tileHeightMm: 600,
  pattern: 'straight',
  groutMm: 2,
  groutColor: GROUT_COLOURS[1].hex,
};

const TILE_PHOTO_TYPES = ['vitrified tile', 'ceramic tile', 'wall tile', 'mosaic', 'tile'];

type FinishTileInfo = Pick<SurfaceFinish, 'finishTypeLabel' | 'albedoUrl' | 'tileWidthMm' | 'tileHeightMm'>;

// Whether the finish's photo already shows tiles (and its grout).
export function hasBakedTiles(finish: FinishTileInfo): boolean {
  if (finish.tileWidthMm) return true;
  return !!finish.albedoUrl && TILE_PHOTO_TYPES.includes(finish.finishTypeLabel.trim().toLowerCase());
}

export type LayingMode =
  | { kind: 'rescale'; scaleX: number; scaleY: number } // stretch the photo's own tiles
  | { kind: 'overlay' } // draw a grout grid
  | { kind: 'unknown-size' } // a tile photo whose tile size isn't recorded
  | { kind: 'none' };

export function tilingMode(finish: FinishTileInfo | undefined, tiling: SurfaceTiling | null | undefined): LayingMode {
  if (!tiling || !finish) return { kind: 'none' };
  if (!hasBakedTiles(finish)) return { kind: 'overlay' };
  if (!finish.tileWidthMm || !finish.tileHeightMm) return { kind: 'unknown-size' };
  return { kind: 'rescale', scaleX: tiling.tileWidthMm / finish.tileWidthMm, scaleY: tiling.tileHeightMm / finish.tileHeightMm };
}

// The finish as the 3D view should tile it: a baked-tile photo with its
// swatch scaled so its tiles come out at the chosen size.
export function finishForTiling<F extends Pick<SurfaceFinish, 'swatchWidthMm' | 'swatchHeightMm'> & FinishTileInfo>(
  finish: F,
  tiling: SurfaceTiling | null | undefined
): F {
  const mode = tilingMode(finish, tiling);
  if (mode.kind !== 'rescale') return finish;
  return { ...finish, swatchWidthMm: finish.swatchWidthMm * mode.scaleX, swatchHeightMm: finish.swatchHeightMm * mode.scaleY };
}

// ---- The drawn grout grid ----

// One repeat of the grid as a picture: a tile wide, and one tile tall
// (straight) or two (offset: the second row shifted half a tile). Grout
// is centred on the cell's edges so repeats join into whole lines.
export interface GroutCell {
  widthPx: number;
  heightPx: number;
  groutPx: number;
  rows: 1 | 2;
  // Vertical joint positions (px from the left), per row.
  joints: number[][];
}

export const GROUT_CELL_PX = 512;

export function groutCell(t: SurfaceTiling): GroutCell {
  const pxPerMm = GROUT_CELL_PX / t.tileWidthMm;
  const rows = t.pattern === 'offset' ? 2 : 1;
  return {
    widthPx: GROUT_CELL_PX,
    heightPx: Math.max(8, Math.round(t.tileHeightMm * pxPerMm * rows)),
    // At least a pixel and a half, or a 2mm joint on a large tile
    // vanishes once the texture is shrunk for distance.
    groutPx: Math.max(1.5, t.groutMm * pxPerMm),
    rows,
    joints: rows === 1 ? [[0]] : [[0], [GROUT_CELL_PX / 2]],
  };
}

// How many repeats of the cell cover a face, and where the grid starts,
// so tiles line up from the room's corner and carry on across the
// pieces of a wall either side of a window. `startAlongMm`/`startUpMm`
// is where the face begins; `reversed` when the face's U runs against
// the wall's own direction (south and west walls, seen from inside).
export function groutRepeat(
  t: SurfaceTiling,
  faceWidthMm: number,
  faceHeightMm: number,
  startAlongMm: number,
  startUpMm: number,
  reversed: boolean
): { repeat: [number, number]; offset: [number, number] } {
  const cellH = t.tileHeightMm * (t.pattern === 'offset' ? 2 : 1);
  const repeatU = faceWidthMm / t.tileWidthMm;
  const repeatV = faceHeightMm / cellH;
  const offsetU = reversed ? -(startAlongMm + faceWidthMm) / t.tileWidthMm : startAlongMm / t.tileWidthMm;
  const offsetV = startUpMm / cellH;
  const frac = (n: number) => n - Math.floor(n);
  return { repeat: [repeatU, repeatV], offset: [frac(offsetU), frac(offsetV)] };
}

// "600×1200 mm tiles, offset, 2 mm light grey grout", for the inspector
// row and the image brief.
export function describeTiling(t: SurfaceTiling): string {
  const grout = GROUT_COLOURS.find((g) => g.hex.toLowerCase() === t.groutColor.toLowerCase())?.label.toLowerCase() ?? t.groutColor;
  return `${t.tileWidthMm}×${t.tileHeightMm} mm tiles${t.pattern === 'offset' ? ', offset rows' : ''}, ${t.groutMm} mm ${grout} grout`;
}
