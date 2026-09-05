// src/lib/fittedModel.ts
//
// Generic "measure a GLTF scene and normalise it to a stored box" dance,
// extracted out of ApplianceModel.tsx so ApplianceModel (appliances) and
// FixtureModel (light fixtures) can share it instead of each keeping its
// own copy of the Box3-measure-and-normalise-and-orient logic.
//
// See ApplianceModel.tsx's file header for the full CLONING / FITTING /
// ORIENTATION reasoning — none of that changed, it just no longer reads
// widthMm/heightMm/depthMm off a PlacedApplianceItem specifically.

import * as THREE from 'three';
import { mmToWorld } from './scene3d';

export interface ModelOrientation {
  xDeg: number;
  yDeg: number;
  zDeg: number;
}

export const NO_MODEL_ORIENTATION: ModelOrientation = { xDeg: 0, yDeg: 0, zDeg: 0 };

export interface FittedModelResult {
  model: THREE.Object3D;
  scale: [number, number, number];
  offset: [number, number, number];
}

// Clones `scene` (see note 1 in ApplianceModel.tsx — never add a cached
// useGLTF scene to the graph directly), applies the correction rotation,
// measures it, and returns a scale/offset that puts it in a
// widthMm x heightMm x depthMm box sitting on y=0 of whatever group this
// gets placed in.
export function fitModelToBox(
  scene: THREE.Object3D,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  orientation: ModelOrientation
): FittedModelResult {
  const model = scene.clone(true);

  model.rotation.set(
    THREE.MathUtils.degToRad(orientation.xDeg),
    THREE.MathUtils.degToRad(orientation.yDeg),
    THREE.MathUtils.degToRad(orientation.zDeg)
  );
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const safe = (n: number) => (n > 1e-6 ? n : 1);
  const scale: [number, number, number] = [
    mmToWorld(widthMm) / safe(size.x),
    mmToWorld(heightMm) / safe(size.y),
    mmToWorld(depthMm) / safe(size.z),
  ];

  const offset: [number, number, number] = [
    -center.x * scale[0],
    -box.min.y * scale[1],
    -center.z * scale[2],
  ];

  return { model, scale, offset };
}
