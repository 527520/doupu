'use client';

/**
 * 根布局错误边界（连布局都渲染失败时的兜底，必须自带 html/body）。
 */
import { useEffect } from 'react';
import { zhCN } from '@/messages/zh-CN';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  const t = zhCN.errorPages;
  return (
    <html lang="zh-CN">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
          <p className="text-7xl font-bold text-gray-200" aria-hidden="true">
            !
          </p>
          <h1 className="text-2xl font-semibold">{t.errorTitle}</h1>
          <p className="max-w-md text-sm leading-6 text-gray-500">{t.errorBody}</p>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
