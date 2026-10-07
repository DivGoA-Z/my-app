import { describe, expect, it } from 'vitest';
import { buildRenderBrief } from './renderBrief';
import { buildLeonardoPack, leonardoPrompt, LEONARDO, LEONARDO_PREFIX, LEONARDO_SIZE, INIT_IMAGE_ID_PLACEHOLDER, LINE_ARTEFACT_TERMS, LEONARDO_MAX_PROMPT_CHARS, SHORT_PROMPT_MAX_CHARS, SHORT_NEGATIVE_MAX_CHARS } from './leonardo';
import { CONDENSED_MAX_WORDS } from './renderBrief';
import { cabinet, layout } from '../test/fixtures';
import { defaultRateCard } from '../types/rates';

function brief(cabinets = [cabinet('base-cabinet', 600, 560, 720, { x: 0, y: 0 }), cabinet('wall-cabinet', 600, 350, 720, { x: 0, y: 0 })]) {
  return buildRenderBrief({
    layout: layout({ dimensions: { widthMm: 3000, depthMm: 2400, ceilingHeightMm: 2700 } }),
    cabinets,
    appliances: [{ id: 'h', layoutId: 'l', applianceType: 'stove', x: 0, y: 30, widthMm: 600, depthMm: 500, heightMm: 80, elevationMm: 760, rotationDeg: 0, unitPrice: 0, quantity: 1 }],
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
  });
}

const pack = () => buildLeonardoPack(brief(), { guidance: 'k-leonardo-guide.png' });

describe('leonardoPrompt', () => {
  it('starts with the prefix and stays within the word cap, prefix included', () => {
    const p = leonardoPrompt(brief());
    expect(p.startsWith(LEONARDO_PREFIX)).toBe(true);
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(CONDENSED_MAX_WORDS);
    // Leonardo's box takes 1,500 characters (Phoenix's API takes 2,000).
    expect(p.length).toBeLessThanOrEqual(LEONARDO_MAX_PROMPT_CHARS);
  });

  it('reads as prose, not "Key: value" fields', () => {
    const p = leonardoPrompt(brief());
    expect(p).not.toMatch(/Appliances:|Lighting:/);
    expect(p).toContain('It has a built-in hob.');
  });

  it('never names a CG renderer (it would pull towards a CG look)', () => {
    expect(leonardoPrompt(brief()).toLowerCase()).not.toContain('octane');
  });
});

describe('buildLeonardoPack', () => {
  it('locks structure with Edge to Image on an SDXL model (Phoenix has no edge/depth ControlNet)', () => {
    const body = pack().requests.structureLocked.body as Record<string, unknown>;
    expect(body.modelId).toBe(LEONARDO.visionXL);
    expect(body).toMatchObject({ alchemy: true, photoReal: true, photoRealVersion: 'v2', presetStyle: 'CINEMATIC' });
    expect(body.controlnets).toEqual([
      // "Mid", not "High": High drew the guide's lines as stitched seams (§104).
      { initImageId: INIT_IMAGE_ID_PLACEHOLDER, initImageType: 'UPLOADED', preprocessorId: 19, strengthType: 'Mid' },
    ]);
  });

  it('uses a size Alchemy accepts (≤ 1024, multiples of 8)', () => {
    const body = pack().requests.structureLocked.body as { width: number; height: number };
    for (const v of [body.width, body.height]) {
      expect(v).toBeLessThanOrEqual(1024);
      expect(v % 8).toBe(0);
    }
    expect(pack().guidanceImage).toMatchObject({ widthPx: LEONARDO_SIZE.widthPx, heightPx: LEONARDO_SIZE.heightPx });
  });

  it('passes the brief\'s negative prompt through, plus the line-artefact terms', () => {
    const b = brief();
    const p = buildLeonardoPack(b, { guidance: 'g.png' });
    expect(p.negative_prompt.endsWith(b.prompt.negativePrompt)).toBe(true);
    for (const t of LINE_ARTEFACT_TERMS) expect(p.negative_prompt).toContain(t);
    expect((p.requests.structureLocked.body as { negative_prompt: string }).negative_prompt).toBe(p.negative_prompt);
  });

  it('has a short prompt and negative that fit the free plan, colours first', () => {
    const p = pack();
    expect(p.promptShort.length).toBeLessThanOrEqual(SHORT_PROMPT_MAX_CHARS);
    expect(p.negativePromptShort.length).toBeLessThanOrEqual(SHORT_NEGATIVE_MAX_CHARS);
    // Materials come in the second sentence, before appliances and light.
    const second = p.promptShort.split('. ')[1];
    expect(second).toMatch(/cabinets/);
    expect(p.promptShort).not.toMatch(/\bmm\b|\b[CAOPL]\d+\b/);
    for (const t of LINE_ARTEFACT_TERMS.slice(0, 3)) expect(p.negativePromptShort).toContain(t);
  });

  it('offers Phoenix on v2 with a style id, not presetStyle, and no prompt rewriting', () => {
    const phoenix = pack().requests.phoenix;
    expect(phoenix.url).toBe(LEONARDO.v2Generations);
    const params = (phoenix.body as { parameters: Record<string, unknown> }).parameters;
    expect(params.style_ids).toEqual([LEONARDO.phoenixStyleProColorPhoto]);
    expect(params.prompt_enhance).toBe('OFF');
    expect(params).not.toHaveProperty('presetStyle');
  });

  it('never carries prices or customer details', () => {
    const text = JSON.stringify(pack());
    expect(text).not.toMatch(/unitPrice|₹|clientName|phone/);
  });
});

describe('the 1,500-character limit', () => {
  it('holds on a large kitchen with many finishes, ending on a whole sentence', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      cabinet(i % 3 ? 'base-cabinet' : 'wall-cabinet', 600, 560, 720, { x: (i % 5) * 600, y: 0, colorOverride: `#${(i * 397_000).toString(16).padStart(6, '0').slice(0, 6)}` })
    );
    const p = leonardoPrompt(brief(many));
    expect(p.length).toBeLessThanOrEqual(LEONARDO_MAX_PROMPT_CHARS);
    expect(p.endsWith('.')).toBe(true);
  });
});
