// worker/renderHandler.ts
//
// "Make image" (§132): the app sends the image brief (text) and its
// pictures (the main camera's line drawing and colour view, the other
// cameras' views); this checks sign-in and the business's image limits,
// asks Gemini (the model behind Google AI Studio) for ONE image, records
// the usage, and passes Gemini's reply back for the app to show and save.
//
// The Gemini key lives only in the Worker's secrets (GEMINI_API_KEY), for
// the same reason as the help relay's RunPod key: anything in the browser
// is readable by every visitor.
//
// The reply is passed through as TEXT, not parsed: it holds the image as
// a few MB of base64, and parsing that is CPU time a Worker is short of.
// Only the small usage block at its end is read (usageFromGeminiReply).

import { checkUsage, recordUsage, signedInToken, type SupabaseEnv } from './usage.ts';
import { geminiFetch, type GeminiProxyNamespace } from './geminiProxy.ts';

export interface RenderEnv extends SupabaseEnv {
  GEMINI_API_KEY?: string;
  // Configurable so the model can change without a code change. Starts on
  // the Pro image model ("Nano Banana Pro"), the user's choice (§132).
  GEMINI_IMAGE_MODEL?: string;
  // The US-pinned Durable Object that makes the call (§135); absent in
  // tests and the dev server, which call Google directly.
  GEMINI_PROXY?: GeminiProxyNamespace;
}

export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type RenderPart = { text: string } | { image: { mimeType: string; data: string } };

export interface RenderRequestBody {
  parts: RenderPart[];
  // e.g. "16:9", "4:3"; one Gemini accepts.
  aspectRatio?: string;
}

const MAX_IMAGES = 10;
const MAX_TOTAL_CHARS = 25_000_000;
const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validateRenderBody(body: unknown): body is RenderRequestBody {
  if (!body || typeof body !== 'object') return false;
  const { parts, aspectRatio } = body as RenderRequestBody;
  if (!Array.isArray(parts) || parts.length === 0) return false;
  if (aspectRatio !== undefined && !ASPECT_RATIOS.has(aspectRatio)) return false;
  let images = 0;
  let chars = 0;
  let hasText = false;
  for (const p of parts) {
    if (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string') {
      hasText ||= p.text.trim().length > 0;
      chars += p.text.length;
    } else if (p && typeof p === 'object' && 'image' in p && p.image && IMAGE_TYPES.has(p.image.mimeType) && typeof p.image.data === 'string') {
      images += 1;
      chars += p.image.data.length;
    } else {
      return false;
    }
  }
  return hasText && images <= MAX_IMAGES && chars <= MAX_TOTAL_CHARS;
}

// Gemini's request: our parts in order, asking for an image back.
export function geminiRequest(body: RenderRequestBody): unknown {
  return {
    contents: [
      {
        role: 'user',
        parts: body.parts.map((p) => ('text' in p ? { text: p.text } : { inline_data: { mime_type: p.image.mimeType, data: p.image.data } })),
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(body.aspectRatio ? { imageConfig: { aspectRatio: body.aspectRatio } } : {}),
    },
  };
}

// The usage block at the END of Gemini's reply, without parsing the
// image before it. Images: 1 if the reply holds any image data.
export function usageFromGeminiReply(text: string): { tokens: number; images: number } {
  const images = /"inline_?[dD]ata"/.test(text) ? 1 : 0;
  const at = text.lastIndexOf('"usageMetadata"');
  if (at < 0) return { tokens: 0, images };
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      try {
        const u = JSON.parse(text.slice(open, i + 1)) as { totalTokenCount?: number; promptTokenCount?: number; candidatesTokenCount?: number };
        return { tokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0), images };
      } catch {
        break;
      }
    }
  }
  return { tokens: 0, images };
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });

export async function handleRender(request: Request, env: RenderEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, 'Use POST.');
  if (!env.GEMINI_API_KEY) return json(503, 'Image making isn’t set up yet.');
  const token = await signedInToken(request, env);
  if (!token) return json(401, 'Please sign in again.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, 'Bad request.');
  }
  if (!validateRenderBody(body)) return json(400, 'Nothing to make an image from.');

  const allowance = await checkUsage(env, token, 'image');
  if (!allowance.allowed) return json(429, allowance.reason ?? 'Your business has reached its image limit.');

  const model = env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  let upstream: Response;
  try {
    upstream = await geminiFetch(env.GEMINI_PROXY, `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(geminiRequest(body)),
    });
  } catch {
    return json(502, 'The image service can’t be reached right now.');
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    // Google's error message says what's wrong (bad key, model name,
    // quota); never the key itself.
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // not JSON
    }
    console.error('Gemini error', upstream.status, message);
    return json(502, `The image service returned an error (${upstream.status}): ${message}`);
  }

  const usage = usageFromGeminiReply(text);
  await recordUsage(env, token, { kind: 'image', images: usage.images, tokens: usage.tokens, model });
  return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-render-model': model } });
}
