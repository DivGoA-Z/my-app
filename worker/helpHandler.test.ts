// The help assistant's relay (§129).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMessages, handleHelp, MAX_CHARS_PER_TURN, MAX_TURNS, parseNdjsonChunk, parseSseChunk, validateBody } from './helpHandler';

const env = {
  HELP_LLM_BASE_URL: 'https://llm.example/v1',
  HELP_LLM_MODEL: 'qwen',
  HELP_LLM_API_KEY: 'secret-key',
  SUPABASE_URL: 'https://sb.example',
  SUPABASE_ANON_KEY: 'anon',
};
const ask = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer user-token' }) =>
  new Request('https://app/api/help', { method: 'POST', headers, body: JSON.stringify(body) });
const sse = (...parts: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    })
  );

afterEach(() => vi.restoreAllMocks());

describe('building the model request', () => {
  it('puts the guide first, with where the person is, then the recent turns', () => {
    const msgs = buildMessages('GUIDE', {
      screen: 'Design editor · Plan tab',
      messages: [{ role: 'user', content: 'where is cutting list' }],
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/^GUIDE\n\n## Where the person is right now\n\nDesign editor · Plan tab$/);
    expect(msgs[1]).toEqual({ role: 'user', content: 'where is cutting list' });
  });

  it('keeps only the last few turns, each clipped', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: 'x'.repeat(5000) }));
    const msgs = buildMessages('G', { messages: many });
    expect(msgs).toHaveLength(MAX_TURNS + 1);
    expect(msgs[1].content).toHaveLength(MAX_CHARS_PER_TURN);
  });

  it('accepts only a conversation ending with a question', () => {
    expect(validateBody({ messages: [{ role: 'user', content: 'hi' }] })).toBe(true);
    expect(validateBody({ messages: [] })).toBe(false);
    expect(validateBody({ messages: [{ role: 'assistant', content: 'hi' }] })).toBe(false);
    expect(validateBody({ messages: [{ role: 'user', content: '  ' }] })).toBe(false);
  });
});

describe('reading the streamed answer', () => {
  it('takes the text out of OpenAI-style events, keeping a split line for later', () => {
    const r = parseSseChunk('data: {"choices":[{"delta":{"content":"Open "}}]}\ndata: {"choices":[{"delta":{"content":"**Cutting')
    expect(r.texts).toEqual(['Open ']);
    expect(r.rest).toMatch(/^data: /);
    const r2 = parseSseChunk(r.rest + ' list**"}}]}\ndata: [DONE]\n');
    expect(r2.texts).toEqual(['**Cutting list**']);
    expect(r2.done).toBe(true);
  });
});

describe('the relay', () => {
  it('refuses a caller who isn’t signed in, without calling the model', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }), env, 'G');
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1); // the sign-in check only
    expect(String(f.mock.calls[0][0])).toBe('https://sb.example/auth/v1/user');
    const noToken = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }, {}), env, 'G');
    expect(noToken.status).toBe(401);
  });

  it('says it isn’t set up when no model is configured', async () => {
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }), {}, 'G', { skipAuth: true });
    expect(res.status).toBe(503);
  });

  it('calls the model with the key and the guide, and streams plain text back', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/auth/v1/user')
        ? new Response('{}', { status: 200 })
        : sse('data: {"choices":[{"delta":{"content":"Press "}}]}\n', 'data: {"choices":[{"delta":{"content":"**Cutting list**."}}]}\ndata: [DONE]\n')
    );
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'cutting list?' }], screen: 'Design editor' }), env, 'GUIDE');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Press **Cutting list**.');
    const [url, init] = f.mock.calls[1];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject({ model: 'qwen', stream: true });
    expect(sent.messages[0].content).toMatch(/^GUIDE/);
  });

  it('reports the model being down as a plain message, never the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }), env, 'G', { skipAuth: true });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/secret-key/);
  });
});

describe('a local Ollama (its own API)', () => {
  it('asks for a context long enough for the guide, and reads its line-by-line answer', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse('{"message":{"content":"Press "},"done":false}\n{"message":{"content":"**Cutting list**."},"done":false}\n{"done":true}\n')
    );
    const res = await handleHelp(
      ask({ messages: [{ role: 'user', content: 'cutting list?' }] }),
      { HELP_LLM_BASE_URL: 'http://localhost:11434', HELP_LLM_MODEL: 'qwen', HELP_LLM_PROVIDER: 'ollama' },
      'G',
      { skipAuth: true }
    );
    expect(await res.text()).toBe('Press **Cutting list**.');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init!.body as string).options.num_ctx).toBeGreaterThanOrEqual(12288);
  });

  it('splits lines across chunks correctly', () => {
    const r = parseNdjsonChunk('{"message":{"content":"a"}}\n{"message":{"con');
    expect(r.texts).toEqual(['a']);
    expect(r.rest).toBe('{"message":{"con');
  });

  it('says plainly when the model isn\u2019t downloaded yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('model not found', { status: 404 }));
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }), env, 'G', { skipAuth: true });
    expect((await res.json()).error).toMatch(/isn’t available yet \(not found\)/);
  });
});

describe('replies that don’t stream as expected (first RunPod test, §131)', () => {
  const run = async (upstream: Response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const res = await handleHelp(ask({ messages: [{ role: 'user', content: 'hi' }] }), env, 'G', { skipAuth: true });
    return res.text();
  };

  it('skips vLLM’s empty first event and keeps reading', async () => {
    expect(
      await run(sse('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', 'data: {"choices":[{"delta":{"content":"Open **Quote**."}}]}\n\ndata: [DONE]\n\n'))
    ).toBe('Open **Quote**.');
  });

  it('reads a last line with no newline after it', async () => {
    expect(await run(sse('data: {"choices":[{"delta":{"content":"Yes."}}]}'))).toBe('Yes.');
  });

  it('reads an answer that came back whole, not streamed', async () => {
    expect(await run(sse('{"choices":[{"message":{"role":"assistant","content":"Press **Undo**."}}]}'))).toBe('Press **Undo**.');
    expect(await run(sse('{"id":"j1","status":"COMPLETED","output":[{"choices":[{"tokens":["Press ","**Undo**."]}]}]}'))).toBe('Press **Undo**.');
  });

  it('reads events sent as JSON strings', async () => {
    expect(await run(sse(`data: ${JSON.stringify(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }))}\n\n`))).toBe('Hi');
  });

  it('says what arrived instead of answering with nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = await run(new Response('{"status":"IN_QUEUE"}', { headers: { 'content-type': 'application/json' } }));
    expect(text).toMatch(/no answer text.*IN_QUEUE/);
    expect(await run(sse('{"error":"model overloaded"}'))).toMatch(/returned an error: model overloaded/);
  });
});
