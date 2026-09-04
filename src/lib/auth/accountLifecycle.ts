import { and, count, eq, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  analyticsEvents,
  analyticsIdentityLinks,
  designShares,
  designs,
  emailTokens,
  palettes,
  sessions,
  users,
} from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { sanitizeAuditState } from '@/lib/admin/audit';

export async function anonymizeAccount(
  db: AnyDatabase,
  input: { userId: string; requestId: string; now?: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${users} where ${users.role} = 'admin' for update`);
    const [account] = await tx.select({
      id: users.id,
      role: users.role,
      accountStatus: users.accountStatus,
      governanceVersion: users.governanceVersion,
      publicAuthorId: users.publicAuthorId,
    }).from(users).where(eq(users.id, input.userId));
    if (!account || account.accountStatus !== 'active') {
      throw new AppError('NOT_FOUND', '账号不存在');
    }
    if (account.role === 'admin') {
      const [row] = await tx.select({ value: count() }).from(users).where(and(
        eq(users.role, 'admin'),
        eq(users.accountStatus, 'active'),
      ));
      if (row.value <= 1) {
        throw new AppError('STATE_CONFLICT', '必须先移交管理员角色才能注销账号');
      }
    }

    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, account.id));
    // Account erasure removes user-linked raw analytics while preserving the
    // already de-identified daily rollups.
    await tx.delete(analyticsEvents).where(eq(analyticsEvents.userId, account.id));
    await tx.delete(analyticsIdentityLinks).where(eq(analyticsIdentityLinks.userId, account.id));
    await tx.delete(designShares).where(eq(designShares.userId, account.id));
    await tx.delete(designs).where(eq(designs.userId, account.id));
    await tx.delete(palettes).where(eq(palettes.userId, account.id));

    const now = input.now ?? new Date();
    const [updated] = await tx.update(users).set({
      email: null,
      username: null,
      passwordHash: null,
      emailVerifiedAt: null,
      role: 'user',
      accountStatus: 'anonymized',
      governanceVersion: account.governanceVersion + 1,
      accountStatusReason: 'self_requested',
      statusChangedAt: now,
      suspendedAt: null,
      anonymizedAt: now,
      updatedAt: now,
    }).where(eq(users.id, account.id)).returning();

    await tx.insert(adminAuditLogs).values({
      actorUserId: account.id,
      actorRole: account.role,
      action: 'account.anonymized',
      targetType: 'user',
      targetId: account.id,
      reason: '用户确认注销账号',
      requestId: input.requestId,
      beforeState: sanitizeAuditState(account),
      afterState: sanitizeAuditState(updated),
    });
  });
}
