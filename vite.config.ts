/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleHelp } from './worker/helpHandler.ts'
import { handleRender } from './worker/renderHandler.ts'
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
      // "Make image" (§132), against the real Gemini and the real Supabase
      // limits. The key comes from the shell (GEMINI_API_KEY=… npm run dev)
      // or, since §143, from .env: a GEMINI_ name has no VITE_ prefix, so
      // Vite never puts it in the browser bundle, and .env is gitignored.
      // Unlike Help it keeps the sign-in and the limits, since every image
      // costs money.
      server.middlewares.use('/api/render', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const fileEnv = loadEnv('development', import.meta.dirname, '')
        const geminiKey = process.env.GEMINI_API_KEY || fileEnv.GEMINI_API_KEY
        if (!geminiKey) {
          // The Worker's own "isn't set up yet" says nothing about where
          // the key goes on this machine.
          res.statusCode = 503
          res.setHeader('content-type', 'application/json')
          return res.end(JSON.stringify({ error: 'Image making isn’t set up on this computer: add GEMINI_API_KEY=<your key> to the .env file, then restart npm run dev.' }))
        }
        const request = new Request('http://localhost/api/render', {
          method: req.method,
          headers: { 'content-type': 'application/json', authorization: String(req.headers.authorization ?? '') },
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        })
        const response = await handleRender(request, {
          GEMINI_API_KEY: geminiKey,
          GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL || fileEnv.GEMINI_IMAGE_MODEL,
          SUPABASE_URL: fileEnv.VITE_SUPABASE_URL,
          SUPABASE_ANON_KEY: fileEnv.VITE_SUPABASE_ANON_KEY,
        })
        res.statusCode = response.status
        response.headers.forEach((v: string, k: string) => res.setHeader(k, v))
        res.end(Buffer.from(await response.arrayBuffer()))
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