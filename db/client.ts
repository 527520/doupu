/**
 * 生产数据库客户端（ADR-0003）：node-postgres 连接池。
 * 注意：PGlite 测试客户端在 db/testClient.ts（仅测试导入，避免进入应用打包链）。
 */
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql, lt } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { poolOptions } from '@/lib/config';
import * as schema from './schema';
import { designs, palettes, rateLimits } from './schema';

export type ProdDatabase = NodePgDatabase<typeof schema>;
/** 生产/测试两种客户端共用的联合类型（PGlite 仅为 type-only 导入，不进打包链）。 */
export type AnyDatabase = ProdDatabase | PgliteDatabase<typeof schema>;

/** 生产客户端：连接池（超时与容量见 config.database，A-11）。 */
export function createProdClient(databaseUrl: string): ProdDatabase {
  const pool = new Pool({ connectionString: databaseUrl, ...poolOptions() });
  return drizzlePg(pool, { schema });
}

/**
 * 限流计数原子递增（spec §4.2 429 语义）：
 * 同 key + 同窗口内 UPSERT 累加；新窗口重置为 1。返回递增后的 count。
 */
export async function incrementRateLimit(
  db: AnyDatabase,
  key: string,
  windowStart: Date,
): Promise<number> {
  const result = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart })
    .onConflictDoUpdate({
      target: rateLimits.key,
      // One UPSERT owns both same-window increments and rollover. The previous
      // two-statement fallback let concurrent first requests in a new window
      // repeatedly reset each other back to one. A delayed request from an
      // older bucket is deliberately ignored instead of rolling state back.
      set: {
        count: sql`case
          when ${rateLimits.windowStart} > ${windowStart.toISOString()} then ${rateLimits.count}
          when ${rateLimits.windowStart} = ${windowStart.toISOString()} then ${rateLimits.count} + 1
          else 1
        end`,
        windowStart: sql`case
          when ${rateLimits.windowStart} > ${windowStart.toISOString()} then ${rateLimits.windowStart}
          else ${windowStart.toISOString()}
        end`,
      },
    })
    .returning();
  return result[0].count;
}

/**
 * 清理过期限流窗口（优化票 03）：删除 windowStart 早于 olderThan 的行。
 * 窗口为小时对齐，过期窗口不会再被命中；由 instrumentation 在生产环境每日调用。
 * 返回删除行数。
 */
export async function cleanupRateLimits(db: AnyDatabase, olderThan: Date): Promise<number> {
  const result = await db.delete(rateLimits).where(lt(rateLimits.windowStart, olderThan)).returning();
  return result.length;
}

/** Daily hard-delete for compact sync tombstones after the 90-day propagation window. */
export async function cleanupSyncTombstones(
  db: AnyDatabase,
  now: Date,
): Promise<{ designs: number; palettes: number }> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [removedDesigns, removedPalettes] = await Promise.all([
    db.delete(designs).where(lt(designs.deletedAt, cutoff)).returning(),
    db.delete(palettes).where(lt(palettes.deletedAt, cutoff)).returning(),
  ]);
  return { designs: removedDesigns.length, palettes: removedPalettes.length };
}
