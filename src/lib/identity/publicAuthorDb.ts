import { eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';

/** Assigns legacy accounts a public id at their first public operation. */
export async function ensurePublicAuthorId(db: AnyDatabase, userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [account] = await tx.select({
      publicAuthorId: users.publicAuthorId,
      accountStatus: users.accountStatus,
    }).from(users).where(eq(users.id, userId)).for('update');
    if (!account || account.accountStatus !== 'active') {
      throw new AppError('NOT_FOUND', '账号不存在');
    }
    if (account.publicAuthorId) return account.publicAuthorId;
    const publicAuthorId = crypto.randomUUID();
    const [updated] = await tx.update(users)
      .set({ publicAuthorId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated?.publicAuthorId) throw new AppError('INTERNAL', '无法创建公开作者身份');
    return updated.publicAuthorId;
  });
}
