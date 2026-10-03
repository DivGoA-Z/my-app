/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})