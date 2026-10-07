import { describe, expect, it } from 'vitest';
import { modelUrlProblem } from './modelUrl';

describe('modelUrlProblem (§109)', () => {
  it('accepts a .glb or .gltf address, or none', () => {
    expect(modelUrlProblem('/models/range-hood.glb')).toBeNull();
    expect(modelUrlProblem('/models/lighting/pendant.GLTF')).toBeNull();
    expect(modelUrlProblem('https://x.co/m.glb?v=2')).toBeNull();
    expect(modelUrlProblem('')).toBeNull();
    expect(modelUrlProblem(undefined)).toBeNull();
  });

  it('refuses the stray full stop that turned a chimney into a box', () => {
    expect(modelUrlProblem('/models/range-hood.glb.')).toMatch(/\.glb or \.gltf/);
  });

  it('refuses spaces at either end and other file types', () => {
    expect(modelUrlProblem(' /models/a.glb')).toMatch(/space/);
    expect(modelUrlProblem('/models/a.glb ')).toMatch(/space/);
    expect(modelUrlProblem('/models/a.obj')).not.toBeNull();
  });
});
