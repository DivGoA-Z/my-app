/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { handleHelp } from './worker/helpHandler.ts'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The help assistant's relay on this machine (§129): the same code as the
// deployed Worker, pointed at a local Ollama unless HELP_LLM_* says
// otherwise. Uses Ollama's own API so the context is long enough for the
// guide (see HELP_LLM_PROVIDER in worker/helpHandler.ts).
function helpDevRelay(): Plugin {
  return {
    name: 'help-dev-relay',
    configureServer(server) {
      server.middlewares.use('/api/help', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const request = new Request('http://localhost/api/help', {
          method: req.method,
          headers: { 'content-type': 'application/json' },
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        })
        const guide = fs.readFileSync(path.resolve(import.meta.dirname, 'docs/chatbot/APP_GUIDE_FOR_ASSISTANT.md'), 'utf8')
        const response = await handleHelp(
          request,
          {
            HELP_LLM_BASE_URL: process.env.HELP_LLM_BASE_URL ?? 'http://localhost:11434',
            HELP_LLM_PROVIDER: process.env.HELP_LLM_BASE_URL ? 'openai' : 'ollama',
            HELP_LLM_MODEL: process.env.HELP_LLM_MODEL ?? 'qwen3:4b-instruct-2507-q4_K_M',
            HELP_LLM_API_KEY: process.env.HELP_LLM_API_KEY,
          },
          guide,
          { skipAuth: true }
        )
        res.statusCode = response.status
        response.headers.forEach((v: string, k: string) => res.setHeader(k, v))
        if (!response.body) return res.end()
        const reader = response.body.getReader()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          res.write(value)
        }
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), helpDevRelay()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Screen tests (§66) run in jsdom, chosen per file with a
  // `// @vitest-environment jsdom` line, so the maths tests stay in fast
  // plain Node. The Supabase values are dummies: the client refuses to
  // load without them, and the tests replace every store action that
  // would reach the network, so nothing is ever sent.
  test: {
    setupFiles: ['./src/test/setupDom.ts'],
    // Browser runs (Playwright) live in e2e/ and have their own runner.
    exclude: ['e2e/**', 'node_modules/**'],
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})