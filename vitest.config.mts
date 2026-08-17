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
    // worker threads avoid child-process spawning (sandbox/CI friendly)
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          exclude: [
            'src/**/*.performance.test.{ts,tsx}',
            'src/app/api/**/*.test.{ts,tsx}',
            'src/lib/auth/password.test.ts',
            'src/components/palettes/PaletteEditor.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'serial',
          include: [
            'src/lib/auth/password.test.ts',
            'src/components/palettes/PaletteEditor.test.tsx',
          ],
          // Argon2 原生模块与 500 行大 DOM 场景隔离到单一子进程，避免线程并发崩溃/超时。
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/app/api/**/*.test.{ts,tsx}', 'db/**/*.test.ts'],
          // API/PGlite/Argon2 共享进程级测试 seam；按文件串行，避免全局 DB/env/native addon 串扰。
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'performance',
          include: ['src/**/*.performance.test.ts'],
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/*.performance.test.ts',
        'src/lib/palettes/data/**',
        // These modules own database, cookie and route transaction boundaries.
        // They are exercised in the isolated integration project instead of
        // under V8 instrumentation, which previously destabilized native
        // Argon2/PGlite. The integration job remains a required CI dependency.
        'src/lib/auth/cookies.ts',
        'src/lib/auth/db.ts',
        'src/lib/auth/guard.ts',
        'src/lib/auth/rateLimit.ts',
        'src/lib/auth/session.ts',
        'src/lib/auth/transitions.ts',
      ],
      // Pure-library coverage guard: lines/statements/functions ≥90%, branches ≥75%.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 75,
      },
    },
  },
});
