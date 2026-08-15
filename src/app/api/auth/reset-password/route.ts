import { and, eq, gt, isNull } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { resetPasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { deleteAllUserSessions } from '@/lib/auth/session';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const RATE_LIMIT = 60; // 令牌 256-bit 不可爆破，此限流仅防滥用/轻量 DoS

/** 重置密码：令牌一次性；成功后旧会话全部失效（spec E32）。 */
export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = resetPasswordSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { token, password } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('reset', ip), RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }
  const now = new Date();
  // 原子消费：条件更新（usedAt IS NULL 且未过期），并发双 POST 只有一次生效（安全审查 P2）
  const consumed = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, 'reset'),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, now),
      ),
    )
    .returning();

  // 过期/重用/伪造统一文案（spec E30）
  if (consumed.length === 0) {
    return apiError(new AppError('VALIDATION', zhCN.auth.linkInvalid));
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, consumed[0].userId));
  await deleteAllUserSessions(db, consumed[0].userId);

  return noContent();
}
