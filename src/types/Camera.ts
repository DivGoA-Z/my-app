// src/types/Camera.ts
//
// A "Camera Node" is a saved viewpoint on the 2D grid — the Phase 2
// bridge. Phase 2's 360° panorama viewer will generate one panorama
// node per CameraNode, using x/y as its floor position, heightMm as
// its eye height off the floor, and viewAngleDeg as its initial look
// direction. Nothing here renders a panorama — this is purely the
// Phase 1 authoring step (drop the node, aim it) that Phase 2 will
// consume later.
//
// Uses the SAME x/y grid (mm, room-origin-relative) as cabinets and
// obstacles, so it renders on RoomCanvas at the same scale with no
// conversion. Unlike cabinets/obstacles, x/y here is the camera's
// actual point position, not a bounding box's top-left corner — a
// camera has no footprint to speak of.

export interface CameraNode {
  id: string;
  layoutId: string;    // FK -> RoomLayout.id
  label: string;         // e.g. "Camera 1" — editable so a rep can name views ("Sink View", "Entry View")
  x: number;              // mm, room-origin-relative floor position
  y: number;
  viewAngleDeg: number;   // 0-359, clockwise from north/"up" (compass-style) — see CameraLayer.tsx
  heightMm: number;       // eye height off the floor
  // Step 2 of the walkthrough architecture (lib/panoramaCapture.ts +
  // lib/panoramaStorage.ts): the public URL of this node's captured
  // 360° equirectangular JPEG, once "Capture 360°" has been run for it
  // from the 3D preview (Room3DCanvas.tsx) — undefined until then.
  // Lives directly on the node (not a separate table) since `cameras`
  // is already a JSONB array column on `layouts` — see schema.sql.
  panoramaUrl?: string;
  panoramaCapturedAt?: string; // ISO timestamp of the last capture, for "captured 2 days ago" UI
  createdAt: string;
  updatedAt: string;
}

// Standard adult eye height, used as the default for every new camera
// node. Kept as a named export (not just inlined) since Phase 2's
// panorama generation will likely want to reference the same constant.
export const DEFAULT_CAMERA_HEIGHT_MM = 1600;

/*
Example JSON:

{
  "id": "cam_001",
  "layoutId": "layout_001",
  "label": "Sink View",
  "x": 1500,
  "y": 800,
  "viewAngleDeg": 180,
  "heightMm": 1600,
  "createdAt": "2026-08-29T10:00:00.000Z",
  "updatedAt": "2026-08-29T10:00:00.000Z"
}
*/
