/**
 * drizzle-kit 配置（供 T21 接入 npm scripts：db:generate / db:migrate）。
 * 刻意不 import 'drizzle-kit'（依赖未安装期间保持可 typecheck），导出形状与其 Config 兼容。
 */
import { fileURLToPath } from 'node:url';

export default {
  dialect: 'postgresql' as const,
  // drizzle-kit 需要相对配置文件的路径（不支持绝对文件路径）
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://doupu:doupu@localhost:5432/doupu',
  },
  strict: true,
  verbose: true,
};
