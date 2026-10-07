// src/components/designer/CabinetPreview3D.tsx
//
// The Cabinet Designer's 3D preview: the cabinet drawn as its actual
// PANELS — each side, the top or rails, bottom, back, shelves, fronts —
// at their real cut sizes and positions, coloured by board. Built from
// CutPart.boxes (lib/cutList.ts), the same call that produces the cut
// sizes and the price, so an unticked back disappears here, a 25mm side
// looks thicker, and rails show as rails — the picture can't disagree
// with the cutting list or the quote (§46).
//
// Deliberately NOT the walkthrough's CabinetMesh (Room3DCanvas.tsx).
// That draws the FINISHED cabinet — a sealed box behind doors — which
// would look identical whether or not the back was ticked, i.e. it would
// ignore everything this page edits. The finished look already lives in
// the room walkthrough.
//
// Coordinates: PartBox is mm, cabinet-local, +x right, +y up, +z front —
// the same handedness as three.js's default, so it's a straight scale
// by MM_TO_M (lib/scene3d.ts), no axis swap.

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import type { CutPart, PartBox } from '../../lib/cutList';
import type { PanelRole } from '../../types/cabinet';
import { MM_TO_M } from '../../lib/scene3d';

// Distinct, wood-like tones, assigned by board in order of first use, so
// two different boards in one cabinet are always told apart.
const BOARD_TONES = ['#d8b98a', '#a8c3a0', '#c9a0a0', '#9fb4cf', '#d6c27a', '#b8a2cf'];
const BACK_TONE = '#efe4cf';
const MISSING_TONE = '#e05252';
const HIGHLIGHT = '#f59e0b';

// Which way each panel moves in the exploded view — straight out from
// the face it belongs to.
const EXPLODE_DIR: Record<PanelRole | 'extra', [number, number, number]> = {
  leftSide: [-1, 0, 0],
  rightSide: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  back: [0, 0, -1],
  shelves: [0, 0, 0.4],
  fronts: [0, 0, 1],
  // Drawer boxes slide out the way a drawer does.
  drawerBoxes: [0, 0, 0.7],
  // Hand-entered extra parts have no position (no boxes), so this is
  // never actually used — present only to keep the map total.
  extra: [0, 0, 0],
};
const EXPLODE_MM = 160;

interface BoardTone {
  name: string;
  color: string;
}

// Also drives the legend under the canvas, so swatches match meshes.
function boardTones(parts: CutPart[]): Map<string, BoardTone> {
  const tones = new Map<string, BoardTone>();
  for (const p of parts) {
    const key = p.boardId ?? `missing:${p.boardName}`;
    if (tones.has(key)) continue;
    const color = !p.boardId
      ? MISSING_TONE
      : p.kind === 'back'
        ? BACK_TONE
        : BOARD_TONES[[...tones.values()].filter((t) => t.color !== BACK_TONE && t.color !== MISSING_TONE).length % BOARD_TONES.length];
    tones.set(key, { name: p.boardName, color });
  }
  return tones;
}

function Piece({
  box,
  part,
  color,
  highlighted,
  exploded,
  onHover,
  onPick,
}: {
  box: PartBox;
  part: CutPart;
  color: string;
  highlighted: boolean;
  exploded: boolean;
  onHover: (part: CutPart | null) => void;
  onPick: (role: PanelRole) => void;
}) {
  const dir = EXPLODE_DIR[part.role];
  const off = exploded ? EXPLODE_MM : 0;
  const position: [number, number, number] = [
    (box.cx + dir[0] * off) * MM_TO_M,
    (box.cy + dir[1] * off) * MM_TO_M,
    (box.cz + dir[2] * off) * MM_TO_M,
  ];
  return (
    <mesh
      position={position}
      rotation={[0, box.rotY ?? 0, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(part);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (part.role !== 'extra') onPick(part.role);
      }}
    >
      <boxGeometry args={[box.sx * MM_TO_M, box.sy * MM_TO_M, box.sz * MM_TO_M]} />
      <meshStandardMaterial
        color={highlighted ? HIGHLIGHT : color}
        roughness={0.8}
        transparent={part.kind === 'front'}
        opacity={part.kind === 'front' ? 0.85 : 1}
      />
      <Edges color={highlighted ? '#92400e' : '#6b5a45'} />
    </mesh>
  );
}

export function CabinetPreview3D({
  parts,
  widthMm,
  heightMm,
  depthMm,
  frontColor,
  highlightRole,
  onPickRole,
  undrawnCount,
}: {
  parts: CutPart[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  frontColor?: string;
  highlightRole: PanelRole | null;
  onPickRole: (role: PanelRole) => void;
  // Hand-entered extra parts have no position, so they aren't drawn —
  // said so under the canvas rather than silently missing.
  undrawnCount: number;
}) {
  const [showFronts, setShowFronts] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [hovered, setHovered] = useState<CutPart | null>(null);
  const tones = boardTones(parts);

  // Camera framed off the cabinet's own size, from the front-right and a
  // little above — how a cabinet is usually drawn in a catalogue.
  const span = Math.max(widthMm, heightMm, depthMm) * MM_TO_M;
  const camera: [number, number, number] = [span * 1.1, span * 0.7, span * 1.6];

  const visible = parts.filter((p) => showFronts || p.kind !== 'front');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-80 overflow-hidden rounded-md border border-gray-200 bg-gradient-to-b from-gray-50 to-gray-200">
        {/* Drawn only on change (§108): the preview is still unless dragged. */}
        <Canvas frameloop="demand" camera={{ position: camera, fov: 35, near: 0.01, far: 50 }} dpr={[1, 2]}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 4, 3]} intensity={1.1} />
          <directionalLight position={[-3, 2, -2]} intensity={0.35} />
          {visible.flatMap((part, i) =>
            part.boxes.map((box, j) => (
              <Piece
                key={`${i}-${j}`}
                box={box}
                part={part}
                color={
                  part.kind === 'front' && frontColor && part.boardId
                    ? frontColor
                    : (tones.get(part.boardId ?? `missing:${part.boardName}`)?.color ?? MISSING_TONE)
                }
                highlighted={highlightRole === part.role}
                exploded={exploded}
                onHover={setHovered}
                onPick={onPickRole}
              />
            ))
          )}
          <OrbitControls makeDefault enablePan={false} minDistance={span * 0.8} maxDistance={span * 5} />
        </Canvas>
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-white/85 px-2 py-1 text-[11px] text-gray-700">
          {hovered
            ? `${hovered.name} — ${hovered.lengthMm} × ${hovered.widthMm} × ${hovered.thicknessMm}mm, ${hovered.boardName}`
            : 'Drag to turn · scroll to zoom · click a panel to find its row'}
        </div>
      </div>
      {undrawnCount > 0 && (
        <span className="text-[11px] text-gray-500">
          + {undrawnCount} part{undrawnCount === 1 ? '' : 's'} not drawn here (extra parts have no fixed
          position; a corner carousel's pentagon top/bottom isn't a box) — listed and priced below.
        </span>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showFronts} onChange={(e) => setShowFronts(e.target.checked)} />
          Show fronts
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={exploded} onChange={(e) => setExploded(e.target.checked)} />
          Pull panels apart
        </label>
        <span className="ml-auto flex flex-wrap gap-2">
          {[...tones.values()].map((t) => (
            <span key={t.name + t.color} className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm border border-gray-400" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
