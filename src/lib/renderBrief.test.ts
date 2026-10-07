import { describe, expect, it } from 'vitest';
import {
  buildRenderBrief,
  CONDENSED_MAX_WORDS,
  colourName,
  facingOf,
  fromLeftOnWall,
  renderBriefFileStem,
  viewFromWorldCamera,
  type RenderBriefInput,
} from './renderBrief';
import { cabinet, layout } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';
import type { PlacedApplianceItem } from '../types/appliance';
import type { SurfaceFinish } from '../types/finish';
import type { WallOpening } from '../types/opening';

const ROOM_W = 3000;
const ROOM_D = 2400;

function appliance(extra: Partial<PlacedApplianceItem>): PlacedApplianceItem {
  return {
    id: 'app',
    layoutId: 'layout-1',
    applianceType: 'stove',
    x: 0,
    y: 0,
    widthMm: 600,
    depthMm: 500,
    heightMm: 100,
    elevationMm: 760,
    rotationDeg: 0,
    unitPrice: 0,
    quantity: 1,
    ...extra,
  };
}

const walnut: SurfaceFinish = {
  id: 'f-walnut',
  label: 'Walnut 4102',
  brand: 'Merino',
  code: '4102',
  finishTypeLabel: 'Laminate',
  patternCategory: 'wood',
  albedoUrl: '/textures/walnut.jpg',
  reliefStrength: 0.7,
  roughness: 0.6,
  clearcoat: 0,
  clearcoatRoughness: 0,
  metalness: 0.05,
  swatchWidthMm: 600,
  swatchHeightMm: 1200,
  tilingMode: 'repeat',
  pricePerSqM: 0,
  source: 'bundled',
  createdAt: '',
  updatedAt: '',
};

const window1: WallOpening = {
  id: 'win',
  wallId: 'south',
  kind: 'window',
  offsetMm: 500,
  widthMm: 1000,
  heightMm: 1200,
  sillMm: 900,
  suppliedByUs: false,
};

function input(extra: Partial<RenderBriefInput> = {}): RenderBriefInput {
  return {
    layout: layout({
      name: 'Sharma Kitchen',
      dimensions: { widthMm: ROOM_W, depthMm: ROOM_D, ceilingHeightMm: 2700 },
      walls: [{ id: 'w-s', orientation: 'south', lengthMm: ROOM_W, openings: [window1] }],
    }),
    cabinets: [
      // Listed out of order on purpose: refs follow the wall, not the array.
      cabinet('drawer-unit', 600, 560, 720, { id: 'drawers', x: 600, y: 0, elevationMm: 0, finishId: 'f-walnut' }),
      cabinet('base-cabinet', 600, 560, 720, { id: 'base', x: 0, y: 0, elevationMm: 40, finishId: 'f-walnut' }),
      cabinet('wall-cabinet', 600, 350, 720, { id: 'upper', x: 0, y: 0, elevationMm: 1450, finishId: 'f-walnut' }),
    ],
    appliances: [appliance({ id: 'hob', x: 600, y: 30, elevationMm: 800 })],
    obstacles: [],
    finishes: [walnut],
    handles: [],
    applianceCatalog: [],
    fixtureCatalog: [],
    hardwareRates: defaultRateCard().hardware,
    view: null,
    referenceImages: [],
    assetOrigin: 'https://app.example',
    generatedAt: '2026-10-06T00:00:00.000Z',
    ...extra,
  };
}

describe('fromLeftOnWall', () => {
  // Standing in the room facing each wall, "left" is a different corner.
  const rect = { x: 200, y: 300, widthMm: 600, depthMm: 500 };
  it('measures from the corner on your left as you face the wall', () => {
    expect(fromLeftOnWall('north', rect, ROOM_W, ROOM_D)).toBe(200);
    expect(fromLeftOnWall('east', rect, ROOM_W, ROOM_D)).toBe(300);
    expect(fromLeftOnWall('south', rect, ROOM_W, ROOM_D)).toBe(ROOM_W - 800);
    expect(fromLeftOnWall('west', rect, ROOM_W, ROOM_D)).toBe(ROOM_D - 800);
  });
});

describe('facingOf', () => {
  it('follows the front-direction rule (0→+y south, 90→−x west …)', () => {
    expect(facingOf(0)).toBe('south');
    expect(facingOf(90)).toBe('west');
    expect(facingOf(180)).toBe('north');
    expect(facingOf(270)).toBe('east');
  });
});

describe('colourName', () => {
  it('names neutrals by lightness and colours by hue', () => {
    expect(colourName('#ffffff')).toBe('white');
    expect(colourName('#f5f3ef')).toBe('off-white');
    expect(colourName('#111111')).toBe('black');
    expect(colourName('#1e3a8a')).toBe('dark blue');
    expect(colourName('#5c3a1e')).toBe('dark brown');
    expect(colourName('#e8dcc4')).toBe('beige');
    expect(colourName('not a colour')).toBeUndefined();
  });
});

describe('viewFromWorldCamera', () => {
  it('converts metres Y-up to room mm and a compass heading', () => {
    const v = viewFromWorldCamera({
      mode: 'walkthrough',
      position: [1.5, 1.6, 2],
      // Looking along world −Z = towards the north wall.
      direction: [0, 0, -1],
      verticalFovDeg: 60,
      imageWidthPx: 1600,
      imageHeightPx: 900,
    });
    expect(v.positionMm).toEqual({ x: 1500, y: 2000, z: 1600 });
    expect(v.headingDeg).toBe(0);
    expect(v.facingWall).toBe('north');
    expect(viewFromWorldCamera({ ...v, mode: 'orbit', position: [0, 0, 0], direction: [1, 0, 0], verticalFovDeg: 50 }).facingWall).toBe('east');
  });
});

describe('buildRenderBrief', () => {
  it('numbers items along each wall left to right, bottom to top', () => {
    const brief = buildRenderBrief(input());
    expect(brief.cabinets.map((c) => [c.ref, c.type])).toEqual([
      ['C1', 'base cabinet'],
      ['C2', 'wall-hung upper cabinet'],
      ['C3', 'drawer base unit'],
    ]);
    const north = brief.room.walls.find((w) => w.wall === 'north')!;
    expect(north.elementsLeftToRight.map((e) => e.ref)).toEqual(['C1', 'C2', 'C3', 'A1']);
  });

  it('gives every item a real box in room mm', () => {
    const brief = buildRenderBrief(input());
    expect(brief.cabinets[1].box).toEqual({ minX: 0, maxX: 600, minY: 0, maxY: 350, minZ: 1450, maxZ: 2170 });
    expect(brief.cabinets[1].against).toEqual({ wall: 'north', fromLeftMm: 0 });
  });

  it('says a hob is on the countertop of the cabinet under it', () => {
    const brief = buildRenderBrief(input());
    expect(brief.appliances[0].relation).toBe('standing on the countertop over C3');
  });

  it('measures openings from the left corner of their wall', () => {
    const brief = buildRenderBrief(input());
    // South wall, faced from inside: left is the east end, so offset 500
    // from x=0 with width 1000 is 3000 − 1500 from the left.
    expect(brief.openings[0]).toMatchObject({ ref: 'O1', wall: 'south', fromLeftMm: 1500, sillMm: 900 });
  });

  it('describes finishes with the swatch as an absolute URL', () => {
    const f = buildRenderBrief(input()).cabinets[0].finish!;
    expect(f).toMatchObject({ name: 'Walnut 4102', pattern: 'Wood Grain', sheen: 'matte' });
    expect(f.swatchImageUrl).toBe('https://app.example/textures/walnut.jpg');
  });

  it('lists what is absent so the model does not invent it', () => {
    const brief = buildRenderBrief(input());
    expect(brief.inventory.windows).toBe(1);
    expect(brief.notInThisRoom).toContain('range hood / chimney');
    expect(brief.notInThisRoom).toContain('sink or tap');
    expect(brief.notInThisRoom).not.toContain('windows');
    expect(brief.notInThisRoom).not.toContain('upper / wall cabinets');
    expect(brief.prompt.negativePrompt).toContain('range hood / chimney');
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildRenderBrief(input()))).toBe(JSON.stringify(buildRenderBrief(input())));
  });

  it('turns the design name into a safe file stem', () => {
    expect(renderBriefFileStem('Kitchen - Ground Floor')).toBe('kitchen-ground-floor');
    expect(renderBriefFileStem('***')).toBe('kitchen');
  });
});

describe('imagePromptCondensed', () => {
  it('is short, has no refs or millimetres, and keeps the fixed order', () => {
    const p = buildRenderBrief(input()).prompt.imagePromptCondensed;
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(CONDENSED_MAX_WORDS);
    expect(p).not.toMatch(/\b[CAOPL]\d+\b/);
    expect(p).not.toMatch(/\bmm\b/);
    // No fixtures in this layout, so light is the plain daylight sentence.
    const order = ['photograph', 'Base cabinets', 'Upper wall cabinets', 'countertop', 'daylight', 'Uncluttered'];
    const at = order.map((w) => p.indexOf(w));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('groups finishes by run instead of listing cabinets', () => {
    const p = buildRenderBrief(input()).prompt.imagePromptCondensed;
    // A photographed finish has no colour of its own; its name stands in.
    expect(p).toContain('Base cabinets in walnut matte wood-grain laminate');
  });

  it('stays under the cap on a big kitchen by dropping optional sentences', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      cabinet('base-cabinet', 600, 560, 720, { x: (i % 5) * 600, y: 0, finishId: 'f-walnut', colorOverride: `#${(i * 400000).toString(16).padStart(6, '0').slice(0, 6)}` })
    );
    const p = buildRenderBrief(input({ cabinets: many })).prompt.imagePromptCondensed;
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(CONDENSED_MAX_WORDS);
    expect(p).toContain('Uncluttered architectural photograph');
  });

  it('names the layout shape', () => {
    expect(buildRenderBrief(input()).prompt.imagePromptCondensed).toContain('single-wall modular kitchen');
  });

  it('says no shape for an empty room, without repeating itself', () => {
    const p = buildRenderBrief(input({ cabinets: [], appliances: [] })).prompt.imagePromptCondensed;
    expect(p).toContain('compact modular kitchen');
    expect(p).not.toContain('modular modular');
  });
});

describe('negativePrompt', () => {
  it('carries exactly the absences, deduplicated, and never a present item', () => {
    const b = buildRenderBrief(input());
    const terms = b.prompt.negativePrompt.split(', ');
    expect(new Set(terms).size).toBe(terms.length);
    for (const absent of b.notInThisRoom) expect(terms).toContain(absent);
    // The layout has a hob, so the hob must not be negated.
    expect(b.prompt.negativePrompt).not.toContain('hob');
    // And no island in the generic list any more: one might be designed.
    expect(terms).not.toContain('island');
  });
});

describe('prompt wording (§104)', () => {
  it('keeps trade acronyms, drops sizes, and picks a/an by sound', async () => {
    const { proseCase, withoutSizes, withArticle } = await import('./renderBrief');
    expect(proseCase('Off-white PU')).toBe('off-white PU');
    expect(proseCase('Under-sink RO purifier')).toBe('under-sink RO purifier');
    expect(withoutSizes('4-Burner Hob (600mm)')).toBe('4-Burner Hob');
    expect(withoutSizes('Chimney 90 cm')).toBe('Chimney');
    expect(withArticle('under-sink RO purifier')).toBe('an under-sink RO purifier');
    expect(withArticle('RO purifier')).toBe('an RO purifier');
    expect(withArticle('4-burner hob')).toBe('a 4-burner hob');
  });

  it('does not repeat a word the finish name shares with its type', async () => {
    const { shortFinish, describeFinish } = await import('./renderBrief');
    const veneer = describeFinish(
      { id: 'v', label: 'Teak Veneer', finishTypeLabel: 'Veneer', patternCategory: 'wood', albedoUrl: '/t.jpg', reliefStrength: 0.7, roughness: 0.6, clearcoat: 0, clearcoatRoughness: 0, metalness: 0.05, swatchWidthMm: 600, swatchHeightMm: 1200, tilingMode: 'repeat', pricePerSqM: 0, source: 'bundled', createdAt: '', updatedAt: '' },
      ''
    );
    expect(shortFinish(veneer, '')).toBe('teak matte wood-grain veneer');
  });
});

describe('short prompt (§105)', () => {
  it('fits the length limits, materials first, no sizes or refs', async () => {
    const { SHORT_PROMPT_MAX_CHARS, SHORT_NEGATIVE_MAX_CHARS } = await import('./renderBrief');
    const p = buildRenderBrief(input()).prompt;
    expect(p.imagePromptShort.length).toBeLessThanOrEqual(SHORT_PROMPT_MAX_CHARS);
    expect(p.negativePromptShort.length).toBeLessThanOrEqual(SHORT_NEGATIVE_MAX_CHARS);
    expect(p.imagePromptShort.split('. ')[1]).toMatch(/cabinets/);
    expect(p.imagePromptShort).not.toMatch(/\bmm\b|\b[CAOPL]\d+\b/);
  });

  it('leads the short negative with text (§112), then counter clutter (§104), so neither is cut off', () => {
    const neg = buildRenderBrief(input()).prompt.negativePromptShort;
    expect(neg.startsWith('text or labels, decor or utensils on the counters')).toBe(true);
    expect(new Set(neg.split(', ')).size).toBe(neg.split(', ').length);
  });

  it('names no image model anywhere in the brief', () => {
    expect(JSON.stringify(buildRenderBrief(input()))).not.toMatch(/leonardo|phoenix|gemini|qwen|flux|sdxl/i);
  });
});

describe('no text in the image (§112)', () => {
  it('says so first in the instructions, in the full prompt, and in both negatives', () => {
    const p = buildRenderBrief(input()).prompt;
    expect(p.instructions.split('\n')[1]).toMatch(/^NEVER DRAW ANY TEXT/);
    expect(p.imagePrompt).toMatch(/No text, letters, numbers, labels or reference codes/);
    for (const t of ['letters', 'numbers', 'labels', 'reference codes']) expect(p.negativePrompt.split(', ')).toContain(t);
    expect(p.negativePromptShort).toMatch(/^text or labels/);
  });
});

describe('colour reference (§113)', () => {
  it('explains the colour view as placement only, not the look to copy', () => {
    const b = buildRenderBrief(input({
      referenceImages: [
        { kind: 'line-render', file: 'k-guide.png', widthPx: 1024, heightPx: 576 },
        { kind: 'colour-render', file: 'k-colour.png', widthPx: 1024, heightPx: 576 },
      ],
    }));
    expect(b.referenceImages.map((i) => i.kind)).toEqual(['line-render', 'colour-render']);
    expect(b.referenceImages[1].whatItIs).toMatch(/SAME camera/);
    expect(b.referenceImages[1].whatItIs).toMatch(/do NOT copy its look/);
    expect(b.prompt.instructions).toMatch(/k-colour\.png\) is the same view in colour/);
    expect(b.prompt.instructions).toMatch(/k-guide\.png/);
  });
});
