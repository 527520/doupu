import { eq, sql } from 'drizzle-orm';
import { users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { forgotPasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { deliverResetEmailToken } from '@/lib/auth/transitions';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { reserveMailSendLimits } from '@/lib/auth/mailLimits';
import { buildResetLink, DEV_MAIL_LINK_HEADER, isDevMailMode, isMailCircuitOpen, sendMail } from '@/lib/auth/mailer';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 小时
const RATE_LIMIT = 10;
const IP_RATE_LIMIT = 30;

/** 忘记密码：防枚举（spec E30/E33）——恒返回 204；仅格式非法返回 400。 */
async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = forgotPasswordSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { email } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('forgot-ip', ip), IP_RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }
  if (!(await checkRateLimit(db, rateLimitKey('forgot', ip, email), RATE_LIMIT))) {
    // 限流也保持防枚举：仍返回 204（不泄露账号状态）
    return noContent();
  }

  // 熔断器打开时：统一 503（对幽灵与真实邮箱一致，无枚举面）
  if (isMailCircuitOpen()) {
    return apiError(new AppError('MAIL_UNAVAILABLE', zhCN.auth.mailSendFailed));
  }

  // 发信成本防护：每邮箱日限（默认 3）命中 → 静默 204——分布式轰炸受害者邮箱无效
  const mailReservation = await reserveMailSendLimits(db, { email, ip, emailLimit: 3 });
  const mailLimit = mailReservation.result;
  if (mailLimit === 'emailLimited') {
    console.warn('[mail] forgot skipped (email daily limit)');
    return noContent();
  }
  if (mailLimit !== 'ok') {
    // IP/全局限：统一 429（与具体邮箱无关，无枚举面）
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  let mailSent = false;
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email));
    let devLink: string | null = null;
    if (rows.length === 1) {
      const token = generateToken();
      const now = new Date();
      const link = buildResetLink(token);
      try {
        await deliverResetEmailToken(
          db,
          {
            userId: rows[0].id,
            tokenHash: hashToken(token),
            expiresAt: new Date(now.getTime() + RESET_TTL_MS),
            now,
          },
          async () => {
            await sendMail(
              email,
              zhCN.auth.resetSubject,
              zhCN.auth.resetHtml(link),
              zhCN.auth.resetText(link),
              { sesTemplate: { templateId: process.env.SES_RESET_TEMPLATE_ID ?? '', templateData: { token } } },
            );
            mailSent = true;
          },
        );
      } catch {
        // 发送失败：保持 204（防枚举；熔断器已打开，后续请求统一 503）
        console.error('[mail] forgot send failed');
        return noContent();
      }
      // 开发邮件模式：链接随响应头返回，前端直接展示（正式环境绝不下发）
      devLink = isDevMailMode() ? link : null;
    } else if (!isDevMailMode()) {
      // 幽灵账号：补一个与真实发信（SES 模板 API 往返）同量级的固定延迟，抹平时序枚举（防枚举 E30/E33）
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const headers = devLink ? { [DEV_MAIL_LINK_HEADER]: devLink } : undefined;
    return noContent(204, headers ? { headers } : undefined);
  } finally {
    if (!mailSent) await mailReservation.release();
  }
}

export const POST = withApiErrors(post);
