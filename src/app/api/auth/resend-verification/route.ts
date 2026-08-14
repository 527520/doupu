import { eq, sql } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { resendVerificationSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { buildVerifyLink, sendMail } from '@/lib/auth/mailer';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, readJson } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT = 10;

/**
 * 重发验证邮件：防枚举（spec §F9）——无论邮箱是否存在/是否已验证，恒返回 204。
 * 仅「邮箱格式不合法」返回 400（不含存在性信息）。
 */
export async function POST(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = resendVerificationSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const { email } = parsed.data;

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('resend', ip, email), RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }

  const rows = await db
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));

  if (rows.length === 1 && rows[0].emailVerifiedAt === null) {
    const token = generateToken();
    await db.insert(emailTokens).values({
      userId: rows[0].id,
      purpose: 'verify',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    });
    const link = buildVerifyLink(token);
    await sendMail(email, zhCN.auth.verifySubject, zhCN.auth.verifyHtml(link), zhCN.auth.verifyText(link));
  }

  return noContent();
}
