import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookies } from 'next/headers';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import { MutableRequestCookiesAdapter, RequestCookiesAdapter } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { sessions, users } from '@/../db/schema';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/tokens';
import { setTestDb } from '@/lib/auth/db';
import { getSessionActor, getSessionUserId } from '@/lib/auth/session';
import { requireApiActor } from '@/lib/auth/dal';

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

  afterEach(() => vi.useRealTimers());

  it('reads an aging session through a real read-only page cookie jar without renewing it', async () => {
    const now = new Date('2026-09-05T00:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const [user] = await db.insert(users).values({ email: 'page-cookie@example.com', passwordHash: 'hash', emailVerifiedAt: now }).returning();
    const pageToken = 'page-session-token';
    const expiresAt = new Date('2026-09-19T00:00:00Z');
    const absoluteExpiresAt = new Date('2026-11-01T00:00:00Z');
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(pageToken), expiresAt, absoluteExpiresAt });
    const readonlyJar = RequestCookiesAdapter.seal(new RequestCookies(new Headers({ cookie: `${SESSION_COOKIE_NAME}=${pageToken}` })));

    for (const time of ['2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z']) {
      vi.setSystemTime(new Date(time));
      vi.mocked(cookies).mockResolvedValueOnce(readonlyJar);
      await expect(getSessionActor()).resolves.toMatchObject({ userId: user.id });
      expect((await db.select().from(sessions).where(eq(sessions.userId, user.id)))[0].expiresAt).toEqual(expiresAt);
    }

    // The same aging session is renewed only when a Route Handler opts in.
    const mutableJar = MutableRequestCookiesAdapter.wrap(new RequestCookies(new Headers({ cookie: `${SESSION_COOKIE_NAME}=${pageToken}` })));
    vi.mocked(cookies).mockResolvedValueOnce(Object.assign(
      new RequestCookies(new Headers({ cookie: `${SESSION_COOKIE_NAME}=${pageToken}` })),
      { set: mutableJar.set.bind(mutableJar), delete: mutableJar.delete.bind(mutableJar) },
    ));
    await expect(requireApiActor('community:interact')).resolves.toMatchObject({ userId: user.id });
    expect((await db.select().from(sessions).where(eq(sessions.userId, user.id)))[0].expiresAt).toEqual(new Date('2026-10-05T00:00:00Z'));
    expect(mutableJar.toString()).toContain('Max-Age=2592000');

    vi.setSystemTime(absoluteExpiresAt);
    vi.mocked(cookies).mockResolvedValueOnce(readonlyJar);
    await expect(getSessionActor()).resolves.toBeNull();
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
