'use client';

import { useEffect, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

type Mode = 'comments' | 'reports';
interface Item { id: string; workId?: string; targetType?: string; targetId?: string; status: string; version: number; body?: string; category?: string; riskCategories?: string[]; details?: string | null }

export default function GovernanceConsole({ mode }: { mode: Mode }) {
  const t = zhCN.communityAdmin;
  const g = t.governance;
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const load = async () => {
    const response = await fetch(`/api/admin/community/${mode}`);
    const body = await response.json();
    if (!response.ok) { setError(body?.error?.message ?? t.queueLoadFailed); return; }
    setItems(body.items);
    setSelectedId((current) => body.items.some((item: Item) => item.id === current) ? current : body.items[0]?.id ?? null);
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/community/${mode}`).then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) { setError(body?.error?.message ?? t.queueLoadFailed); return; }
      setItems(body.items);
      setSelectedId(body.items[0]?.id ?? null);
    });
    return () => { active = false; };
  }, [mode, t.queueLoadFailed]);

  const decide = async (decision: string) => {
    if (!selected || reason.trim().length < 3) return;
    const response = await fetch(`/api/admin/community/${mode}/${selected.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ decision, expectedVersion: selected.version, reason }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error?.message ?? t.actionFailed); return; }
    setReason(''); setError(null); await load();
  };

  return <div className="review-console governance-console">
    <section className="review-queue" aria-label={g.queue}><header><h2>{mode === 'comments' ? t.pendingComments : t.pendingReports}</h2><span>{items.length}</span></header>
      {items.length === 0 ? <p className="admin-empty">{g.empty}</p> : <ul>{items.map((item) => <li key={item.id}><button type="button" aria-current={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.body?.slice(0, 24) || `${item.targetType} / ${item.category}`}</strong><small>{item.status} · v{item.version}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview">{selected ? <><span className="studio-eyebrow">{g.caseMaterial.toUpperCase()}</span><h2>{mode === 'comments' ? t.commentPlainText : t.reportFacts}</h2><p className="governance-body">{selected.body || selected.details || t.noDetails}</p><dl><div><dt>{g.status}</dt><dd>{selected.status}</dd></div><div><dt>{g.risk}</dt><dd>{selected.riskCategories?.join(g.separator) || selected.category || t.unmarked}</dd></div></dl></> : <p className="admin-empty">{g.select}</p>}</section>
    <aside className="review-actions"><h2>{g.action}</h2><label>{g.reason}<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>{error && <p role="alert" className="notice notice-danger">{error}</p>}<div>{mode === 'comments' ? <><button className="btn-danger-outline" disabled={reason.trim().length < 3} onClick={() => void decide('hidden')}>{t.actions.hide}</button><button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('published')}>{t.actions.publish}</button></> : <><button className="btn-ghost" disabled={reason.trim().length < 3} onClick={() => void decide('dismissed')}>{t.actions.dismiss}</button>{selected?.status === 'accepted' ? <button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('resolved')}>{t.actions.resolve}</button> : <button className="btn-primary" disabled={reason.trim().length < 3} onClick={() => void decide('accepted')}>{t.actions.accept}</button>}</>}</div></aside>
  </div>;
}
