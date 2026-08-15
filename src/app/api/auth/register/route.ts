import { eq, sql } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { registerSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { checkMailSendLimits } from '@/lib/auth/mailLimits';
import { buildVerifyLink, DEV_MAIL_LINK_HEADER, isDevMailMode, sendMail } from '@/lib/auth/mailer';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT = 10;

export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = registerSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { email, password } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('register', ip, email), RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  // 发信成本防护：配额耗尽时先于建号拒绝（IP/全局限 → 统一 429）
  const mailLimit = await checkMailSendLimits(db, { email, ip });
  if (mailLimit !== 'ok') {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));
  if (existing.length > 0) {
    return apiError(new AppError('CONFLICT', zhCN.auth.emailTaken, 'email'));
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    [user] = await db.insert(users).values({ email, passwordHash }).returning();
  } catch (error) {
    // 并发同邮箱注册命中唯一索引：与预检查重同文案（防枚举）
    if (isUniqueViolation(error)) {
      return apiError(new AppError('CONFLICT', zhCN.auth.emailTaken, 'email'));
    }
    throw error;
  }

  const token = generateToken();
  await db.insert(emailTokens).values({
    userId: user.id,
    purpose: 'verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });

  const link = buildVerifyLink(token);
  try {
    await sendMail(
      email,
      zhCN.auth.verifySubject,
      zhCN.auth.verifyHtml(link),
      zhCN.auth.verifyText(link),
      { sesTemplate: { templateId: process.env.SES_VERIFY_TEMPLATE_ID ?? '', templateData: { link } } },
    );
  } catch {
    // 账号已创建、验证邮件发送失败：返回 503，用户可稍后经「重发验证邮件」恢复；
    // 熔断器已在 mailer 内打开（60 秒内发信请求统一快速失败，不烧配额）。
    return apiError(new AppError('MAIL_UNAVAILABLE', zhCN.auth.mailSendFailed));
  }
  // 开发邮件模式：链接随响应头返回，前端直接展示（正式环境绝不下发）
  const headers = isDevMailMode() ? { [DEV_MAIL_LINK_HEADER]: link } : undefined;
  return noContent(204, headers ? { headers } : undefined);
}

/** Postgres 唯一约束冲突（23505）；PGlite 以 cause/code 形式透传。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}
