import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { deleteAccountSchema, updateProfileSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { verifyPassword } from '@/lib/auth/password';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { clearSessionCookie } from '@/lib/auth/cookies';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';
import { anonymizeAccount } from '@/lib/auth/accountLifecycle';

/** 注销账号：需会话与密码；匿名化身份并删除私人数据，公开事实留存。 */
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
  if (rows.length === 0 || rows[0].passwordHash === null || !(await verifyPassword(rows[0].passwordHash, parsed.data.password))) {
    return apiError(new AppError('VALIDATION', zhCN.auth.currentPasswordWrong, 'password'));
  }

  await anonymizeAccount(db, {
    userId,
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
  });
  return new NextResponse(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
}

export const DELETE = withApiErrors(deleteAccount);

/** 展示资料：用户名可修改或清空；邮箱仍是唯一登录身份。 */
async function updateProfile(request: Request): Promise<NextResponse> {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const userId = await getVerifiedSessionUserId();
  if (userId === null) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = updateProfileSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  await getDb()
    .update(users)
    .set({ username: parsed.data.username || null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return new NextResponse(null, { status: 204 });
}

export const PATCH = withApiErrors(updateProfile);
