'use client';

import { useEffect, useState } from 'react';
import { safeAuthReturnTo } from '@/lib/auth/returnTo';

/** SSR and first hydration render agree; resolve the browser context afterwards. */
export function useAuthReturnTo(): string {
  const [target, setTarget] = useState('/designs');
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setTarget(safeAuthReturnTo(new URLSearchParams(window.location.search).get('next'))); });
    return () => { active = false; };
  }, []);
  return target;
}
