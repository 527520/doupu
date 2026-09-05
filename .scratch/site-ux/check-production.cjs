// Local candidate-image verification only. Tokens stay in memory and child environments.
const { Pool } = require('pg');
const { randomBytes, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const dbUrl = new URL(process.env.DATABASE_URL);
const origin = new URL(process.env.E2E_BASE_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.ok(dbUrl.pathname.startsWith('/siteux_image_'));
assert.equal(origin.hostname, '127.0.0.1');
const pool = new Pool({ connectionString: dbUrl.href, max: 1 });
const ids = [101, 102, 103].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
const hash = (token) => createHash('sha256').update(token).digest('hex');
const env = { ...process.env, E2E_SESSION_TOKEN: tokens[0], E2E_VERIFY_TOKEN: tokens[1], E2E_ADMIN_SESSION_TOKEN: tokens[2] };
async function main() {
  assert.equal((await pool.query('select id from users where id = any($1::uuid[])', [ids])).rowCount, 0, 'use a fresh local candidate database');
  await pool.query('begin');
  try {
    for (let i = 0; i < ids.length; i++) await pool.query('insert into users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,$4,$5)', [ids[i], `siteux-production-${i}@example.test`, 'not-used', i === 1 ? null : new Date(), i === 2 ? 'admin' : 'user']);
    await pool.query("insert into sessions(user_id,token_hash,expires_at,absolute_expires_at) values($1,$2,now()+interval '30 days',now()+interval '90 days'),($3,$4,now()+interval '14 days',now()+interval '74 days')", [ids[0], hash(tokens[0]), ids[2], hash(tokens[2])]);
    await pool.query("insert into email_tokens(user_id,purpose,token_hash,expires_at) values($1,'verify',$2,now()+interval '1 day')", [ids[1], hash(tokens[1])]);
    await pool.query('commit');
  } catch (error) { await pool.query('rollback'); throw error; }
  try {
    const routes = spawnSync(process.execPath, ['tests/postgres/route-contract.cjs'], { env, stdio: 'inherit', timeout: 120_000 });
    assert.equal(routes.status, 0, 'candidate route contract failed');
    const browsers = spawnSync('npm', ['run', 'test:e2e:production', '--', '--output=/tmp/doupu-siteux-production-results'], { env, stdio: 'inherit', timeout: 300_000 });
    assert.equal(browsers.status, 0, 'candidate production browser smoke failed');
  } finally { await pool.query('delete from users where id = any($1::uuid[])', [ids]); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
