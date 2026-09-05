'use client';

import { useState } from 'react';
import Link from 'next/link';
import PatternPreview from '@/components/preview/PatternPreview';
import { getBoardProfile } from '@/lib/boardProfiles';
import type { ReportTargetInspection } from '@/lib/community/reportInspection';
import { zhCN } from '@/messages/zh-CN';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';
import { useAdminCommand } from './useAdminCommand';
import AdminCommandNotice from './AdminCommandNotice';
import { useAdminTaskFocus } from './useAdminTaskFocus';

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
  const c = t.command;
  const states = t.states;
  const queue = useAdminCollection<Item>(`/api/admin/community/${mode}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const selected = queue.items.find((item) => item.id === selectedId) ?? null;
  const { queueRef, detailRef } = useAdminTaskFocus(selected?.id ?? null);
  const inspection = useAdminInspection<ReportTargetInspection>(mode === 'reports' && selected ? `/api/admin/community/reports/${selected.id}` : null);
  const target = inspection.data?.reportId === selected?.id ? inspection.data : null;
  const command = useAdminCommand();
  const canDecide = !queue.loading && !queue.error && !command.locked && Boolean(selected)
    && reason.trim().length >= 3 && (mode === 'comments' || target !== null);
  const statusLabel = (status: string) => mode === 'comments'
    ? states.comment[status as keyof typeof states.comment] ?? status
    : states.report[status as keyof typeof states.report] ?? status;
  const riskLabel = (risk: string) => states.risk[risk as keyof typeof states.risk] ?? risk;
  const select = (id: string | null) => {
    if (command.locked) return;
    setSelectedId(id); setReason(''); command.resetNotice();
  };
  const decide = async (decision: string) => {
    if (!selected || !canDecide) return;
    await command.run({
      url: `/api/admin/community/${mode}/${selected.id}`, method: 'PATCH',
      body: { decision, expectedVersion: selected.version, reason },
    }, async () => { setReason(''); setSelectedId(null); await queue.reload(); });
  };
  const refresh = async () => { await queue.reload(); await inspection.reload(); };
  return <div className={`review-console governance-console${selected ? ' is-inspecting' : ''}`}>
    <section className="review-queue" aria-label={g.queue} tabIndex={-1} ref={queueRef}>
      <header><h2>{mode === 'comments' ? t.pendingComments : t.pendingReports}</h2><span>{queue.items.length}</span></header>
      {queue.error ? <div><p role="alert" className="notice notice-danger">{queue.error}</p><button type="button" className="btn-outline" onClick={() => void queue.reload()}>{c.reload}</button></div>
        : queue.loading ? <p role="status" className="admin-empty">{c.loading}</p>
          : queue.items.length === 0 ? <p className="admin-empty">{g.empty}</p>
            : <ul>{queue.items.map((item) => <li key={item.id}><button type="button" disabled={command.locked} aria-current={selected?.id === item.id} onClick={() => select(item.id)}><span><strong>{item.body?.slice(0, 24) || `${states.target[item.targetType as keyof typeof states.target] ?? item.targetType} / ${item.category ? riskLabel(item.category) : t.unmarked}`}</strong><small>{statusLabel(item.status)} · v{item.version}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview" aria-label={g.caseMaterial} tabIndex={-1} ref={detailRef}>{selected ? <>
      <button type="button" className="btn-outline admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</button>
      <span className="studio-eyebrow">{g.caseMaterial}</span><h2>{mode === 'comments' ? t.commentPlainText : t.reportFacts}</h2>
      <p className="governance-body">{selected.body || selected.details || t.noDetails}</p>
      <dl><div><dt>{g.status}</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>{g.risk}</dt><dd>{selected.riskCategories?.map(riskLabel).join(g.separator) || (selected.category ? riskLabel(selected.category) : t.unmarked)}</dd></div></dl>
      {mode === 'reports' && (target ? <ReportMaterial target={target} /> : inspection.error ? <div><p role="alert">{inspection.error}</p><button type="button" className="btn-outline" onClick={() => void inspection.reload()}>{c.reload}</button></div> : <p role="status">{g.loadingTarget}</p>)}
    </> : <p className="admin-empty">{g.select}</p>}</section>
    <aside className="review-actions">
      {selected && <><h2>{g.action}</h2><label>{g.reason}<textarea value={reason} maxLength={500} disabled={command.locked} onChange={(event) => setReason(event.target.value)} /></label>
        <div>{mode === 'comments' ? <><button type="button" className="btn-danger-outline" disabled={!canDecide} onClick={() => void decide('hidden')}>{t.actions.hide}</button><button type="button" className="btn-primary" disabled={!canDecide} onClick={() => void decide('published')}>{t.actions.publish}</button></> : <><button type="button" className="btn-ghost" disabled={!canDecide} onClick={() => void decide('dismissed')}>{t.actions.dismiss}</button>{selected.status === 'accepted' ? <button type="button" className="btn-primary" disabled={!canDecide} onClick={() => void decide('resolved')}>{t.actions.resolve}</button> : <button type="button" className="btn-primary" disabled={!canDecide} onClick={() => void decide('accepted')}>{t.actions.accept}</button>}</>}</div></>}
      <AdminCommandNotice command={command} onRefresh={() => void refresh()} />
      {selected && queue.error && <div><p role="alert">{queue.error}</p><button type="button" className="btn-outline" onClick={() => void queue.reload()}>{c.reload}</button></div>}
    </aside>
  </div>;
}
