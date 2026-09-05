import { beforeEach, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET } from './route';
import { GET as system } from '../system/route';

let token: string | undefined;
let db: TestDatabase;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
beforeEach(async () => { db = await createTestClient(); setTestDb(db); token = undefined; });
const audit = (query = '') => GET(new Request(`http://localhost/api/admin/audit${query}`));
it('limits audit and runtime evidence to admins and never caches the response publicly', async () => {
  expect((await audit()).status).toBe(401); expect((await system()).status).toBe(401);
  for (const role of ['user', 'moderator', 'admin'] as const) {
    const [account] = await db.insert(users).values({ email: `${role}@example.test`, role, emailVerifiedAt: new Date() }).returning();
    token = (await createSession(db, account.id)).token;
    for (const read of [audit, system]) {
      const response = await read(); expect(response.status).toBe(role === 'admin' ? 200 : 403);
      if (role === 'admin') expect(response.headers.get('cache-control')).toContain('no-store');
    }
  }
  expect((await audit('?cursor=broken')).status).toBe(400);
  expect((await audit('?from=2026-09-05&to=2026-09-01')).status).toBe(400);
});
