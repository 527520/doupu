'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics/client';

interface CommentItem {
  id: string;
  author: { publicAuthorId: string; displayName: string };
  body: string;
  version: number;
  createdAt: string;
  editedAt: string | null;
}

export default function CommunityInteractions({ workId, initialLikes, initialReuses, commentsLocked }: {
  workId: string; initialLikes: number; initialReuses: number; commentsLocked: boolean;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [body, setBody] = useState('');
  const [likes, setLikes] = useState(initialLikes);
  const [reuses, setReuses] = useState(initialReuses);
  const [message, setMessage] = useState<string | null>(null);

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
    if (!response.ok) throw new Error(result?.error?.message ?? '操作失败，请稍后重试');
    return result;
  };

  const like = async (liked: boolean) => {
    try {
      const result = await request(`/api/community/works/${workId}/like`, { method: liked ? 'PUT' : 'DELETE' });
      setLikes(result.likeCount);
      track({ name: 'community_like_changed', properties: { action: liked ? 'added' : 'removed' } });
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
  };

  const reuse = async () => {
    try {
      const result = await request(`/api/community/works/${workId}/reuse`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } });
      setReuses(result.reuseCount);
      track({ name: 'community_reuse_succeeded', properties: {} });
      setMessage(`私人副本已创建：${result.designId.slice(0, 8).toUpperCase()}。可前往“我的设计”继续编辑。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '引用失败'); }
  };

  const comment = async () => {
    try {
      const result = await request(`/api/community/works/${workId}/comments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }),
      });
      track({ name: 'community_comment_created', properties: { moderationState: result.status } });
      setBody('');
      setMessage(result.status === 'pending_review' ? '评论已提交，审核通过后公开。' : '评论已发布。');
      await loadComments();
    } catch (error) { setMessage(error instanceof Error ? error.message : '评论失败'); }
  };

  const report = async () => {
    try {
      await request('/api/community/reports', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'work', targetId: workId, category: 'other' }) });
      track({ name: 'community_report_created', properties: { targetType: 'work', reasonCategory: 'other' } });
      setMessage('举报已进入治理队列。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '举报失败'); }
  };

  return (
    <section className="community-interactions" aria-labelledby="community-interaction-title">
      <header><div><span className="studio-eyebrow">COMMUNITY ACTIONS</span><h2 id="community-interaction-title">引用与讨论</h2></div><p>{likes} 赞 · {reuses} 次引用</p></header>
      <div className="community-action-row">
        <button type="button" className="btn-secondary" onClick={() => void like(true)}>点赞</button>
        <button type="button" className="btn-ghost" onClick={() => void like(false)}>取消赞</button>
        <button type="button" className="btn-primary" onClick={() => void reuse()}>创建私人副本</button>
        <button type="button" className="btn-ghost" onClick={() => void report()}>举报作品</button>
        <Link href="/designs">我的设计</Link>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <div className="community-comment-form">
        <label htmlFor="community-comment">发表评论</label>
        <textarea id="community-comment" value={body} maxLength={500} disabled={commentsLocked}
          onChange={(event) => setBody(event.target.value)} placeholder={commentsLocked ? '评论已锁定' : '最多 500 字；链接仅作为纯文本展示'} />
        <div><small>{body.length}/500</small><button className="btn-primary" type="button" disabled={commentsLocked || body.trim().length === 0} onClick={() => void comment()}>发布评论</button></div>
      </div>
      <ol className="community-comment-list">
        {comments.map((item) => <li key={item.id}><header><strong>{item.author.displayName}</strong><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time></header><p>{item.body}</p></li>)}
      </ol>
    </section>
  );
}
