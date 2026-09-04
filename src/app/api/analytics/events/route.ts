import { NextResponse } from 'next/server';
import { getDb } from '@/lib/auth/db';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, readJson, withApiErrors } from '@/lib/auth/http';
import { checkRateLimit, clientIp } from '@/lib/auth/rateLimit';
import { resolveSession } from '@/lib/auth/session';
import { analyticsBatchSchema } from '@/lib/analytics/events';
import { readAnalyticsConsent, readAnalyticsVisitorToken } from '@/lib/analytics/cookies';
import { ingestAnalyticsEvents } from '@/lib/analytics/ingest';
import { analyticsIpRateKey } from '@/lib/analytics/security';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
const MAX_BATCH_BYTES = 64 * 1024;

async function post(request: Request): Promise<NextResponse> {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const cookieHeader = request.headers.get('cookie');
  const consent = readAnalyticsConsent(cookieHeader);
  const visitorToken = readAnalyticsVisitorToken(cookieHeader);
  if (consent !== 'granted' || !visitorToken) {
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  const db = getDb();
  const allowed = await checkRateLimit(
    db,
    analyticsIpRateKey(clientIp(request)),
    config.security.analyticsRateLimit,
  );
  if (!allowed) return NextResponse.json({ accepted: 0 }, { status: 202 });

  const body = await readJson(request, MAX_BATCH_BYTES);
  if (!body.ok) return body.response;
  const parsed = analyticsBatchSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);
  const session = await resolveSession(db, cookieHeader);
  const accepted = await ingestAnalyticsEvents(db, visitorToken, parsed.data.events, {
    userAgent: request.headers.get('user-agent'),
    actor: session ? {
      userId: session.userId,
      role: session.role,
      accountStatus: session.accountStatus,
      emailVerified: session.emailVerified,
    } : null,
    isInternal: false,
  });
  return NextResponse.json({ accepted }, { status: 202 });
}

export const POST = withApiErrors(post);
