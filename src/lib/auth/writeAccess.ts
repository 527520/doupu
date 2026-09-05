import { eq, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { authorize, type Capability } from './authorization';

/** 与容器 CLI 共享。管理锁必须在任何账号/业务行锁之前取得。 */
export async function lockAccountGovernance(tx: AnyDatabase): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('doupu:user-governance', 0))`);
}

/** DAL 的请求身份不是写入许可：账号锁与实际写入必须处于同一事务。 */
export async function lockActiveAccount(tx: AnyDatabase, userId: string, capability?: Capability) {
  const [account] = await tx.select().from(users).where(eq(users.id, userId)).for('no key update');
  if (!account || account.accountStatus !== 'active') throw new AppError('FORBIDDEN', '账号当前不可用');
  if (capability && !authorize({ userId, role: account.role, accountStatus: account.accountStatus, emailVerified: account.emailVerifiedAt !== null }, capability)) {
    throw new AppError('FORBIDDEN', '没有执行此操作的权限');
  }
  return account;
}
