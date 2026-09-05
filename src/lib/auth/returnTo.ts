/** Bounded same-origin navigation only; authentication never replays a mutation. */
export function safeAuthReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !/^\/[^/]/u.test(value) || /[\\\u0000-\u001f\u007f]/u.test(value)) return '/designs';
  try {
    const url = new URL(value, 'https://doupu.invalid');
    if (url.origin !== 'https://doupu.invalid' || !/^\/[^/]/u.test(url.pathname) || /%(?:2f|5c|0[0-9a-f]|7f|25)/iu.test(url.pathname)) return '/designs';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/designs'; }
}

/** 后台入口只按安全归一化后的路径判断，不匹配 /administrator 等相似前缀。 */
export function isAdminReturnTo(value: string): boolean {
  const pathname = safeAuthReturnTo(value).split(/[?#]/u)[0];
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function authPageHref(page: 'login' | 'register' | 'forgot-password', next: string): string {
  const target = safeAuthReturnTo(next);
  if (page === 'register' && isAdminReturnTo(target)) return '/register';
  return `/${page}${target === '/designs' ? '' : `?${new URLSearchParams({ next: target })}`}`;
}
