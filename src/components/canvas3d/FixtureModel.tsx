// src/components/canvas3d/FixtureModel.tsx
//
// Renders a placed light fixture's BODY as a real GLTF model instead of
// the primitive bar/disc, fitted to a fixed real-world size — mirrors
// ApplianceModel.tsx (read its file header for the fitting/orientation
// reasoning in full) but for fixtures, which don't carry widthMm/
// heightMm/depthMm the way appliances do. A pendant is a decorative
// body, not a priced/measured item, so the caller picks a sensible
// fixed size instead of reading one off the catalogue.
//
// IMPORTANT: this is BODY GEOMETRY ONLY. The emissive glow and the real
// light in FixtureInScene are computed from item.lumens/colorTempK/
// throwDirection, entirely independent of what represents the body —
// see the comment above PlacedFixtures in Room3DCanvas.tsx for why a
// fixture that glows by itself but lights nothing was a bug fixed once
// already. A GLB with a baked-bright material must not reintroduce it:
// this component renders ONLY the primitive geometry from the file, and
// never adds its own light or emissive material on top.

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { fitModelToBox, NO_MODEL_ORIENTATION } from '../../lib/fittedModel';
import type { ModelOrientation } from '../../lib/fittedModel';
import { useGLTF } from '@react-three/drei';
import { ModelWithFallback } from './ModelWithFallback';

export interface FixtureModelProps {
  modelUrl?: string;
  orientation?: ModelOrientation;
  // Real-world size, in millimetres, the model gets fitted to — a fixed
  // per-kind default chosen by the caller (FixtureInScene), not read
  // off the catalogue the way an appliance's priced dimensions are.
  widthMm: number;
  heightMm: number;
  depthMm: number;
  // Rendered while the model loads and if it fails to load.
  fallback: ReactNode;
}

function useFittedFixtureModel(
  url: string,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  orientation: ModelOrientation
) {
  const { scene } = useGLTF(url);
  const { xDeg, yDeg, zDeg } = orientation;

  return useMemo(
    () => fitModelToBox(scene, widthMm, heightMm, depthMm, { xDeg, yDeg, zDeg }),
    [scene, widthMm, heightMm, depthMm, xDeg, yDeg, zDeg]
  );
}

function FittedFixture({
  url,
  widthMm,
  heightMm,
  depthMm,
  orientation,
}: {
  url: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  orientation: ModelOrientation;
}) {
  const { model, scale, offset } = useFittedFixtureModel(
    url,
    widthMm,
    heightMm,
    depthMm,
    orientation
  );

  // No outer group/position/rotation here, unlike ApplianceModel's
  // FittedModel — the caller (FixtureInScene) already wraps its whole
  // body, glow mesh and light in one positioned <group>, and fixtures
  // have no independent placement-rotation control the way appliances
  // do (item.rotationDeg). This just needs to sit at that group's local
  // origin, base on y=0, fitted to the given box.
  return (
    <group scale={scale} position={offset}>
      <primitive object={model} />
    </group>
  );
}

export function FixtureModel({
  modelUrl,
  orientation = NO_MODEL_ORIENTATION,
  widthMm,
  heightMm,
  depthMm,
  fallback,
}: FixtureModelProps) {
  if (!modelUrl) return <>{fallback}</>;

  return (
    <ModelWithFallback fallback={fallback} logPrefix="FixtureModel">
      <FittedFixture
        url={modelUrl}
        widthMm={widthMm}
        heightMm={heightMm}
        depthMm={depthMm}
        orientation={orientation}
      />
    </ModelWithFallback>
  );
}
