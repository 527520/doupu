import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin role CLI', () => {
  it('fails closed before database access unless explicit confirmation matches the action and user id', () => {
    const script = resolve(process.cwd(), 'db/admin-role.cjs');
    const result = spawnSync(process.execPath, [
      script,
      'grant',
      '--user-id', '00000000-0000-4000-8000-000000000001',
      '--email', 'owner@example.com',
      '--reason', 'initial administrator',
      '--confirm', 'wrong',
    ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('GRANT:00000000-0000-4000-8000-000000000001');
    expect(result.stderr).not.toContain('DATABASE_URL is required');
  });
});
