// src/components/canvas3d/GroutOverlay.tsx
//
// A seamless finish laid as tiles (§122): the grout grid drawn on a thin
// transparent plane just in front of the surface, so it works over any
// material (marble, terrazzo, paint, a plain colour) without touching its
// shader. Aligned from the room's corner and continuous across the pieces
// of a wall either side of a window (lib/tiling.ts groutRepeat).

import { useEffect, useMemo } from 'react';
import { groutTexture } from '../../lib/groutTexture';
import { groutRepeat, type SurfaceTiling } from '../../lib/tiling';

export function GroutOverlay({
  tiling,
  widthMm,
  heightMm,
  startAlongMm,
  startUpMm,
  reversed,
  position,
  rotation,
}: {
  tiling: SurfaceTiling;
  widthMm: number;
  heightMm: number;
  startAlongMm: number;
  startUpMm: number;
  reversed: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  // A clone per face: repeat/offset differ, the canvas is shared.
  const map = useMemo(() => {
    const { repeat, offset } = groutRepeat(tiling, widthMm, heightMm, startAlongMm, startUpMm, reversed);
    const t = groutTexture(tiling).clone();
    t.repeat.set(repeat[0], repeat[1]);
    t.offset.set(offset[0], offset[1]);
    t.needsUpdate = true;
    return t;
  }, [tiling, widthMm, heightMm, startAlongMm, startUpMm, reversed]);
  // The clone only; the shared canvas texture stays cached.
  useEffect(() => () => map.dispose(), [map]);

  return (
    <mesh position={position} rotation={rotation} renderOrder={1}>
      <planeGeometry args={[widthMm / 1000, heightMm / 1000]} />
      <meshStandardMaterial
        map={map}
        transparent
        alphaTest={0.05}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  );
}
