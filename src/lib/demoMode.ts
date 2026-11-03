// src/lib/demoMode.ts
//
// The public demo account (§138). The database refuses every write from
// a demo business, so other visitors always see the original sample. The
// app still lets this visitor change anything: in demo mode the Supabase
// client's writes are answered HERE with a plausible success instead of
// being sent, so autosave says "Saved", dialogs close, and the change
// lives on in this tab's memory until a refresh, which reloads the
// sample. Reads (and signing in or out) go through as normal.
//
// The server's refusal is the guard; this only keeps the app from
// showing errors for a refusal the visitor can't do anything about.

let demo = false;

export function setDemoMode(on: boolean): void {
  demo = on;
}

export function isDemoMode(): boolean {
  return demo;
}

// RPCs that only read, called by the app in a normal session.
const READ_RPCS = new Set(['is_super_admin', 'my_usage_status', 'usage_check']);

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// What PostgREST would have returned for this write, built from the
// request itself: the rows sent (insert/upsert), or the patch plus the
// `col=eq.value` filters (update). Only when the caller asked for rows
// back (Prefer: return=representation); a single object when it asked
// for one (.single()).
export async function fakeRestWrite(req: Request): Promise<Response> {
  const prefer = req.headers.get('prefer') ?? '';
  if (!prefer.includes('return=representation')) return new Response(null, { status: req.method === 'POST' ? 201 : 204 });
  const text = await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const url = new URL(req.url);
  const filters: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (v.startsWith('eq.')) filters[k] = v.slice(3);
  });
  const rows: Record<string, unknown>[] =
    req.method === 'DELETE'
      ? [filters]
      : (Array.isArray(body) ? body : [body ?? {}]).map((r) => ({ ...filters, ...(r as Record<string, unknown>) }));
  const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
  return json(single ? (rows[0] ?? null) : rows, req.method === 'POST' ? 201 : 200);
}

export async function demoAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!demo) return fetch(input, init);
  const req = new Request(input, init);
  if (req.method === 'GET' || req.method === 'HEAD') return fetch(req);
  const path = new URL(req.url).pathname;
  // Signing in, refreshing and signing out work; changing the shared
  // demo login's password or email doesn't.
  if (path.startsWith('/auth/v1/')) {
    if (path === '/auth/v1/user') return json({ msg: 'The demo account can’t be changed.' }, 403);
    return fetch(req);
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    if (READ_RPCS.has(path.split('/').pop() ?? '')) return fetch(req);
    return json(null);
  }
  if (path.startsWith('/rest/v1/')) return fakeRestWrite(req);
  if (path.startsWith('/storage/v1/object')) return json({ Key: path.replace(/^\/storage\/v1\/object\//, '') });
  return fetch(req);
}
