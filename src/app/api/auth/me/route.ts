import { eq } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { getDb } from '@/lib/auth/db';
import { getSessionUserId } from '@/lib/auth/session';
import { apiError, okJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

/** 当前用户信息；未登录 401；未验证邮箱 403 EMAIL_UNVERIFIED 语义（spec E29）。 */
async function get(_request: Request) {
  const userId = await getSessionUserId();
  if (userId === null) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }
  const rows = await getDb()
    .select({
      email: users.email,
      username: users.username,
      emailVerifiedAt: users.emailVerifiedAt,
      publicAuthorId: users.publicAuthorId,
      role: users.role,
      accountStatus: users.accountStatus,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (rows.length === 0) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }
  const user = rows[0];
  if (user.emailVerifiedAt === null) {
    return apiError(new AppError('FORBIDDEN', zhCN.auth.emailUnverified, 'email'));
  }
  return okJson({
    email: user.email,
    username: user.username,
    publicAuthorId: user.publicAuthorId,
    role: user.role,
    accountStatus: user.accountStatus,
    emailVerified: true,
    createdAt: user.createdAt.toISOString(),
  });
}

export const GET = withApiErrors(get);
