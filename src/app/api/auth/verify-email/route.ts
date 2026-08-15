import { and, eq, gt, isNull } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { verifyEmailSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashToken } from '@/lib/auth/tokens';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, okJson, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = verifyEmailSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const db = getDb();
  const now = new Date();
  // 原子消费：条件更新（usedAt IS NULL 且未过期），并发双 POST 只有一次生效（安全审查 P2）
  const consumed = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(parsed.data.token)),
        eq(emailTokens.purpose, 'verify'),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, now),
      ),
    )
    .returning();

  // 过期/重用/伪造统一文案（spec 边界 E30）
  if (consumed.length === 0) {
    return apiError(new AppError('VALIDATION', zhCN.auth.linkInvalid));
  }

  await db
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(users.id, consumed[0].userId));

  return okJson({ ok: true });
}
