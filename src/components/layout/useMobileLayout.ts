'use client';

import { useEffect, useState } from 'react';

/** 仅挂载当前工作台布局，避免桌面/移动两套画布同时占用内存并重复暴露给读屏。 */
export function useMobileLayout(query = '(max-width: 720px)'): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = (): void => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return mobile;
}
