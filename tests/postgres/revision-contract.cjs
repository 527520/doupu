/** PostgreSQL 16 contract for revision CAS and transactional quotas. Requires migrated DATABASE_URL. */
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString, max: 12 });
const userId = randomUUID();

async function createWithinQuota(index) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const usage = await client.query(
      'SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS active FROM designs WHERE user_id = $1',
      [userId],
    );
    if (usage.rows[0].active >= 100) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO designs(id,user_id,name,project,revision,payload_bytes)
       VALUES ($1,$2,$3,$4::jsonb,1,$5)`,
      [randomUUID(), userId, `concurrent-${index}`, JSON.stringify({ n: index }), 16],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

(async () => {
  await pool.query(
    'INSERT INTO users(id,email,password_hash,email_verified_at) VALUES ($1,$2,$3,now())',
    [userId, `revision-contract-${userId}@example.test`, 'not-a-real-hash'],
  );
  try {
    const creates = await Promise.all(Array.from({ length: 101 }, (_, index) => createWithinQuota(index)));
    if (creates.filter(Boolean).length !== 100) throw new Error('transactional active-row quota was exceeded');

    const target = (await pool.query('SELECT id FROM designs WHERE user_id=$1 LIMIT 1', [userId])).rows[0].id;
    const cas = await Promise.all([
      pool.query('UPDATE designs SET revision=revision+1,name=$1 WHERE id=$2 AND user_id=$3 AND revision=1 RETURNING revision', ['winner-a', target, userId]),
      pool.query('UPDATE designs SET revision=revision+1,name=$1 WHERE id=$2 AND user_id=$3 AND revision=1 RETURNING revision', ['winner-b', target, userId]),
    ]);
    if (cas.filter((result) => result.rowCount === 1).length !== 1) throw new Error('CAS allowed zero or multiple winners');

    await pool.query(
      `UPDATE designs SET name='',project=NULL,payload_bytes=0,deleted_at=now(),updated_at=now(),revision=revision+1
       WHERE id=$1 AND user_id=$2`,
      [target, userId],
    );
    const tombstone = (await pool.query('SELECT project,payload_bytes FROM designs WHERE id=$1', [target])).rows[0];
    if (tombstone.project !== null || tombstone.payload_bytes !== 0) throw new Error('tombstone retained payload');
    process.stdout.write('postgres revision/quota contract passed\n');
  } finally {
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
  }
})().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
