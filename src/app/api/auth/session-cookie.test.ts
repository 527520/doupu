import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { sessions, users } from '@/../db/schema';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/tokens';
import { setTestDb } from '@/lib/auth/db';
import { getSessionUserId } from '@/lib/auth/session';

const { setCookie, token } = vi.hoisted(() => ({ setCookie: vi.fn(), token: 'cookie-renew-token' }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => name === SESSION_COOKIE_NAME ? { name, value: token } : undefined,
    set: setCookie,
  })),
}));

describe('session rolling cookie', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestClient();
    setTestDb(db);
  });

  it('renews the database row and cookie to the same absolute-capped deadline', async () => {
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + 10 * 24 * 60 * 60 * 1000);
    const [user] = await db.insert(users).values({ email: 'cookie-roll@example.com', passwordHash: 'hash' }).returning();
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      absoluteExpiresAt,
    });

    await expect(getSessionUserId()).resolves.toBe(user.id);
    const [stored] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    expect(Math.abs(stored.expiresAt.getTime() - absoluteExpiresAt.getTime())).toBeLessThan(10);
    expect(setCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      token,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: expect.any(Number) }),
    );
    const options = setCookie.mock.calls[0][2] as { maxAge: number };
    expect(options.maxAge).toBeGreaterThan(9 * 24 * 60 * 60);
    expect(options.maxAge).toBeLessThanOrEqual(10 * 24 * 60 * 60);
  });
});
