/** PostgreSQL 16 upgrade rehearsal from the deployed 0004 schema to current. */
const assert = require('node:assert/strict');
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');

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
  await migrate(db, { migrationsFolder: migrations });

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

  await migrate(db, { migrationsFolder: migrations });
  const journal = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
  assert.equal(journal.rows[0].count, 10, 'idempotent replay changed migration journal');
  process.stdout.write('postgres 0004-to-current community upgrade contract passed\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end().catch(() => undefined);
  rmSync(partial, { recursive: true, force: true });
});
