// Fitting a catalogue model into its item's box (§126).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitModelToBox } from './fittedModel';

// A 1 × 0.5 × 1 (m) model, as a loaded file might be.
const model = () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1));
const upright = { xDeg: 0, yDeg: 0, zDeg: 0 };

describe('fitModelToBox', () => {
  it('stretches the model to the item’s width, height and depth', () => {
    expect(fitModelToBox(model(), 600, 200, 450, upright).scale.map((n) => +n.toFixed(3))).toEqual([0.6, 0.4, 0.45]);
  });

  it('with no height (a sink set flush), keeps the model’s proportions instead of flattening it', () => {
    const { scale } = fitModelToBox(model(), 600, 0, 450, upright);
    expect(scale[1]).toBeGreaterThan(0);
    expect(scale[1]).toBeCloseTo((0.6 + 0.45) / 2, 5);
  });
});

it('fits a sink evenly inside its footprint (§126): never stretched, tap upright', async () => {
  const { fitModelToBox } = await import('./fittedModel');
  const THREE = await import('three');
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.9));
  const { scale } = fitModelToBox(m, 600, 200, 450, { xDeg: 0, yDeg: 0, zDeg: 0 }, 'uniform');
  // min(0.6/0.8, 0.45/0.9) = 0.5 on every axis.
  expect(scale.map((n) => +n.toFixed(3))).toEqual([0.5, 0.5, 0.5]);
});
