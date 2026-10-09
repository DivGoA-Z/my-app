// src/components/canvas3d/ApplianceModel.tsx
//
// Renders a placed appliance as a real GLTF model instead of a box,
// fitted to the dimensions stored on the item.
//
// Three things here are easy to get wrong and all three produce bugs
// that look like something else:
//
// 1. CLONING. useGLTF caches and returns ONE scene object per URL. A
//    three.js Object3D can only sit at one place in the graph, so two
//    stoves sharing the cached scene means the second one steals it and
//    the first vanishes. Every instance gets its own clone.
//
// 2. FITTING. Downloaded models arrive at arbitrary scale, arbitrary
//    origin, and often not sitting on their own floor — a hob might be
//    12 units wide and centred on its middle rather than its base.
//    Nothing can be positioned by hand reliably, so the model is
//    measured (Box3) and normalised: scaled to the stored width/depth/
//    height, then offset so its base sits at elevationMm and its
//    footprint centres on the stored x/y.
//
// 2b. ORIENTATION, which is the half of fitting that was missing. The
//    Box3 pass normalises size and position but says nothing about
//    which way the model faces, so a Blender export (Z-up, where glTF
//    wants Y-up) came out lying on its side, and a model authored
//    facing +X came out facing the wall. Two separate rotations are
//    involved and the ORDER between them and the measurement matters:
//
//      * the model's own CORRECTION (from the catalogue row) must be
//        applied BEFORE measuring, because rotating a model changes
//        its bounding box — a 600x60x500 hob laid on its side measures
//        600x500x60. Measure first and the fit is computed against the
//        wrong axes, so the model comes out correctly oriented and
//        wrongly proportioned.
//      * the PLACEMENT rotation the designer chose must be applied
//        AFTER, on the outer group, so it turns the already-fitted
//        appliance about its own centre. Folding it into the
//        pre-measurement rotation would swap the width/depth the fit
//        scales to and stretch the model on every quarter turn.
//
// 3. FAILING SAFELY. useGLTF suspends while loading and THROWS on a
//    missing or malformed file. An uncaught throw inside <Canvas> blanks
//    the entire 3D view — so a mistyped model path would take out the
//    whole walkthrough rather than one appliance. Hence the Suspense
//    boundary AND the error boundary below, both falling back to the
//    plain box.

import { servedModelUrl } from '../../lib/modelUrl';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { mmToWorld, groundPosition, clockwiseDegToThreeY } from '../../lib/scene3d';
import { fitModelToBox } from '../../lib/fittedModel';
import { NO_MODEL_ORIENTATION } from '../../lib/applianceGeometry';
import type { ModelOrientation } from '../../lib/applianceGeometry';
import type { PlacedApplianceItem } from '../../types/appliance';
import { ModelWithFallback } from './ModelWithFallback';

export interface ApplianceModelProps {
  item: PlacedApplianceItem;
  // Resolved by the CALLER rather than read off the item, because a
  // placed appliance normally inherits its model from the catalogue —
  // see resolveApplianceModel in lib/applianceGeometry. Undefined means
  // "no model", and the fallback renders instead.
  modelUrl?: string;
  // The catalogue row's fixed correction for how this FILE was
  // exported — see note 2b above. Defaults to no correction.
  orientation?: ModelOrientation;
  // Rendered while the model loads and if it fails to load — the caller
  // passes its existing box mesh, so a missing model degrades to the
  // old behaviour rather than to a hole in the scene.
  //
  // (baseMm, below: where the model's base is drawn, when the caller
  // knows better than elevationMm — a sink dropped into its counter.)
  fallback: ReactNode;
  baseMm?: number;
}

// Per-axis scaling makes the model occupy EXACTLY the box the quote was
// priced against, which matters more than preserving its proportions:
// a 600mm hob has to read as 600mm wide next to a 600mm cabinet. The
// cost is distortion when a model's own proportions differ from the
// stored dimensions — if that looks wrong for a particular asset, the
// fix is correcting that appliance's dimensions rather than loosening
// this, since the dimensions are what the client is being charged for.
//
// CONSTRAINT on the correction angles: they must be multiples of 90°.
// The per-axis scale below sits on a PARENT of the rotated model, and
// a non-uniform scale over an arbitrary rotation shears. Quarter turns
// are safe because they map axes onto axes, so scale-then-rotate is
// equivalent to rotate-then-scale with the factors permuted — which is
// also the only kind of correction a wrongly-exported asset ever needs.
//
// The actual measure-and-normalise dance now lives in
// lib/fittedModel.ts's fitModelToBox, shared with FixtureModel.tsx.
// This is a thin wrapper that re-fits only when the things that affect
// the fit actually change — destructured to primitives so the
// dependency list can be verified, since passing `item`/`orientation`
// themselves would re-clone the scene on every render.
function useFittedModel(item: PlacedApplianceItem, url: string, orientation: ModelOrientation) {
  // Tolerates a stray "public/" prefix in a saved address (§124).
  const { scene } = useGLTF(servedModelUrl(url));
  const { xDeg, yDeg, zDeg } = orientation;
  const { widthMm, heightMm, depthMm } = item;
  // A sink keeps its model's proportions (§126); everything else fills
  // its box exactly, as before.
  const fit = item.applianceType === 'sink' ? 'uniform' : 'stretch';

  return useMemo(
    () => fitModelToBox(scene, widthMm, heightMm, depthMm, { xDeg, yDeg, zDeg }, fit),
    [scene, widthMm, heightMm, depthMm, xDeg, yDeg, zDeg, fit]
  );
}

function FittedModel({
  item,
  url,
  orientation,
  baseMm,
}: {
  item: PlacedApplianceItem;
  url: string;
  orientation: ModelOrientation;
  baseMm?: number;
}) {
  const { model, scale, offset } = useFittedModel(item, url, orientation);

  // Same convention as ApplianceMesh: item.x/y is the unrotated
  // top-left corner, so the centre is x + width/2 — and that centre is
  // exactly what stays put under rotation (see lib/footprint.ts), which
  // is why the placement turn can go on this group without touching
  // the position.
  const [worldX, worldZ] = groundPosition(
    item.x + item.widthMm / 2,
    item.y + item.depthMm / 2
  );
  // A sink resting on a counter is drawn dropped into it (§126,
  // lib/sinkPlacement); otherwise the base sits at elevationMm.
  const elevationM = mmToWorld(baseMm ?? item.elevationMm);

  return (
    <group
      position={[worldX, elevationM, worldZ]}
      // Note 2b: the PLACEMENT turn goes on the outer group, applied
      // after fitting, so it spins the finished appliance about its own
      // centre instead of changing what the fit measured.
      rotation={[0, clockwiseDegToThreeY(item.rotationDeg), 0]}
    >
      <group scale={scale} position={offset}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export function ApplianceModel({
  item,
  modelUrl,
  orientation = NO_MODEL_ORIENTATION,
  fallback,
  baseMm,
}: ApplianceModelProps) {
  if (!modelUrl) return <>{fallback}</>;

  return (
    <ModelWithFallback fallback={fallback} logPrefix="ApplianceModel">
      <FittedModel item={item} url={modelUrl} orientation={orientation} baseMm={baseMm} />
    </ModelWithFallback>
  );
}
