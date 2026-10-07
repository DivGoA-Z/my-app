import { describe, expect, it } from 'vitest';
import { buildRenderBrief, hingeSideFacingWall, type RenderBriefInput } from './renderBrief';
import { planSvg } from './planDrawing';
import { cabinet, layout } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';
import type { WallOpening } from '../types/opening';

const door = (extra: Partial<WallOpening>): WallOpening => ({
  id: 'd',
  wallId: 'south',
  kind: 'door',
  offsetMm: 1800,
  widthMm: 900,
  heightMm: 2100,
  sillMm: 0,
  swing: 'in-left',
  doorState: 'closed',
  suppliedByUs: false,
  ...extra,
});

function brief(extra: Partial<RenderBriefInput> = {}) {
  return buildRenderBrief({
    layout: layout({
      dimensions: { widthMm: 3600, depthMm: 3000, ceilingHeightMm: 2700 },
      walls: [{ id: 's', orientation: 'south', lengthMm: 3600, openings: [door({})] }],
    }),
    cabinets: [
      cabinet('base-cabinet', 600, 560, 720, { x: 0, y: 0 }),
      cabinet('wall-cabinet', 600, 350, 720, { x: 0, y: 0 }),
      // An island: back to no wall.
      cabinet('base-cabinet', 1200, 600, 850, { x: 1200, y: 1400, rotationDeg: 180 }),
    ],
    appliances: [],
    obstacles: [],
    finishes: [],
    handles: [],
    applianceCatalog: [],
    fixtureCatalog: [],
    hardwareRates: defaultRateCard().hardware,
    view: null,
    referenceImages: [],
    assetOrigin: '',
    generatedAt: '',
    ...extra,
  });
}

describe('hingeSideFacingWall', () => {
  // 'in-left' = hinge at the wall's START, which is your left only on the
  // north and east walls (OpeningLayer.tsx's swingGeometry).
  it('turns the stored along-wall side into left/right as you face the wall', () => {
    expect(hingeSideFacingWall('north', 'in-left')).toBe('left');
    expect(hingeSideFacingWall('east', 'in-left')).toBe('left');
    expect(hingeSideFacingWall('south', 'in-left')).toBe('right');
    expect(hingeSideFacingWall('west', 'in-left')).toBe('right');
    expect(hingeSideFacingWall('south', 'in-right')).toBe('left');
    expect(hingeSideFacingWall('north', 'sliding')).toBeNull();
  });
});

describe('planSvg', () => {
  it('draws every unit, hung ones dashed, with refs', () => {
    const svg = planSvg(brief(), 800, 700);
    expect(svg.match(/data-ref="C\d"/g)).toHaveLength(3);
    expect(svg).toMatch(/data-ref="C2" fill="none" stroke="#292524" stroke-width="1.2" stroke-dasharray/);
    // The island is drawn even though it's on no wall's elevation.
    const island = brief().cabinets.find((c) => !c.against)!;
    expect(svg).toContain(`>${island.ref}</text>`);
  });

  it('draws an in-swinging door with its leaf and arc, hinged at the right end', () => {
    const svg = planSvg(brief(), 800, 700);
    expect(svg).toContain('data-door-leaf="O1"');
    const out = planSvg(brief({ layout: layout({ dimensions: { widthMm: 3600, depthMm: 3000 }, walls: [{ id: 's', orientation: 'south', lengthMm: 3600, openings: [door({ swing: 'out' })] }] }) }), 800, 700);
    expect(out).not.toContain('data-door-leaf');
    // in-left on the south wall = hinge at x 1800 (the start), which is
    // the RIGHT end facing the wall: the leaf stands at x 1800.
    const b = brief();
    expect(b.openings[0].door?.hingeSide).toBe('right');
  });

  it('shows the camera only for a real standing position', () => {
    const view = { mode: 'walkthrough' as const, positionMm: { x: 1800, y: 2700, z: 1600 }, headingDeg: 0, pitchDeg: 0, facingWall: 'north' as const, verticalFovDeg: 60, imageWidthPx: 1600, imageHeightPx: 900 };
    expect(planSvg(brief({ view }), 800, 700)).toContain('data-camera');
    expect(planSvg(brief({ view: { ...view, mode: 'orbit' } }), 800, 700)).not.toContain('data-camera');
  });

  it('is well-formed (no duplicate attributes, which make the browser refuse it)', () => {
    const svg = planSvg(brief(), 800, 700);
    for (const tag of svg.match(/<[a-z]+ [^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
      expect(new Set(names).size, tag).toBe(names.length);
    }
  });
});
