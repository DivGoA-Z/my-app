// worker/index.ts — the Cloudflare Worker in front of the app (§129).
//
// Only /api/* reaches this code (wrangler.jsonc run_worker_first); every
// other request is the static app, served by the assets layer exactly as
// before this file existed.
//
// Secrets and settings, set in the Cloudflare dashboard (Worker →
// Settings → Variables and secrets), never in the code:
//   HELP_LLM_BASE_URL   e.g. https://api.runpod.ai/v2/<endpoint-id>/openai/v1
//   HELP_LLM_MODEL      the model name RunPod serves (the Hugging Face repo)
//   HELP_LLM_API_KEY    the RunPod API key (a Secret)
//   SUPABASE_URL, SUPABASE_ANON_KEY   the same public values the app uses

import guide from '../docs/chatbot/APP_GUIDE_FOR_ASSISTANT.md';
import { handleHelp, type HelpEnv } from './helpHandler';

interface Env extends HelpEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/help') return handleHelp(request, env, guide);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
