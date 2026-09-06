'use client';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

/**
 * 审核 / 治理台里的原图并排预览（D49）。
 * 请求经服务端代理并按会话鉴权，图片响应不缓存；取不到时显式说明，而不是留一张断图。
 */
export default function OriginalPreview({ revisionId, title }: { revisionId: string; title: string }) {
  const t = zhCN.communityAdmin.original;
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  return (
    <figure className="admin-original-preview" data-status={status}>
      <figcaption>{t.title}</figcaption>
      {status !== 'missing' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={revisionId}
          src={`/api/community/revisions/${revisionId}/original`}
          alt={t.alt(title)}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('missing')}
        />
      ) : <p>{t.missing}</p>}
      {status === 'loading' && <p role="status">{t.loading}</p>}
      <small>{t.help}</small>
    </figure>
  );
}
