/**
 * 最终镜像与 PostgreSQL 16 的协议发布门禁契约。
 *
 * CI service 数据库是一次性的，脚本启动时必须为空。契约直接运行候选镜像内的检查器与
 * 迁移产物，并验证拒绝旧协议的路径没有修改数据。
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { strictV3Project, strictV3Share } = require('./protocol-fixtures.cjs');

const connectionString = process.env.DATABASE_URL;
const image = process.env.PROTOCOL_PREFLIGHT_IMAGE;
if (!connectionString || !image) {
  throw new Error('DATABASE_URL and PROTOCOL_PREFLIGHT_IMAGE are required');
}

const pool = new Pool({ connectionString, max: 1 });
const fixtureIds = {
  user: '00000000-0000-4000-8000-000000000201',
  validDesign: '00000000-0000-4000-8000-000000000202',
  validShare: '00000000-0000-4000-8000-000000000203',
  legacyDesign: '00000000-0000-4000-8000-000000000204',
  legacyShare: '00000000-0000-4000-8000-000000000205',
};

function runImage(command, expectedStatus, label) {
  const result = spawnSync('docker', [
    'run', '--rm', '--network', 'host', '-e', 'DATABASE_URL', image, 'node', ...command,
  ], {
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expectedStatus,
    `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runPreflight(expectedStatus, label) {
  return runImage(['deploy/scripts/check-protocol-v3.cjs'], expectedStatus, label);
}

async function main() {
  const tableStatus = await pool.query(`
    SELECT
      to_regclass('public.designs')::text AS designs,
      to_regclass('public.design_shares')::text AS shares
  `);
  assert.deepEqual(tableStatus.rows[0], { designs: null, shares: null }, 'contract database must start empty');

  const empty = runPreflight(0, 'empty database preflight');
  assert.match(empty.stdout, /0 条活动设计，0 条分享/);

  runImage(['db/migrate.cjs'], 0, 'candidate-image migration');

  const validProject = strictV3Project('valid-v3');
  const validShare = strictV3Share(validProject, 'valid-v3-share');
  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO users(id,email,password_hash,email_verified_at)
       VALUES ($1,$2,$3,now())`,
      [fixtureIds.user, 'protocol-preflight@example.test', 'not-a-real-hash'],
    );
    await pool.query(
      `INSERT INTO designs(id,user_id,name,project,revision,payload_bytes)
       VALUES ($1,$2,$3,$4::jsonb,1,$5)`,
      [fixtureIds.validDesign, fixtureIds.user, validProject.name, JSON.stringify(validProject), 1],
    );
    await pool.query(
      `INSERT INTO design_shares(id,design_id,user_id,token_hash,snapshot,name)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        fixtureIds.validShare,
        fixtureIds.validDesign,
        fixtureIds.user,
        'protocol-preflight-valid-token',
        JSON.stringify(validShare),
        validShare.name,
      ],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  const valid = runPreflight(0, 'strict-v3 rows preflight');
  assert.match(valid.stdout, /1 条活动设计，1 条分享/);

  const legacyProject = { ...strictV3Project('legacy-design'), version: 2 };
  const legacyShare = { ...strictV3Share(legacyProject, 'legacy-share'), version: 2 };
  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO designs(id,user_id,name,project,revision,payload_bytes)
       VALUES ($1,$2,$3,$4::jsonb,1,$5)`,
      [fixtureIds.legacyDesign, fixtureIds.user, legacyProject.name, JSON.stringify(legacyProject), 1],
    );
    await pool.query(
      `INSERT INTO design_shares(id,design_id,user_id,token_hash,snapshot,name)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        fixtureIds.legacyShare,
        fixtureIds.legacyDesign,
        fixtureIds.user,
        'protocol-preflight-legacy-token',
        JSON.stringify(legacyShare),
        legacyShare.name,
      ],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  const before = await pool.query(
    `SELECT
       (SELECT to_jsonb(designs) FROM designs WHERE id = $1) AS design,
       (SELECT to_jsonb(design_shares) FROM design_shares WHERE id = $2) AS share`,
    [fixtureIds.legacyDesign, fixtureIds.legacyShare],
  );
  const rejected = runPreflight(1, 'legacy rows preflight');
  assert.match(rejected.stderr, new RegExp(fixtureIds.legacyDesign));
  assert.match(rejected.stderr, new RegExp(fixtureIds.legacyShare));
  const after = await pool.query(
    `SELECT
       (SELECT to_jsonb(designs) FROM designs WHERE id = $1) AS design,
       (SELECT to_jsonb(design_shares) FROM design_shares WHERE id = $2) AS share`,
    [fixtureIds.legacyDesign, fixtureIds.legacyShare],
  );
  assert.deepEqual(after.rows, before.rows, 'read-only rejection mutated legacy rows');

  await pool.query('DELETE FROM design_shares WHERE id = $1', [fixtureIds.legacyShare]);
  await pool.query('DELETE FROM designs WHERE id = $1', [fixtureIds.legacyDesign]);
  runPreflight(0, 'post-rejection cleanup preflight');
  process.stdout.write('candidate-image strict-v3 preflight contract passed\n');

  await pool.query('DELETE FROM users WHERE id = $1', [fixtureIds.user]);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    const tables = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS users_exists`);
    if (tables.rows[0]?.users_exists) {
      await pool.query('DELETE FROM users WHERE id = $1', [fixtureIds.user]);
    }
  } catch {
    // 原始失败优先；CI PostgreSQL 是一次性服务，清理失败不覆盖诊断。
  }
  await pool.end().catch(() => undefined);
  process.exit(1);
});
