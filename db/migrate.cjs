/**
 * 生产迁移入口：容器内 `node db/migrate.cjs` 执行（ADR-0005）。
 * 依赖 DATABASE_URL；幂等，可重复执行。
 */
const path = require('node:path');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const { Pool } = require('pg');

async function lastMigration(client) {
  const exists = await client.query("select to_regclass('drizzle.__drizzle_migrations') as value");
  if (!exists.rows[0].value) return null;
  return (await client.query('select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1')).rows[0] ?? null;
}

/** One checked-out connection owns the session lock through migration and evidence.
 * Existing Drizzle timestamps are file metadata: never backfill them as execution times. */
async function migrateWithEvidence(pool, migrationsFolder = path.join(__dirname, 'migrations')) {
  const client = await pool.connect();
  let locked = false;
  let runId = null;
  let applied = false;
  try {
    await client.query("set lock_timeout = '5s'");
    await client.query("set statement_timeout = '60s'");
    locked = (await client.query("select pg_try_advisory_lock(hashtext('doupu:database.migrate')) as acquired")).rows[0].acquired;
    if (!locked) throw Object.assign(new Error('MIGRATION_BUSY'), { code: 'MIGRATION_BUSY' });
    const before = await lastMigration(client);
    const pending = readMigrationFiles({ migrationsFolder }).some((entry) => !before || entry.folderMillis > Number(before.created_at));
    // No-op invocations do not re-date an old migration or create success evidence.
    if (!pending) return { changed: false, migrationId: before?.id ?? null };
    const startedAt = new Date();
    const hasRuns = (await client.query("select to_regclass('public.maintenance_runs') as value")).rows[0].value;
    if (hasRuns) runId = (await client.query("insert into maintenance_runs(task,status,started_at) values ('database.migrate','running',$1) returning id", [startedAt])).rows[0].id;
    await migrate(drizzle(client), { migrationsFolder });
    applied = true;
    const completedAt = new Date();
    const after = await lastMigration(client);
    if (!after || after.id === before?.id) throw new Error('MIGRATION_EVIDENCE_FAILED');
    const summary = JSON.stringify({ journalTimestamp: String(after.created_at), hash: after.hash });
    if (runId) {
      await client.query("update maintenance_runs set status='succeeded', cursor=$2, summary=$3::jsonb, completed_at=$4 where id=$1", [runId, String(after.id), summary, completedAt]);
    } else {
      // Fresh databases / 0004 upgrades acquire this table during migration.
      await client.query("insert into maintenance_runs(task,status,cursor,summary,started_at,completed_at) values ('database.migrate','succeeded',$1,$2::jsonb,$3,$4)", [String(after.id), summary, startedAt, completedAt]);
    }
    return { changed: true, migrationId: after.id };
  } catch (error) {
    const code = applied ? 'MIGRATION_EVIDENCE_FAILED' : error.code === 'MIGRATION_BUSY' ? 'MIGRATION_BUSY' : 'MIGRATION_FAILED';
    if (runId) await client.query("update maintenance_runs set status='failed',error_code=$2,completed_at=now() where id=$1", [runId, code]).catch(() => undefined);
    // Never log the driver error: it may include SQL values or a connection URL.
    throw Object.assign(new Error(code), { code });
  } finally {
    if (locked) await client.query("select pg_advisory_unlock(hashtext('doupu:database.migrate'))").catch(() => undefined);
    // Dedicated migration connections are discarded: neither session settings
    // nor a lock whose unlock reply was lost can leak to another pool consumer.
    client.release(true);
  }
}

module.exports = { migrateWithEvidence };
if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required'); process.exitCode = 1; }
  else {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    migrateWithEvidence(pool).then((result) => console.log(result.changed ? 'migrations applied; execution recorded' : 'migrations already current; historical execution time unchanged'))
      .catch((error) => { console.error(['MIGRATION_BUSY', 'MIGRATION_EVIDENCE_FAILED'].includes(error.code) ? error.code : 'MIGRATION_FAILED'); process.exitCode = 1; })
      .finally(() => pool.end());
  }
}
