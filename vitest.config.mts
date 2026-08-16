import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true, // 注册 testing-library 自动 cleanup 等全局钩子
    setupFiles: ['tests/setup.ts'], // jsdom canvas stub
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}', 'db/**/*.test.ts'],
    // worker threads avoid child-process spawning (sandbox/CI friendly)
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/palettes/data/**'],
      // 覆盖率护栏（优化票 12 / spec §8）：src/lib 行/语句/函数 ≥90%，分支 ≥75%。
      // 实测基线（含本票新增测试）：行 92.93 / 语句 91.78 / 函数 94.15 / 分支 81.08。
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 75,
      },
    },
  },
});
