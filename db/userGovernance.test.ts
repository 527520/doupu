import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from './testClient';
import { adminAuditLogs, sessions, users } from './schema';
import { updateUserGovernance } from '@/lib/admin/userGovernance';

describe('user governance', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('does not let an administrator change their own role', async () => {
    const [admin] = await db.insert(users).values({
      email: 'last-admin@example.com',
      passwordHash: 'hash',
      emailVerifiedAt: new Date(),
      role: 'admin',
    }).returning();

    await expect(updateUserGovernance(db, {
      actorUserId: admin.id,
      targetUserId: admin.id,
      targetConfirmation: admin.id,
      role: 'user',
      expectedVersion: 1,
      reason: '轮换管理员',
      requestId: 'request-last-admin',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('changes another account with CAS, revokes sessions and writes minimized audit metadata', async () => {
    const [admin] = await db.insert(users).values({
      email: 'admin@example.com', passwordHash: 'hash', emailVerifiedAt: new Date(), role: 'admin',
    }).returning();
    const [target] = await db.insert(users).values({
      email: 'target@example.com', passwordHash: 'hash', emailVerifiedAt: new Date(),
    }).returning();
    await db.insert(sessions).values({
      userId: target.id,
      tokenHash: 'target-session',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(updateUserGovernance(db, {
      actorUserId: admin.id,
      targetUserId: target.id,
      targetConfirmation: target.id,
      accountStatus: 'suspended',
      expectedVersion: 1,
      reason: '明确的垃圾推广行为',
      requestId: 'request-suspend-target',
    })).resolves.toMatchObject({ accountStatus: 'suspended', governanceVersion: 2 });

    expect(await db.select().from(sessions)).toEqual([]);
    const [audit] = await db.select().from(adminAuditLogs);
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      action: 'user.status_changed',
      targetId: target.id,
      reason: '明确的垃圾推广行为',
    });
    expect(JSON.stringify(audit)).not.toContain('target@example.com');

    await expect(updateUserGovernance(db, {
      actorUserId: admin.id,
      targetUserId: target.id,
      targetConfirmation: target.id,
      accountStatus: 'active',
      expectedVersion: 1,
      reason: '错误的旧版本',
      requestId: 'request-stale-target',
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
