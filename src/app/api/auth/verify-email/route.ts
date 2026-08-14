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
  const rows = await db
    .select({ id: emailTokens.id, userId: emailTokens.userId })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(parsed.data.token)),
        eq(emailTokens.purpose, 'verify'),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, now),
      ),
    );

  // 过期/重用/伪造统一文案（spec 边界 E30）
  if (rows.length === 0) {
    return apiError(new AppError('VALIDATION', zhCN.auth.linkInvalid));
  }

  await db.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, rows[0].id));
  await db
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(users.id, rows[0].userId));

  return okJson({ ok: true });
}
