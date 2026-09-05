import { parseCookieHeader } from '@/lib/auth/cookies';

export const ANALYTICS_CONSENT_COOKIE = 'doupu_analytics_consent';
export const ANALYTICS_VISITOR_COOKIE = 'doupu_visitor';
export const ANALYTICS_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export type AnalyticsConsent = 'granted' | 'denied';

const BASE = 'Path=/; Secure; SameSite=Lax';

export function serializeConsentCookie(value: AnalyticsConsent): string {
  return `${ANALYTICS_CONSENT_COOKIE}=${value}; ${BASE}; Max-Age=${ANALYTICS_COOKIE_MAX_AGE_SECONDS}`;
}

// A withdrawal intent is NOT valid server consent or confirmed server erasure.
// Keep it across reloads so a failed deletion can be retried without collecting.
export function serializePendingWithdrawalCookie(): string {
  return `${ANALYTICS_CONSENT_COOKIE}=withdrawn; ${BASE}; Max-Age=${ANALYTICS_COOKIE_MAX_AGE_SECONDS}`;
}

export function serializeVisitorCookie(token: string): string {
  return `${ANALYTICS_VISITOR_COOKIE}=${token}; ${BASE}; HttpOnly; Max-Age=${ANALYTICS_COOKIE_MAX_AGE_SECONDS}`;
}

export function clearAnalyticsCookie(name: typeof ANALYTICS_CONSENT_COOKIE | typeof ANALYTICS_VISITOR_COOKIE): string {
  const httpOnly = name === ANALYTICS_VISITOR_COOKIE ? '; HttpOnly' : '';
  return `${name}=; ${BASE}${httpOnly}; Max-Age=0`;
}

export function readAnalyticsConsent(cookieHeader: string | null): AnalyticsConsent | null {
  const value = parseCookieHeader(cookieHeader).get(ANALYTICS_CONSENT_COOKIE);
  return value === 'granted' || value === 'denied' ? value : null;
}

export function readAnalyticsVisitorToken(cookieHeader: string | null): string | null {
  const value = parseCookieHeader(cookieHeader).get(ANALYTICS_VISITOR_COOKIE) ?? '';
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}
