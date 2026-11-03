// The public demo's local writes (§138).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoAwareFetch, fakeRestWrite, setDemoMode } from './demoMode';

afterEach(() => {
  setDemoMode(false);
  vi.restoreAllMocks();
});

const rest = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://sb.example/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe('PostgREST answers for writes that aren’t sent', () => {
  it('an insert asking for its row back gets it', async () => {
    const res = await fakeRestWrite(rest('POST', 'projects', { id: 'p1', client_name: 'Asha' }, { prefer: 'return=representation', accept: 'application/vnd.pgrst.object+json' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'p1', client_name: 'Asha' });
  });

  it('an update gets the patch plus its id filter (what .select("id") checks)', async () => {
    const res = await fakeRestWrite(rest('PATCH', 'projects?id=eq.p1&select=id', { notes: 'hi' }, { prefer: 'return=representation' }));
    expect(await res.json()).toEqual([{ id: 'p1', notes: 'hi' }]);
  });

  it('a bulk upsert gets all its rows; without return=representation, no body', async () => {
    const res = await fakeRestWrite(rest('POST', 'layouts?on_conflict=id', [{ id: 'a' }, { id: 'b' }], { prefer: 'resolution=merge-duplicates,return=representation' }));
    expect(await res.json()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect((await fakeRestWrite(rest('DELETE', 'projects?id=eq.p1'))).status).toBe(204);
  });
});

describe('in demo mode', () => {
  it('reads go to Supabase; writes, uploads and password changes don’t', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    setDemoMode(true);
    await demoAwareFetch('https://sb.example/rest/v1/projects?select=*');
    await demoAwareFetch('https://sb.example/rest/v1/rpc/my_usage_status', { method: 'POST', body: '{}' });
    await demoAwareFetch('https://sb.example/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: '{}' });
    expect(f).toHaveBeenCalledTimes(3);
    expect((await demoAwareFetch('https://sb.example/rest/v1/projects', { method: 'POST', body: '{}' })).status).toBe(201);
    expect(await (await demoAwareFetch('https://sb.example/rest/v1/rpc/save_my_catalog_default', { method: 'POST', body: '{}' })).json()).toBeNull();
    expect(await (await demoAwareFetch('https://sb.example/storage/v1/object/renders/b/x.png', { method: 'POST', body: 'x' })).json()).toEqual({ Key: 'renders/b/x.png' });
    expect((await demoAwareFetch('https://sb.example/auth/v1/user', { method: 'PUT', body: '{"password":"x"}' })).status).toBe(403);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('outside demo mode everything goes through', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    await demoAwareFetch('https://sb.example/rest/v1/projects', { method: 'POST', body: '{}' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
