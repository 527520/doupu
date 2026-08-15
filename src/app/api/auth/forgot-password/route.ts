import { and, eq, isNull, sql } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { forgotPasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { checkMailSendLimits } from '@/lib/auth/mailLimits';
import { buildResetLink, DEV_MAIL_LINK_HEADER, isDevMailMode, isMailCircuitOpen, sendMail } from '@/lib/auth/mailer';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 小时
const RATE_LIMIT = 10;

/** 忘记密码：防枚举（spec E30/E33）——恒返回 204；仅格式非法返回 400。 */
export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = forgotPasswordSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { email } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('forgot', ip, email), RATE_LIMIT))) {
    // 限流也保持防枚举：仍返回 204（不泄露账号状态）
    return noContent();
  }

  // 熔断器打开时：统一 503（对幽灵与真实邮箱一致，无枚举面）
  if (isMailCircuitOpen()) {
    return apiError(new AppError('MAIL_UNAVAILABLE', zhCN.auth.mailSendFailed));
  }

  // 发信成本防护：每邮箱日限（默认 3）命中 → 静默 204——分布式轰炸受害者邮箱无效
  const mailLimit = await checkMailSendLimits(db, { email, ip, emailLimit: 3 });
  if (mailLimit === 'emailLimited') {
    console.warn('[mail] forgot skipped (email daily limit)');
    return noContent();
  }
  if (mailLimit !== 'ok') {
    // IP/全局限：统一 429（与具体邮箱无关，无枚举面）
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));
  let devLink: string | null = null;
  if (rows.length === 1) {
    // 旧的重置令牌作废：同一时刻只保留一个有效重置链接
    await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.userId, rows[0].id), eq(emailTokens.purpose, 'reset'), isNull(emailTokens.usedAt)));
    const token = generateToken();
    await db.insert(emailTokens).values({
      userId: rows[0].id,
      purpose: 'reset',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    const link = buildResetLink(token);
    try {
      await sendMail(email, zhCN.auth.resetSubject, zhCN.auth.resetHtml(link), zhCN.auth.resetText(link));
    } catch {
      // 发送失败：保持 204（防枚举；熔断器已打开，后续请求统一 503）
      console.error('[mail] forgot send failed');
      devLink = null;
      return noContent();
    }
    // 开发邮件模式：链接随响应头返回，前端直接展示（正式环境绝不下发）
    devLink = isDevMailMode() ? link : null;
  } else if (!isDevMailMode()) {
    // 幽灵账号：补一个与 SMTP 往返同量级的固定延迟，抹平时序枚举（防枚举 E30/E33）
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const headers = devLink ? { [DEV_MAIL_LINK_HEADER]: devLink } : undefined;
  return noContent(204, headers ? { headers } : undefined);
}
