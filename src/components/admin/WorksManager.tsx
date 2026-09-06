'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import TagInput, { type TagSuggestion } from '@/components/ui/TagInput';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import type { ManagedCommunityWork, ManagedWorkInspection } from '@/lib/community/adminQueries';
import { getBoardProfile } from '@/lib/boardProfiles';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import OriginalPreview from '@/components/community/OriginalPreview';
import PatternPreview from '@/components/preview/PatternPreview';
import AdminQueueState from './AdminQueueState';
import AdminCommandNotice from './AdminCommandNotice';
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
  return <div className={`admin-task-layout works-task-layout${selected ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" ref={queueRef} tabIndex={-1} aria-label={t.queue}>
      <header><h2>{t.queue}</h2><span>{t.page(cursors.length)}</span></header>
      <form className="admin-form-stack" onSubmit={(event) => { event.preventDefault(); if (!command.locked) { select(null); setFilter({ q: q.trim(), status }); setCursors(['']); setChecked([]); if (q.trim() === filter.q && status === filter.status && cursors.length === 1) void queue.reload(); } }}>
        <label>{t.search}<input value={q} maxLength={80} disabled={command.locked} onChange={(event) => setQ(event.target.value)} /></label>
        <ResponsiveSelect label={t.status} value={status} disabled={command.locked} onValueChange={setStatus} options={[{value:'all',label:t.all},...(['active','withdrawn','removed'] as const).map(value=>({value,label:states.work[value]}))]} />
        <button type="submit" className="btn-outline" disabled={command.locked || queue.loading}>{t.query}</button>
      </form>
      <AdminQueueState {...queue} empty={queue.items.length === 0}>
        <label className="admin-batch-select"><input type="checkbox" checked={allChecked} disabled={command.locked} onChange={(event) => setChecked(event.target.checked ? queue.items.map((item) => item.id) : [])} />{allChecked ? t.clearSelection : t.selectAll}{checked.length > 0 && <span>{t.selectedCount(checked.length)}</span>}</label>
        {checked.length > 0 && <div className="admin-bulk-tags" aria-label={t.bulkTagTitle}>
          <TagInput label={t.bulkTagLabel(checked.length)} value={bulkTags} onChange={setBulkTags} suggest={suggestTags} disabled={command.locked} />
          <div><button type="button" className="btn-primary" disabled={command.locked || bulkTags.length === 0} onClick={() => void bulkTag()}>{t.bulkTagSubmit}</button><button type="button" className="btn-ghost" disabled={command.locked} onClick={() => { setChecked([]); setBulkTags([]); }}>{c.cancel}</button></div>
        </div>}
        <ul className="admin-object-list">{queue.items.map((item) => <li key={item.id}>
          <label><input type="checkbox" aria-label={t.selectWork(item.title ?? t.noTitle)} checked={checked.includes(item.id)} disabled={command.locked} onChange={(event) => setChecked((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></label>
          <button type="button" disabled={command.locked} aria-current={selectedId === item.id} onClick={() => select(item.id)}>
            {item.thumbnail && <CommunityThumbnail revisionId={item.thumbnail.revisionId} width={item.thumbnail.width} height={item.thumbnail.height} label={item.title ?? t.noTitle} />}
            <strong>{item.title ?? t.noTitle}</strong><span>{item.displayName} · {states.work[item.lifecycleStatus]} · {item.isPublic ? t.public : t.notPublic}{item.featured ? ` · ${t.featured}` : ''}</span>
          </button>
        </li>)}</ul>
      </AdminQueueState>
      <div className="admin-pagination"><button type="button" className="btn-outline" disabled={command.locked || queue.loading || cursors.length === 1} onClick={() => page(cursors.slice(0, -1))}>{t.previous}</button><button type="button" className="btn-outline" disabled={command.locked || queue.loading || !queue.nextCursor} onClick={() => page([...cursors, queue.nextCursor!])}>{t.next}</button></div>
    </section>
    <section className="admin-panel admin-task-detail" ref={detailRef} tabIndex={-1} aria-label={t.material}>
      {selected ? <div className="admin-form-stack">
        <button type="button" className="btn-outline admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</button>
        <h2>{selected.title ?? t.noTitle}</h2><p className="mono-id">{t.workId} {selected.id}</p>
        {inspection.error ? <div><p role="alert" className="notice notice-danger">{inspection.error}</p><button type="button" className="btn-outline" onClick={() => void inspection.reload()}>{c.reload}</button></div> : !detail ? <p role="status">{c.loading}</p> : <>
          <p>{states.work[detail.lifecycleStatus]} · {detail.isPublic ? t.public : t.notPublic} · {detail.commentsLocked ? t.locked : t.unlocked}</p>
          {detail.removedReason && <p className="notice">{t.removedReason} {detail.removedReason}</p>}
          <section className="admin-form-stack" style={{ padding: 0 }} aria-label={t.tagsTitle}>
            <TagInput label={t.tagsTitle} value={tagDraft} onChange={setTagDraft} suggest={suggestTags} disabled={!ready} describedBy="work-tags-help" />
            <p id="work-tags-help" className="admin-help">{t.tagsHelp}</p>
            <div className="admin-work-actions"><button type="button" className="btn-primary" disabled={!ready || sameTags(tagDraft, tagBase)} onClick={() => void saveTags()}>{t.saveTags}</button>{!sameTags(tagDraft, tagBase) && <button type="button" className="btn-ghost" disabled={command.locked} onClick={() => setTagDraft(tagBase)}>{t.resetTags}</button>}</div>
          </section>
          {detail.material ? <><h3>{detail.material.title} · {t.revisionNumber(detail.material.revisionNumber)} · {states.revision[detail.material.status]}</h3><PatternPreview pattern={detail.material.snapshot.pattern} boardSize={getBoardProfile(detail.material.snapshot.boardProfile).boardCols} /><OriginalPreview revisionId={detail.material.id} title={detail.material.title} /></> : <p>{t.noMaterial}</p>}
          {detail.latestRevision && detail.latestRevision.id !== detail.material?.id && <p className="notice">{t.newerRevision} {t.revisionNumber(detail.latestRevision.revisionNumber)} · {states.revision[detail.latestRevision.status]}</p>}
          <p className="admin-help">{t.counts(detail.counts.likes, detail.counts.comments, detail.counts.reuses)}</p>
          {detail.isPublic && <Link href={`/community/${selected.id}`} target="_blank" rel="noopener noreferrer">{t.openPublic}</Link>}
          {!ready && !command.locked && <p className="notice notice-warning">{c.stale}</p>}
          <label>{t.reason}<textarea value={reason} maxLength={500} disabled={command.locked} onChange={(event) => setReason(event.target.value)} /></label>
          {danger ? <div className="notice notice-warning admin-form-stack" ref={confirmRef} tabIndex={-1}>
            <p>{danger === 'remove' ? t.removeImpact : t.restoreImpact}</p>
            <label className="admin-check"><input type="checkbox" checked={confirmed} disabled={command.locked} onChange={(event) => setConfirmed(event.target.checked)} />{t.confirm(selected.title ?? t.noTitle, danger === 'remove' ? t.remove : t.restore)}</label>
            <button type="button" className="btn-danger-outline" disabled={!ready || reason.trim().length < 3 || !confirmed} onClick={() => void act(danger)}>{danger === 'remove' ? t.confirmRemove : t.confirmRestore}</button>
            <button type="button" className="btn-ghost" disabled={command.locked} onClick={() => { setDanger(null); setConfirmed(false); detailRef.current?.focus(); }}>{c.cancel}</button>
          </div> : <div className="admin-work-actions">
            {(detail.isPublic || detail.featured) && <button type="button" className="btn-outline" disabled={!ready || reason.trim().length < 3} onClick={() => void act(detail.featured ? 'unfeature' : 'feature')}>{detail.featured ? t.unfeature : t.feature}</button>}
            <button type="button" className="btn-outline" disabled={!ready || reason.trim().length < 3} onClick={() => void act(detail.commentsLocked ? 'unlock_comments' : 'lock_comments')}>{detail.commentsLocked ? t.unlock : t.lock}</button>
            {detail.lifecycleStatus !== 'removed' && <button type="button" className="btn-danger-outline" disabled={!ready || reason.trim().length < 3} onClick={() => { setDanger('remove'); setConfirmed(false); }}>{t.remove}</button>}
            {detail.lifecycleStatus !== 'active' && (detail.canRestore ? <button type="button" className="btn-primary" disabled={!ready || reason.trim().length < 3} onClick={() => { setDanger('restore'); setConfirmed(false); }}>{t.restore}</button> : <p>{t.noApproved}</p>)}
          </div>}
        </>}
      </div> : <p className="admin-empty">{c.select}</p>}
    </section>
    <div className="admin-task-notice"><AdminCommandNotice command={command} onRefresh={() => void refresh()} />{selected && queue.error && <AdminQueueState {...queue} empty={false}>{null}</AdminQueueState>}</div>
  </div>;
}
