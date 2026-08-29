/**
 * 认证状态变更的事务边界。
 *
 * 路由负责校验输入、执行昂贵哈希；本模块只接收不可逆结果并在一个数据库
 * 事务内完成所有相关写入。hooks 仅用于故障注入，验证任一写入失败都会回滚。
 */
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { emailTokens, sessions, users } from '@/../db/schema';

export interface AuthTransitionHooks {
  afterTokenConsumed?: () => void | Promise<void>;
  afterPasswordUpdated?: () => void | Promise<void>;
  afterUserCreated?: () => void | Promise<void>;
}

/** 创建待验证账号与首个验证令牌必须同生共死。 */
export async function createUnverifiedUser(
  db: AnyDatabase,
  input: { email: string; username?: string; passwordHash: string; tokenHash: string; expiresAt: Date },
  hooks: Pick<AuthTransitionHooks, 'afterUserCreated'> = {},
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, username: input.username || null, passwordHash: input.passwordHash })
      .returning();
    await hooks.afterUserCreated?.();
    await tx.insert(emailTokens).values({
      userId: user.id,
      purpose: 'verify',
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    return { id: user.id };
  });
}

export interface ResetPasswordTransition {
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

/** 返回 false 表示验证令牌不存在、已使用或已过期。 */
export async function verifyEmailWithToken(
  db: AnyDatabase,
  input: { tokenHash: string; now: Date },
  hooks: Pick<AuthTransitionHooks, 'afterTokenConsumed'> = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(emailTokens)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(emailTokens.tokenHash, input.tokenHash),
          eq(emailTokens.purpose, 'verify'),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, input.now),
        ),
      )
      .returning();
    if (consumed.length === 0) return false;
    await hooks.afterTokenConsumed?.();
    await tx
      .update(users)
      .set({ emailVerifiedAt: input.now, updatedAt: input.now })
      .where(eq(users.id, consumed[0].userId));
    return true;
  });
}

/** 作废同用途旧令牌并创建替代令牌；两步必须一起提交。 */
export async function rotateEmailToken(
  db: AnyDatabase,
  input: {
    userId: string;
    purpose: 'verify' | 'reset';
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  },
  hooks: Pick<AuthTransitionHooks, 'afterTokenConsumed'> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(emailTokens)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(emailTokens.userId, input.userId),
          eq(emailTokens.purpose, input.purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    await hooks.afterTokenConsumed?.();
    await tx.insert(emailTokens).values({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
  });
}

/**
 * 先以不可消费状态暂存 reset token；只有 delivery 成功后，才在一个事务内
 * 激活新 token 并撤销旧 token。delivery 或激活失败时删除暂存 token。
 */
export async function deliverResetEmailToken(
  db: AnyDatabase,
  input: { userId: string; tokenHash: string; expiresAt: Date; now: Date },
  delivery: () => Promise<void>,
  hooks: Pick<AuthTransitionHooks, 'afterTokenConsumed'> = {},
): Promise<void> {
  await db.insert(emailTokens).values({
    userId: input.userId,
    purpose: 'reset',
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    usedAt: input.now,
  });

  try {
    await delivery();
    await db.transaction(async (tx) => {
      await tx
        .update(emailTokens)
        .set({ usedAt: input.now })
        .where(
          and(
            eq(emailTokens.userId, input.userId),
            eq(emailTokens.purpose, 'reset'),
            isNull(emailTokens.usedAt),
          ),
        );
      await hooks.afterTokenConsumed?.();
      await tx
        .update(emailTokens)
        .set({ usedAt: null })
        .where(
          and(
            eq(emailTokens.userId, input.userId),
            eq(emailTokens.purpose, 'reset'),
            eq(emailTokens.tokenHash, input.tokenHash),
          ),
        );
    });
  } catch (error) {
    await db.delete(emailTokens).where(eq(emailTokens.tokenHash, input.tokenHash));
    throw error;
  }
}

/** 返回 false 表示令牌不存在、已使用或已过期。 */
export async function resetPasswordWithToken(
  db: AnyDatabase,
  input: ResetPasswordTransition,
  hooks: AuthTransitionHooks = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(emailTokens)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(emailTokens.tokenHash, input.tokenHash),
          eq(emailTokens.purpose, 'reset'),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, input.now),
        ),
      )
      .returning();
    if (consumed.length === 0) return false;

    await hooks.afterTokenConsumed?.();
    await tx
      .update(users)
      .set({ passwordHash: input.passwordHash, updatedAt: input.now })
      .where(eq(users.id, consumed[0].userId));
    await hooks.afterPasswordUpdated?.();
    await tx.delete(sessions).where(eq(sessions.userId, consumed[0].userId));
    return true;
  });
}

/** 修改密码与吊销其他会话必须一起提交。 */
export async function changePasswordAndRevokeSessions(
  db: AnyDatabase,
  input: { userId: string; expectedPasswordHash: string; passwordHash: string; keepTokenHash: string | null; now: Date },
  hooks: Pick<AuthTransitionHooks, 'afterPasswordUpdated'> = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash: input.passwordHash, updatedAt: input.now })
      .where(and(eq(users.id, input.userId), eq(users.passwordHash, input.expectedPasswordHash)))
      .returning();
    if (updated.length === 0) return false;
    await hooks.afterPasswordUpdated?.();
    const predicate = input.keepTokenHash
      ? and(eq(sessions.userId, input.userId), ne(sessions.tokenHash, input.keepTokenHash))
      : eq(sessions.userId, input.userId);
    await tx.delete(sessions).where(predicate);
    return true;
  });
}
