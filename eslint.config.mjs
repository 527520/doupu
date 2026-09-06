import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // 浏览器代码禁止直接调用 crypto.randomUUID：局域网 HTTP 等非安全上下文没有它。
  // 统一走 src/lib/ids.ts 的 randomId()，服务端 Route Handler / lib 不受限制。
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/lib/analytics/client.ts', 'src/lib/storage/**/*.ts', 'src/lib/sync/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'crypto',
        property: 'randomUUID',
        message: '非安全上下文（局域网 HTTP）没有 crypto.randomUUID，请使用 @/lib/ids 的 randomId()。',
      }],
    },
  },
  // .scratch 是调研草稿区；test-results / playwright-report 是浏览器生成物，
  // 包括第三方运行时 trace，不属于本仓库源码，不参与 lint。
  globalIgnores(['.next/**', '.next-e2e/**', '.artifacts/**', 'out/**', 'build/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', '.scratch/**']),
]);

export default eslintConfig;
