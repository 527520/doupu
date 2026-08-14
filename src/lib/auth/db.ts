/**
 * 数据库访问器（认证模块专用）：
 * - 生产：按 DATABASE_URL 惰性创建 node-postgres 客户端（进程级单例）；
 * - 测试：__setDbForTests 注入 PGlite 测试库。
 */
import { createProdClient, type Database } from '@/../db/client';

let prodDb: Database | null = null;
let testDb: Database | null = null;

export function getDb(): Database {
  if (testDb) return testDb;
  if (!prodDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    prodDb = createProdClient(url);
  }
  return prodDb;
}

/** 测试注入（仅测试调用）。 */
export function setTestDb(db: Database): void {
  testDb = db;
}
