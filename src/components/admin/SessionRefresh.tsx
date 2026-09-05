'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** RSC 只读 Cookie；滚动续期必须经可写 Set-Cookie 的 HTTP 响应完成。 */
export default function SessionRefresh() {
  const pathname = usePathname();
  useEffect(() => {
    const refresh = () => { void fetch('/api/auth/me', { cache: 'no-store' }).catch(() => undefined); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [pathname]);
  return null;
}
