// src/components/common/ColorPicker.tsx
//
// Drag-to-pick colour control: a saturation/value square, a hue strip,
// a hex field, and a filterable preset palette.
//
// Hand-built rather than pulling in react-colorful or similar. It's a
// modest amount of well-understood HSV maths (lib/color.ts) against a
// dependency that would need installing, versioning and trusting — and
// this project has already hit friction with npm installs mid-session.
//
// Works in HSV, not HSL, because the saturation/value square is the
// interaction people expect from a colour picker: hue on its own axis,
// then a 2D area where right = more colourful and up = brighter. HSL's
// lightness axis makes that square behave oddly at the top (everything
// converges to white through a washed-out band).
//
// This file exports ONLY the component — the conversion helpers live in
// lib/color.ts because React Fast Refresh silently stops working on any
// module that exports a mix of components and other values.

import { useRef, useState } from 'react';
import { Button } from '../ui/button';
import {
  COLOR_FAMILY_LABELS,
  parseHexInput,
  PRESET_SWATCHES,
  clamp01,
  colorFamily,
  hexToHsv,
  hsvToHex,
} from '../../lib/color';
import type { ColorFamily } from '../../lib/color';

export interface ColorPickerProps {
  value: string; // hex, e.g. "#c08a4e"
  onChange: (hex: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const hsv = hexToHsv(value);
  const [familyFilter, setFamilyFilter] = useState<ColorFamily | null>(null);
  // The hex box's own text. Follows `value` when the colour changes
  // elsewhere (adjusted during render, not in an effect), but keeps an
  // unfinished code while typing.
  const [hexDraft, setHexDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (parseHexInput(hexDraft) !== value.toLowerCase()) setHexDraft(value);
  }
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Shared drag handling for both the square and the hue strip.
  // setPointerCapture keeps the drag tracking even when the pointer
  // leaves the element, which is what makes dragging past the edge feel
  // right rather than sticking.
  function trackDrag(
    element: HTMLDivElement | null,
    event: React.PointerEvent,
    handler: (xRatio: number, yRatio: number) => void
  ) {
    if (!element) return;
    element.setPointerCapture(event.pointerId);

    const apply = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      handler(
        clamp01((clientX - rect.left) / rect.width),
        clamp01((clientY - rect.top) / rect.height)
      );
    };

    apply(event.clientX, event.clientY);

    const onMove = (e: PointerEvent) => apply(e.clientX, e.clientY);
    const onUp = (e: PointerEvent) => {
      element.releasePointerCapture(e.pointerId);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
  }

  const visibleSwatches = familyFilter
    ? PRESET_SWATCHES.filter((hex) => colorFamily(hex) === familyFilter)
    : PRESET_SWATCHES;

  const families = Object.keys(COLOR_FAMILY_LABELS) as ColorFamily[];

  return (
    <div className="flex w-56 flex-col gap-2">
      {/* Saturation / value square */}
      <div
        ref={squareRef}
        onPointerDown={(e) =>
          trackDrag(squareRef.current, e, (x, y) =>
            onChange(hsvToHex({ h: hsv.h, s: x, v: 1 - y }))
          )
        }
        className="relative h-28 w-full cursor-crosshair rounded border border-gray-300"
        style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
      >
        <div
          className="absolute inset-0 rounded"
          style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }}
        />
        <div
          className="absolute inset-0 rounded"
          style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }}
        />
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      {/* Hue strip */}
      <div
        ref={hueRef}
        onPointerDown={(e) =>
          trackDrag(hueRef.current, e, (x) => onChange(hsvToHex({ ...hsv, h: x * 360 })))
        }
        className="relative h-3 w-full cursor-ew-resize rounded border border-gray-300"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-white/40 shadow"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      {/* Current value + detected family */}
      <div className="flex items-center gap-2">
        <div
          className="h-6 w-6 shrink-0 rounded border border-gray-300"
          style={{ backgroundColor: value }}
        />
        {/* Typed freely (§115): this box used to be bound straight to
            `value` and refused every partial code, so each keystroke
            snapped back and nothing could be typed. Now it holds its own
            text, applies the colour the moment the code is complete (with
            or without '#', 3 or 6 digits), and follows the swatches and
            the square when those change the colour. */}
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
          Hex
          <input
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const hex = parseHexInput(e.target.value);
              if (hex) onChange(hex);
            }}
            onBlur={() => setHexDraft(value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            spellCheck={false}
            aria-label="Hex colour code"
            aria-invalid={parseHexInput(hexDraft) === null}
            placeholder="#c08a4e"
            className="h-9 w-28 rounded-[8px] border border-input bg-card px-2 font-mono text-[13px] font-normal text-foreground aria-invalid:border-destructive"
          />
        </label>
        <span className="text-[10px] text-gray-500">{COLOR_FAMILY_LABELS[colorFamily(value)]}</span>
      </div>

      {/* Family filter + presets */}
      <div className="flex flex-wrap gap-1">
        <Button
          variant={familyFilter === null ? 'default' : 'secondary'}
          size="icon-xs"
          className="h-auto w-auto px-1.5 py-0.5 text-[10px]"
          onClick={() => setFamilyFilter(null)}
        >
          All
        </Button>
        {families.map((family) => (
          <Button
            key={family}
            variant={familyFilter === family ? 'default' : 'secondary'}
            size="icon-xs"
            className="h-auto w-auto px-1.5 py-0.5 text-[10px]"
            onClick={() => setFamilyFilter(family === familyFilter ? null : family)}
          >
            {COLOR_FAMILY_LABELS[family]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {visibleSwatches.map((hex) => (
          <button
            key={hex}
            onClick={() => onChange(hex)}
            title={hex}
            className={`h-5 w-5 rounded border ${
              hex.toLowerCase() === value.toLowerCase()
                ? 'border-gray-800 ring-1 ring-gray-400'
                : 'border-gray-300'
            }`}
            style={{ backgroundColor: hex }}
          />
        ))}
        {visibleSwatches.length === 0 && (
          <span className="text-[10px] text-gray-400">No presets in this family.</span>
        )}
      </div>
    </div>
  );
}
