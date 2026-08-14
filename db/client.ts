/**
 * 数据库客户端工厂（ADR-0003）。
 * - 生产：node-postgres 连接池（DATABASE_URL）。
 * - 测试：PGlite（进程内 Postgres，免 Docker；@electric-sql/pglite + drizzle-orm/pglite）。
 * 说明：drizzle-orm / @electric-sql/pglite / pg 依赖由父代理安装（T13 交付时缺失），
 * 安装后执行 typecheck 与 db/models.test.ts。
 */
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { rateLimits } from './schema';

export type Database = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/** 生产客户端：连接池（max 10，单实例规模）。 */
export function createProdClient(databaseUrl: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return drizzlePg(pool, { schema });
}

/** 测试客户端：内存 PGlite + 执行全部迁移（从零可重放、幂等）。 */
export async function createTestClient(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
  await migratePglite(db, { migrationsFolder });
  return db;
}

/**
 * 限流计数原子递增（spec §4.2 429 语义）：
 * 同 key + 同窗口内 UPSERT 累加；新窗口重置为 1。返回递增后的 count。
 */
export async function incrementRateLimit(
  db: Database,
  key: string,
  windowStart: Date,
): Promise<number> {
  const result = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1` },
      // 窗口过期则重置计数（由调用方保证 windowStart 语义一致）
      where: sql`${rateLimits.windowStart} = ${windowStart.toISOString()}`,
    })
    .returning();
  if (result.length > 0) return result[0].count;
  // 窗口过期分支：更新为新窗口、计数 1
  const reset = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: 1, windowStart },
    })
    .returning();
  return reset[0].count;
}
