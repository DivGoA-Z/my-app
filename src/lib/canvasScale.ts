// src/lib/canvasScale.ts
//
// Shared mm-to-px scale math so every canvas layer (grid, obstacles,
// cabinets) positions things identically. Compute once per render with
// the same widthMm/depthMm/maxWidthPx/maxHeightPx and every layer lines
// up automatically.

export const CANVAS_PADDING_PX = 60; // reserved for dimension labels

export interface RoomScale {
  scale: number;       // px per mm
  roomWidthPx: number;
  roomHeightPx: number;
  originX: number;      // px, top-left of the room rect on the Stage
  originY: number;
}

export function computeRoomScale(
  widthMm: number,
  depthMm: number,
  maxWidthPx: number,
  maxHeightPx: number
): RoomScale {
  const availableWidthPx = maxWidthPx - CANVAS_PADDING_PX * 2;
  const availableHeightPx = maxHeightPx - CANVAS_PADDING_PX * 2;
  const scale = Math.min(availableWidthPx / widthMm, availableHeightPx / depthMm);

  return {
    scale,
    roomWidthPx: widthMm * scale,
    roomHeightPx: depthMm * scale,
    // Centred in the space (§89). Was always the top-left padding,
    // which left a wide plan hugging the left edge with empty space to
    // its right (seen in Present mode). Every layer reads these two, so
    // they all move together.
    originX: Math.max(CANVAS_PADDING_PX, (maxWidthPx - widthMm * scale) / 2),
    originY: Math.max(CANVAS_PADDING_PX, (maxHeightPx - depthMm * scale) / 2),
  };
}
