'use client';

import { useState, type CSSProperties } from 'react';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import OriginalPreview from '@/components/community/OriginalPreview';
import PatternPreview from '@/components/preview/PatternPreview';
import type { CommunityPreviewV1 } from '@/lib/community/snapshot';
import type { CommunityRevisionInspection } from '@/lib/community/queries';
import { getBoardProfile } from '@/lib/boardProfiles';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';
import { useAdminCommand } from './useAdminCommand';
import AdminCommandNotice from './AdminCommandNotice';
import { useAdminTaskFocus } from './useAdminTaskFocus';
import { AdminEmpty, AdminSkeleton, ReasonPanel } from './AdminPrimitives';
import Button from '@/components/ui/Button';
import Disclosure from '@/components/ui/Disclosure';
import Notice from '@/components/ui/Notice';

interface ReviewItem {
  revisionId: string; workId: string; revisionNumber: number; title: string; version: number;
  width: number; height: number; colorCount: number; boardProfile: string; submittedAt: string | null;
  author: { displayName: string; publicAuthorId: string; authorType: string }; preview: CommunityPreviewV1;
}

export default function ReviewConsole() {
  const t = zhCN.communityAdmin;
  const r = t.review;
  const c = t.command;
  const queue = useAdminCollection<ReviewItem>('/api/admin/community/revisions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pendingDecision, setPendingDecision] = useState<'published' | 'rejected' | null>(null);
  const selected = queue.items.find((item) => item.revisionId === selectedId) ?? null;
  const { queueRef, detailRef } = useAdminTaskFocus(selected?.revisionId ?? null);
  const inspection = useAdminInspection<CommunityRevisionInspection>(selected ? `/api/admin/community/revisions/${selected.revisionId}` : null);
  const command = useAdminCommand();
  const detail = inspection.data;
  const ready = !queue.loading && !queue.error && selected && detail?.id === selected.revisionId
    && detail.lifecycleStatus === 'active' && detail.status === 'pending_review' && detail.version === selected.version;
  const refresh = async () => { await queue.reload(); await inspection.reload(); };
  const select = (id: string | null) => {
    if (command.locked) return;
    setSelectedId(id); setReason(''); command.resetNotice();
  };
  const decide = async (decision: 'published' | 'rejected') => {
    if (!selected || !ready || reason.trim().length < 3 || command.locked) return;
    setPendingDecision(decision);
    try {
      await command.run({
        url: `/api/admin/community/revisions/${selected.revisionId}/review`, method: 'POST',
        body: { decision, expectedVersion: selected.version, reason },
      }, async () => {
        track({ name: 'community_reviewed', properties: { decision } });
        if (decision === 'published') track({ name: 'community_published', properties: {} });
        setReason(''); setSelectedId(null); await queue.reload();
      });
    } finally { setPendingDecision(null); }
  };
  const decidable = Boolean(ready) && !command.locked && reason.trim().length >= 3;
  const reloadQueue = <div className="admin-form-stack"><Notice kind="danger">{queue.error}</Notice><div className="admin-form-actions"><Button variant="secondary" size="sm" icon="refresh" onClick={() => void queue.reload()}>{c.reload}</Button></div></div>;
  return <div className={`review-console${selected ? ' is-inspecting' : ''}`}>
    <section className="review-queue" aria-label={r.queue} tabIndex={-1} ref={queueRef}>
      <header><h2>{r.title}</h2><span>{queue.items.length}</span></header>
      {queue.error ? reloadQueue
        : queue.loading ? <AdminSkeleton label={r.loading} />
        : queue.items.length === 0 ? <AdminEmpty icon="check" title={r.empty} />
        : <ul className="stagger">{queue.items.map((item, index) => <li key={item.revisionId} style={{ '--i': index } as CSSProperties}><button type="button" disabled={command.locked} aria-current={selected?.revisionId === item.revisionId} onClick={() => select(item.revisionId)}><CommunityThumbnail revisionId={item.revisionId} width={item.width} height={item.height} label={`${item.title} ${r.preview}`} /><span><strong>{item.title}</strong><small>R{item.revisionNumber} · {item.author.displayName}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview" aria-label={c.frozenMaterial} tabIndex={-1} ref={detailRef}>
      {selected ? <div className="review-preview-body animate-rise">
        <Button variant="quiet" size="sm" icon="chevron-left" className="admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</Button>
        <header><span>R{selected.revisionNumber}</span><h2>{selected.title}</h2><p>{selected.author.displayName} · {selected.width}×{selected.height} · {selected.colorCount} {r.colorSuffix}</p></header>
        {inspection.error && !detail ? <div className="admin-form-stack"><Notice kind="danger">{inspection.error}</Notice><div className="admin-form-actions"><Button variant="secondary" size="sm" icon="refresh" onClick={() => void inspection.reload()}>{c.reload}</Button></div></div>
          : detail ? <>
            {inspection.error && <Notice kind="danger">{inspection.error}</Notice>}
            {/* 图纸与作者原图等宽并排，说明行 → 工具行 → 舞台三段对位，两张图顶边严格对齐。 */}
            <div className="review-material-pair">
              <PatternPreview variant="compact" caption={`${c.frozenMaterial} · R${detail.revisionNumber}`} pattern={detail.snapshot.pattern} boardSize={getBoardProfile(detail.snapshot.boardProfile).boardCols} />
              <OriginalPreview revisionId={detail.id} title={selected.title} />
            </div>
            {detail.previous && <Disclosure compact icon="clock" summary={`${c.previous} · R${detail.previous.revisionNumber}`}><PatternPreview variant="compact" caption={detail.previous.title} pattern={detail.previous.snapshot.pattern} boardSize={getBoardProfile(detail.previous.snapshot.boardProfile).boardCols} /></Disclosure>}
            {!ready && <Notice kind="warning">{c.stale}</Notice>}</>
          : <AdminSkeleton rows={4} label={c.loading} />}
      </div> : <AdminEmpty icon="eye" title={r.select} />}
    </section>
    <aside className="review-actions">
      {selected && <><h2>{r.action}</h2>
        <ReasonPanel label={r.reason} placeholder={r.reasonPlaceholder} reason={reason} onReasonChange={setReason} disabled={command.locked}>
          <Button variant="danger" icon="close" disabled={!decidable} loading={pendingDecision === 'rejected'} onClick={() => void decide('rejected')}>{t.actions.dismiss}</Button>
          <Button variant="primary" icon="check" disabled={!decidable} loading={pendingDecision === 'published'} onClick={() => void decide('published')}>{t.actions.approve}</Button>
        </ReasonPanel></>}
      <AdminCommandNotice command={command} onRefresh={() => void refresh()} />
      {selected && queue.error && reloadQueue}
    </aside>
  </div>;
}
