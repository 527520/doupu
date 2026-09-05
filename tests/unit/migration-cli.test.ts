import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('requires explicit database configuration without logging environment values', () => {
  const result = spawnSync(process.execPath, [resolve('db/migrate.cjs')], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  expect(result.status).toBe(1); expect(result.stderr.trim()).toBe('DATABASE_URL is required'); expect(result.stdout).toBe('');
});

it('exports the rehearsal runner without connecting or executing on import', () => {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(typeof require("./db/migrate.cjs").migrateWithEvidence)'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  expect(result.status).toBe(0); expect(result.stdout).toBe('function'); expect(result.stderr).toBe('');
});
