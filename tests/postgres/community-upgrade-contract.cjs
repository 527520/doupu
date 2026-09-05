/** PostgreSQL 16 upgrade rehearsal from the deployed 0004 schema to current. */
const assert = require('node:assert/strict');
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { migrateWithEvidence } = require('../../db/migrate.cjs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const root = path.resolve(__dirname, '../..');
const migrations = path.join(root, 'db/migrations');
const partial = mkdtempSync(path.join(tmpdir(), 'doupu-0004-upgrade-'));
const pool = new Pool({ connectionString, max: 2 });
const ids = {
  user: '00000000-0000-4000-8000-000000000401',
  design: '00000000-0000-4000-8000-000000000402',
  share: '00000000-0000-4000-8000-000000000403',
};

function prepare0004Migrations() {
  mkdirSync(path.join(partial, 'meta'));
  const journal = JSON.parse(readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 5);
  writeFileSync(path.join(partial, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  for (const entry of journal.entries) {
    cpSync(path.join(migrations, `${entry.tag}.sql`), path.join(partial, `${entry.tag}.sql`));
  }
}

async function main() {
  const db = drizzle(pool);
  const existing = await pool.query("select to_regclass('public.users')::text as users");
  assert.equal(existing.rows[0].users, null, 'upgrade contract database must start empty');
  prepare0004Migrations();
  await migrate(db, { migrationsFolder: partial });

  const project = { format: 'doupu-project', version: 3, name: '升级前设计', cells: ['R1'] };
  const sharedSnapshot = { format: 'doupu-share', version: 3, project };
  await pool.query('begin');
  try {
    await pool.query(
      'insert into users(id,email,password_hash,username,email_verified_at) values ($1,$2,$3,$4,now())',
      [ids.user, 'upgrade-existing@example.test', 'existing-password-hash', '旧用户'],
    );
    await pool.query(
      'insert into designs(id,user_id,name,project,revision,payload_bytes) values ($1,$2,$3,$4::jsonb,7,$5)',
      [ids.design, ids.user, '升级前设计', JSON.stringify(project), Buffer.byteLength(JSON.stringify(project))],
    );
    await pool.query(
      'insert into design_shares(id,design_id,user_id,token_hash,snapshot,name,view_count) values ($1,$2,$3,$4,$5::jsonb,$6,9)',
      [ids.share, ids.design, ids.user, 'upgrade-share-token-hash', JSON.stringify(sharedSnapshot), '升级前分享'],
    );
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback');
    throw error;
  }

  const before = await pool.query(
    `select
       (select to_jsonb(u) from users u where id=$1) as user_row,
       (select to_jsonb(d) from designs d where id=$2) as design_row,
       (select to_jsonb(s) from design_shares s where id=$3) as share_row`,
    [ids.user, ids.design, ids.share],
  );
  const executionStart = new Date();
  const upgrade = await migrateWithEvidence(pool);
  assert.equal(upgrade.changed, true);
  const evidence = await pool.query("select * from maintenance_runs where task='database.migrate' and status='succeeded'");
  assert.equal(evidence.rows.length, 1);
  assert.equal(evidence.rows[0].cursor, String(upgrade.migrationId));
  assert.ok(evidence.rows[0].started_at >= executionStart);
  assert.ok(evidence.rows[0].completed_at >= evidence.rows[0].started_at);
  assert.ok(evidence.rows[0].completed_at <= new Date());

  const after = await pool.query(
    `select
       (select to_jsonb(u) from users u where id=$1) as user_row,
       (select to_jsonb(d) from designs d where id=$2) as design_row,
       (select to_jsonb(s) from design_shares s where id=$3) as share_row,
       to_regclass('public.analytics_events')::text as analytics_events,
       to_regclass('public.community_works')::text as community_works,
       to_regclass('public.community_comments')::text as community_comments,
       to_regclass('public.official_batches')::text as official_batches`,
    [ids.user, ids.design, ids.share],
  );
  const old = before.rows[0];
  const current = after.rows[0];
  assert.equal(current.user_row.email, old.user_row.email);
  assert.equal(current.user_row.password_hash, old.user_row.password_hash);
  assert.equal(current.user_row.username, old.user_row.username);
  assert.equal(current.user_row.role, 'user');
  assert.equal(current.user_row.account_status, 'active');
  assert.equal(current.user_row.public_author_id, null);
  assert.deepEqual(current.design_row.project, old.design_row.project);
  assert.equal(current.design_row.revision, 7);
  assert.equal(current.design_row.community_source_work_id, null);
  assert.deepEqual(current.share_row.snapshot, old.share_row.snapshot);
  assert.equal(current.share_row.view_count, 9);
  assert.deepEqual(
    [current.analytics_events, current.community_works, current.community_comments, current.official_batches],
    ['analytics_events', 'community_works', 'community_comments', 'official_batches'],
  );

  assert.equal((await migrateWithEvidence(pool)).changed, false);
  const afterNoop = await pool.query("select * from maintenance_runs where task='database.migrate'");
  assert.deepEqual(afterNoop.rows, evidence.rows, 'no-op invocation must not fabricate a newer migration execution');
  let journal = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
  assert.equal(journal.rows[0].count, 13, 'idempotent replay changed migration journal');
  const initialRules = await pool.query(
    `select version, jsonb_array_length(rules)::int as rule_count, active
     from moderation_rule_set_versions where id='f0c81a4d-a5d8-4d6a-97e4-e42dc8ca9cc8'`,
  );
  assert.deepEqual(initialRules.rows, [{ version: 1, rule_count: 8, active: true }]);

  // The paired down SQL is intentionally legal only before new feature data
  // exists. This fixture contains exclusively pre-0005 rows, so rehearse the
  // complete reverse path and prove the Drizzle journal permits re-upgrade.
  for (const tag of [
    '0012_comment_publication_time',
    '0011_initial_moderation_rules',
    '0010_analytics_time_index',
    '0009_official_batch_links',
    '0008_community_governance',
    '0007_community_core',
    '0006_consent_analytics',
    '0005_identity_governance',
  ]) {
    await pool.query(readFileSync(path.join(migrations, 'down', `${tag}.down.sql`), 'utf8'));
  }
  const rolledBack = await pool.query(
    `select
       (select to_jsonb(u) from users u where id=$1) as user_row,
       (select to_jsonb(d) from designs d where id=$2) as design_row,
       (select to_jsonb(s) from design_shares s where id=$3) as share_row,
       to_regclass('public.analytics_events')::text as analytics_events,
       to_regclass('public.community_works')::text as community_works`,
    [ids.user, ids.design, ids.share],
  );
  assert.deepEqual(rolledBack.rows[0].user_row, old.user_row);
  assert.deepEqual(rolledBack.rows[0].design_row, old.design_row);
  assert.deepEqual(rolledBack.rows[0].share_row, old.share_row);
  assert.equal(rolledBack.rows[0].analytics_events, null);
  assert.equal(rolledBack.rows[0].community_works, null);
  journal = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
  assert.equal(journal.rows[0].count, 5, 'down SQL did not restore the 0004 migration journal');

  await migrateWithEvidence(pool);
  journal = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
  assert.equal(journal.rows[0].count, 13, 're-upgrade after down SQL did not restore all migrations');
  const reupgraded = await pool.query(
    `select
       (select project from designs where id=$1) as project,
       to_regclass('public.analytics_events')::text as analytics_events,
       to_regclass('public.community_works')::text as community_works`,
    [ids.design],
  );
  assert.deepEqual(reupgraded.rows[0].project, old.design_row.project);
  assert.equal(reupgraded.rows[0].analytics_events, 'analytics_events');
  assert.equal(reupgraded.rows[0].community_works, 'community_works');

  const locker = await pool.connect();
  try {
    await locker.query("select pg_advisory_lock(hashtext('doupu:database.migrate'))");
    await assert.rejects(migrateWithEvidence(pool), { code: 'MIGRATION_BUSY' });
  } finally { await locker.query("select pg_advisory_unlock(hashtext('doupu:database.migrate'))"); locker.release(); }

  const failedFolder = path.join(partial, 'failure');
  cpSync(migrations, failedFolder, { recursive: true });
  const failedJournal = JSON.parse(readFileSync(path.join(failedFolder, 'meta/_journal.json'), 'utf8'));
  failedJournal.entries.push({ idx: 13, version: '7', when: failedJournal.entries.at(-1).when + 1000, tag: '0013_execution_failure_probe', breakpoints: true });
  writeFileSync(path.join(failedFolder, 'meta/_journal.json'), JSON.stringify(failedJournal));
  writeFileSync(path.join(failedFolder, '0013_execution_failure_probe.sql'), 'CREATE TABLE migration_evidence_rollback_probe (id int); SELECT nonexistent_column FROM users;');
  await assert.rejects(migrateWithEvidence(pool, failedFolder), { code: 'MIGRATION_FAILED' });
  assert.equal((await pool.query("select to_regclass('migration_evidence_rollback_probe') as value")).rows[0].value, null, 'failed migration must roll back DDL');
  assert.equal((await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows[0].count, 13);
  const failure = (await pool.query("select status,error_code,summary from maintenance_runs where task='database.migrate' order by started_at desc limit 1")).rows[0];
  assert.deepEqual(failure, { status: 'failed', error_code: 'MIGRATION_FAILED', summary: null });
  process.stdout.write('postgres 0004 upgrade, empty-feature rollback, re-upgrade, execution evidence, no-op, advisory lock and failed-DDL rollback contracts passed\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end().catch(() => undefined);
  rmSync(partial, { recursive: true, force: true });
});
