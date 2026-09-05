'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics/client';
import { openIndexedDb, parseStoredProject } from '@/lib/storage';
import { createDoupuApi } from '@/lib/sync/api';
import { ApiError, createSyncClient } from '@/lib/sync/clientAdapter';
import { withDesignStorageLock } from '@/lib/sync/queue';
import ActionOverflow from '@/components/layout/ActionOverflow';
import Modal from '@/components/ui/Modal';
import { zhCN } from '@/messages/zh-CN';

interface CommentItem {
  id: string;
  author: { publicAuthorId: string; displayName: string };
  body: string;
  version: number;
  createdAt: string;
  editedAt: string | null;
  editable: boolean;
  deletable: boolean;
  status: 'published' | 'pending_review' | 'hidden';
}
type ReportCategory = 'harm' | 'harassment' | 'sexual' | 'spam' | 'copyright' | 'other';
type ReportTarget = { targetType: 'work' | 'comment'; targetId: string };

export default function CommunityInteractions({ workId, initialLikes, initialReuses, commentsLocked, children }: {
  workId: string; initialLikes: number; initialReuses: number; commentsLocked: boolean; children?: ReactNode;
}) {
  const t = zhCN.communityAdmin.interaction;
  const router = useRouter();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsState, setCommentsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [body, setBody] = useState('');
  const [liked, setLiked] = useState<boolean | null>(null);
  const [likeLoadFailed, setLikeLoadFailed] = useState(false);
  const commentsRequest = useRef(0);
  const likeRequest = useRef(0);
  const [lockedByServer, setLockedByServer] = useState(false);
  const locked = commentsLocked || lockedByServer;
  const [likes, setLikes] = useState(initialLikes);
  const [reuses, setReuses] = useState(initialReuses);
  const [message, setMessage] = useState<{ text: string; error: boolean; auth?: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const navigating = useRef(false);
  const reuseKey = useRef<string | null>(null);
  const createdCopy = useRef<string | null>(null);
  const [copyReady, setCopyReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [category, setCategory] = useState<ReportCategory>('other');
  const [details, setDetails] = useState('');

  const loadComments = useCallback(async () => {
    const requestId = ++commentsRequest.current;
    try {
      const response = await fetch(`/api/community/works/${workId}/comments`);
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.items)) throw new Error('invalid comments');
      if (mounted.current && requestId === commentsRequest.current) { setComments(result.items); setCommentsState('ready'); }
    } catch { if (mounted.current && requestId === commentsRequest.current) setCommentsState('error'); }
  }, [workId]);
  const loadLike = useCallback(async () => {
    const requestId = ++likeRequest.current;
    try {
      const response = await fetch(`/api/community/works/${workId}/like`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || typeof result.liked !== 'boolean' || !Number.isInteger(result.likeCount)) throw new Error('invalid like state');
      if (mounted.current && requestId === likeRequest.current) { setLiked(result.liked); setLikes(result.likeCount); setLikeLoadFailed(false); }
    } catch { if (mounted.current && requestId === likeRequest.current) setLikeLoadFailed(true); }
  }, [workId]);
  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Both loaders await remote responses before updating state; the effect itself only starts reads.
    void loadComments(); void loadLike();
    return () => { mounted.current = false; };
  }, [loadComments, loadLike]);

  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, result?.error?.code ?? 'INTERNAL', result?.error?.message ?? t.actionFailed);
    if (!result || typeof result !== 'object') throw new Error('invalid response');
    return result;
  };
  const run = async (action: string, task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(action); setMessage(null);
    try { await task(); }
    catch (error) {
      if (mounted.current && error instanceof ApiError && error.code === 'COMMENTS_LOCKED') setLockedByServer(true);
      if (mounted.current) setMessage({
        text: action === 'reuse' && createdCopy.current ? t.copyKept : error instanceof ApiError ? error.message : t.actionFailed,
        error: true, auth: error instanceof ApiError ? error.status : undefined,
      });
    } finally {
      if (!navigating.current) {
        pendingRef.current = false;
        if (mounted.current) setPending(null);
      }
    }
  };
  const like = () => run('like', async () => {
    if (liked === null) return;
    const next = !liked;
    const result = await request(`/api/community/works/${workId}/like`, { method: next ? 'PUT' : 'DELETE' });
    if (typeof result.liked !== 'boolean' || !Number.isInteger(result.likeCount)) throw new Error('invalid like result');
    if (!mounted.current) return;
    setLiked(result.liked); setLikes(result.likeCount);
    track({ name: 'community_like_changed', properties: { action: result.liked ? 'added' : 'removed' } });
  });
  const reuse = () => run('reuse', async () => {
    if (!createdCopy.current) {
      reuseKey.current ??= crypto.randomUUID();
      const result = await request(`/api/community/works/${workId}/reuse`, { method: 'POST', headers: { 'idempotency-key': reuseKey.current } });
      if (typeof result.designId !== 'string' || !/^[a-f0-9-]{36}$/i.test(result.designId)) throw new Error('invalid copy id');
      createdCopy.current = result.designId;
      if (!mounted.current) return;
      setCopyReady(true); setReuses(result.reuseCount);
      track({ name: 'community_reuse_succeeded', properties: {} });
    }
    const id = createdCopy.current;
    if (!id) throw new Error('copy id unavailable');
    const storage = await openIndexedDb();
    const client = createSyncClient(storage, createDoupuApi());
    await withDesignStorageLock(async () => {
      if (!(await storage.getAll()).some((record) => record.id === id)) await client.pullDesign(id);
      const copy = (await storage.getAll()).find((record) => record.id === id);
      if (!copy || !parseStoredProject(copy.projectJson)) throw new Error('copy not available locally');
    });
    if (mounted.current) { router.push(`/app?id=${encodeURIComponent(id)}&mode=edit`); navigating.current = true; }
  });
  const comment = () => run('comment', async () => {
    const result = await request(`/api/community/works/${workId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    if (!mounted.current) return;
    track({ name: 'community_comment_created', properties: { moderationState: result.status } });
    setBody(''); setMessage({ text: result.status === 'pending_review' ? t.pending : t.published, error: false });
    await loadComments();
  });
  const editComment = (item: CommentItem) => run('edit', async () => {
    const result = await request(`/api/community/comments/${item.id}`, { method: 'PATCH', body: JSON.stringify({ body: editingBody, expectedVersion: item.version }) });
    if (!mounted.current) return;
    track({ name: 'community_comment_edited', properties: { moderationState: result.status } });
    setEditingId(null); setEditingBody('');
    setMessage({ text: result.status === 'pending_review' ? t.editPending : t.updated, error: false });
    await loadComments();
  });
  const deleteComment = (item: CommentItem) => run('delete', async () => {
    await request(`/api/community/comments/${item.id}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion: item.version }) });
    if (!mounted.current) return;
    setMessage({ text: t.deleted, error: false }); await loadComments();
  });
  const beginReport = (target: ReportTarget) => {
    setMessage(null); setCategory('other'); setDetails(''); setReportTarget(target);
  };
  const report = () => run('report', async () => {
    if (!reportTarget) return;
    await request('/api/community/reports', { method: 'POST', body: JSON.stringify({ ...reportTarget, category, details }) });
    if (!mounted.current) return;
    track({ name: 'community_report_created', properties: { targetType: reportTarget.targetType, reasonCategory: category === 'harm' ? 'explicit_harm' : category } });
    setReportTarget(null); setMessage({ text: t.reported, error: false });
  });
  const feedback = message && <div className={message.error ? 'notice notice-danger' : 'notice'} role={message.error ? 'alert' : 'status'}><span>{message.text}
    {message.auth === 401 && <>{' '}<Link href={`/login?next=${encodeURIComponent(`/community/${workId}`)}`}>{t.loginContinue}</Link></>}
    {message.auth === 403 && <>{' '}<Link href="/account">{t.accountAccess}</Link></>}
  </span></div>;

  return (
    <section className="community-interactions" aria-labelledby="community-interaction-title">
      <header><h2 id="community-interaction-title">{t.title}</h2><p>{t.counts(likes, reuses)}</p></header>
      <div className="community-action-row">
        <button type="button" className="btn-primary" disabled={pending !== null} onClick={() => void reuse()}>{pending === 'reuse' ? t.opening : copyReady ? t.openCopy : t.reuse}</button>
        <button type="button" className="btn-outline" aria-pressed={liked ?? false} disabled={pending !== null || liked === null} onClick={() => void like()}>{liked ? t.unlike : t.like}</button>
        <ActionOverflow label={t.more} actions={<>
          <button type="button" disabled={pending !== null} onClick={() => beginReport({ targetType: 'work', targetId: workId })}>{t.reportWork}</button>
          <Link href="/designs">{t.myDesigns}</Link>
        </>} />
      </div>
      {likeLoadFailed && <p>{t.likeLoadFailed} <button type="button" className="btn-outline" onClick={() => void loadLike()}>{zhCN.common.retry}</button></p>}
      {!reportTarget && feedback}
      {children}
      <div className="community-comment-form">
        <label htmlFor="community-comment">{t.comment}</label>
        <textarea id="community-comment" value={body} maxLength={500} disabled={locked || pending === 'comment'}
          onChange={(event) => setBody(event.target.value)} placeholder={locked ? t.locked : t.commentPlaceholder} />
        <div><small>{body.length}/500</small><button className="btn-outline" type="button" disabled={pending !== null || locked || body.trim().length === 0} onClick={() => void comment()}>{t.publishComment}</button></div>
      </div>
      {commentsState === 'loading' && <p role="status">{t.loadingComments}</p>}
      {commentsState === 'error' && <p role="status">{t.commentsFailed} <button type="button" className="btn-outline" onClick={() => void loadComments()}>{zhCN.common.retry}</button></p>}
      {commentsState === 'ready' && comments.length === 0 && <p>{t.noComments}</p>}
      <ol className="community-comment-list">
        {comments.map((item) => <li key={item.id} id={`comment-${item.id}`}>
          <header><strong>{item.author.displayName}</strong><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time></header>
          {item.status !== 'published' && <small>{zhCN.communityAdmin.states.comment[item.status]}</small>}
          {editingId === item.id ? <div className="community-inline-edit"><textarea aria-label={t.edit} maxLength={500} disabled={pending !== null || locked} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /><button type="button" disabled={pending !== null || locked || !editingBody.trim()} onClick={() => void editComment(item)}>{t.saveEdit}</button><button type="button" disabled={pending !== null} onClick={() => setEditingId(null)}>{t.cancelEdit}</button></div> : <p>{item.body}</p>}
          <div className="community-comment-actions">
            {item.editable && !locked && <button type="button" disabled={pending !== null} onClick={() => { setEditingId(item.id); setEditingBody(item.body); }}>{t.edit}</button>}
            {item.deletable && <button type="button" disabled={pending !== null} onClick={() => void deleteComment(item)}>{t.delete}</button>}
            {item.status === 'published' && <button type="button" disabled={pending !== null} onClick={() => beginReport({ targetType: 'comment', targetId: item.id })}>{t.report}</button>}
          </div>
        </li>)}
      </ol>
      {reportTarget && <Modal label={t.reportTitle} onClose={() => { if (!pendingRef.current) setReportTarget(null); }} panelClassName="max-w-md">
        <form className="community-report-form" onSubmit={(event) => { event.preventDefault(); void report(); }}>
          <h2>{t.reportTitle}</h2>{feedback}
          <label>{t.reportCategory}<select value={category} disabled={pending !== null} onChange={(event) => setCategory(event.target.value as ReportCategory)}>
            {Object.entries(t.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>{t.reportDetails}<textarea value={details} maxLength={500} disabled={pending !== null} onChange={(event) => setDetails(event.target.value)} /></label>
          <div><button type="button" className="btn-outline" disabled={pending !== null} onClick={() => setReportTarget(null)}>{zhCN.common.cancel}</button><button type="submit" className="btn-primary" disabled={pending !== null}>{t.submitReport}</button></div>
        </form>
      </Modal>}
    </section>
  );
}
