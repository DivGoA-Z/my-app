// "Make image" relay (§132).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMAGE_MODEL, geminiRequest, handleRender, usageFromGeminiReply, validateRenderBody } from './renderHandler';

const env = { GEMINI_API_KEY: 'g-key', SUPABASE_URL: 'https://sb.example', SUPABASE_ANON_KEY: 'anon' };
const body = { parts: [{ text: 'Make the kitchen photo.' }, { image: { mimeType: 'image/png', data: 'iVBOR' } }], aspectRatio: '16:9' };
const ask = (b: unknown = body, headers: Record<string, string> = { authorization: 'Bearer user-token' }) =>
  new Request('https://app/api/render', { method: 'POST', headers, body: JSON.stringify(b) });
const geminiReply = JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'Here it is.' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
  usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 1290, totalTokenCount: 3090 },
});

afterEach(() => vi.restoreAllMocks());

const world = (gemini: () => Response, allowed = true) => {
  const recorded: unknown[] = [];
  const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return new Response('{}', { status: 200 });
    if (u.endsWith('/rpc/usage_check')) return new Response(JSON.stringify(allowed ? { allowed: true } : { allowed: false, reason: 'All 20 images used today.' }));
    if (u.endsWith('/rpc/usage_record')) {
      recorded.push(JSON.parse(init!.body as string));
      return new Response('', { status: 204 });
    }
    return gemini();
  });
  return { f, recorded };
};

describe('the request', () => {
  it('accepts text with images, and refuses anything else', () => {
    expect(validateRenderBody(body)).toBe(true);
    expect(validateRenderBody({ parts: [] })).toBe(false);
    expect(validateRenderBody({ parts: [{ image: { mimeType: 'image/png', data: 'x' } }] })).toBe(false); // no text
    expect(validateRenderBody({ parts: [{ text: 'a' }, { image: { mimeType: 'image/gif', data: 'x' } }] })).toBe(false);
    expect(validateRenderBody({ ...body, aspectRatio: '7:3' })).toBe(false);
    expect(validateRenderBody({ parts: [{ text: 'a' }, ...Array.from({ length: 15 }, () => ({ image: { mimeType: 'image/png', data: 'x' } }))] })).toBe(false);
  });

  it('becomes a Gemini request asking for an image, in order', () => {
    expect(geminiRequest(body)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'Make the kitchen photo.' }, { inline_data: { mime_type: 'image/png', data: 'iVBOR' } }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } },
    });
  });
});

describe('reading the reply without parsing the image', () => {
  it('finds the usage block at the end, and whether an image came back', () => {
    expect(usageFromGeminiReply(geminiReply)).toEqual({ tokens: 3090, images: 1 });
    expect(usageFromGeminiReply('{"candidates":[{"finishReason":"SAFETY"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":0}}')).toEqual({ tokens: 10, images: 0 });
    expect(usageFromGeminiReply('not json')).toEqual({ tokens: 0, images: 0 });
  });
});

describe('the relay', () => {
  it('needs the key, a sign-in, and something to draw', async () => {
    expect((await handleRender(ask(), {})).status).toBe(503);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    expect((await handleRender(ask(), env)).status).toBe(401);
    expect((await handleRender(ask(body, {}), env)).status).toBe(401);
  });

  it('refuses over the limit without calling Gemini', async () => {
    const { f, recorded } = world(() => {
      throw new Error('Gemini must not be called');
    }, false);
    const res = await handleRender(ask(), env);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('All 20 images used today.');
    expect(f.mock.calls.some(([u]) => String(u).includes('googleapis'))).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('calls Gemini with the key and model, passes the reply back, and records one image', async () => {
    const { f, recorded } = world(() => new Response(geminiReply));
    const res = await handleRender(ask(), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(geminiReply);
    const [url, init] = f.mock.calls.find(([u]) => String(u).includes('googleapis'))!;
    expect(String(url)).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_IMAGE_MODEL}:generateContent`);
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(recorded).toEqual([{ p_kind: 'image', p_images: 1, p_tokens: 3090, p_model: DEFAULT_IMAGE_MODEL }]);
  });

  it('uses the configured model', async () => {
    const { f } = world(() => new Response(geminiReply));
    await handleRender(ask(), { ...env, GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image' });
    expect(f.mock.calls.some(([u]) => String(u).includes('/models/gemini-2.5-flash-image:generateContent'))).toBe(true);
  });

  it('shows Google’s error message, never the key, and records nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { recorded } = world(() => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 }));
    const res = await handleRender(ask(), env);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/API key not valid/);
    expect(text).not.toMatch(/g-key/);
    expect(recorded).toEqual([]);
  });
});
