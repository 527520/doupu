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

let prodDb: ProdDatabase | null = null;
let testDb: PgliteDatabase<typeof schema> | null = null;
let fallbackDb: PgliteDatabase<typeof schema> | null = null;

/** 是否走进程内 PGlite（开发/E2E）。 */
export function usesPgliteFallback(): boolean {
  const url = process.env.DATABASE_URL;
  return !url || url.startsWith('pglite:');
}

async function initFallbackDb(): Promise<PgliteDatabase<typeof schema>> {
  const [{ PGlite }, { drizzle }, { migrate }, schemaModule] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
    import('@/../db/schema'),
  ]);
  const client = new PGlite();
  const db = drizzle(client, { schema: schemaModule });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'db/migrations') });
  return db;
}

/** 服务启动钩子（instrumentation.ts）调用：初始化进程内 PGlite 回退库。 */
export async function ensureFallbackDb(): Promise<void> {
  if (usesPgliteFallback() && !fallbackDb) {
    fallbackDb = await initFallbackDb();
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
  if (!fallbackDb) throw new Error('database is not ready (PGlite initializing)');
  return fallbackDb;
}

/** 测试注入（仅测试调用）。 */
export function setTestDb(db: PgliteDatabase<typeof schema>): void {
  testDb = db;
}
