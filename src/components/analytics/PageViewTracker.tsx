'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/analytics/client';

export type AnalyticsSurface = 'home' | 'workbench' | 'designs' | 'palettes' | 'share' | 'community' | 'account' | 'admin';

export function surfaceForPath(path: string): AnalyticsSurface {
  if (path === '/') return 'home';
  if (path.startsWith('/app')) return 'workbench';
  if (path.startsWith('/designs')) return 'designs';
  if (path.startsWith('/palettes')) return 'palettes';
  if (path.startsWith('/s/')) return 'share';
  if (path.startsWith('/community')) return 'community';
  if (path.startsWith('/admin')) return 'admin';
  return 'account';
}

export default function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    track({ name: 'page_viewed', properties: { surface: surfaceForPath(pathname) } });
  }, [pathname]);
  return null;
}
