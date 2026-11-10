import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: process.env.PW_OUT || 'test-results/out',
  use: { baseURL: 'http://127.0.0.1:8788', channel: process.env.PW_CHANNEL || 'msedge', locale: 'de-DE', timezoneId: 'Europe/Berlin', trace: 'off' },
  webServer: {
    command: 'node scripts/e2e-setup.mjs && pnpm exec wrangler dev --local --persist-to .e2e-state --port 8788',
    // 401 means the worker is up and refusing anonymous callers.
    url: 'http://127.0.0.1:8788/api/me', reuseExistingServer: false, timeout: 180_000,
  },
});
