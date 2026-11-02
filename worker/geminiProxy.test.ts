// The US-pinned Gemini caller (§135).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProxy, geminiFetch, type GeminiProxyNamespace } from './geminiProxy';

afterEach(() => vi.restoreAllMocks());

describe('geminiFetch', () => {
  it('goes through the object pinned to eastern North America when deployed', async () => {
    const stubFetch = vi.fn(async (r: Request) => new Response(`via ${new URL(r.url).pathname} ${r.headers.get('x-goog-api-key')}`));
    const get = vi.fn(() => ({ fetch: stubFetch }));
    const ns: GeminiProxyNamespace = { idFromName: (n) => `id:${n}`, get };
    const res = await geminiFetch(ns, 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': 'k' },
      body: '{}',
    });
    expect(await res.text()).toBe('via /v1beta/models/m:generateContent k');
    expect(get).toHaveBeenCalledWith('id:gemini-us', { locationHint: 'enam' });
  });

  it('calls Google directly without the binding (tests, dev server)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('direct'));
    expect(await (await geminiFetch(undefined, 'https://generativelanguage.googleapis.com/x', {})).text()).toBe('direct');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('the object', () => {
  it('forwards only to Gemini, so it is not an open proxy', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const proxy = new GeminiProxy();
    expect((await proxy.fetch(new Request('https://evil.example/steal'))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
    expect(await (await proxy.fetch(new Request('https://generativelanguage.googleapis.com/v1beta/models'))).text()).toBe('ok');
  });
});
