import { describe, expect, it } from 'vitest';
import {
  buildRenderBrief,
  CONDENSED_MAX_WORDS,
  edgeProfileWhere,
  tileRowsLine,
  MAX_FINISH_SWATCHES,
  colourName,
  facingOf,
  fromLeftOnWall,
  renderBriefFileStem,
  tileSizeWords,
  viewFromWorldCamera,
  type RenderBriefInput,
} from './renderBrief';
import { cabinet, layout } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';
import type { PlacedApplianceItem } from '../types/appliance';
import type { ApplianceCatalogItem } from '../types/Catalog';
import type { SurfaceFinish } from '../types/finish';
import type { WallOpening } from '../types/opening';
import type { FixtureCatalogItem, LightFixture } from '../types/fixture';
import type { HandleSpec } from '../types/front';
import type { SurfaceTiling } from './tiling';

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

describe('without codes (§114)', () => {
  const noRefs = () => buildRenderBrief(input({ refs: false }));

  it('leaves no code anywhere a model could copy it', async () => {
    const { withoutRefs } = await import('./renderBrief');
    const text = JSON.stringify(withoutRefs(noRefs()));
    expect(text).not.toMatch(/\b[CAOPL]\d+\b/);
    expect(text).not.toMatch(/"ref"/);
  });

  it('names things in words instead, so relations still make sense', () => {
    const b = noRefs();
    expect(b.appliances[0].relation).toBe('standing on the countertop over the drawer base unit on the north wall');
    expect(b.prompt.imagePrompt).toMatch(/Shutters and visible cabinet sides of the 2 base cabinets|Shutters and visible cabinet sides of the 1 base cabinet/);
    expect(b.prompt.imagePrompt).toMatch(/Through the window on the south wall/);
    expect(b.countertop?.covers[0]).toMatch(/^the /);
  });

  it('keeps codes by default, for the plan-and-walls sheet', () => {
    expect(buildRenderBrief(input()).prompt.imagePrompt).toMatch(/\bC1\b/);
  });
});

describe('add nothing, spelled out for this design (§114)', () => {
  it('lists what stylist models add, near the top', () => {
    const p = buildRenderBrief(input()).prompt;
    const line = p.instructions.split('\n')[2];
    expect(line).toMatch(/^ADD NOTHING\. Counters bare: no plants/);
    // The fixture layout has no wall finishes and no fixtures: plain walls,
    // no fittings, and its window has no outside photo.
    expect(line).toMatch(/plain matte paint everywhere; no backsplash/);
    expect(line).toMatch(/no visible light fittings/);
    // §144: a soft, blurred view outside, never a sharp one.
    expect(line).toMatch(/Through the window: bright daylight and a soft, blurred, slightly overexposed view outside .*no sharp buildings, trees or other detail/);
    for (const t of ['potted plants', 'backsplash tiles', 'LED strip lights', 'sharp detailed view outside the window']) {
      expect(p.negativePrompt.split(', ')).toContain(t);
    }
    expect(p.negativePromptShort).toMatch(/^text or labels, decor or utensils on the counters, backsplash tiles/);
  });
});

describe('re-photograph, and bare vs styled (§127)', () => {
  const withColour = (extra: Partial<RenderBriefInput> = {}) =>
    buildRenderBrief(
      input({
        referenceImages: [
          { kind: 'line-render', file: 'g.png', widthPx: 1024, heightPx: 576 },
          { kind: 'colour-render', file: 'c.png', widthPx: 1024, heightPx: 576 },
        ],
        ...extra,
      })
    );

  it('tells the model the colour preview is a draft to re-photograph, only when there is one', () => {
    const b = withColour();
    expect(b.prompt.instructions).toMatch(/RE-PHOTOGRAPH, not an image to edit/);
    expect(b.prompt.imagePrompt).toMatch(/must not look like a 3D render/);
    expect(b.prompt.imagePromptCondensed).toMatch(/real photograph, not a 3D render/);
    expect(buildRenderBrief(input()).prompt.instructions).not.toMatch(/RE-PHOTOGRAPH/);
  });

  it('is bare by default: nothing on the counters, plants and utensils forbidden', () => {
    const b = withColour();
    expect(b.styling).toBe('bare');
    expect(b.prompt.instructions).toMatch(/ADD NOTHING\. Counters bare/);
    expect(b.prompt.negativePrompt.split(', ')).toContain('potted plants');
  });

  it('styled allows only a few named props and a soft view outside', () => {
    const b = withColour({ styling: 'styled' });
    expect(b.styling).toBe('styled');
    expect(b.prompt.instructions).toMatch(/LIGHTLY STYLED, NOTHING ELSE ADDED\. .*at most four small neutral props/);
    expect(b.prompt.instructions).toMatch(/soft, out-of-focus greenery/);
    const neg = b.prompt.negativePrompt.split(', ');
    expect(neg).not.toContain('potted plants');
    expect(neg).not.toContain('sharp detailed view outside the window');
    // Still never a kettle or dispensers.
    expect(neg).toContain('kettle');
    expect(b.prompt.negativePromptShort).toMatch(/^text or labels, clutter on the counters/);
  });
});

describe('one image, other cameras as context (§128)', () => {
  const b = buildRenderBrief(
    input({
      referenceImages: [
        { kind: 'line-render', file: 'k-guide.png', widthPx: 1024, heightPx: 576 },
        { kind: 'colour-render', file: 'k-colour.png', widthPx: 1024, heightPx: 576 },
        { kind: 'context-view', file: 'k-context-camera-2.png', widthPx: 1024, heightPx: 576, cameraLabel: 'Camera 2' },
      ],
    })
  );

  it('asks for a single photo from the main camera, the rest for understanding', () => {
    expect(b.referenceImages[2].whatItIs).toMatch(/for understanding only/);
    expect(b.prompt.instructions).toMatch(/ONE IMAGE ONLY\. Produce a single photograph from the main camera \(k-guide\.png\)/);
    expect(b.prompt.instructions).toMatch(/k-context-camera-2\.png, Camera 2/);
    expect(b.prompt.imagePrompt).toMatch(/never combine views/);
    expect(b.prompt.imagePromptCondensed).toMatch(/One single photograph from the main camera/);
  });

  it('says nothing about context without context views', () => {
    expect(buildRenderBrief(input()).prompt.instructions).not.toMatch(/ONE IMAGE ONLY/);
  });
});

describe('what is designed, said so it can be drawn (§139)', () => {
  const cove = {
    id: 'cove-2700',
    label: 'Cove strip 2700K',
    kind: 'cove',
    colorTempK: 2700,
    lumens: 700,
    pricingMode: 'per-metre',
    price: 0,
  } as FixtureCatalogItem;
  const underUpper = {
    id: 'fx-1',
    layoutId: 'layout-1',
    catalogItemId: 'cove-2700',
    mount: { kind: 'cabinet', cabinetId: 'upper', face: 'under' },
    throwDirection: 'down',
    runLengthMm: 600,
    quantity: 1,
    enabled: true,
  } as LightFixture;
  const lit = (fixtures: LightFixture[]) => {
    const base = input();
    return input({ layout: { ...base.layout, fixtures }, fixtureCatalog: [cove] });
  };

  it('a cove light under a wall cabinet is a strip there, and is never banned', () => {
    const b = buildRenderBrief(lit([underUpper]));
    expect(b.lighting.fixtures[0].underCabinet).toBe('C2');
    expect(b.lighting.fixtures[0].placement).toBe('along the underside of C2, shining down onto the counter');
    expect(b.prompt.imagePrompt).toMatch(/a warm-white \(2700 K\) LED light strip along the underside of C2/);
    expect(b.prompt.instructions).toMatch(/light strips only under C2, and nothing under any other wall cabinet/);
    expect(b.prompt.instructions).not.toMatch(/no LED strips under the wall cabinets/);
    expect(b.prompt.negativePrompt).not.toMatch(/LED strip/);
    // No coordinates in the prompt's light line any more.
    expect(b.prompt.imagePrompt).not.toMatch(/cove light 2700 K at \(/);
  });

  it('a cove light on top bans strips underneath, but not strips as such', () => {
    const b = buildRenderBrief(lit([{ ...underUpper, mount: { kind: 'cabinet', cabinetId: 'upper', face: 'top' }, throwDirection: 'up' }]));
    expect(b.lighting.fixtures[0].underCabinet).toBeUndefined();
    expect(b.prompt.instructions).toMatch(/no LED strips under the wall cabinets/);
    expect(b.prompt.negativePrompt.split(', ')).toContain('under-cabinet LED strips');
    expect(b.prompt.negativePrompt.split(', ')).not.toContain('LED strip lights');
  });

  it('says how big a mosaic tile is, unless the surface is laid at a chosen size', () => {
    const mosaic: SurfaceFinish = { ...walnut, id: 'f-hex', label: 'White Hexagon Mosaic', finishTypeLabel: 'Mosaic', patternCategory: 'solid', solidColor: '#ffffff', tileWidthMm: 35, tileHeightMm: 35 };
    const base = input();
    const withWall = (tiling?: SurfaceTiling) =>
      buildRenderBrief(
        input({
          finishes: [walnut, mosaic],
          layout: { ...base.layout, walls: [{ id: 'w-n', orientation: 'north', lengthMm: ROOM_W, openings: [], finishId: 'f-hex', tiling }] },
        })
      );
    const b = withWall();
    expect(b.room.walls[0].finish?.tileSizeMm).toEqual({ width: 35, height: 35 });
    expect(b.prompt.imagePrompt).toMatch(/White Hexagon Mosaic[^)]*\), small tiles about 35 mm across/);
    expect(b.prompt.imagePromptCondensed).toMatch(/small mosaic/);
    expect(tileSizeWords({ ...b.room.walls[0].finish!, tileSizeMm: { width: 300, height: 600 } })).toBe('300×600 mm tiles');
    const laid = withWall({ tileWidthMm: 100, tileHeightMm: 100, pattern: 'straight', groutMm: 2, groutColor: '#c9c7c2' });
    expect(laid.prompt.imagePrompt).toMatch(/laid as 100×100 mm/);
    expect(laid.prompt.imagePrompt).not.toMatch(/about 35 mm/);
  });

  it('describes an edge profile as flush, and allows no other handles', () => {
    const edge: HandleSpec = {
      id: 'h-edge',
      label: 'Edge Profile — Matte Black',
      kind: 'edge-profile',
      lengthMm: 600,
      colorHex: '#222222',
      metalness: 0.6,
      roughness: 0.6,
      pricingMode: 'per-metre',
      price: 0,
      createdAt: '',
      updatedAt: '',
    };
    const base = input();
    const b = buildRenderBrief(input({ handles: [edge], cabinets: base.cabinets.map((c) => ({ ...c, handleId: 'h-edge' })) }));
    expect(b.prompt.imagePrompt).toMatch(/aluminium profile fixed along the top edge of each (drawer|hinged door)[^,]*, flush with it; nothing sticks out/);
    expect(b.prompt.imagePrompt).toMatch(/No other handles/);
  });

  it('allows at most two plain switch plates, in instructions and prompt (§141)', () => {
    const p = buildRenderBrief(input()).prompt;
    expect(p.instructions).toMatch(/at most two plain white switch-socket plates on the backsplash/);
    expect(p.imagePrompt).toMatch(/at most two plain white switch-socket plates on the backsplash/);
    expect(p.negativePrompt).not.toMatch(/socket/);
  });

  it('calls a camera eye-level only at eye level', () => {
    const view = { mode: 'walkthrough', positionMm: { x: 1500, y: 2300, z: 2113 }, headingDeg: 0, pitchDeg: -28, facingWall: 'north', verticalFovDeg: 60, imageWidthPx: 1024, imageHeightPx: 576 } as const;
    const high = buildRenderBrief(input({ view: { ...view } })).prompt;
    expect(high.imagePrompt).toMatch(/Camera: photo taken from a raised position/);
    expect(high.imagePromptCondensed).toMatch(/^Photograph looking toward/);
    const eye = buildRenderBrief(input({ view: { ...view, positionMm: { ...view.positionMm, z: 1400 } } })).prompt;
    expect(eye.imagePrompt).toMatch(/Camera: eye-level photo taken standing/);
  });
});

describe('finish photos attached (§139)', () => {
  it('lists each finish photo once, with where it is used, only when asked', () => {
    expect(buildRenderBrief(input()).referenceImages).toEqual([]);
    const b = buildRenderBrief(input({ attachSwatches: true }));
    const sw = b.referenceImages.filter((r) => r.kind === 'finish-swatch');
    expect(sw).toHaveLength(1);
    expect(sw[0]).toMatchObject({
      file: 'swatch-1-walnut-4102.jpg',
      finishName: 'Walnut 4102',
      usedOn: 'base cabinet fronts and upper cabinet fronts',
      sourceUrl: 'https://app.example/textures/walnut.jpg',
    });
    expect(sw[0].whatItIs).toMatch(/^A flat close-up photo of one finish/);
    expect(b.prompt.instructions).toMatch(/the attached finish photos .* are the real materials/);
  });

  it('keeps at most MAX_FINISH_SWATCHES, cabinets first', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...walnut, id: `f-${i}`, label: `Finish ${i}`, albedoUrl: `/t/${i}.jpg` }));
    const base = input();
    const b = buildRenderBrief(
      input({
        attachSwatches: true,
        finishes: many,
        cabinets: base.cabinets.map((c, i) => ({ ...c, finishId: `f-${i}` })),
        layout: {
          ...base.layout,
          countertopFinishId: 'f-3',
          floorFinishId: 'f-7',
          walls: (['north', 'east', 'south', 'west'] as const).map((o, i) => ({ id: `w-${o}`, orientation: o, lengthMm: 3000, openings: [], finishId: `f-${4 + (i % 3)}` })),
        },
      })
    );
    const sw = b.referenceImages.filter((r) => r.kind === 'finish-swatch');
    expect(sw).toHaveLength(MAX_FINISH_SWATCHES);
    expect(sw.slice(0, 3).map((s) => s.usedOn)).toEqual(['base cabinet fronts', 'upper cabinet fronts', 'base cabinet fronts']);
    expect(sw.map((s) => s.finishName)).not.toContain('Finish 7'); // the floor was the one dropped
  });
});

describe('finish photos within the request limit (§139)', () => {
  it('takes fewer photos when the caller has less room, never fewer than none', () => {
    const many = Array.from({ length: 3 }, (_, i) => ({ ...walnut, id: `f-${i}`, label: `Finish ${i}`, albedoUrl: `/t/${i}.jpg` }));
    const base = input();
    const cabs = base.cabinets.map((c, i) => ({ ...c, finishId: `f-${i}` }));
    const n = (maxSwatches: number) =>
      buildRenderBrief(input({ attachSwatches: true, maxSwatches, finishes: many, cabinets: cabs })).referenceImages.filter((r) => r.kind === 'finish-swatch').length;
    expect(n(2)).toBe(2);
    expect(n(-4)).toBe(0);
    expect(n(99)).toBe(3);
  });
});

describe('edgeProfileWhere (§139)', () => {
  const panel = (kind: string, orientation: 'horizontal' | 'vertical') => ({
    kind, widthMm: 200, heightMm: 800, fromLeftMm: 0, fromBottomMm: 0,
    handle: { kind: 'edge-profile', orientation, lengthMm: 800, centerFromLeftMm: 0, centerFromBottomMm: 0 },
  });
  it('puts the profile on the top of drawers and down the side of pull-outs', () => {
    expect(edgeProfileWhere([panel('drawers', 'horizontal'), panel('drawers', 'horizontal')])).toBe('along the top edge of each drawer');
    expect(edgeProfileWhere([panel('trolley', 'vertical')])).toBe('down the side edge of each pull-out front');
    expect(edgeProfileWhere([panel('drawers', 'horizontal'), panel('trolley', 'vertical')])).toBe(
      'along the top edge of each drawer, and down the side edge of each pull-out front'
    );
    expect(edgeProfileWhere([])).toBe('along the top edge of each front');
  });
});

describe('appliances described by their look (§141)', () => {
  const sinkRow = { id: 'cat-sink', label: 'Single Bowl Sink (600mm)', applianceType: 'sink', widthMm: 600, depthMm: 450, heightMm: 200, defaultElevationMm: 850, unitPrice: 0, createdAt: '', updatedAt: '' } as ApplianceCatalogItem;
  const withSink = (row: ApplianceCatalogItem, extra: Partial<RenderBriefInput> = {}) =>
    buildRenderBrief(input({ applianceCatalog: [row], appliances: [appliance({ id: 'sink', applianceType: 'sink', catalogItemId: 'cat-sink', x: 0, y: 30, elevationMm: 760 })], ...extra }));

  it('uses the catalogue description, and says every appliance is unbranded', () => {
    const b = withSink({ ...sinkRow, appearance: 'black granite single-bowl sink with a matte black tap' });
    expect(b.appliances[0].appearance).toBe('black granite single-bowl sink with a matte black tap');
    expect(b.prompt.imagePrompt).toMatch(/Appliances look like this: Single Bowl Sink \(600mm\) \(sink\): black granite single-bowl sink with a matte black tap\. Every appliance is unbranded/);
  });

  it('without a description, points at the colour preview, or keeps it plain without one', () => {
    const colour = [{ kind: 'colour-render' as const, file: 'c.jpg', widthPx: 10, heightPx: 10 }];
    expect(withSink(sinkRow, { referenceImages: colour }).prompt.imagePrompt).toMatch(/\(sink\): colour and material as in the colour preview/);
    expect(withSink(sinkRow).prompt.imagePrompt).toMatch(/\(sink\): not specified: plain and neutral/);
  });

  it('the condensed prompt names the look instead of the catalogue label', () => {
    const hobRow = { ...sinkRow, id: 'cat-hob', label: '2-Burner Hob', applianceType: 'stove', appearance: 'black glass two-burner gas hob' } as ApplianceCatalogItem;
    const b = buildRenderBrief(input({ applianceCatalog: [hobRow], appliances: [appliance({ id: 'hob', catalogItemId: 'cat-hob', x: 600, y: 30, elevationMm: 800 })] }));
    expect(b.prompt.imagePromptCondensed).toMatch(/It has a black glass two-burner gas hob\./);
  });
});

describe('tile scale as a count (§145)', () => {
  const mosaic: SurfaceFinish = { ...walnut, id: 'f-hex', label: 'White Hexagon Mosaic', finishTypeLabel: 'Mosaic', patternCategory: 'solid', tileWidthMm: 35, tileHeightMm: 35 };
  const withWall = (tiling?: SurfaceTiling) => {
    const base = input();
    return buildRenderBrief(
      input({
        finishes: [walnut, mosaic],
        layout: { ...base.layout, walls: [{ id: 'w-n', orientation: 'north', lengthMm: ROOM_W, openings: [], finishId: 'f-hex', tiling }] },
      })
    );
  };

  it('counts rows between the counter and the lowest wall cabinet', () => {
    // Base units 720 tall (one raised 40) → counter top 760 + 40 slab; upper at 1450.
    const b = withWall();
    const top = b.countertop!.topHeightsMm[0];
    const gap = 1450 - top;
    expect(b.prompt.imagePrompt).toContain(`north wall: about ${Math.round(gap / 35)} rows of tiles in the ${gap} mm between the counter and the wall cabinets`);
  });

  it('uses the laid size when the wall is laid at a chosen size', () => {
    const b = withWall({ tileWidthMm: 300, tileHeightMm: 150, pattern: 'straight', groutMm: 2, groutColor: '#c9c7c2' });
    const gap = 1450 - b.countertop!.topHeightsMm[0];
    expect(tileRowsLine(b)).toContain(`about ${Math.round(gap / 150)} rows`);
  });

  it('says nothing for an untiled wall or a wall without wall cabinets', () => {
    expect(tileRowsLine(buildRenderBrief(input()))).toBeNull();
    const base = input();
    const noUppers = buildRenderBrief(
      input({
        finishes: [walnut, mosaic],
        cabinets: base.cabinets.filter((c) => c.moduleType !== 'wall-cabinet'),
        layout: { ...base.layout, walls: [{ id: 'w-n', orientation: 'north', lengthMm: ROOM_W, openings: [], finishId: 'f-hex' }] },
      })
    );
    expect(tileRowsLine(noUppers)).toBeNull();
  });
});

describe('an open side in the brief (§146)', () => {
  it('has no finish, says the units stand free, and that the kitchen opens there', () => {
    const base = input();
    const b = buildRenderBrief(
      input({
        finishes: [walnut],
        layout: { ...base.layout, walls: [{ id: 'w-n', orientation: 'north', lengthMm: ROOM_W, openings: [], finishId: 'f-walnut', open: true }] },
      })
    );
    const north = b.room.walls.find((w) => w.wall === 'north')!;
    expect(north.open).toBe(true);
    expect(north.finish).toBeNull();
    expect(b.prompt.imagePrompt).toMatch(/North side, OPEN: no wall, the units stand free there/);
    expect(b.prompt.imagePrompt).toMatch(/there is NO wall on the north side; the kitchen opens there into an adjoining room/);
  });
});

describe('colour words and hung units (§152)', () => {
  it('a vivid colour is not called dark; a deep one still is', () => {
    expect(colourName('#ba2a04')).toBe('vivid red');
    expect(colourName('#1e3a8a')).toBe('dark blue');
  });

  it('a recoloured solid finish carries its hex and says it is a custom colour', () => {
    const gloss: SurfaceFinish = { ...walnut, id: 'f-gloss', label: 'White Gloss', albedoUrl: undefined, solidColor: '#ffffff', finishTypeLabel: 'Acrylic', patternCategory: 'solid', roughness: 0.1, clearcoat: 1 };
    const base = input();
    const b = buildRenderBrief(input({ finishes: [gloss], cabinets: base.cabinets.map((c) => ({ ...c, finishId: 'f-gloss', colorOverride: '#ba2a04' })) }));
    expect(b.prompt.imagePrompt).toMatch(/vivid red \(#ba2a04\) acrylic in high gloss \(custom colour on White Gloss[,)]/);
  });

  it('a base-type unit hung on the wall carries no countertop and is described as hung', () => {
    const base = input();
    const hung = cabinet('corner-blind', 850, 600, 700, { id: 'hung', x: 2000, y: 0, elevationMm: 1450, finishId: 'f-walnut' });
    const b = buildRenderBrief(input({ cabinets: [...base.cabinets, hung] }));
    const entry = b.cabinets.find((c) => c.box.minZ === 1450 && c.type.startsWith('blind'))!;
    expect(entry.countertop).toBe(false);
    expect(entry.type).toBe('blind corner base unit hung as a wall unit');
    expect(b.countertop!.topHeightsMm.every((z) => z < 1000)).toBe(true);
  });
});
