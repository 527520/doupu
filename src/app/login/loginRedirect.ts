/**
 * 登录后跳转目标（?next= 参数）。
 * 只允许站内绝对路径（以单个 / 开头、不含反斜杠），拒绝 //、协议外链与 \ 变体，防开放重定向。
 */
import { safeAuthReturnTo } from '@/lib/auth/returnTo';

export function loginRedirectTarget(): string {
  if (typeof window === 'undefined') return '/designs';
  const next = new URLSearchParams(window.location.search).get('next');
  return safeAuthReturnTo(next);
}
