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
  // .scratch 是调研草稿区；test-results / playwright-report 是浏览器生成物，
  // 包括第三方运行时 trace，不属于本仓库源码，不参与 lint。
  globalIgnores(['.next/**', '.next-e2e/**', '.artifacts/**', 'out/**', 'build/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', '.scratch/**']),
]);

export default eslintConfig;
