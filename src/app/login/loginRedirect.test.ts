// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loginRedirectTarget } from './loginRedirect';

/** 设置 window.location.search（jsdom 允许 history.replaceState）。 */
function setSearch(query: string): void {
  window.history.replaceState({}, '', query);
}

afterEach(() => {
  window.history.replaceState({}, '', '/login');
});

describe('loginRedirectTarget（?next= 回跳与开放重定向防护）', () => {
  it.each(['/\nevil.test', '/%2f%2fevil.test', '/%5cevil.test', '/%2e%2e//evil.example', '/a/%2e%2e//evil.example', '/' + 'a'.repeat(2200)])('拒绝控制字符、编码分隔符或过长路径 %s', (value) => {
    setSearch(`/login?next=${encodeURIComponent(value)}`);
    expect(loginRedirectTarget()).toBe('/designs');
  });

  it('无 next 参数：默认跳我的设计', () => {
    setSearch('/login');
    expect(loginRedirectTarget()).toBe('/designs');
  });

  it('合法站内路径：原样返回', () => {
    setSearch('/login?next=/palettes');
    expect(loginRedirectTarget()).toBe('/palettes');
  });

  it('拒绝协议外链', () => {
    setSearch('/login?next=https://evil.example.com');
    expect(loginRedirectTarget()).toBe('/designs');
  });

  it('拒绝协议相对 // 外链', () => {
    setSearch('/login?next=//evil.example.com');
    expect(loginRedirectTarget()).toBe('/designs');
  });

  it('拒绝反斜杠变体与仅斜杠', () => {
    setSearch('/login?next=/\\evil.example.com');
    expect(loginRedirectTarget()).toBe('/designs');
    setSearch('/login?next=/');
    expect(loginRedirectTarget()).toBe('/designs');
  });

  it('多参数场景：只取 next', () => {
    setSearch('/login?foo=1&next=/app&bar=2');
    expect(loginRedirectTarget()).toBe('/app');
  });
});
