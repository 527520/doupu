import { describe, expect, it } from 'vitest';
import { authPageHref, isAdminReturnTo, safeAuthReturnTo } from './returnTo';

describe('safe auth return navigation', () => {
  it.each(['//evil.example', '/%2e%2e//evil.example', '/a/%2e%2e//evil.example', '/%2f%2fevil.example', '/\\evil.example', '/\nevil.example'])('rejects normalized external navigation %s', (value) => {
    expect(safeAuthReturnTo(value)).toBe('/designs');
    expect(authPageHref('register', value)).toBe('/register');
  });
  it('preserves a bounded local context including query and fragment', () => {
    expect(safeAuthReturnTo('/community/submit?designId=one#details')).toBe('/community/submit?designId=one#details');
    expect(authPageHref('forgot-password', '/community/submit')).toBe('/forgot-password?next=%2Fcommunity%2Fsubmit');
  });

  it.each(['/admin', '/admin/', '/admin/users?tab=roles#list', '/community/../admin'])('后台回跳 %s 不进入注册链接，登录与找回密码仍保留', (value) => {
    expect(isAdminReturnTo(value)).toBe(true);
    expect(authPageHref('register', value)).toBe('/register');
    for (const page of ['login', 'forgot-password'] as const) {
      expect(new URL(authPageHref(page, value), 'http://local').searchParams.get('next')).toBe(safeAuthReturnTo(value));
    }
  });

  it.each(['/administrator', '/admin-guide', '/community?next=/admin', '//evil.example/admin'])('不将非后台路径 %s 误认为后台', (value) => {
    expect(isAdminReturnTo(value)).toBe(false);
    const expected = safeAuthReturnTo(value);
    expect(new URL(authPageHref('register', value), 'http://local').searchParams.get('next')).toBe(expected === '/designs' ? null : expected);
  });
});
