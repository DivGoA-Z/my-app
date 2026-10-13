// worker/helpHandler.ts
//
// The help assistant's relay (§129): the browser sends the conversation
// here; this checks the person is signed in, puts the app guide in front
// as the model's instructions, calls the model, and streams the answer
// back as plain text.
//
// Why a relay at all: the model's API key (RunPod) must never reach the
// browser — anything in the bundle, VITE_* included, is readable by any
// visitor. The key lives only in the Worker's secrets.
//
// Pure fetch/streams code, no Cloudflare or Node specifics, so the same
// function runs in the deployed Worker (worker/index.ts) and in the Vite
// dev server against a local Ollama (vite.config.ts).
//
// The upstream is any OpenAI-compatible chat endpoint: RunPod's vLLM
// worker (https://api.runpod.ai/v2/<endpoint-id>/openai/v1) or Ollama
// (http://localhost:11434/v1).

export interface HelpEnv {
  // OpenAI-compatible base URL, ending in /v1.
  HELP_LLM_BASE_URL?: string;
  HELP_LLM_MODEL?: string;
  // Secret. Absent for a local Ollama.
  HELP_LLM_API_KEY?: string;
  // 'ollama' = Ollama's own API (base URL without /v1), which, unlike its
  // OpenAI-compatible one, lets us ask for a context long enough for the
  // guide. Otherwise Ollama's default context silently cut the guide off
  // and the answers came out long and wrong (§129). Default: OpenAI-compatible.
  HELP_LLM_PROVIDER?: 'openai' | 'ollama';
  // To check the caller's sign-in. Public values (the browser has them).
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface HelpTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HelpRequestBody {
  messages: HelpTurn[];
  // Where the person is in the app right now, e.g. "Design editor · Plan
  // tab · a Cabinet is selected". Helps with "where is…" questions.
  screen?: string;
}

// Enough history for a follow-up ("and then?"), short enough for a 4B
// model's attention and the context window next to a ~6k-token guide.
export const MAX_TURNS = 8;
export const MAX_CHARS_PER_TURN = 1500;
export const MAX_ANSWER_TOKENS = 600;
// The guide is ~7,000 tokens; room for it, the history and the answer.
export const CONTEXT_TOKENS = 12288;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// The messages sent to the model: the guide, where the person is, then the
// most recent turns (clipped), ending with the person's question.
export function buildMessages(guide: string, body: HelpRequestBody): ChatMessage[] {
  const turns = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_TURN) }));
  const screen = body.screen?.trim().slice(0, 200);
  const system = screen ? `${guide}\n\n## Where the person is right now\n\n${screen}` : guide;
  return [{ role: 'system', content: system }, ...turns];
}

export function validateBody(body: unknown): body is HelpRequestBody {
  if (!body || typeof body !== 'object') return false;
  const messages = (body as HelpRequestBody).messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return !!last && last.role === 'user' && typeof last.content === 'string' && last.content.trim().length > 0;
}

// Text from an OpenAI-style streaming response ("data: {...}" lines, then
// "data: [DONE]"). Lines can arrive split across chunks, so the caller
// keeps the unfinished tail and passes it back in.
export function parseSseChunk(buffer: string): { texts: string[]; rest: string; done: boolean } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let done = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    try {
      const text = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text) texts.push(text);
    } catch {
      // A keep-alive or malformed line: skip it.
    }
  }
  return { texts, rest, done };
}

// The same for Ollama's own API: one JSON object per line.
export function parseNdjsonChunk(buffer: string): { texts: string[]; rest: string; done: boolean } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let done = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.message?.content === 'string' && obj.message.content) texts.push(obj.message.content);
      if (obj?.done) done = true;
    } catch {
      // skip
    }
  }
  return { texts, rest, done };
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });

async function signedIn(request: Request, env: HelpEnv): Promise<boolean> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  return res.ok;
}

export async function handleHelp(
  request: Request,
  env: HelpEnv,
  guide: string,
  // The dev server skips the sign-in check: it only listens on this machine.
  { skipAuth = false }: { skipAuth?: boolean } = {}
): Promise<Response> {
  if (request.method !== 'POST') return json(405, 'Use POST.');
  if (!env.HELP_LLM_BASE_URL || !env.HELP_LLM_MODEL) return json(503, 'The help assistant isn’t set up yet.');
  if (!skipAuth && !(await signedIn(request, env))) return json(401, 'Please sign in again.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, 'Bad request.');
  }
  if (!validateBody(body)) return json(400, 'Ask a question first.');

  const ollama = env.HELP_LLM_PROVIDER === 'ollama';
  const base = env.HELP_LLM_BASE_URL.replace(/\/$/, '');
  const messages = buildMessages(guide, body);
  let upstream: Response;
  try {
    upstream = await fetch(ollama ? `${base}/api/chat` : `${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.HELP_LLM_API_KEY ? { authorization: `Bearer ${env.HELP_LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify(
        ollama
          ? {
              model: env.HELP_LLM_MODEL,
              messages,
              stream: true,
              options: { temperature: 0.2, num_predict: MAX_ANSWER_TOKENS, num_ctx: CONTEXT_TOKENS },
            }
          : { model: env.HELP_LLM_MODEL, messages, stream: true, temperature: 0.2, max_tokens: MAX_ANSWER_TOKENS }
      ),
    });
  } catch {
    return json(502, 'The assistant can’t be reached right now.');
  }
  if (upstream.status === 404) return json(502, 'The assistant’s model isn’t available yet (not found). If it’s still downloading, try again when it’s done.');
  if (!upstream.ok || !upstream.body) return json(502, `The assistant isn’t available right now (${upstream.status}).`);

  // Upstream SSE → plain text, so the browser just appends what arrives.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = ollama ? parseNdjsonChunk(buffer) : parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const t of parsed.texts) controller.enqueue(encoder.encode(t));
      if (parsed.done) {
        controller.close();
        await reader.cancel();
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
