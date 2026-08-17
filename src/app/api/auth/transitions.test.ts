import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { emailTokens, sessions, users } from '@/../db/schema';
import {
  changePasswordAndRevokeSessions,
  createUnverifiedUser,
  deliverResetEmailToken,
  resetPasswordWithToken,
  rotateEmailToken,
  verifyEmailWithToken,
} from '@/lib/auth/transitions';

describe('auth state transitions', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('rolls back token consumption, password update and session revocation when reset fails', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'reset-rollback@example.com', passwordHash: 'old-hash' })
      .returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'reset-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: 'session-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      resetPasswordWithToken(
        db,
        { tokenHash: 'reset-token-hash', passwordHash: 'new-hash', now: new Date() },
        { afterPasswordUpdated: () => { throw new Error('injected failure'); } },
      ),
    ).rejects.toThrow('injected failure');

    const [token] = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, 'reset-token-hash'));
    const [storedUser] = await db.select().from(users).where(eq(users.id, user.id));
    const storedSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(token.usedAt).toBeNull();
    expect(storedUser.passwordHash).toBe('old-hash');
    expect(storedSessions).toHaveLength(1);
  });

  it('rolls back user creation when initial verification-token insertion fails', async () => {
    await expect(createUnverifiedUser(db, {
      email: 'register-rollback@example.com',
      passwordHash: 'hash',
      tokenHash: 'verify-hash',
      expiresAt: new Date(Date.now() + 60_000),
    }, {
      afterUserCreated: () => { throw new Error('token insertion failure'); },
    })).rejects.toThrow('token insertion failure');

    expect(await db.select().from(users).where(eq(users.email, 'register-rollback@example.com'))).toHaveLength(0);
    expect(await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, 'verify-hash'))).toHaveLength(0);
  });

  it('rolls back verification token consumption when updating the user fails', async () => {
    const [user] = await db.insert(users).values({ email: 'verify-rollback@example.com', passwordHash: 'hash' }).returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'verify',
      tokenHash: 'verify-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      verifyEmailWithToken(db, { tokenHash: 'verify-token-hash', now: new Date() }, {
        afterTokenConsumed: () => { throw new Error('verify failure'); },
      }),
    ).rejects.toThrow('verify failure');

    const [token] = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, 'verify-token-hash'));
    const [storedUser] = await db.select().from(users).where(eq(users.id, user.id));
    expect(token.usedAt).toBeNull();
    expect(storedUser.emailVerifiedAt).toBeNull();
  });

  it('rolls back old-token invalidation when creating its replacement fails', async () => {
    const [user] = await db.insert(users).values({ email: 'rotate-rollback@example.com', passwordHash: 'hash' }).returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'old-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      rotateEmailToken(db, {
        userId: user.id,
        purpose: 'reset',
        tokenHash: 'new-token-hash',
        expiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      }, { afterTokenConsumed: () => { throw new Error('insert failure'); } }),
    ).rejects.toThrow('insert failure');

    const oldTokens = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, 'old-token-hash'));
    const newTokens = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, 'new-token-hash'));
    expect(oldTokens[0].usedAt).toBeNull();
    expect(newTokens).toHaveLength(0);
  });

  it('keeps the old reset token usable and the staged replacement unusable when delivery fails', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'reset-delivery-failure@example.com', passwordHash: 'old-hash' })
      .returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'old-delivered-token',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date();

    await expect(
      deliverResetEmailToken(
        db,
        {
          userId: user.id,
          tokenHash: 'new-undelivered-token',
          expiresAt: new Date(now.getTime() + 120_000),
          now,
        },
        async () => { throw new Error('mail delivery failed'); },
      ),
    ).rejects.toThrow('mail delivery failed');

    expect(await resetPasswordWithToken(db, {
      tokenHash: 'old-delivered-token',
      passwordHash: 'old-token-won',
      now: new Date(),
    })).toBe(true);
    expect(await resetPasswordWithToken(db, {
      tokenHash: 'new-undelivered-token',
      passwordHash: 'undelivered-token-won',
      now: new Date(),
    })).toBe(false);
  });

  it('rolls back activation when the database transition fails after delivery', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'reset-activation-failure@example.com', passwordHash: 'old-hash' })
      .returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'old-before-activation-failure',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date();

    await expect(
      deliverResetEmailToken(
        db,
        {
          userId: user.id,
          tokenHash: 'staged-before-activation-failure',
          expiresAt: new Date(now.getTime() + 120_000),
          now,
        },
        async () => undefined,
        { afterTokenConsumed: () => { throw new Error('activation failed'); } },
      ),
    ).rejects.toThrow('activation failed');

    expect(await resetPasswordWithToken(db, {
      tokenHash: 'old-before-activation-failure',
      passwordHash: 'old-token-won',
      now: new Date(),
    })).toBe(true);
    expect(await resetPasswordWithToken(db, {
      tokenHash: 'staged-before-activation-failure',
      passwordHash: 'staged-token-won',
      now: new Date(),
    })).toBe(false);
  });

  it('activates the delivered reset token and revokes the old token atomically', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'reset-delivery-success@example.com', passwordHash: 'old-hash' })
      .returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'old-before-delivery-success',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date();

    await deliverResetEmailToken(
      db,
      {
        userId: user.id,
        tokenHash: 'new-after-delivery-success',
        expiresAt: new Date(now.getTime() + 120_000),
        now,
      },
      async () => undefined,
    );

    expect(await resetPasswordWithToken(db, {
      tokenHash: 'old-before-delivery-success',
      passwordHash: 'old-token-won',
      now: new Date(),
    })).toBe(false);
    expect(await resetPasswordWithToken(db, {
      tokenHash: 'new-after-delivery-success',
      passwordHash: 'new-token-won',
      now: new Date(),
    })).toBe(true);
  });

  it('keeps exactly one delivered reset token active across concurrent rotations', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'concurrent-reset-delivery@example.com', passwordHash: 'old-hash' })
      .returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'old-before-concurrent-delivery',
      expiresAt: new Date(Date.now() + 60_000),
    });
    let arrivals = 0;
    let releaseDeliveries!: () => void;
    const bothStaged = new Promise<void>((resolve) => { releaseDeliveries = resolve; });
    const delivery = async (): Promise<void> => {
      arrivals += 1;
      if (arrivals === 2) releaseDeliveries();
      await bothStaged;
    };
    const now = new Date();

    await Promise.all([
      deliverResetEmailToken(db, {
        userId: user.id,
        tokenHash: 'concurrent-delivered-a',
        expiresAt: new Date(now.getTime() + 120_000),
        now,
      }, delivery),
      deliverResetEmailToken(db, {
        userId: user.id,
        tokenHash: 'concurrent-delivered-b',
        expiresAt: new Date(now.getTime() + 120_000),
        now,
      }, delivery),
    ]);

    const results = await Promise.all([
      resetPasswordWithToken(db, {
        tokenHash: 'concurrent-delivered-a',
        passwordHash: 'password-a',
        now: new Date(),
      }),
      resetPasswordWithToken(db, {
        tokenHash: 'concurrent-delivered-b',
        passwordHash: 'password-b',
        now: new Date(),
      }),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await resetPasswordWithToken(db, {
      tokenHash: 'old-before-concurrent-delivery',
      passwordHash: 'old-password',
      now: new Date(),
    })).toBe(false);
  });

  it('rolls back password update when revoking other sessions fails', async () => {
    const [user] = await db.insert(users).values({ email: 'change-rollback@example.com', passwordHash: 'old-hash' }).returning();
    await db.insert(sessions).values([
      { userId: user.id, tokenHash: 'keep-hash', expiresAt: new Date(Date.now() + 60_000) },
      { userId: user.id, tokenHash: 'revoke-hash', expiresAt: new Date(Date.now() + 60_000) },
    ]);

    await expect(
      changePasswordAndRevokeSessions(db, {
        userId: user.id,
        expectedPasswordHash: 'old-hash',
        passwordHash: 'new-hash',
        keepTokenHash: 'keep-hash',
        now: new Date(),
      }, { afterPasswordUpdated: () => { throw new Error('revoke failure'); } }),
    ).rejects.toThrow('revoke failure');

    const [storedUser] = await db.select().from(users).where(eq(users.id, user.id));
    const storedSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(storedUser.passwordHash).toBe('old-hash');
    expect(storedSessions).toHaveLength(2);
  });

  it('allows only one concurrent consumer of a reset token', async () => {
    const [user] = await db.insert(users).values({ email: 'double-consume@example.com', passwordHash: 'old-hash' }).returning();
    await db.insert(emailTokens).values({
      userId: user.id,
      purpose: 'reset',
      tokenHash: 'single-use-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date();
    const results = await Promise.all([
      resetPasswordWithToken(db, { tokenHash: 'single-use-hash', passwordHash: 'new-a', now }),
      resetPasswordWithToken(db, { tokenHash: 'single-use-hash', passwordHash: 'new-b', now }),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });
});
