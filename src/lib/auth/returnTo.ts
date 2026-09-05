/** Bounded same-origin navigation only; authentication never replays a mutation. */
export function safeAuthReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !/^\/[^/]/u.test(value) || /[\\\u0000-\u001f\u007f]/u.test(value)) return '/designs';
  try {
    const url = new URL(value, 'https://doupu.invalid');
    if (url.origin !== 'https://doupu.invalid' || /%(?:2f|5c|0[0-9a-f]|7f|25)/iu.test(url.pathname)) return '/designs';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/designs'; }
}

export function authPageHref(page: 'login' | 'register' | 'forgot-password', next: string): string {
  const target = safeAuthReturnTo(next);
  return `/${page}${target === '/designs' ? '' : `?${new URLSearchParams({ next: target })}`}`;
}
