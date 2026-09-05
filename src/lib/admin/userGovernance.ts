import { and, count, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { adminAuditLogs, sessions, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import type { AccountStatus, UserRole } from '@/lib/auth/authorization';
import { sanitizeAuditState } from './audit';
import { lockAccountGovernance } from '@/lib/auth/writeAccess';

export interface UpdateUserGovernanceInput {
  actorUserId: string;
  targetUserId: string;
  targetConfirmation: string;
  expectedVersion: number;
  role?: UserRole;
  accountStatus?: Extract<AccountStatus, 'active' | 'suspended'>;
  reason: string;
  requestId: string;
  now?: Date;
}

export interface UserGovernanceResult {
  userId: string;
  role: UserRole;
  accountStatus: AccountStatus;
  governanceVersion: number;
}

export async function updateUserGovernance(
  db: AnyDatabase,
  input: UpdateUserGovernanceInput,
): Promise<UserGovernanceResult> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError('VALIDATION', '操作理由需为 3–500 个字符', 'reason');
  }
  if (input.targetConfirmation !== input.targetUserId) {
    throw new AppError('VALIDATION', '目标账号二次确认不匹配', 'targetConfirmation');
  }

  return db.transaction(async (tx) => {
    await lockAccountGovernance(tx);

    const [actor] = await tx.select({
      id: users.id,
      role: users.role,
      accountStatus: users.accountStatus,
      emailVerifiedAt: users.emailVerifiedAt,
    }).from(users).where(eq(users.id, input.actorUserId)).for('no key update');
    if (!actor || actor.role !== 'admin' || actor.accountStatus !== 'active' || !actor.emailVerifiedAt) {
      throw new AppError('FORBIDDEN', '没有人员治理权限');
    }

    const [target] = await tx.select({
      id: users.id,
      role: users.role,
      accountStatus: users.accountStatus,
      governanceVersion: users.governanceVersion,
    }).from(users).where(eq(users.id, input.targetUserId)).for('no key update');
    if (!target || target.accountStatus === 'anonymized') {
      throw new AppError('NOT_FOUND', '账号不存在');
    }

    const nextRole = input.role ?? target.role;
    const nextStatus = input.accountStatus ?? target.accountStatus;
    const changesOwnRole = input.actorUserId === input.targetUserId && nextRole !== target.role;
    const suspendsSelf = input.actorUserId === input.targetUserId && nextStatus !== 'active';
    if (changesOwnRole || suspendsSelf) {
      throw new AppError('FORBIDDEN', '管理员不能修改自己的角色或暂停自己');
    }
    if (target.governanceVersion !== input.expectedVersion) {
      throw new AppError('STATE_CONFLICT', '账号状态已变化，请刷新后重试');
    }
    if (nextRole === target.role && nextStatus === target.accountStatus) {
      throw new AppError('STATE_CONFLICT', '账号状态没有变化');
    }

    const removesActiveAdmin = target.role === 'admin'
      && target.accountStatus === 'active'
      && (nextRole !== 'admin' || nextStatus !== 'active');
    if (removesActiveAdmin) {
      const [row] = await tx.select({ value: count() }).from(users).where(and(
        eq(users.role, 'admin'),
        eq(users.accountStatus, 'active'),
      ));
      if (row.value <= 1) {
        throw new AppError('STATE_CONFLICT', '必须保留至少一名有效管理员');
      }
    }

    const now = input.now ?? new Date();
    const [updated] = await tx.update(users).set({
      role: nextRole,
      accountStatus: nextStatus,
      governanceVersion: target.governanceVersion + 1,
      accountStatusReason: nextStatus === target.accountStatus ? undefined : reason,
      statusChangedAt: nextStatus === target.accountStatus ? undefined : now,
      suspendedAt: nextStatus === 'suspended' ? now : null,
      updatedAt: now,
    }).where(and(
      eq(users.id, target.id),
      eq(users.governanceVersion, target.governanceVersion),
    )).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '账号状态已变化，请刷新后重试');

    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    await tx.insert(adminAuditLogs).values({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: nextRole !== target.role ? 'user.role_changed' : 'user.status_changed',
      targetType: 'user',
      targetId: target.id,
      reason,
      requestId: input.requestId,
      beforeState: sanitizeAuditState(target),
      afterState: sanitizeAuditState(updated),
    });

    return {
      userId: updated.id,
      role: updated.role,
      accountStatus: updated.accountStatus,
      governanceVersion: updated.governanceVersion,
    };
  });
}
