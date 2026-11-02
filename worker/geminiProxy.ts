// worker/geminiProxy.ts
//
// Calls Google's Gemini API from the US (§135). Gemini refuses some
// countries by the CALLER's address ("User location is not supported for
// the API use"), and Cloudflare runs a Worker wherever the request lands:
// from India that was Singapore or Hong Kong at random (measured: about
// half each), and Hong Kong is refused. A Durable Object can be pinned to
// a region (locationHint), so the Worker hands the Gemini request to one
// created in eastern North America, which makes the call from there.
//
// The classic Durable Object shape (a class with fetch), so it needs no
// Cloudflare-only imports and the rest of worker/ still type-checks and
// runs under Node (tests, the dev server). It forwards ONLY to Google's
// Gemini host, so it can't be used as an open proxy.

const GEMINI_HOST = 'generativelanguage.googleapis.com';

export class GeminiProxy {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).hostname !== GEMINI_HOST) return new Response('Not allowed', { status: 403 });
    return fetch(request);
  }
}

// The binding, as the Worker sees it (wrangler.jsonc durable_objects).
export interface GeminiProxyNamespace {
  idFromName(name: string): unknown;
  get(id: unknown, options?: { locationHint?: string }): { fetch(request: Request): Promise<Response> };
}

// fetch() for a Gemini request: through the US proxy when the binding
// exists (deployed), straight out otherwise (tests, the dev server).
export function geminiFetch(proxy: GeminiProxyNamespace | undefined, url: string, init: RequestInit): Promise<Response> {
  if (!proxy) return fetch(url, init);
  // One named object, created in eastern North America on first use.
  const stub = proxy.get(proxy.idFromName('gemini-us'), { locationHint: 'enam' });
  return stub.fetch(new Request(url, init));
}
