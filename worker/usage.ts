// worker/usage.ts
//
// Sign-in and AI usage limits for the Worker's paid endpoints (§132): the
// Help assistant and "Make image". Both call Supabase AS THE USER (their
// own token), so the database decides which business it is and applies
// that business's limits; the Worker holds no Supabase key of its own.
//
// Check before calling the model; record after, with what it actually
// used. The user can't skip the record: the model's key is only here.

export interface SupabaseEnv {
  // The same public values the app uses.
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export function bearerToken(request: Request): string | null {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
}

// The caller's token if they're signed in, else null.
export async function signedInToken(request: Request, env: SupabaseEnv): Promise<string | null> {
  const token = bearerToken(request);
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  return res.ok ? token : null;
}

async function rpc(env: SupabaseEnv, token: string, fn: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY ?? '',
    },
    body: JSON.stringify(args),
  });
}

export type UsageKind = 'image' | 'help';

// May the caller's business use this now? Fails CLOSED: if the limits
// can't be read (schema.sql not re-run, Supabase down), nothing paid runs.
export async function checkUsage(env: SupabaseEnv, token: string, kind: UsageKind): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const res = await rpc(env, token, 'usage_check', { p_kind: kind });
    if (!res.ok) {
      console.error('usage_check failed', res.status, (await res.text()).slice(0, 300));
      return { allowed: false, reason: 'Usage limits couldn’t be checked right now. Please try again later.' };
    }
    const body = (await res.json()) as { allowed?: boolean; reason?: string };
    return { allowed: body.allowed === true, reason: body.reason };
  } catch {
    return { allowed: false, reason: 'Usage limits couldn’t be checked right now. Please try again later.' };
  }
}

// Never throws: the answer is already on its way to the person.
export async function recordUsage(
  env: SupabaseEnv,
  token: string,
  usage: { kind: UsageKind; images: number; tokens: number; model: string }
): Promise<void> {
  try {
    const res = await rpc(env, token, 'usage_record', {
      p_kind: usage.kind,
      p_images: Math.max(0, Math.round(usage.images)),
      p_tokens: Math.max(0, Math.round(usage.tokens)),
      p_model: usage.model,
    });
    if (!res.ok) console.error('usage_record failed', res.status, (await res.text()).slice(0, 300));
  } catch (err) {
    console.error('usage_record failed', err);
  }
}

// A rough token count when the model didn't report one: ~4 characters
// per token for English, which is what limits need (not billing).
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
}
