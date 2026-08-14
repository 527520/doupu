import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 串行执行：dev 服务器首编译较慢，且各用例共享服务器日志（邮件钩子），并行会互相干扰
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // 由 globalSetup 启动 dev 服务器（webpack，非 turbopack——确保 instrumentation 可用），
  // stdout 捕获到日志文件供邮件链接钩子读取；globalTeardown 负责清理。
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  workers: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
