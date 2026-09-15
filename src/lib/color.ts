// src/lib/color.ts
//
// Colour conversion and classification. Split out of
// components/common/ColorPicker.tsx because React Fast Refresh only
// works when a module exports components and nothing else — mixing
// these helpers in with the component silently disabled hot reload for
// that file.
//
// Everything here is pure and dependency-free, so it's also usable from
// anywhere else that needs to reason about colour (the quote, a future
// palette report) without pulling in a React component.

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

export type ColorFamily =
  | 'neutral'
  | 'wood'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple';

export const COLOR_FAMILY_LABELS: Record<ColorFamily, string> = {
  neutral: 'Neutral',
  wood: 'Wood tone',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

// Kitchen-relevant starting points rather than a generic rainbow: the
// neutrals and wood tones most shutters actually are, plus a few
// accents for the occasional bold island or tall unit.
export const PRESET_SWATCHES = [
  '#f7f5f2', '#e8e4dc', '#d6d1c7', '#b8b2a7', '#8a857c', '#4a4741', '#23211e',
  '#e0c49a', '#c08a4e', '#96622f', '#6b4423', '#3f2a18',
  '#b03a2e', '#c0562f', '#d9a520', '#4f7942', '#2e5c8a', '#5b4b8a',
];

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const FALLBACK_RGB = { r: 220, g: 215, b: 207 };

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const int = parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return FALLBACK_RGB;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (n: number) =>
    Math.round(clamp01(n / 255) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

// Derived from HSV rather than tagged per swatch, so a colour picked
// freehand on the picker's square gets classified exactly the same way
// a preset does — the label always agrees with the filter chips.
export function colorFamily(hex: string): ColorFamily {
  const { h, s, v } = hexToHsv(hex);

  // Barely-saturated or very dark colours read as neutral regardless of
  // hue — a near-white with a 200-degree hue is off-white, not "blue",
  // and most kitchen shutters live in exactly that zone.
  if (s < 0.15 || v < 0.12) return 'neutral';

  // Browns are oranges at reduced value — there's no brown hue. Kitchens
  // are full of them, so they get their own family rather than being
  // dumped in with bright orange.
  if (h >= 15 && h < 50 && v < 0.75) return 'wood';

  if (h < 15 || h >= 330) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 260) return 'blue';
  return 'purple';
}

export const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
