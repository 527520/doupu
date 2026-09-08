'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import TagInput, { type TagSuggestion } from '@/components/ui/TagInput';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { ManagedCommunityWork, ManagedWorkInspection } from '@/lib/community/adminQueries';
import { getBoardProfile } from '@/lib/boardProfiles';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import OriginalPreview from '@/components/community/OriginalPreview';
import PatternPreview from '@/components/preview/PatternPreview';
import AdminQueueState from './AdminQueueState';
import AdminCommandNotice from './AdminCommandNotice';
import { AdminEmpty, AdminSkeleton, FilterBar, Pagination, ReasonPanel, StatusBadge } from './AdminPrimitives';
import Button, { ButtonLink } from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Notice from '@/components/ui/Notice';
import TextField from '@/components/ui/TextField';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';
import { useAdminCommand } from './useAdminCommand';
import { useAdminTaskFocus } from './useAdminTaskFocus';

type Action = 'remove' | 'restore' | 'feature' | 'unfeature' | 'lock_comments' | 'unlock_comments';

const sameTags = (left: string[], right: string[]) => left.length === right.length && left.every((name, index) => name === right[index]);

/** 标签联想：复用后台标签列表接口的 q 参数，返回名称与使用作品数。 */
async function suggestTags(query: string, signal: AbortSignal): Promise<TagSuggestion[]> {
  const response = await fetch(`/api/admin/community/tags?q=${encodeURIComponent(query)}`, { signal, cache: 'no-store' });
  if (!response.ok) return [];
  const body = await response.json() as { items?: Array<{ id: string; name: string; active: boolean; mergedIntoTagId: string | null; workCount?: number }> };
  return (body.items ?? []).filter((item) => item.active && !item.mergedIntoTagId).map((item) => ({ id: item.id, name: item.name, count: item.workCount }));
}

export default function WorksManager({ initialWorkId }: { initialWorkId?: string } = {}) {
  const t = zhCN.communityAdmin.works;
  const c = zhCN.communityAdmin.command;
  const states = zhCN.communityAdmin.states;
  const [q, setQ] = useState(initialWorkId ?? '');
  const [status, setStatus] = useState('all');
  const [filter, setFilter] = useState({ q: initialWorkId ?? '', status: 'all' });
  const [cursors, setCursors] = useState(['']);
  const query = new URLSearchParams(filter);
  const cursor = cursors.at(-1);
  if (cursor) query.set('cursor', cursor);
  const queue = useAdminCollection<ManagedCommunityWork>(`/api/admin/community/works?${query}`);
  const command = useAdminCommand();
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkId ?? null);
  const selected = queue.items.find((item) => item.id === selectedId) ?? null;
  const inspection = useAdminInspection<ManagedWorkInspection>(selected ? `/api/admin/community/works/${selected.id}` : null);
  const detail = inspection.data;
  const { queueRef, detailRef } = useAdminTaskFocus(selected?.id ?? null);
  const [reason, setReason] = useState('');
  const [danger, setDanger] = useState<'remove' | 'restore' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  // 标签草稿以「作品 + 版本」为键派生：详情刷新或切换作品时自动回到服务端集合，不需要 effect 同步。
  const [tagEdit, setTagEdit] = useState<{ key: string; draft: string[] } | null>(null);
  const tagKey = detail && detail.id === selectedId ? `${detail.id}:${detail.version}` : null;
  const tagBase = tagKey && detail ? detail.tags.map((tag) => tag.name) : [];
  const tagDraft = tagKey && tagEdit?.key === tagKey ? tagEdit.draft : tagBase;
  const setTagDraft = (next: string[]) => { if (tagKey) setTagEdit({ key: tagKey, draft: next }); };
  const [checkedIds, setChecked] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  useEffect(() => { if (danger) confirmRef.current?.focus(); }, [danger]);
  // 列表刷新后只保留仍在当前页的勾选项，不用 effect 触发级联渲染。
  const checked = checkedIds.filter((id) => queue.items.some((item) => item.id === id));
  const ready = selected && detail?.id === selected.id && detail.version === selected.version && !queue.loading && !queue.error && !command.locked;
  const select = useCallback((id: string | null) => {
    if (command.locked) return;
    setSelectedId(id); setReason(''); setDanger(null); setConfirmed(false); command.resetNotice();
  }, [command]);
  const refresh = async () => { await queue.reload(); await inspection.reload(); setConfirmed(false); };
  const act = async (action: Action) => {
    if (!selected || !ready || reason.trim().length < 3 || ((action === 'remove' || action === 'restore') && !confirmed)) return;
    await command.run({ url: `/api/admin/community/works/${selected.id}`, method: 'PATCH', body: { action, expectedVersion: selected.version, reason } }, async () => {
      setSelectedId(null); setReason(''); setDanger(null); setConfirmed(false); await queue.reload();
    });
  };
  const saveTags = async () => {
    if (!selected || !ready || sameTags(tagDraft, tagBase)) return;
    await command.run({ url: `/api/admin/community/works/${selected.id}/tags`, method: 'PUT', body: { expectedVersion: selected.version, tags: tagDraft } }, async () => {
      await queue.reload(); await inspection.reload();
    });
  };
  const bulkTag = async () => {
    if (command.locked || checked.length === 0 || bulkTags.length === 0) return;
    await command.run({ url: '/api/admin/community/works/tags', method: 'POST', body: { workIds: checked, tags: bulkTags } }, async () => {
      setBulkTags([]); setChecked([]); await queue.reload(); if (selected) await inspection.reload();
    });
  };
  const page = (next: string[]) => { if (!command.locked) { select(null); setCursors(next); setChecked([]); } };
  const allChecked = queue.items.length > 0 && checked.length === queue.items.length;
  const reasonReady = Boolean(ready) && reason.trim().length >= 3;
  // 结果反馈紧挨着动作：有选中项时在理由区正下方，处理完毕（选中项清空）后落在详情面板顶部。
  const notice = <AdminCommandNotice command={command} onRefresh={() => void refresh()} />;
  return <div className={`admin-task-layout works-task-layout${selected ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" ref={queueRef} tabIndex={-1} aria-label={t.queue}>
      <header><h2>{t.queue}</h2><span>{t.page(cursors.length)}</span></header>
      <FilterBar className="is-search-first" submitLabel={t.query} disabled={command.locked || queue.loading} onSubmit={(event) => { event.preventDefault(); if (!command.locked) { select(null); setFilter({ q: q.trim(), status }); setCursors(['']); setChecked([]); if (q.trim() === filter.q && status === filter.status && cursors.length === 1) void queue.reload(); } }}>
        <TextField label={t.search} value={q} maxLength={80} disabled={command.locked} onChange={(event) => setQ(event.target.value)} />
        <ResponsiveSelect label={t.status} value={status} disabled={command.locked} onValueChange={setStatus} options={[{value:'all',label:t.all},...(['active','withdrawn','removed'] as const).map(value=>({value,label:states.work[value]}))]} />
      </FilterBar>
      <AdminQueueState {...queue} empty={queue.items.length === 0}>
        <div className="admin-batch-select"><Checkbox compact label={<>{allChecked ? t.clearSelection : t.selectAll}{checked.length > 0 && <span className="admin-batch-count">{t.selectedCount(checked.length)}</span>}</>} checked={allChecked} disabled={command.locked} onChange={(next) => setChecked(next ? queue.items.map((item) => item.id) : [])} /></div>
        {checked.length > 0 && <div className="admin-bulk-tags animate-rise" aria-label={t.bulkTagTitle}>
          <TagInput label={t.bulkTagLabel(checked.length)} value={bulkTags} onChange={setBulkTags} suggest={suggestTags} disabled={command.locked} />
          <div className="admin-form-actions"><Button variant="quiet" size="sm" disabled={command.locked} onClick={() => { setChecked([]); setBulkTags([]); }}>{t.clearSelection}</Button><Button variant="primary" size="sm" icon="tag" disabled={command.locked || bulkTags.length === 0} loading={command.busy && bulkTags.length > 0} onClick={() => void bulkTag()}>{t.bulkTagSubmit}</Button></div>
        </div>}
        <ul className="admin-object-list stagger">{queue.items.map((item, index) => <li key={item.id} style={{ '--i': index } as CSSProperties}>
          <Checkbox compact className="admin-row-check" label={<span className="sr-only">{t.selectWork(item.title ?? t.noTitle)}</span>} checked={checked.includes(item.id)} disabled={command.locked} onChange={(next) => setChecked((current) => next ? [...current, item.id] : current.filter((id) => id !== item.id))} />
          <button type="button" disabled={command.locked} aria-current={selectedId === item.id} onClick={() => select(item.id)}>
            {item.thumbnail && <CommunityThumbnail revisionId={item.thumbnail.revisionId} width={item.thumbnail.width} height={item.thumbnail.height} label={item.title ?? t.noTitle} />}
            <strong>{item.title ?? t.noTitle}</strong><span>{item.displayName}<StatusBadge kind="work" value={item.lifecycleStatus} /><small>{item.isPublic ? t.public : t.notPublic}</small>{item.featured && <small>{t.featured}</small>}</span>
          </button>
        </li>)}</ul>
      </AdminQueueState>
      <Pagination page={cursors.length} hasPrevious={cursors.length > 1} hasNext={Boolean(queue.nextCursor)} disabled={command.locked || queue.loading} onPrevious={() => page(cursors.slice(0, -1))} onNext={() => page([...cursors, queue.nextCursor!])} />
    </section>
    <section className="admin-panel admin-task-detail" ref={detailRef} tabIndex={-1} aria-label={t.material}>
      <header><h2>{t.material}</h2>{inspection.refreshing && <span role="status">{c.loading}</span>}</header>
      {selected ? <div className="admin-form-stack animate-rise">
        <Button variant="quiet" size="sm" icon="chevron-left" className="admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</Button>
        <h2>{selected.title ?? t.noTitle}</h2><p className="mono-id">{t.workId} {selected.id}</p>
        {inspection.error && !detail ? <><Notice kind="danger">{inspection.error}</Notice><div className="admin-form-actions"><Button variant="secondary" size="sm" icon="refresh" onClick={() => void inspection.reload()}>{c.reload}</Button></div></> : !detail ? <AdminSkeleton rows={4} label={c.loading} /> : <>
          {inspection.error && <Notice kind="danger">{inspection.error}</Notice>}
          <p className="admin-badges"><StatusBadge kind="work" value={detail.lifecycleStatus} /><span>{detail.isPublic ? t.public : t.notPublic}</span><span>{detail.commentsLocked ? t.locked : t.unlocked}</span><span>{t.counts(detail.counts.likes, detail.counts.comments, detail.counts.reuses)}</span></p>
          {detail.removedReason && <Notice kind="info">{t.removedReason} {detail.removedReason}</Notice>}
          <section className="admin-subsection" aria-label={t.tagsTitle}>
            <TagInput label={t.tagsTitle} value={tagDraft} onChange={setTagDraft} suggest={suggestTags} disabled={!ready} describedBy="work-tags-help" />
            <div className="admin-subsection-foot"><p id="work-tags-help" className="admin-help">{t.tagsHelp}</p><div className="admin-form-actions">{!sameTags(tagDraft, tagBase) && <Button variant="quiet" size="sm" disabled={command.locked} onClick={() => setTagDraft(tagBase)}>{t.resetTags}</Button>}<Button variant="primary" size="sm" icon="tag" disabled={!ready || sameTags(tagDraft, tagBase)} onClick={() => void saveTags()}>{t.saveTags}</Button></div></div>
          </section>
          {detail.material ? <div className="review-material-pair">
            <PatternPreview variant="compact" caption={`${detail.material.title} · ${t.revisionNumber(detail.material.revisionNumber)} · ${states.revision[detail.material.status]}`} pattern={detail.material.snapshot.pattern} boardSize={getBoardProfile(detail.material.snapshot.boardProfile).boardCols} />
            <OriginalPreview revisionId={detail.material.id} title={detail.material.title} />
          </div> : <AdminEmpty icon="image" title={t.noMaterial} />}
          {detail.latestRevision && detail.latestRevision.id !== detail.material?.id && <Notice kind="info">{t.newerRevision} {t.revisionNumber(detail.latestRevision.revisionNumber)} · {states.revision[detail.latestRevision.status]}</Notice>}
          {detail.isPublic && <ButtonLink variant="secondary" size="sm" icon="external" iconPosition="end" href={`/community/${selected.id}`} target="_blank" rel="noopener noreferrer">{t.openPublic}</ButtonLink>}
          {!ready && !command.locked && <Notice kind="warning">{c.stale}</Notice>}
          <div ref={confirmRef} tabIndex={-1}>
            <ReasonPanel reason={reason} onReasonChange={setReason} disabled={command.locked}
              confirm={danger ? { checked: confirmed, onChange: setConfirmed, danger: danger === 'remove', label: t.confirm(selected.title ?? t.noTitle, danger === 'remove' ? t.remove : t.restore) } : undefined}
              hint={danger ? (danger === 'remove' ? t.removeImpact : t.restoreImpact) : undefined}>
              {danger ? <>
                <Button variant="quiet" disabled={command.locked} onClick={() => { setDanger(null); setConfirmed(false); detailRef.current?.focus(); }}>{c.cancel}</Button>
                <Button variant={danger === 'remove' ? 'dangerSolid' : 'primary'} icon={danger === 'remove' ? 'trash' : 'refresh'} disabled={!reasonReady || !confirmed} loading={command.busy} onClick={() => void act(danger)}>{danger === 'remove' ? t.confirmRemove : t.confirmRestore}</Button>
              </> : <>
                {(detail.isPublic || detail.featured) && <Button variant="secondary" icon="star" disabled={!reasonReady} onClick={() => void act(detail.featured ? 'unfeature' : 'feature')}>{detail.featured ? t.unfeature : t.feature}</Button>}
                <Button variant="secondary" icon="lock" disabled={!reasonReady} onClick={() => void act(detail.commentsLocked ? 'unlock_comments' : 'lock_comments')}>{detail.commentsLocked ? t.unlock : t.lock}</Button>
                {detail.lifecycleStatus !== 'removed' && <Button variant="danger" icon="trash" disabled={!reasonReady} onClick={() => { setDanger('remove'); setConfirmed(false); }}>{t.remove}</Button>}
                {detail.lifecycleStatus !== 'active' && (detail.canRestore ? <Button variant="primary" icon="refresh" disabled={!reasonReady} onClick={() => { setDanger('restore'); setConfirmed(false); }}>{t.restore}</Button> : <p className="admin-help">{t.noApproved}</p>)}
              </>}
            </ReasonPanel>
          </div>
        </>}
        {notice}
      </div> : <div className="admin-form-stack">{notice}<AdminEmpty icon="image" title={c.select} /></div>}
    </section>
    {selected && queue.error && <div className="admin-task-notice"><AdminQueueState {...queue} empty={false}>{null}</AdminQueueState></div>}
  </div>;
}
