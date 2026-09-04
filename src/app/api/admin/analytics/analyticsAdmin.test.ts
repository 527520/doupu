import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { sessions, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { hashToken } from '@/lib/auth/tokens';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET as summaryGet } from './summary/route';
import { GET as dimensionsGet } from './dimensions/route';

let sessionToken: string | null = null;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => name === SESSION_COOKIE_NAME && sessionToken ? { name, value: sessionToken } : undefined,
    set: vi.fn(),
  })),
}));

describe('admin analytics API authorization', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
    setTestDb(db);
    sessionToken = null;
  });

  async function loginAs(role: 'user' | 'admin') {
    const [user] = await db.insert(users).values({
      email: `${role}-${crypto.randomUUID()}@example.com`,
      username: role,
      passwordHash: 'hash',
      emailVerifiedAt: new Date(),
      role,
    }).returning();
    sessionToken = crypto.randomUUID();
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 60_000),
    });
  }

  it('returns 401 to guests and 403 to ordinary users', async () => {
    const url = 'http://localhost/api/admin/analytics/summary?start=2026-09-01&end=2026-09-05';
    expect((await summaryGet(new Request(url))).status).toBe(401);
    await loginAs('user');
    expect((await summaryGet(new Request(url))).status).toBe(403);
  });

  it('serves admins and validates a fixed dimension vocabulary', async () => {
    await loginAs('admin');
    const base = 'start=2026-09-01&end=2026-09-05';
    const summary = await summaryGet(new Request(`http://localhost/api/admin/analytics/summary?${base}`));
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ capability: { mode: 'exact' } });

    const invalid = await dimensionsGet(new Request(`http://localhost/api/admin/analytics/dimensions?${base}&dimension=email`));
    expect(invalid.status).toBe(400);
  });
});
