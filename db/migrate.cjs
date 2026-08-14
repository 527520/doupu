/**
 * 生产迁移入口：容器内 `node db/migrate.cjs` 执行（ADR-0005）。
 * 依赖 DATABASE_URL；幂等，可重复执行。
 */
const path = require('node:path');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  await pool.end();
  console.log('migrations applied');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
