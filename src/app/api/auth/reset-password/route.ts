import { and, eq, gt, isNull } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { resetPasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { deleteAllUserSessions } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

/** 重置密码：令牌一次性；成功后旧会话全部失效（spec E32）。 */
export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = resetPasswordSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { token, password } = parsed.data;

  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ id: emailTokens.id, userId: emailTokens.userId })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, 'reset'),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, now),
      ),
    );

  // 过期/重用/伪造统一文案（spec E30）
  if (rows.length === 0) {
    return apiError(new AppError('VALIDATION', zhCN.auth.linkInvalid));
  }

  const passwordHash = await hashPassword(password);
  await db.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, rows[0].id));
  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, rows[0].userId));
  await deleteAllUserSessions(db, rows[0].userId);

  return noContent();
}
