'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

interface CommentItem {
  id: string;
  author: { publicAuthorId: string; displayName: string };
  body: string;
  version: number;
  createdAt: string;
  editedAt: string | null;
  editable: boolean;
}

export default function CommunityInteractions({ workId, initialLikes, initialReuses, commentsLocked }: {
  workId: string; initialLikes: number; initialReuses: number; commentsLocked: boolean;
}) {
  const t = zhCN.communityAdmin.interaction;
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [body, setBody] = useState('');
  const [likes, setLikes] = useState(initialLikes);
  const [reuses, setReuses] = useState(initialReuses);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const loadComments = async () => {
    const response = await fetch(`/api/community/works/${workId}/comments`);
    if (response.ok) setComments((await response.json()).items);
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/community/works/${workId}/comments`).then(async (response) => {
      if (active && response.ok) setComments((await response.json()).items);
    });
    return () => { active = false; };
  }, [workId]);

  const request = async (url: string, init: RequestInit) => {
    setMessage(null);
    const response = await fetch(url, init);
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error?.message ?? t.actionFailed);
    return result;
  };

  const like = async (liked: boolean) => {
    try {
      const result = await request(`/api/community/works/${workId}/like`, { method: liked ? 'PUT' : 'DELETE' });
      setLikes(result.likeCount);
      track({ name: 'community_like_changed', properties: { action: liked ? 'added' : 'removed' } });
    } catch (error) { setMessage(error instanceof Error ? error.message : t.genericFailed); }
  };

  const reuse = async () => {
    try {
      const result = await request(`/api/community/works/${workId}/reuse`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } });
      setReuses(result.reuseCount);
      track({ name: 'community_reuse_succeeded', properties: {} });
      setMessage(t.reuseCreated(result.designId.slice(0, 8).toUpperCase()));
    } catch (error) { setMessage(error instanceof Error ? error.message : t.reuseFailed); }
  };

  const comment = async () => {
    try {
      const result = await request(`/api/community/works/${workId}/comments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }),
      });
      track({ name: 'community_comment_created', properties: { moderationState: result.status } });
      setBody('');
      setMessage(result.status === 'pending_review' ? t.pending : t.published);
      await loadComments();
    } catch (error) { setMessage(error instanceof Error ? error.message : t.commentFailed); }
  };

  const report = async () => {
    try {
      await request('/api/community/reports', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'work', targetId: workId, category: 'other' }) });
      track({ name: 'community_report_created', properties: { targetType: 'work', reasonCategory: 'other' } });
      setMessage(t.reported);
    } catch (error) { setMessage(error instanceof Error ? error.message : t.reportFailed); }
  };

  const editComment = async (item: CommentItem) => {
    try {
      const result = await request(`/api/community/comments/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: editingBody, expectedVersion: item.version }) });
      track({ name: 'community_comment_edited', properties: { moderationState: result.status } });
      setEditingId(null); setEditingBody('');
      setMessage(result.status === 'pending_review' ? t.editPending : t.updated); await loadComments();
    } catch (error) { setMessage(error instanceof Error ? error.message : t.editFailed); }
  };
  const deleteComment = async (item: CommentItem) => {
    try { await request(`/api/community/comments/${item.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: item.version }) }); setMessage(t.deleted); await loadComments(); }
    catch (error) { setMessage(error instanceof Error ? error.message : t.deleteFailed); }
  };
  const reportComment = async (item: CommentItem) => {
    try { await request('/api/community/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'comment', targetId: item.id, category: 'other' }) }); track({ name: 'community_report_created', properties: { targetType: 'comment', reasonCategory: 'other' } }); setMessage(t.commentReported); }
    catch (error) { setMessage(error instanceof Error ? error.message : t.reportFailed); }
  };

  return (
    <section className="community-interactions" aria-labelledby="community-interaction-title">
      <header><div><span className="studio-eyebrow">{t.eyebrow}</span><h2 id="community-interaction-title">{t.title}</h2></div><p>{t.counts(likes, reuses)}</p></header>
      <div className="community-action-row">
        <button type="button" className="btn-secondary" onClick={() => void like(true)}>{t.like}</button>
        <button type="button" className="btn-ghost" onClick={() => void like(false)}>{t.unlike}</button>
        <button type="button" className="btn-primary" onClick={() => void reuse()}>{t.reuse}</button>
        <button type="button" className="btn-ghost" onClick={() => void report()}>{t.reportWork}</button>
        <Link href="/designs">{t.myDesigns}</Link>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <div className="community-comment-form">
        <label htmlFor="community-comment">{t.comment}</label>
        <textarea id="community-comment" value={body} maxLength={500} disabled={commentsLocked}
          onChange={(event) => setBody(event.target.value)} placeholder={commentsLocked ? t.locked : t.commentPlaceholder} />
        <div><small>{body.length}/500</small><button className="btn-primary" type="button" disabled={commentsLocked || body.trim().length === 0} onClick={() => void comment()}>{t.publishComment}</button></div>
      </div>
      <ol className="community-comment-list">
        {comments.map((item) => <li key={item.id}><header><strong>{item.author.displayName}</strong><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time></header>{editingId === item.id ? <div className="community-inline-edit"><textarea maxLength={500} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /><button type="button" onClick={() => void editComment(item)}>{t.saveEdit}</button><button type="button" onClick={() => setEditingId(null)}>{t.cancelEdit}</button></div> : <p>{item.body}</p>}<div className="community-comment-actions">{item.editable && <><button type="button" onClick={() => { setEditingId(item.id); setEditingBody(item.body); }}>{t.edit}</button><button type="button" onClick={() => void deleteComment(item)}>{t.delete}</button></>}<button type="button" onClick={() => void reportComment(item)}>{t.report}</button></div></li>)}
      </ol>
    </section>
  );
}
