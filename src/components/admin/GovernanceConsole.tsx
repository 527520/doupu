'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PatternPreview from '@/components/preview/PatternPreview';
import { getBoardProfile } from '@/lib/boardProfiles';
import type { ReportTargetInspection } from '@/lib/community/reportInspection';
import { zhCN } from '@/messages/zh-CN';

type Mode = 'comments' | 'reports';
interface Item { id: string; workId?: string; targetType?: string; targetId?: string; status: string; version: number; body?: string; category?: string; riskCategories?: string[]; details?: string | null }

function ReportMaterial({ target }: { target: ReportTargetInspection }) {
  const { governance: g, states } = zhCN.communityAdmin;
  const status = target.targetType === 'work'
    ? states.revision[target.contentStatus as keyof typeof states.revision]
    : states.comment[target.contentStatus as keyof typeof states.comment];
  return <div className="report-material">
    <h3>{target.title ?? g.targetUnavailable}</h3>
    <dl>
      <div><dt>{g.targetId}</dt><dd className="break-all">{target.targetId}</dd></div>
      <div><dt>{g.reportedVersion}</dt><dd>{target.reportedVersion}</dd></div>
      <div><dt>{g.contentVersion}</dt><dd>{target.contentVersion ?? g.unavailable}</dd></div>
      <div><dt>{g.currentVersion}</dt><dd>{target.currentVersion ?? g.unavailable}</dd></div>
      <div><dt>{g.contentStatus}</dt><dd>{status ?? g.targetUnavailable}</dd></div>
      {target.workStatus && <div><dt>{g.workStatus}</dt><dd>{states.work[target.workStatus]}</dd></div>}
    </dl>
    {target.changed && <p className="notice notice-warning">{target.targetType === 'work' ? g.workChanged : g.commentChanged}</p>}
    {target.snapshot && <PatternPreview pattern={target.snapshot.pattern} boardSize={getBoardProfile(target.snapshot.boardProfile).boardCols} />}
    {target.body !== null && <p className="governance-body">{target.body}</p>}
    {!target.snapshot && target.body === null && <p>{g.contentUnavailable}</p>}
    {target.publicUrl ? <Link href={target.publicUrl}>{g.openCurrentTarget}</Link> : <p>{g.notPublic}</p>}
  </div>;
}

export default function GovernanceConsole({ mode }: { mode: Mode }) {
  const t = zhCN.communityAdmin;
  const g = t.governance;
  const states = t.states;
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ReportTargetInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const reportId = mode === 'reports' ? selected?.id : undefined;
  const target = inspection?.reportId === reportId ? inspection : null;
  const canDecide = Boolean(selected) && reason.trim().length >= 3 && (mode === 'comments' || target !== null);
  const statusLabel = (status: string) => mode === 'comments'
    ? states.comment[status as keyof typeof states.comment] ?? status
    : states.report[status as keyof typeof states.report] ?? status;
  const riskLabel = (risk: string) => states.risk[risk as keyof typeof states.risk] ?? risk;
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

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    void fetch(`/api/admin/community/reports/${reportId}`).then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) throw new Error(body?.error?.message ?? g.inspectionFailed);
      setInspection(body); setInspectionError(null);
    }).catch(() => { if (active) setInspectionError(g.inspectionFailed); });
    return () => { active = false; };
  }, [reportId, g.inspectionFailed]);

  const decide = async (decision: string) => {
    if (!selected || !canDecide) return;
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
      {items.length === 0 ? <p className="admin-empty">{g.empty}</p> : <ul>{items.map((item) => <li key={item.id}><button type="button" aria-current={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.body?.slice(0, 24) || `${states.target[item.targetType as keyof typeof states.target] ?? item.targetType} / ${item.category ? riskLabel(item.category) : t.unmarked}`}</strong><small>{statusLabel(item.status)} · v{item.version}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview">{selected ? <><span className="studio-eyebrow">{g.caseMaterial.toUpperCase()}</span><h2>{mode === 'comments' ? t.commentPlainText : t.reportFacts}</h2><p className="governance-body">{selected.body || selected.details || t.noDetails}</p><dl><div><dt>{g.status}</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>{g.risk}</dt><dd>{selected.riskCategories?.map(riskLabel).join(g.separator) || (selected.category ? riskLabel(selected.category) : t.unmarked)}</dd></div></dl>{mode === 'reports' && (target ? <ReportMaterial target={target} /> : <p role="status">{inspectionError ?? g.loadingTarget}</p>)}</> : <p className="admin-empty">{g.select}</p>}</section>
    <aside className="review-actions"><h2>{g.action}</h2><label>{g.reason}<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>{error && <p role="alert" className="notice notice-danger">{error}</p>}<div>{mode === 'comments' ? <><button className="btn-danger-outline" disabled={!canDecide} onClick={() => void decide('hidden')}>{t.actions.hide}</button><button className="btn-primary" disabled={!canDecide} onClick={() => void decide('published')}>{t.actions.publish}</button></> : <><button className="btn-ghost" disabled={!canDecide} onClick={() => void decide('dismissed')}>{t.actions.dismiss}</button>{selected?.status === 'accepted' ? <button className="btn-primary" disabled={!canDecide} onClick={() => void decide('resolved')}>{t.actions.resolve}</button> : <button className="btn-primary" disabled={!canDecide} onClick={() => void decide('accepted')}>{t.actions.accept}</button>}</>}</div></aside>
  </div>;
}
