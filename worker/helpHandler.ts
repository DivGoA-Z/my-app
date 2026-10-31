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
      let obj = JSON.parse(data);
      // Some proxies send each event as a JSON string holding the JSON.
      if (typeof obj === 'string') obj = JSON.parse(obj);
      const choice = obj?.choices?.[0];
      const text = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
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
  const callModel = (stream: boolean) =>
    fetch(ollama ? `${base}/api/chat` : `${base}/chat/completions`, {
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
              stream,
              options: { temperature: 0.2, num_predict: MAX_ANSWER_TOKENS, num_ctx: CONTEXT_TOKENS },
            }
          : { model: env.HELP_LLM_MODEL, messages, stream, temperature: 0.2, max_tokens: MAX_ANSWER_TOKENS }
      ),
    });
  let upstream: Response;
  try {
    upstream = await callModel(true);
  } catch {
    return json(502, 'The assistant can’t be reached right now.');
  }
  if (upstream.status === 404) return json(502, 'The assistant’s model isn’t available yet (not found). If it’s still downloading, try again when it’s done.');
  if (!upstream.ok || !upstream.body) return json(502, `The assistant isn’t available right now (${upstream.status}).`);

  // Upstream SSE → plain text, so the browser just appends what arrives.
  //
  // The first real RunPod test (24 Oct 2026) streamed back 200 with no text
  // at all, while the same code streamed fine from Ollama and from a fake
  // vLLM in workerd. So: keep the start of the raw reply, and if no text
  // came out of it, read it as one whole reply (a non-streamed answer, or an
  // error sent with a 200) — and failing that, say what arrived instead of
  // an empty answer.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const contentType = upstream.headers.get('content-type') ?? '';
  let buffer = '';
  let raw = '';
  let sentAny = false;
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, texts: string[]) => {
    for (const t of texts) controller.enqueue(encoder.encode(t));
    if (texts.length) sentAny = true;
  };
  const parse = (text: string) => (ollama ? parseNdjsonChunk(text) : parseSseChunk(text));
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    // A last line without a newline after it.
    if (buffer.trim()) emit(controller, parse(buffer + '\n').texts);
    buffer = '';
    // An EMPTY stream (RunPod, 24 Oct 2026: 200, text/event-stream, no
    // bytes): ask once more without streaming, which returns the whole
    // answer — or the real error, which the stream swallowed.
    if (!sentAny && !raw.trim()) {
      try {
        const again = await callModel(false);
        raw = (await again.text()).slice(0, RAW_KEEP);
        if (!again.ok) {
          console.error('Help: non-streamed retry failed', { status: again.status, start: raw.slice(0, 500) });
          emit(controller, [`The assistant’s model returned an error (${again.status}): ${raw.slice(0, 240) || 'empty'}`]);
        }
      } catch {
        // Fall through to the message below.
      }
    }
    if (!sentAny) {
      const whole = textFromWholeReply(raw);
      if (whole) emit(controller, [whole]);
      else {
        console.error('Help: no text in the model reply', { status: upstream.status, contentType, start: raw.slice(0, 500) });
        emit(controller, [`The assistant replied, but with no answer text. (${contentType || 'no content type'}: ${raw.slice(0, 160) || 'empty'})`]);
      }
    }
    controller.close();
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Read until there's something to send: a chunk can carry no text
      // (vLLM's first event is an empty "role" delta), and a pull that
      // enqueues nothing isn't always called again.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return finish(controller);
        const chunk = decoder.decode(value, { stream: true });
        if (raw.length < RAW_KEEP) raw += chunk.slice(0, RAW_KEEP - raw.length);
        buffer += chunk;
        const parsed = parse(buffer);
        buffer = parsed.rest;
        emit(controller, parsed.texts);
        if (parsed.done) {
          await reader.cancel();
          return finish(controller);
        }
        if (parsed.texts.length) return;
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

// How much of the raw reply to keep for the fallback below.
const RAW_KEEP = 4000;

// The answer in a reply that wasn't streamed as expected: one OpenAI-style
// JSON object (choices[0].message.content or .text), RunPod's own job
// wrapper ({output: ...}), or an error. '' if none of these.
export function textFromWholeReply(raw: string): string {
  const body = raw.trim();
  if (!body) return '';
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return '';
  }
  const pick = (o: unknown): string => {
    if (typeof o === 'string') return o;
    if (Array.isArray(o)) return o.map(pick).join('');
    if (!o || typeof o !== 'object') return '';
    const r = o as Record<string, unknown>;
    const choice = Array.isArray(r.choices) ? (r.choices[0] as Record<string, unknown> | undefined) : undefined;
    if (choice) {
      const msg = choice.message as { content?: unknown } | undefined;
      const delta = choice.delta as { content?: unknown } | undefined;
      const t = msg?.content ?? delta?.content ?? choice.text ?? choice.tokens;
      return pick(t);
    }
    if ('output' in r) return pick(r.output);
    if (r.error) return `The assistant’s model returned an error: ${typeof r.error === 'string' ? r.error : JSON.stringify(r.error).slice(0, 200)}`;
    return '';
  };
  return pick(obj);
}
