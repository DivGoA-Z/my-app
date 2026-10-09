// src/lib/groutTexture.ts
//
// The drawn grout grid (§122) as a texture: one repeat of the grid
// (lib/tiling.ts groutCell) painted on a transparent canvas, grout lines
// centred on the cell's edges so repeats join into whole lines. Cached by
// what it looks like, so every wall with the same tiling shares one.

import * as THREE from 'three';
import { groutCell, type SurfaceTiling } from './tiling';

const cache = new Map<string, THREE.CanvasTexture>();

export function groutTexture(t: SurfaceTiling): THREE.CanvasTexture {
  const key = `${t.tileWidthMm}x${t.tileHeightMm}|${t.pattern}|${t.groutMm}|${t.groutColor}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cell = groutCell(t);
  const canvas = document.createElement('canvas');
  canvas.width = cell.widthPx;
  canvas.height = cell.heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = t.groutColor;
  const g = cell.groutPx;
  const rowH = cell.heightPx / cell.rows;
  // Horizontal joints: on each row boundary (top/bottom edges wrap).
  for (let r = 0; r <= cell.rows; r++) ctx.fillRect(0, r * rowH - g / 2, cell.widthPx, g);
  // Vertical joints, per row; one at x=0 is drawn at both edges so the
  // wrap joins it.
  cell.joints.forEach((xs, r) => {
    for (const x of xs) {
      const y0 = r * rowH;
      if (x === 0) {
        ctx.fillRect(0, y0, g / 2, rowH);
        ctx.fillRect(cell.widthPx - g / 2, y0, g / 2, rowH);
      } else {
        ctx.fillRect(x - g / 2, y0, g, rowH);
      }
    }
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}
