import { eq, sql } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { registerSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { reserveMailSendLimits } from '@/lib/auth/mailLimits';
import { buildVerifyLink, DEV_MAIL_LINK_HEADER, isDevMailMode, sendMail } from '@/lib/auth/mailer';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';
import { config } from '@/lib/config';
import { createUnverifiedUser } from '@/lib/auth/transitions';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** 注册限流阈值（票 02 配置化：环境变量 RATE_REGISTER）。 */
const RATE_LIMIT = config.security.registerRateLimit;
/** 独立每 IP 上限（安全自查 M2）：防批量注册。 */
const IP_RATE_LIMIT = Math.max(20, RATE_LIMIT * 3);

async function post(request: Request) {
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
  if (!(await checkRateLimit(db, rateLimitKey('register-ip', ip), IP_RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  // 发信成本防护：配额耗尽时先于建号拒绝（IP/全局限 → 统一 429）
  const mailReservation = await reserveMailSendLimits(db, { email, ip });
  if (mailReservation.result !== 'ok') {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  let mailSent = false;
  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email));
    if (existing.length > 0) {
      return apiError(new AppError('CONFLICT', zhCN.auth.emailTaken, 'email'));
    }

    const passwordHash = await hashPassword(password);
    const token = generateToken();
    try {
      await createUnverifiedUser(db, {
        email,
        passwordHash,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      });
    } catch (error) {
      // 并发同邮箱注册命中唯一索引：与预检查重同文案（防枚举）
      if (isUniqueViolation(error)) {
        return apiError(new AppError('CONFLICT', zhCN.auth.emailTaken, 'email'));
      }
      throw error;
    }

    const link = buildVerifyLink(token);
    try {
      await sendMail(
        email,
        zhCN.auth.verifySubject,
        zhCN.auth.verifyHtml(link),
        zhCN.auth.verifyText(link),
        { sesTemplate: { templateId: process.env.SES_VERIFY_TEMPLATE_ID ?? '', templateData: { token } } },
      );
      mailSent = true;
    } catch {
      // 账号已创建、验证邮件发送失败：返回 503，用户可稍后经「重发验证邮件」恢复。
      return apiError(new AppError('MAIL_UNAVAILABLE', zhCN.auth.mailSendFailed));
    }
    const headers = isDevMailMode() ? { [DEV_MAIL_LINK_HEADER]: link } : undefined;
    return noContent(204, headers ? { headers } : undefined);
  } finally {
    if (!mailSent) await mailReservation.release();
  }
}

export const POST = withApiErrors(post);

/** Postgres 唯一约束冲突（23505）；PGlite 以 cause/code 形式透传。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}
