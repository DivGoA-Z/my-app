// src/lib/leonardo.ts
//
// Ready-to-send Leonardo.ai request bodies for one design, built from the
// render brief (lib/renderBrief.ts) and a structure render of the 3D
// camera (lib/viewSnapshot.ts). Nothing here calls Leonardo: an API key
// can't live in this app (every VITE_ value ships to the browser), so
// sending needs a small server-side proxy first — see §101.
//
// Every Leonardo-specific value below was checked against
// docs.leonardo.ai on 6 Oct 2026 (LEONARDO_DOCS_CHECKED). The points that
// differ from the brief we were given, and why:
//
//   - Phoenix CANNOT take a depth or edge map. Leonardo's ControlNet table
//     lists Edge to Image (19) and Depth to Image (20) for SDXL models
//     only; Phoenix's image inputs are style / content / character /
//     image-to-image references. So the structure-locked request is
//     Vision XL (SDXL) with Edge to Image; Phoenix is offered as a
//     prompt-only alternative.
//   - ControlNet strength is a named bucket on a 0–2 scale ("Low" 0–0.66,
//     "Mid" 0.66–1.32, "High" 1.32–2), not 0.7–0.85. "Medium-high" on a
//     0–1 scale is 1.4–1.7 on theirs: "High" — which proved too strong in
//     practice (§104), so the request uses "Mid".
//   - There is no "INTERIOR" presetStyle. "CINEMATIC" exists (SDXL /
//     PhotoReal). Phoenix uses style_ids instead; "Pro color photography"
//     fits a true-to-colour interior better than "Cinematic".
//   - With Alchemy on, width and height must be ≤ 1024 and multiples of
//     8: 1024 × 576 (16:9).
//   - "octane render" is left out of the prefix: it's a CG renderer's
//     name, it pulls the image towards a CG look, and "CGI look" is in
//     our own negative prompt.
//   - Phoenix's prompt_enhance is OFF: Leonardo rewriting the prompt would
//     undo the grounding.
//
// AFTER THE FIRST REAL RUN (§104: Lightning XL, Edge to Image at High):
// the geometry was exact, but every edge came out as a drawn, stitched
// seam on grey "cardboard", and the off-white gloss was lost. The edges
// were followed too literally. So the request now uses "Mid", the
// negative prompt names the artefact (LINE_ARTEFACT_TERMS), and there's
// a short prompt for the free plan's length limit (the full one was
// rewritten by another model to fit, which loses the grounding).

import type { RenderBrief, CabinetEntry } from './renderBrief';
import { condensedPrompt, CONDENSED_MAX_WORDS, kitchenShape, shortFinish, proseCase, withoutSizes, withArticle, metalColour } from './renderBrief';

export const LEONARDO_DOCS_CHECKED = '2026-10-06';

export const LEONARDO_PREFIX = 'Masterpiece, hyper-realistic architectural interior photography, 8k resolution.';

// Alchemy limits both sides to 1024 (multiples of 8).
export const LEONARDO_SIZE = { widthPx: 1024, heightPx: 576 };

export const LEONARDO = {
  v1Generations: 'https://cloud.leonardo.ai/api/rest/v1/generations',
  v2Generations: 'https://cloud.leonardo.ai/api/rest/v2/generations',
  initImage: 'https://cloud.leonardo.ai/api/rest/v1/init-image',
  visionXL: '5c232a9e-9061-4777-980a-ddc8e65647c6',
  kinoXL: 'aa77f04e-3eec-4034-9c07-d0f619684628',
  phoenix: 'phoenix-v1.0',
  edgeToImage: 19,
  depthToImage: 20,
  phoenixStyleProColorPhoto: '7c3f932b-a572-47cb-9b9b-f20211e63b5b',
} as const;

// Placeholder the sender replaces with the id from the init-image upload.
export const INIT_IMAGE_ID_PLACEHOLDER = '<initImageId from step 1>';

// What over-followed edge guidance looks like, named so the model avoids
// it. Added to every Leonardo negative prompt.
export const LINE_ARTEFACT_TERMS = ['visible outlines', 'sketch lines', 'wireframe', 'stitched seams', 'cardboard texture', 'monochrome'];

// Free-plan sized. The exact limit isn't documented where we could see
// it; 400 characters fitted, and the short negative is held to 300.
export const SHORT_PROMPT_MAX_CHARS = 400;
export const SHORT_NEGATIVE_MAX_CHARS = 300;

export interface LeonardoPack {
  docsChecked: string;
  guidanceImage: { file: string; widthPx: number; heightPx: number; kind: 'line-render' };
  prompt: string;
  negative_prompt: string;
  // For a plan with a prompt-length limit: colours first, no counts or
  // sizes. Paste these instead of shortening the full ones by hand.
  promptShort: string;
  negativePromptShort: string;
  steps: string[];
  requests: {
    structureLocked: { what: string; method: 'POST'; url: string; body: Record<string, unknown> };
    phoenix: { what: string; method: 'POST'; url: string; body: Record<string, unknown> };
  };
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

// Leonardo's prompt box takes 1,500 characters, on paid plans too (§104).
export const LEONARDO_MAX_PROMPT_CHARS = 1500;

// Prefix + the condensed prompt, within CONDENSED_MAX_WORDS AND
// LEONARDO_MAX_PROMPT_CHARS. Over the character limit, the word budget is
// tightened so condensedPrompt drops whole optional sentences, never
// cutting one mid-way; the slice is a last resort for a pathological
// design and keeps whole words.
export function leonardoPrompt(brief: Omit<RenderBrief, 'prompt'>): string {
  for (let budget = CONDENSED_MAX_WORDS - words(LEONARDO_PREFIX); budget > 40; budget -= 10) {
    const text = `${LEONARDO_PREFIX} ${condensedPrompt(brief, budget)}`;
    if (text.length <= LEONARDO_MAX_PROMPT_CHARS) return text;
  }
  const text = `${LEONARDO_PREFIX} ${condensedPrompt(brief, 40)}`;
  return text.length <= LEONARDO_MAX_PROMPT_CHARS ? text : text.slice(0, LEONARDO_MAX_PROMPT_CHARS).replace(/\s+\S*$/, '');
}

// The finish most cabinets wear, with their most common handle: the one
// sentence a short prompt can afford about the units.
function mainCabinetLook(cabinets: CabinetEntry[]): string | null {
  if (!cabinets.length) return null;
  const tally = (keys: string[]) => {
    const n = new Map<string, number>();
    for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const finish = tally(cabinets.map((c) => shortFinish(c.finish, 'plain light')));
  const handle = tally(
    cabinets
      .filter((c) => c.handle)
      .map((c) => (c.handle!.kind === 'handleless' ? 'handleless fronts' : `${metalColour(c.handle!)} ${c.handle!.kind} handles`))
  );
  return `${finish} cabinets${handle ? ` with ${handle}` : ''}`;
}

// Colours and materials first (a short prompt's first words weigh most),
// then appliances and light, then style. Whole clauses are dropped from
// the end of the optional list until it fits.
export function leonardoShortPrompt(brief: Omit<RenderBrief, 'prompt'>, maxChars = SHORT_PROMPT_MAX_CHARS): string {
  const first = `Photorealistic interior photo of a compact ${kitchenShape(brief.cabinets)} in an Indian apartment.`;
  const look: string[] = [];
  const cabinets = mainCabinetLook(brief.cabinets);
  if (cabinets) look.push(cabinets);
  if (brief.countertop) look.push(`${shortFinish(brief.countertop.finish, 'polished light-grey stone')} countertop`);
  look.push(`${shortFinish(brief.room.floor, 'light-grey tile')} floor`);
  const optional: string[] = [];
  const hob = brief.appliances.find((a) => a.type === 'Stove / Hob');
  const chimney = brief.appliances.some((a) => a.type === 'Chimney');
  const sink = brief.appliances.some((a) => a.type === 'Sink');
  const kit = [
    hob ? `${withArticle(proseCase(withoutSizes(hob.model ?? 'built-in hob')))}${chimney ? ' under a chimney hood' : ''}` : '',
    sink ? 'an inset sink' : '',
  ].filter(Boolean);
  if (kit.length) optional.push(`${kit.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase()));
  const light = [
    brief.openings.some((o) => o.daylight) ? 'soft daylight from a window' : '',
    ...[...new Set(brief.lighting.fixtures.filter((f) => f.on).map((f) => `warm ${f.colourTempK} K ${f.kind.toLowerCase()}`))].slice(0, 1),
  ].filter(Boolean);
  if (light.length) optional.push(`${light.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase()));
  const style = 'True-to-colour, uncluttered, sharp.';

  const lookSentence = `${look.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
  for (let keep = optional.length; keep >= 0; keep--) {
    const text = [first, lookSentence, ...optional.slice(0, keep), style].join(' ');
    if (text.length <= maxChars) return text;
  }
  return [first, lookSentence, style].join(' ').slice(0, maxChars);
}

// The artefact terms and generic guards first, then what's absent that a
// model is most likely to add.
export function leonardoShortNegative(brief: RenderBrief, maxChars = SHORT_NEGATIVE_MAX_CHARS): string {
  const terms = [...LINE_ARTEFACT_TERMS, 'extra cabinets', 'clutter', 'people', 'text', 'watermark', 'CGI look', 'distorted perspective', ...brief.notInThisRoom];
  const out: string[] = [];
  for (const t of terms) {
    if ([...out, t].join(', ').length > maxChars) break;
    out.push(t);
  }
  return out.join(', ');
}

export function buildLeonardoPack(
  brief: RenderBrief,
  files: { guidance: string }
): LeonardoPack {
  const prompt = leonardoPrompt(brief);
  const negative_prompt = [...LINE_ARTEFACT_TERMS, brief.prompt.negativePrompt].join(', ');
  const { widthPx: width, heightPx: height } = LEONARDO_SIZE;
  return {
    docsChecked: LEONARDO_DOCS_CHECKED,
    guidanceImage: { file: files.guidance, widthPx: width, heightPx: height, kind: 'line-render' },
    prompt,
    negative_prompt,
    promptShort: leonardoShortPrompt(brief),
    negativePromptShort: leonardoShortNegative(brief),
    steps: [
      `1. POST ${LEONARDO.initImage} with {"extension":"png"}. The response's uploadInitImage has an id, a url and fields (a JSON string).`,
      `2. Within 2 minutes, POST ${files.guidance} to that url as multipart/form-data: every key of the parsed fields, then the file as raw bytes (not base64).`,
      `3. Put uploadInitImage.id in place of "${INIT_IMAGE_ID_PLACEHOLDER}" and send requests.structureLocked.`,
      '4. Poll GET https://cloud.leonardo.ai/api/rest/v1/generations/{generationId} until it is COMPLETE.',
      'Every call needs the header "authorization: Bearer <API key>", sent from a server — never from the browser.',
    ],
    requests: {
      structureLocked: {
        what: 'Vision XL + PhotoReal v2 + Alchemy, guided by the line render with Edge to Image at "Mid". "High" was tried first and drew the guide\'s lines as stitched seams (§104); go to "Low" if lines still show, "High" only if units drift. Try Kino XL (LEONARDO.kinoXL) for a more cinematic look.',
        method: 'POST',
        url: LEONARDO.v1Generations,
        body: {
          modelId: LEONARDO.visionXL,
          prompt,
          negative_prompt,
          width,
          height,
          num_images: 4,
          alchemy: true,
          photoReal: true,
          photoRealVersion: 'v2',
          presetStyle: 'CINEMATIC',
          controlnets: [
            {
              initImageId: INIT_IMAGE_ID_PLACEHOLDER,
              initImageType: 'UPLOADED',
              preprocessorId: LEONARDO.edgeToImage,
              strengthType: 'Mid',
            },
          ],
        },
      },
      phoenix: {
        what: 'Phoenix 1.0 from the prompt alone. Phoenix takes no edge or depth guidance, so the layout is only as good as the words: for comparison, not for approval images.',
        method: 'POST',
        url: LEONARDO.v2Generations,
        body: {
          model: LEONARDO.phoenix,
          parameters: {
            prompt,
            negative_prompt,
            width,
            height,
            quantity: 4,
            mode: 'QUALITY',
            contrast: 'MEDIUM',
            prompt_enhance: 'OFF',
            style_ids: [LEONARDO.phoenixStyleProColorPhoto],
          },
          public: false,
        },
      },
    },
  };
}
