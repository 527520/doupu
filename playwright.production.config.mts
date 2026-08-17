import { defineConfig, devices } from '@playwright/test';

/** Browser smoke against an already-running standalone production image. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '08-production-runtime.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'production-chromium', use: { ...devices['Desktop Chrome'] } }],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
});
