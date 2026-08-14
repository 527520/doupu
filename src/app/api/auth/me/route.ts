import { eq } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { getDb } from '@/lib/auth/db';
import { getSessionUserId } from '@/lib/auth/session';
import { apiError, okJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

/** 当前用户信息；未登录 401；未验证邮箱 403 EMAIL_UNVERIFIED 语义（spec E29）。 */
export async function GET() {
  const userId = await getSessionUserId();
  if (userId === null) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.loginRequired));
  }
  const rows = await getDb()
    .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt })
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
    emailVerified: true,
    createdAt: user.createdAt.toISOString(),
  });
}
