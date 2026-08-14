import { eq, sql } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { loginSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { serializeSessionCookie } from '@/lib/auth/cookies';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, okJson, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const RATE_LIMIT = 10;

export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = loginSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { email, password } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('login', ip, email), RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  const rows = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));

  // 用户不存在与密码错误使用同一文案（防枚举，spec E28/E31）
  if (rows.length === 0 || !(await verifyPassword(rows[0].passwordHash, password))) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.invalidCredentials));
  }

  const user = rows[0];
  const session = await createSession(db, user.id);
  return okJson(
    { email: user.email, emailVerified: user.emailVerifiedAt !== null },
    { headers: { 'Set-Cookie': serializeSessionCookie(session.token) } },
  );
}
