import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { changePasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/tokens';
import { changePasswordAndRevokeSessions } from '@/lib/auth/transitions';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

/** 修改密码：需会话与当前密码。 */
async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const userId = await getVerifiedSessionUserId();
  if (userId === null) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = changePasswordSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const db = getDb();
  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (rows.length === 0 || !(await verifyPassword(rows[0].passwordHash, currentPassword))) {
    return apiError(new AppError('VALIDATION', zhCN.auth.currentPasswordWrong, 'currentPassword'));
  }

  const jar = await cookies();
  const currentToken = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  const changed = await changePasswordAndRevokeSessions(db, {
    userId,
    expectedPasswordHash: rows[0].passwordHash,
    passwordHash: await hashPassword(newPassword),
    keepTokenHash: currentToken ? hashToken(currentToken) : null,
    now: new Date(),
  });
  if (!changed) {
    return apiError(new AppError('CONFLICT', '密码已发生变化，请重试'));
  }

  return noContent();
}

export const POST = withApiErrors(post);
