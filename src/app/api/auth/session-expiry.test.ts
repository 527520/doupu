import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { sessions, users } from '@/../db/schema';
import { createSession, resolveSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/tokens';

describe('session expiry', () => {
  let db: TestDatabase;
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('creates a 30-day rolling expiry with a 90-day absolute expiry', async () => {
    const [user] = await db.insert(users).values({ email: 'session-create@example.com', passwordHash: 'hash' }).returning();
    const created = await createSession(db, user.id, now);
    const [stored] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(created.token)));
    expect(stored.expiresAt.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(stored.absoluteExpiresAt.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('caps rolling DB and cookie expiry at the absolute deadline', async () => {
    const [user] = await db.insert(users).values({ email: 'session-roll@example.com', passwordHash: 'hash' }).returning();
    const token = 'rolling-token';
    const absoluteExpiresAt = new Date('2026-01-11T00:00:00.000Z');
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      absoluteExpiresAt,
    });

    const result = await resolveSession(db, `${SESSION_COOKIE_NAME}=${token}`, now, { renew: true });
    const [stored] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    expect(result?.renewedExpiresAt?.toISOString()).toBe(absoluteExpiresAt.toISOString());
    expect(stored.expiresAt.toISOString()).toBe(absoluteExpiresAt.toISOString());
  });

  it('rejects a session after its absolute deadline even when rolling expiry is later', async () => {
    const [user] = await db.insert(users).values({ email: 'session-absolute@example.com', passwordHash: 'hash' }).returning();
    const token = 'expired-token';
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2025-12-31T23:59:59.000Z'),
    });

    await expect(resolveSession(db, `${SESSION_COOKIE_NAME}=${token}`, now)).resolves.toBeNull();
  });

  it('rejects an existing session as soon as the account is suspended', async () => {
    const [user] = await db.insert(users).values({
      email: 'session-suspended@example.com',
      passwordHash: 'hash',
      accountStatus: 'suspended',
    }).returning();
    const token = 'suspended-token';
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    await expect(resolveSession(db, `${SESSION_COOKIE_NAME}=${token}`, now)).resolves.toBeNull();
  });
});
