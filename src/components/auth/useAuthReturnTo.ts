'use client';

import { useEffect, useState } from 'react';
import { safeAuthReturnTo } from '@/lib/auth/returnTo';

/** SSR 与首次水合保持一致；空初值可让入口等待安全回跳解析后再展示。 */
export function useAuthReturnTo(initialTarget: '/designs' | '' = '/designs'): string {
  const [target, setTarget] = useState<string>(initialTarget);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setTarget(safeAuthReturnTo(new URLSearchParams(window.location.search).get('next'))); });
    return () => { active = false; };
  }, []);
  return target;
}
