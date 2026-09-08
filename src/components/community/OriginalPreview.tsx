'use client';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

/**
 * 审核 / 治理台里的原图并排预览（D49 / ui-polish-2026）。
 * 请求经服务端代理并按会话鉴权，图片响应不缓存；取不到时显式说明，而不是留一张断图。
 *
 * 结构与 PatternPreview compact 完全对位（说明行 → 工具行 → 舞台），并排时两张图的顶边严格对齐；
 * 加载中只有一块骨架，加载完 200ms 淡入。
 */
export default function OriginalPreview({ revisionId, title }: { revisionId: string; title: string }) {
  const t = zhCN.communityAdmin.original;
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  return (
    <figure className="admin-original-preview pattern-preview is-compact" data-status={status}>
      <figcaption className="pattern-preview-caption">{t.title}</figcaption>
      <div className="pattern-preview-toolbar"><small className="admin-original-help">{t.help}</small></div>
      <div className="pattern-preview-stage surface-sunken admin-original-stage">
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
        {status === 'loading' && <span className="skeleton admin-original-skeleton" role="status" aria-label={t.loading} />}
      </div>
    </figure>
  );
}
