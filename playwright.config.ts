// playwright.config.ts
//
// Browser runs of the real app (§74): screenshots of every main screen at
// laptop, tablet and phone size, so a screen is looked at before you are
// shown it, and the base for browser tests later.
//
// Sign-in uses a SEPARATE test login, never your own: E2E_EMAIL and
// E2E_PASSWORD in `.env.e2e.local` (git-ignored by the *.local rule).
// Without them, only the sign-in screen is captured.

import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env.e2e.local')) process.loadEnvFile('.env.e2e.local');

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'off',
  },
  // A dev server on its own port, so it never collides with yours.
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'laptop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
