/**
 * 测试数据库客户端：PGlite（进程内 Postgres，免 Docker）。
 * 仅测试文件导入本模块——应用代码不得引用，避免 PGlite 进入打包链。
 */
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export type TestDatabase = PgliteDatabase<typeof schema>;

/** 测试客户端：内存 PGlite + 执行全部迁移（从零可重放、幂等）。 */
export async function createTestClient(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  const migrationsFolder = resolve(process.cwd(), 'db/migrations');
  await migratePglite(db, { migrationsFolder });
  return db;
}
