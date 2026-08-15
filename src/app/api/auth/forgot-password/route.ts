import { eq, sql } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { forgotPasswordSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { buildResetLink, DEV_MAIL_LINK_HEADER, isDevMailMode, sendMail } from '@/lib/auth/mailer';
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

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));
  let devLink: string | null = null;
  if (rows.length === 1) {
    const token = generateToken();
    await db.insert(emailTokens).values({
      userId: rows[0].id,
      purpose: 'reset',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    const link = buildResetLink(token);
    await sendMail(email, zhCN.auth.resetSubject, zhCN.auth.resetHtml(link), zhCN.auth.resetText(link));
    // 开发邮件模式：链接随响应头返回，前端直接展示（正式环境绝不下发）
    devLink = isDevMailMode() ? link : null;
  }

  const headers = devLink ? { [DEV_MAIL_LINK_HEADER]: devLink } : undefined;
  return noContent(204, headers ? { headers } : undefined);
}
