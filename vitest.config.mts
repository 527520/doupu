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
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
});
