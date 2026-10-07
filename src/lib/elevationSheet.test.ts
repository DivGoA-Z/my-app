import { describe, expect, it } from 'vitest';
import { buildRenderBrief, type RenderBriefInput } from './renderBrief';
import { elevationSheetSvg } from './elevationSheet';
import { cabinet, layout } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';
import type { HandleSpec } from '../types/front';

const bar: HandleSpec = {
  id: 'bar',
  label: 'Bar 128',
  kind: 'bar',
  lengthMm: 128,
  colorHex: '#c0c0c0',
  metalness: 0.9,
  roughness: 0.3,
  pricingMode: 'per-unit',
  price: 0,
  createdAt: '',
  updatedAt: '',
};

function brief(extra: Partial<RenderBriefInput> = {}) {
  return buildRenderBrief({
    layout: layout({
      name: 'Test <kitchen>',
      dimensions: { widthMm: 3000, depthMm: 2400, ceilingHeightMm: 2700 },
      walls: [
        {
          id: 'n',
          orientation: 'north',
          lengthMm: 3000,
          openings: [{ id: 'w', wallId: 'north', kind: 'window', offsetMm: 1200, widthMm: 900, heightMm: 1000, sillMm: 1100, suppliedByUs: false }],
        },
      ],
    }),
    cabinets: [
      cabinet('drawer-unit', 600, 560, 720, { x: 600, y: 0, elevationMm: 100 }),
      cabinet('base-cabinet', 900, 560, 720, { x: 1200, y: 0, elevationMm: 100 }),
      // West wall, back to the west, in the north-west corner: its side
      // shows at the north wall's left end.
      cabinet('base-cabinet', 600, 560, 720, { x: 20, y: 20, elevationMm: 100, rotationDeg: 270 }),
    ],
    appliances: [],
    obstacles: [{ id: 'p', type: 'pillar', x: 2700, y: 0, widthMm: 300, depthMm: 300, floorToCeiling: true, heightMm: 2700, elevationMm: 0, rotationDeg: 0 }],
    finishes: [],
    handles: [bar],
    applianceCatalog: [],
    fixtureCatalog: [],
    hardwareRates: defaultRateCard().hardware,
    view: null,
    referenceImages: [],
    assetOrigin: 'https://x',
    generatedAt: 'now',
    ...extra,
  });
}

const wallGroup = (svg: string, wall: string) => svg.split(`<g data-wall="${wall}">`)[1].split('</g>')[0];

describe('elevationSheetSvg', () => {
  it('draws all four walls on one sheet', () => {
    const { svg } = elevationSheetSvg(brief());
    for (const w of ['north', 'east', 'south', 'west']) expect(svg).toContain(`data-wall="${w}"`);
    expect(svg).toContain('NORTH WALL');
  });

  it('splits each cabinet into its real fronts, with a handle on each', () => {
    const north = wallGroup(elevationSheetSvg(brief()).svg, 'north');
    // Drawer unit: 3 drawers (defaultFrontLayout); 900 base: a double door.
    expect(north.match(/data-panel="drawers"/g)).toHaveLength(3);
    expect(north.match(/data-panel="double-door"/g)).toHaveLength(2);
    expect(north.match(/data-handle="bar"/g)).toHaveLength(5);
  });

  it('labels items with the brief\'s refs, outside the drawing', () => {
    const b = brief();
    const north = wallGroup(elevationSheetSvg(b).svg, 'north');
    for (const ref of ['C1', 'C2', 'O1 window', 'P1 pillar']) expect(north).toContain(`>${ref}</text>`);
    // Refs run north wall first, so the west-wall unit is C3, and it
    // appears on the north wall only as a side, in brackets.
    expect(b.cabinets[2].against?.wall).toBe('west');
    expect(north).toContain('>(C3)</text>');
    expect(north).not.toContain('>C3</text>');
  });

  it('keeps every wall at one shared scale', () => {
    const { svg } = elevationSheetSvg(brief());
    // North is the longest wall; it gets the full drawing width (800px).
    const north = wallGroup(svg, 'north');
    const wallRect = north.match(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" fill="#ffffff"/)!;
    expect(Number(wallRect[1])).toBe(800);
    const east = wallGroup(svg, 'east');
    const eastRect = east.match(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" fill="#ffffff"/)!;
    expect(Number(eastRect[1])).toBe(640); // 2400 / 3000 of it
    expect(eastRect[2]).toBe(wallRect[2]); // same ceiling height drawn
  });

  it('puts the plan and the key on the same sheet', () => {
    const { svg } = elevationSheetSvg(brief());
    expect(svg).toContain('data-plan="1"');
    expect(svg).toContain('>KEY</text>');
  });

  it('escapes the design name', () => {
    expect(elevationSheetSvg(brief()).svg).toContain('Test &lt;kitchen&gt;');
  });
});
