'use client';

import { useEffect, useState } from 'react';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import type { CommunityPreviewV1 } from '@/lib/community/snapshot';
import { track } from '@/lib/analytics/client';

interface ReviewItem {
  revisionId: string;
  workId: string;
  revisionNumber: number;
  title: string;
  version: number;
  width: number;
  height: number;
  colorCount: number;
  boardProfile: string;
  submittedAt: string | null;
  author: { displayName: string; publicAuthorId: string; authorType: string };
  preview: CommunityPreviewV1;
}

export default function ReviewConsole() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selected = items.find((item) => item.revisionId === selectedId) ?? items[0] ?? null;

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/community/revisions');
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? '队列加载失败');
      setItems(body.items);
      setSelectedId((current) => body.items.some((item: ReviewItem) => item.revisionId === current) ? current : body.items[0]?.revisionId ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '队列加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/community/revisions').then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) { setError(body?.error?.message ?? '队列加载失败'); setLoading(false); return; }
      setItems(body.items);
      setSelectedId(body.items[0]?.revisionId ?? null);
      setLoading(false);
    }).catch(() => { if (active) { setError('队列加载失败'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const decide = async (decision: 'published' | 'rejected') => {
    if (!selected || reason.trim().length < 3) return;
    setError(null);
    const response = await fetch(`/api/admin/community/revisions/${selected.revisionId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ decision, expectedVersion: selected.version, reason }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error?.message ?? '审核失败'); return; }
    track({ name: 'community_reviewed', properties: { decision } });
    if (decision === 'published') track({ name: 'community_published', properties: {} });
    setReason('');
    await load();
  };

  return (
    <div className="review-console">
      <section className="review-queue" aria-label="待审队列"><header><h2>待审修订</h2><span>{items.length}</span></header>
        {loading ? <p className="admin-empty">正在载入…</p> : items.length === 0 ? <p className="admin-empty">队列已清空。</p> : <ul>{items.map((item) => <li key={item.revisionId}><button type="button" aria-current={selected?.revisionId === item.revisionId} onClick={() => setSelectedId(item.revisionId)}><CommunityPreviewCanvas preview={item.preview} label={`${item.title} 预览`} /><span><strong>{item.title}</strong><small>R{item.revisionNumber} · {item.author.displayName}</small></span></button></li>)}</ul>}
      </section>
      <section className="review-preview">{selected ? <><header><span>{selected.workId.slice(0, 8).toUpperCase()} / R{selected.revisionNumber}</span><h2>{selected.title}</h2><p>{selected.author.displayName} · {selected.width}×{selected.height} · {selected.colorCount} 色</p></header><CommunityPreviewCanvas preview={selected.preview} label={`${selected.title} 大图预览`} /><div className="community-color-band large">{selected.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div></> : <p className="admin-empty">选择一项查看校样。</p>}</section>
      <aside className="review-actions"><h2>处置</h2><label>审核理由<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="至少 3 个字符；将写入审计" /></label>{error && <p role="alert" className="notice notice-danger">{error}</p>}<div><button className="btn-danger-outline" disabled={!selected || reason.trim().length < 3} onClick={() => void decide('rejected')}>驳回</button><button className="btn-primary" disabled={!selected || reason.trim().length < 3} onClick={() => void decide('published')}>批准发布</button></div></aside>
    </div>
  );
}
