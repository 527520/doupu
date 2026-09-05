import { describe, expect, it } from 'vitest';
import { authPageHref, safeAuthReturnTo } from './returnTo';

describe('safe auth return navigation', () => {
  it.each(['//evil.example', '/%2e%2e//evil.example', '/a/%2e%2e//evil.example', '/%2f%2fevil.example', '/\\evil.example', '/\nevil.example'])('rejects normalized external navigation %s', (value) => {
    expect(safeAuthReturnTo(value)).toBe('/designs');
    expect(authPageHref('register', value)).toBe('/register');
  });
  it('preserves a bounded local context including query and fragment', () => {
    expect(safeAuthReturnTo('/community/submit?designId=one#details')).toBe('/community/submit?designId=one#details');
    expect(authPageHref('forgot-password', '/community/submit')).toBe('/forgot-password?next=%2Fcommunity%2Fsubmit');
  });
});
