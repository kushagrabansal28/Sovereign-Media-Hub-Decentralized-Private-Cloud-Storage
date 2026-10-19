import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the production build in the installed Chrome (no
 * browser download), against a real storage server and a development relay
 * that each spec starts for itself.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  globalTimeout: 900_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    launchOptions: { args: ['--disable-gpu', '--disable-dev-shm-usage'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    timezoneId: 'UTC',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
