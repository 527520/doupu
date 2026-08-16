'use client';

/**
 * 全局页面错误边界（渲染异常时的友好提示）。
 * 覆盖 layout 之下的所有页面段；根布局错误由 global-error.tsx 兜底。
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[page-error]', error);
  }, [error]);

  const t = zhCN.errorPages;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream px-6 py-16 text-center">
      <p className="text-7xl font-semibold text-lilac/50" aria-hidden="true">
        !
      </p>
      <h1 className="text-2xl font-semibold tracking-wide text-ink">{t.errorTitle}</h1>
      <p className="max-w-md text-sm leading-6 text-ink-soft">{t.errorBody}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          {t.retry}
        </button>
        <Link href="/" className="btn-outline">
          {t.backHome}
        </Link>
      </div>
    </main>
  );
}
