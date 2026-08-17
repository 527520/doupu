import { AppError } from '@/lib/errors';
import { verifyEmailSchema } from '@/lib/schemas';
import { getDb } from '@/lib/auth/db';
import { hashToken } from '@/lib/auth/tokens';
import { verifyEmailWithToken } from '@/lib/auth/transitions';
import { checkRateLimit, clientIp, rateLimitKey } from '@/lib/auth/rateLimit';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { zhCN } from '@/messages/zh-CN';
import { config } from '@/lib/config';

/** 令牌端点限流（票 02 配置化：环境变量 RATE_TOKEN）；令牌 256-bit 不可爆破，仅防滥用。 */
const RATE_LIMIT = config.security.tokenRateLimit;

async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;

  const ip = clientIp(request);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = verifyEmailSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const db = getDb();
  if (!(await checkRateLimit(db, rateLimitKey('verify', ip), RATE_LIMIT))) {
    return apiError(new AppError('RATE_LIMITED', zhCN.auth.tooManyRequests));
  }
  const verified = await verifyEmailWithToken(db, {
    tokenHash: hashToken(parsed.data.token),
    now: new Date(),
  });
  if (!verified) {
    return apiError(new AppError('VALIDATION', zhCN.auth.linkInvalid));
  }

  return okJson({ ok: true });
}

export const POST = withApiErrors(post);
