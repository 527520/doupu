import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_VISITOR_COOKIE,
  clearAnalyticsCookie,
  serializeConsentCookie,
  serializeVisitorCookie,
} from './cookies';

describe('analytics cookies', () => {
  it('keeps consent readable but makes the visitor token HttpOnly and always Secure', () => {
    const consent = serializeConsentCookie('granted');
    expect(consent).toContain(`${ANALYTICS_CONSENT_COOKIE}=granted`);
    expect(consent).toContain('Secure');
    expect(consent).toContain('SameSite=Lax');
    expect(consent).toContain('Max-Age=15552000');
    expect(consent).not.toContain('HttpOnly');

    const visitor = serializeVisitorCookie('random-token');
    expect(visitor).toContain(`${ANALYTICS_VISITOR_COOKIE}=random-token`);
    expect(visitor).toContain('HttpOnly');
    expect(visitor).toContain('Secure');
    expect(clearAnalyticsCookie(ANALYTICS_VISITOR_COOKIE)).toContain('Max-Age=0');
  });
});
