'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics/client';
import { randomId } from '@/lib/ids';
import { fetchRevisionOriginal } from '@/lib/community/originalsClient';
import { openIndexedDb, parseStoredProject } from '@/lib/storage';
import { putPendingOriginal, rememberOriginalSource } from '@/lib/storage/pendingOriginals';
import { createDoupuApi } from '@/lib/sync/api';
import { ApiError, createSyncClient } from '@/lib/sync/clientAdapter';
import { withDesignStorageLock } from '@/lib/sync/queue';
import ActionOverflow from '@/components/layout/ActionOverflow';
import Button from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Icon from '@/components/ui/Icon';
import IconButton from '@/components/ui/IconButton';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import Textarea from '@/components/ui/Textarea';
import { zhCN } from '@/messages/zh-CN';

interface CommentItem {
  id: string;
  author: { publicAuthorId: string; displayName: string };
  body: string;
  version: number;
  createdAt: string;
  deletable: boolean;
  status: 'published' | 'pending_review' | 'hidden';
}
type ReportCategory = 'harm' | 'harassment' | 'sexual' | 'spam' | 'copyright' | 'other';
type ReportTarget = { targetType: 'work' | 'comment'; targetId: string };
type Feedback = { text: string; error: boolean; auth?: number } | null;

/** 原图交接是锦上添花：超时就放弃，不能拖住打开副本。 */
const ORIGINAL_HANDOFF_TIMEOUT_MS = 8000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

const t = zhCN.communityAdmin.interaction;

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, result?.error?.code ?? 'INTERNAL', result?.error?.message ?? t.actionFailed);
  if (!result || typeof result !== 'object') throw new Error('invalid response');
  return result;
}

function FeedbackNotice({ message, workId }: { message: Feedback; workId: string }) {
  if (!message) return null;
  return <Notice kind={message.error ? 'danger' : 'success'} className="community-feedback"><span>{message.text}
    {message.auth === 401 && <>{' '}<Link href={`/login?next=${encodeURIComponent(`/community/${workId}`)}`}>{t.loginContinue}</Link></>}
    {message.auth === 403 && <>{' '}<Link href="/account">{t.accountAccess}</Link></>}
  </span></Notice>;
}

/** 举报弹窗：作品与评论共用，只有确认分类后才提交。 */
function ReportDialog({ pending, feedback, onClose, onSubmit }: {
  pending: boolean; feedback: ReactNode; onClose: () => void; onSubmit: (category: ReportCategory, details: string) => void;
}) {
  const [category, setCategory] = useState<ReportCategory>('other');
  const [details, setDetails] = useState('');
  return <Modal label={t.reportTitle} onClose={onClose} panelClassName="max-w-md">
    <form className="community-report-form" onSubmit={(event) => { event.preventDefault(); onSubmit(category, details); }}>
      <h2>{t.reportTitle}</h2>{feedback}
      <ResponsiveSelect label={t.reportCategory} value={category} disabled={pending} onValueChange={value=>setCategory(value as ReportCategory)} options={Object.entries(t.categories).map(([value,label])=>({value,label}))} />
      <Textarea label={t.reportDetails} value={details} maxLength={500} disabled={pending} onValueChange={setDetails} rows={4} />
      <div className="community-report-actions"><Button variant="quiet" disabled={pending} onClick={onClose}>{zhCN.common.cancel}</Button><Button type="submit" variant="primary" icon="flag" disabled={pending}>{t.submitReport}</Button></div>
    </form>
  </Modal>;
}

/**
 * 作品动作行：用这张制作（主按钮）、心形豆点赞、旗子举报、更多。
 * 引用流程：创建云端副本 → 拉到本机 → 交接原图 → 进入工作台；幂等键保证重试不重复创建。
 */
export function WorkActions({ workId, initialLikes, initialReuses, canInteract = true }: {
  workId: string; initialLikes: number; initialReuses: number; canInteract?: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState<boolean | null>(null);
  const [likeLoadFailed, setLikeLoadFailed] = useState(false);
  const likeRequest = useRef(0);
  const [likes, setLikes] = useState(initialLikes);
  const [reuses, setReuses] = useState(initialReuses);
  const [message, setMessage] = useState<Feedback>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const navigating = useRef(false);
  const reuseKey = useRef<string | null>(null);
  const createdCopy = useRef<string | null>(null);
  const reuseSource = useRef<{ revisionId: string; available: boolean } | null>(null);
  const [copyReady, setCopyReady] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The loader awaits the remote response before updating state; the effect itself only starts a read.
    if (canInteract) void loadLike();
    return () => { mounted.current = false; };
  }, [loadLike, canInteract]);

  const run = async (action: string, task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(action); setMessage(null);
    try { await task(); }
    catch (error) {
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
      reuseKey.current ??= randomId();
      const result = await request(`/api/community/works/${workId}/reuse`, { method: 'POST', headers: { 'idempotency-key': reuseKey.current } });
      if (typeof result.designId !== 'string' || !/^[a-f0-9-]{36}$/i.test(result.designId)) throw new Error('invalid copy id');
      createdCopy.current = result.designId;
      if (typeof result.revisionId === 'string') {
        reuseSource.current = { revisionId: result.revisionId, available: result.originalAvailable === true };
      }
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
    // D49：引用成功后把作者原图交接给工作台，让引用者能继续裁剪、改格数和颜色数。
    // 原图取不到只是失去再调参能力，不阻断打开副本；交接库的写入按顺序进行，避免并发建库。
    const source = reuseSource.current;
    if (source) {
      let handed = false;
      if (source.available) {
        try {
          const original = await withTimeout(fetchRevisionOriginal(source.revisionId), ORIGINAL_HANDOFF_TIMEOUT_MS);
          if (original) {
            await putPendingOriginal({ designId: id, bytes: original.bytes.buffer as ArrayBuffer, type: original.type, name: `${workId}.${original.type}`, sourceRevisionId: source.revisionId });
            handed = true;
          }
        } catch {
          // 原图缺失或超时：工作台仍可打开图纸副本，并保留「从豆社取回原图」入口。
        }
      }
      if (!handed) await rememberOriginalSource(id, source.revisionId);
    }
    if (mounted.current) { router.push(`/app?id=${encodeURIComponent(id)}&mode=edit`); navigating.current = true; }
  });
  const report = (category: ReportCategory, details: string) => run('report', async () => {
    if (!reportTarget) return;
    await request('/api/community/reports', { method: 'POST', body: JSON.stringify({ ...reportTarget, category, details }) });
    if (!mounted.current) return;
    track({ name: 'community_report_created', properties: { targetType: reportTarget.targetType, reasonCategory: category === 'harm' ? 'explicit_harm' : category } });
    setReportTarget(null); setMessage({ text: t.reported, error: false });
  });
  const feedback = <FeedbackNotice message={message} workId={workId} />;
  const loginHref = `/login?next=${encodeURIComponent(`/community/${workId}`)}`;

  return <div className="community-actions">
    <div className="community-action-row">
      {canInteract
        ? <Button variant="primary" icon="spark" loading={pending === 'reuse'} disabled={pending !== null} onClick={() => void reuse()}>{pending === 'reuse' ? t.opening : copyReady ? t.openCopy : t.reuse}</Button>
        : <Link href={loginHref} className="btn-primary">{t.loginToReuse}</Link>}
      <span className="community-like">
        <IconButton icon={liked ? 'heart-filled' : 'heart'} label={liked ? t.unlike : t.like} pressed={liked ?? false} tone="primary" disabled={!canInteract || pending !== null || liked === null} onClick={() => void like()} />
        <span className="community-like-count" aria-label={zhCN.communityAdmin.detail.likeCount(likes)}>{likes}</span>
      </span>
      <IconButton icon="flag" label={t.reportWork} disabled={!canInteract || pending !== null} onClick={() => { setMessage(null); setReportTarget({ targetType: 'work', targetId: workId }); }} />
      <ActionOverflow label={t.more} actions={<>
        <Link href="/designs"><Icon name="folder" size={16} />{t.myDesigns}</Link>
        <Link href="/community/copyright"><Icon name="shield" size={16} />{t.copyrightNotice}</Link>
      </>} />
    </div>
    <p className="community-stats">{zhCN.communityAdmin.detail.likeCount(likes)} · {zhCN.communityAdmin.detail.reuseCount(reuses)}</p>
    {likeLoadFailed && canInteract && <p className="community-inline-hint">{t.likeLoadFailed} <Button variant="quiet" size="sm" icon="refresh" onClick={() => void loadLike()}>{zhCN.common.retry}</Button></p>}
    {!reportTarget && feedback}
    {reportTarget && <ReportDialog pending={pending !== null} feedback={feedback} onClose={() => { if (!pendingRef.current) setReportTarget(null); }} onSubmit={report} />}
  </div>;
}

/** 讨论区：表单 + 游标分页列表；删除需二次确认，举报走同一弹窗。 */
export function WorkComments({ workId, commentsLocked, canInteract = true }: { workId: string; commentsLocked: boolean; canInteract?: boolean }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [commentsState, setCommentsState] = useState<'loading' | 'ready' | 'error' | 'more'>('loading');
  const [body, setBody] = useState('');
  const commentsRequest = useRef(0);
  const [lockedByServer, setLockedByServer] = useState(false);
  const locked = commentsLocked || lockedByServer;
  const [message, setMessage] = useState<Feedback>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const loadComments = useCallback(async (cursor: string | null = null) => {
    const requestId = ++commentsRequest.current;
    if (cursor) setCommentsState('more');
    try {
      const response = await fetch(`/api/community/works/${workId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.items)) throw new Error('invalid comments');
      if (mounted.current && requestId === commentsRequest.current) {
        setComments((current) => cursor ? [...current, ...result.items] : result.items);
        setNextCursor(typeof result.nextCursor === 'string' ? result.nextCursor : null);
        setCommentsState('ready');
      }
    } catch { if (mounted.current && requestId === commentsRequest.current) setCommentsState(cursor ? 'ready' : 'error'); }
  }, [workId]);
  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The loader awaits the remote response before updating state; the effect itself only starts a read.
    void loadComments();
    return () => { mounted.current = false; };
  }, [loadComments]);

  const run = async (action: string, task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(action); setMessage(null);
    try { await task(); }
    catch (error) {
      if (mounted.current && error instanceof ApiError && error.code === 'COMMENTS_LOCKED') setLockedByServer(true);
      if (mounted.current) setMessage({ text: error instanceof ApiError ? error.message : t.actionFailed, error: true, auth: error instanceof ApiError ? error.status : undefined });
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const comment = () => run('comment', async () => {
    const result = await request(`/api/community/works/${workId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    if (!mounted.current) return;
    track({ name: 'community_comment_created', properties: { moderationState: result.status } });
    setBody(''); setMessage({ text: result.status === 'pending_review' ? t.pending : t.published, error: false });
    await loadComments();
  });
  const deleteComment = async (item: CommentItem) => {
    if (!(await confirm({ title: t.deleteConfirmTitle, message: t.deleteConfirmBody, confirmLabel: t.delete, danger: true }))) return;
    await run('delete', async () => {
      await request(`/api/community/comments/${item.id}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion: item.version }) });
      if (!mounted.current) return;
      setMessage({ text: t.deleted, error: false }); await loadComments();
    });
  };
  const report = (category: ReportCategory, details: string) => run('report', async () => {
    if (!reportTarget) return;
    await request('/api/community/reports', { method: 'POST', body: JSON.stringify({ ...reportTarget, category, details }) });
    if (!mounted.current) return;
    track({ name: 'community_report_created', properties: { targetType: reportTarget.targetType, reasonCategory: category === 'harm' ? 'explicit_harm' : category } });
    setReportTarget(null); setMessage({ text: t.commentReported, error: false });
  });
  const feedback = <FeedbackNotice message={message} workId={workId} />;
  const loginHref = `/login?next=${encodeURIComponent(`/community/${workId}`)}`;
  const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));

  return <section className="community-discussion" aria-labelledby="community-discussion-title">
    <header className="community-discussion-header"><h2 id="community-discussion-title">{t.discussion}</h2>{commentsState !== 'loading' && commentsState !== 'error' && <span>{zhCN.communityAdmin.detail.commentCount(comments.length)}{nextCursor ? '+' : ''}</span>}</header>
    {canInteract ? <div className="community-comment-form">
      <Textarea label={t.comment} id="community-comment" value={body} maxLength={500} disabled={locked || pending === 'comment'} onValueChange={setBody} rows={4}
        placeholder={locked ? t.locked : t.commentPlaceholder} hint={locked ? t.lockedHint : undefined}
        actions={<Button variant="primary" size="sm" icon="send" loading={pending === 'comment'} disabled={pending !== null || locked || body.trim().length === 0} onClick={() => void comment()}>{t.publishComment}</Button>} />
    </div> : <Notice kind="info" className="community-login-hint"><span>{t.loginToComment} <Link href={loginHref}>{t.loginContinue}</Link></span></Notice>}
    {!reportTarget && feedback}
    {commentsState === 'loading' && <p role="status" className="community-inline-hint">{t.loadingComments}</p>}
    {commentsState === 'error' && <p role="status" className="community-inline-hint">{t.commentsFailed} <Button variant="quiet" size="sm" icon="refresh" onClick={() => void loadComments()}>{zhCN.common.retry}</Button></p>}
    {(commentsState === 'ready' || commentsState === 'more') && comments.length === 0 && <EmptyState compact icon="send" title={t.noComments} />}
    <ol className="community-comment-list">
      {comments.map((item) => <li key={item.id} id={`comment-${item.id}`} data-status={item.status}>
        <span className="community-comment-avatar" aria-hidden="true">{item.author.displayName.slice(0, 1)}</span>
        <div className="community-comment-body">
          <header><strong>{item.author.displayName}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>{item.status !== 'published' && <small className="badge" data-tone="warn">{zhCN.communityAdmin.states.comment[item.status]}</small>}</header>
          <p>{item.body}</p>
        </div>
        <div className="community-comment-actions">
          {item.deletable && <IconButton icon="trash" size="sm" tone="danger" label={t.delete} disabled={pending !== null} onClick={() => void deleteComment(item)} />}
          {item.status === 'published' && canInteract && !item.deletable && <IconButton icon="flag" size="sm" label={t.report} disabled={pending !== null} onClick={() => { setMessage(null); setReportTarget({ targetType: 'comment', targetId: item.id }); }} />}
        </div>
      </li>)}
    </ol>
    {nextCursor && <div className="community-load-more"><Button variant="secondary" size="sm" icon="chevron-down" loading={commentsState === 'more'} onClick={() => void loadComments(nextCursor)}>{zhCN.common.loadMore}</Button></div>}
    {confirmDialog}
    {reportTarget && <ReportDialog pending={pending !== null} feedback={feedback} onClose={() => { if (!pendingRef.current) setReportTarget(null); }} onSubmit={report} />}
  </section>;
}

/** 兼容包装：动作行 + 讨论区一起渲染（单测与旧调用方）。 */
export default function CommunityInteractions({ workId, initialLikes, initialReuses, commentsLocked, canInteract = true, children }: {
  workId: string; initialLikes: number; initialReuses: number; commentsLocked: boolean; canInteract?: boolean; children?: ReactNode;
}) {
  return <>
    <WorkActions workId={workId} initialLikes={initialLikes} initialReuses={initialReuses} canInteract={canInteract} />
    {children}
    <WorkComments workId={workId} commentsLocked={commentsLocked} canInteract={canInteract} />
  </>;
}
