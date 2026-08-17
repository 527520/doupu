import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { deleteAccountSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { verifyPassword } from '@/lib/auth/password';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { clearSessionCookie } from '@/lib/auth/cookies';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

/** 注销账号：需会话与密码；删除用户及其全部数据（级联），并清除会话 Cookie。 */
async function deleteAccount(request: Request): Promise<NextResponse> {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const userId = await getVerifiedSessionUserId();
  if (userId === null) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = deleteAccountSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const db = getDb();
  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (rows.length === 0 || !(await verifyPassword(rows[0].passwordHash, parsed.data.password))) {
    return apiError(new AppError('VALIDATION', zhCN.auth.currentPasswordWrong, 'password'));
  }

  await db.delete(users).where(eq(users.id, userId));
  return new NextResponse(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
}

export const DELETE = withApiErrors(deleteAccount);
