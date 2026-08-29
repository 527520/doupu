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
      <body style={{ margin: 0, background: '#f8f7f4', color: '#302938', fontFamily: 'system-ui, sans-serif' }}>
        <main id="main" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section style={{ width: 'min(520px, 100%)', border: '1px solid #e7e2df', borderRadius: 24, background: '#fff', padding: 32, boxSizing: 'border-box', boxShadow: '0 24px 70px -45px #302938' }}>
            <div aria-hidden="true" style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: 16, background: '#f5e2e9', color: '#873253', fontSize: 30, fontWeight: 800 }}>!</div>
            <p style={{ margin: '24px 0 7px', color: '#a83f68', fontSize: 11, fontWeight: 800, letterSpacing: '.12em' }}>{t.studioName}</p>
            <h1 style={{ margin: 0, fontFamily: 'serif', fontSize: 32 }}>{t.errorTitle}</h1>
            <p style={{ margin: '12px 0 24px', color: '#6f6877', fontSize: 14, lineHeight: 1.7 }}>{t.errorBody}</p>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: 42, border: 0, borderRadius: 12, background: '#a83f68', padding: '0 20px', color: '#fff', fontSize: 14, fontWeight: 700 }}
          >
            {t.retry}
          </button>
          </section>
        </main>
      </body>
    </html>
  );
}
