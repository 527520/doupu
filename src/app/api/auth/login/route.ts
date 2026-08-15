import { eq, sql } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { loginSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { serializeSessionCookie } from '@/lib/auth/cookies';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, okJson, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const RATE_LIMIT = 10;

/** 时序对齐用假哈希（懒加载，进程内缓存）：未知邮箱也执行一次 argon2 校验，抹平枚举时序。 */
let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('doupu-timing-equalizer');
  return dummyHashPromise;
}

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

  // 用户不存在与密码错误使用同一文案（防枚举，spec E28/E31）；
  // 未知邮箱也执行一次假哈希校验，抹平「已注册 + 错密码」与「未注册」的 argon2 时序差。
  if (rows.length === 0) {
    await verifyPassword(await dummyPasswordHash(), password);
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.invalidCredentials));
  }
  if (!(await verifyPassword(rows[0].passwordHash, password))) {
    return apiError(new AppError('UNAUTHORIZED', zhCN.auth.invalidCredentials));
  }

  const user = rows[0];
  const session = await createSession(db, user.id);
  return okJson(
    { email: user.email, emailVerified: user.emailVerifiedAt !== null },
    { headers: { 'Set-Cookie': serializeSessionCookie(session.token) } },
  );
}
