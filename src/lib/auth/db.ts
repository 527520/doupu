/**
 * 数据库访问器（认证/设计/色板模块共用）：
 * - 生产：按 DATABASE_URL 惰性创建 node-postgres 客户端（进程级单例）；
 * - 测试：setTestDb 注入 PGlite 测试库；
 * - 开发/E2E 回退：DATABASE_URL 缺失或以 pglite: 开头时，使用进程内 PGlite，
 *   由 src/instrumentation.ts 在服务启动时调用 ensureFallbackDb() 完成初始化
 *   （动态导入，不进主打包链）。
 */
import { resolve } from 'node:path';
import { createProdClient, type ProdDatabase } from '@/../db/client';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from '@/../db/schema';

export type Database = ProdDatabase | PgliteDatabase<typeof schema>;

/**
 * 回退库挂到 globalThis：webpack 会把 instrumentation 与各路由打包成
 * 互相独立的模块副本，模块级变量不共享；globalThis 是唯一可靠的跨副本通道。
 */
const globalFallbackKey = '__doupu_fallback_db__';

let prodDb: ProdDatabase | null = null;
let testDb: PgliteDatabase<typeof schema> | null = null;

function readGlobalFallback(): PgliteDatabase<typeof schema> | null {
  return (globalThis as Record<string, unknown>)[globalFallbackKey] as PgliteDatabase<typeof schema> | undefined ?? null;
}

function writeGlobalFallback(db: PgliteDatabase<typeof schema>): void {
  (globalThis as Record<string, unknown>)[globalFallbackKey] = db;
}

/** 是否走进程内 PGlite（仅开发/E2E）。 */
export function usesPgliteFallback(): boolean {
  // 生产环境绝不允许静默回退内存库（重启即丢数据，安全审查 P0）：
  // 缺 DATABASE_URL 时 fail-fast，由部署侧显式配置。
  if (process.env.NODE_ENV === 'production') return false;
  const url = process.env.DATABASE_URL;
  return !url || url.startsWith('pglite:');
}

async function initFallbackDb(): Promise<PgliteDatabase<typeof schema>> {
  const [{ PGlite }, { drizzle }, schemaModule, { readdirSync, readFileSync }, { join }] =
    await Promise.all([
      import('@electric-sql/pglite'),
      import('drizzle-orm/pglite'),
      import('@/../db/schema'),
      import('node:fs'),
      import('node:path'),
    ]);
  const client = new PGlite();
  const db = drizzle(client, { schema: schemaModule });
  // 直接按文件名顺序执行迁移 SQL（drizzle migrator 在 webpack 打包环境存在
  // URL 类型问题；测试环境的 db/testClient 仍走 migrator 并已由测试覆盖）。
  // 注意：drizzle 生成的迁移文件含 `--> statement-breakpoint` 注释行，非合法 SQL，需剔除。
  const dir = resolve(process.cwd(), 'db/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(dir, file), 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('-->'))
      .join('\n');
    await client.exec(sqlText);
  }
  return db;
}

/** 服务启动钩子（instrumentation.ts）调用：初始化进程内 PGlite 回退库。 */
export async function ensureFallbackDb(): Promise<void> {
  if (usesPgliteFallback() && !readGlobalFallback()) {
    writeGlobalFallback(await initFallbackDb());
  }
}

export function getDb(): Database {
  if (testDb) return testDb;
  if (prodDb) return prodDb;
  const url = process.env.DATABASE_URL;
  if (url && !url.startsWith('pglite:')) {
    prodDb = createProdClient(url);
    return prodDb;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is not configured (production requires PostgreSQL)');
  }
  const fallbackDb = readGlobalFallback();
  if (!fallbackDb) throw new Error('database is not ready (PGlite initializing)');
  return fallbackDb;
}

/** 测试注入（仅测试调用）。 */
export function setTestDb(db: PgliteDatabase<typeof schema>): void {
  testDb = db;
}
