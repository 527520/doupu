#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node db/admin-role.cjs grant|revoke --user-id <uuid> --email <normalized-email> --reason <text> --confirm <GRANT|REVOKE:userId>');
}

function parseArgs(argv) {
  const action = argv[0];
  if (action !== 'grant' && action !== 'revoke') throw new Error('action must be grant or revoke');
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('arguments must be --key value pairs');
    values[key.slice(2)] = value;
  }
  const userId = values['user-id'] ?? '';
  const email = values.email?.trim().toLowerCase() ?? '';
  const reason = values.reason?.trim() ?? '';
  const expectedConfirmation = `${action.toUpperCase()}:${userId}`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('user id must be a UUID');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email !== values.email) {
    throw new Error('email must already be normalized lowercase without surrounding whitespace');
  }
  if (reason.length < 3 || reason.length > 500) throw new Error('reason must contain 3-500 characters');
  if (values.confirm !== expectedConfirmation) {
    throw new Error(`explicit confirmation must equal ${expectedConfirmation}`);
  }
  return { action, userId, email, reason };
}

async function run(input, databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('doupu:user-governance', 0))");
    const result = await client.query(
      `SELECT id, role, account_status, governance_version, public_author_id
         FROM users
        WHERE id = $1 AND lower(email) = $2
        FOR UPDATE`,
      [input.userId, input.email],
    );
    if (result.rowCount !== 1) throw new Error('verified target account not found');
    const target = result.rows[0];
    const verified = await client.query('SELECT 1 FROM users WHERE id = $1 AND email_verified_at IS NOT NULL', [input.userId]);
    if (verified.rowCount !== 1 || target.account_status !== 'active') {
      throw new Error('target account must be verified and active');
    }
    const nextRole = input.action === 'grant' ? 'admin' : 'user';
    if (target.role === nextRole) throw new Error(`target already has role ${nextRole}`);
    if (input.action === 'revoke') {
      const admins = await client.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND account_status = 'active'");
      if (admins.rows[0].count <= 1) throw new Error('cannot revoke the last active administrator');
    }
    const updated = await client.query(
      `UPDATE users
          SET role = $2, governance_version = governance_version + 1, updated_at = now()
        WHERE id = $1
      RETURNING role, account_status, governance_version, public_author_id`,
      [input.userId, nextRole],
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [input.userId]);
    await client.query(
      `INSERT INTO admin_audit_logs
        (actor_user_id, actor_role, action, target_type, target_id, reason, request_id, before_state, after_state)
       VALUES (NULL, 'admin', $1, 'user', $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        `user.role_${input.action}ed_cli`,
        input.userId,
        input.reason,
        `cli:${randomUUID()}`,
        JSON.stringify({ role: target.role, accountStatus: target.account_status, governanceVersion: target.governance_version, publicAuthorId: target.public_author_id }),
        JSON.stringify({ role: updated.rows[0].role, accountStatus: updated.rows[0].account_status, governanceVersion: updated.rows[0].governance_version, publicAuthorId: updated.rows[0].public_author_id }),
      ],
    );
    await client.query('COMMIT');
    return { userId: input.userId, role: nextRole };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  let input;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage(error instanceof Error ? error.message : 'invalid arguments');
    process.exitCode = 2;
    return;
  }
  run(input, process.env.DATABASE_URL)
    .then((result) => console.log(`updated user ${result.userId} role=${result.role}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'admin role update failed');
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, run };
