'use client';

import { useEffect, useState } from 'react';

type Mode = 'comments' | 'reports';
interface Item { id: string; workId?: string; targetType?: string; targetId?: string; status: string; version: number; body?: string; category?: string; riskCategories?: string[]; details?: string | null }

export default function GovernanceConsole({ mode }: { mode: Mode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const load = async () => {
    const response = await fetch(`/api/admin/community/${mode}`);
    const body = await response.json();
    if (!response.ok) { setError(body?.error?.message ?? '队列加载失败'); return; }
    setItems(body.items);
    setSelectedId((current) => body.items.some((item: Item) => item.id === current) ? current : body.items[0]?.id ?? null);
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/community/${mode}`).then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) { setError(body?.error?.message ?? '队列加载失败'); return; }
      setItems(body.items);
      setSelectedId(body.items[0]?.id ?? null);
    });
    return () => { active = false; };
  }, [mode]);

  const decide = async (decision: string) => {
    if (!selected || reason.trim().length < 3) return;
    const response = await fetch(`/api/admin/community/${mode}/${selected.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ decision, expectedVersion: selected.version, reason }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error?.message ?? '处置失败'); return; }
    setReason(''); setError(null); await load();
  };

  return <div className="review-console governance-console">
    <section className="review-queue" aria-label="治理队列"><header><h2>{mode === 'comments' ? '待审评论' : '待处理举报'}</h2><span>{items.length}</span></header>
      {items.length === 0 ? <p className="admin-empty">队列已清空。</p> : <ul>{items.map((item) => <li key={item.id}><button type="button" aria-current={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.body?.slice(0, 24) || `${item.targetType} / ${item.category}`}</strong><small>{item.status} · v{item.version}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview">{selected ? <><span className="studio-eyebrow">CASE MATERIAL</span><h2>{mode === 'comments' ? '评论正文（纯文本）' : '举报事实'}</h2><p className="governance-body">{selected.body || selected.details || '未提供补充说明'}</p><dl><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>风险</dt><dd>{selected.riskCategories?.join('、') || selected.category || '未标记'}</dd></div></dl></> : <p className="admin-empty">选择一项查看。</p>}</section>
    <aside className="review-actions"><h2>处置</h2><label>处置理由<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>{error && <p role="alert" className="notice notice-danger">{error}</p>}<div>{mode === 'comments' ? <><button className="btn-danger-outline" disabled={reason.trim().length < 3} onClick={() => void decide('hidden')}>隐藏</button><button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('published')}>公开</button></> : <><button className="btn-ghost" disabled={reason.trim().length < 3} onClick={() => void decide('dismissed')}>驳回</button>{selected?.status === 'accepted' ? <button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('resolved')}>结案</button> : <button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('accepted')}>受理</button>}</>}</div></aside>
  </div>;
}
