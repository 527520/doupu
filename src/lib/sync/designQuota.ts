import { and, count, eq, lt, sql, sum } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { designs, users } from '@/../db/schema';
import { LIMITS } from '@/lib/appInfo';
import { AppError } from '@/lib/errors';
import { tombstoneCutoff } from './revision';

/** 所有云端设计写入共用用户锁；NO KEY UPDATE 兼容幂等记录的外键锁。 */
export async function lockDesignStorage(tx: AnyDatabase, userId: string, now = new Date()): Promise<void> {
  await tx.execute(sql`select id from ${users} where id = ${userId} for no key update`);
  await tx.delete(designs).where(and(eq(designs.userId, userId), lt(designs.deletedAt, tombstoneCutoff(now))));
}

/** 必须在持有 lockDesignStorage 的事务内调用，计入活动设计、墓碑行及总字节。 */
export async function assertDesignQuota(
  tx: AnyDatabase,
  userId: string,
  payloadBytes: number,
  existing?: { payloadBytes: number; deletedAt: Date | null },
): Promise<void> {
  const [usage] = await tx.select({
    total: count(),
    active: count(sql`case when ${designs.deletedAt} is null then 1 end`),
    bytes: sum(designs.payloadBytes),
  }).from(designs).where(eq(designs.userId, userId));
  if ((!existing || existing.deletedAt) && Number(usage.active) >= LIMITS.designsPerUser
    || !existing && Number(usage.total) >= LIMITS.designRowsPerUser) {
    throw new AppError('CONFLICT', `设计数量已达上限（${LIMITS.designsPerUser} 个）`);
  }
  if (Number(usage.bytes ?? 0) - (existing?.payloadBytes ?? 0) + payloadBytes > LIMITS.designBytesPerUser) {
    throw new AppError('CONFLICT', '设计总存储空间已达上限');
  }
}
