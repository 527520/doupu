import { eq, sql } from 'drizzle-orm';
import { emailTokens, users } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { registerSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { buildVerifyLink, sendMail } from '@/lib/auth/mailer';
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

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));
  if (existing.length > 0) {
    return apiError(new AppError('CONFLICT', zhCN.auth.emailTaken, 'email'));
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash }).returning();

  const token = generateToken();
  await db.insert(emailTokens).values({
    userId: user.id,
    purpose: 'verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });

  const link = buildVerifyLink(token);
  await sendMail(email, zhCN.auth.verifySubject, zhCN.auth.verifyHtml(link), zhCN.auth.verifyText(link));
  return noContent();
}
