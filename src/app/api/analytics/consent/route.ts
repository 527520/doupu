import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, readJson, withApiErrors } from '@/lib/auth/http';
import {
  ANALYTICS_VISITOR_COOKIE,
  clearAnalyticsCookie,
  readAnalyticsVisitorToken,
  serializeConsentCookie,
  serializeVisitorCookie,
} from '@/lib/analytics/cookies';
import { eraseAnalyticsVisitor, grantAnalyticsConsent } from '@/lib/analytics/consent';

const consentSchema = z.object({ status: z.enum(['granted', 'denied', 'withdrawn']) }).strict();

async function put(request: Request): Promise<NextResponse> {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const parsed = consentSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const cookieHeader = request.headers.get('cookie');
  const existingToken = readAnalyticsVisitorToken(cookieHeader);
  const response = NextResponse.json({ status: parsed.data.status === 'granted' ? 'granted' : 'denied' });
  if (parsed.data.status === 'granted') {
    const token = await grantAnalyticsConsent(getDb(), existingToken);
    response.headers.append('Set-Cookie', serializeConsentCookie('granted'));
    response.headers.append('Set-Cookie', serializeVisitorCookie(token));
    return response;
  }

  if (existingToken) await eraseAnalyticsVisitor(getDb(), existingToken);
  response.headers.append('Set-Cookie', serializeConsentCookie('denied'));
  response.headers.append('Set-Cookie', clearAnalyticsCookie(ANALYTICS_VISITOR_COOKIE));
  if (parsed.data.status === 'withdrawn') {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
}

export const PUT = withApiErrors(put);
