'use client';

import { useEffect, useState } from 'react';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import type { CommunityPreviewV1 } from '@/lib/community/snapshot';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

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
  const t = zhCN.communityAdmin;
  const r = t.review;
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
      if (!response.ok) throw new Error(body?.error?.message ?? t.queueLoadFailed);
      setItems(body.items);
      setSelectedId((current) => body.items.some((item: ReviewItem) => item.revisionId === current) ? current : body.items[0]?.revisionId ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.queueLoadFailed); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/community/revisions').then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) { setError(body?.error?.message ?? t.queueLoadFailed); setLoading(false); return; }
      setItems(body.items);
      setSelectedId(body.items[0]?.revisionId ?? null);
      setLoading(false);
    }).catch(() => { if (active) { setError(t.queueLoadFailed); setLoading(false); } });
    return () => { active = false; };
  }, [t.queueLoadFailed]);

  const decide = async (decision: 'published' | 'rejected') => {
    if (!selected || reason.trim().length < 3) return;
    setError(null);
    const response = await fetch(`/api/admin/community/revisions/${selected.revisionId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ decision, expectedVersion: selected.version, reason }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error?.message ?? t.reviewFailed); return; }
    track({ name: 'community_reviewed', properties: { decision } });
    if (decision === 'published') track({ name: 'community_published', properties: {} });
    setReason('');
    await load();
  };

  return (
    <div className="review-console">
      <section className="review-queue" aria-label={r.queue}><header><h2>{r.title}</h2><span>{items.length}</span></header>
        {loading ? <p className="admin-empty">{r.loading}</p> : items.length === 0 ? <p className="admin-empty">{r.empty}</p> : <ul>{items.map((item) => <li key={item.revisionId}><button type="button" aria-current={selected?.revisionId === item.revisionId} onClick={() => setSelectedId(item.revisionId)}><CommunityPreviewCanvas preview={item.preview} label={`${item.title} ${r.preview}`} /><span><strong>{item.title}</strong><small>R{item.revisionNumber} · {item.author.displayName}</small></span></button></li>)}</ul>}
      </section>
      <section className="review-preview">{selected ? <><header><span>{selected.workId.slice(0, 8).toUpperCase()} / R{selected.revisionNumber}</span><h2>{selected.title}</h2><p>{selected.author.displayName} · {selected.width}×{selected.height} · {selected.colorCount} {r.colorSuffix}</p></header><CommunityPreviewCanvas preview={selected.preview} label={`${selected.title} ${r.largePreview}`} /><div className="community-color-band large">{selected.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div></> : <p className="admin-empty">{r.select}</p>}</section>
      <aside className="review-actions"><h2>{r.action}</h2><label>{r.reason}<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={r.reasonPlaceholder} /></label>{error && <p role="alert" className="notice notice-danger">{error}</p>}<div><button className="btn-danger-outline" disabled={!selected || reason.trim().length < 3} onClick={() => void decide('rejected')}>{t.actions.dismiss}</button><button className="btn-primary" disabled={!selected || reason.trim().length < 3} onClick={() => void decide('published')}>{t.actions.approve}</button></div></aside>
    </div>
  );
}
