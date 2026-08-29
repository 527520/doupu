'use client';

/**
 * 全局页面错误边界（渲染异常时的友好提示）。
 * 覆盖 layout 之下的所有页面段；根布局错误由 global-error.tsx 兜底。
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import StateShell from '@/components/system/StateShell';

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
    <StateShell mark="!" eyebrow={t.errorEyebrow} title={t.errorTitle} body={t.errorBody}>
        <button type="button" onClick={reset} className="btn-primary">
          {t.retry}
        </button>
        <Link href="/" className="btn-outline">
          {t.backHome}
        </Link>
    </StateShell>
  );
}
