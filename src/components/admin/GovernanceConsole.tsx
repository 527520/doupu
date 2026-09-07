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
import { AdminEmpty, ReasonPanel, StatusBadge } from './AdminPrimitives';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';

type Mode = 'comments' | 'reports';
interface ModerationCheck { provider: string; suggestion: string | null; label: string | null; subLabel: string | null; score: number | null; keywords: string[]; reason: string; checkedAt: string }
interface Item { id: string; workId?: string; targetType?: string; targetId?: string; status: string; version: number; body?: string; category?: string; riskCategories?: string[]; details?: string | null; moderation?: ModerationCheck | null }

/** 内容安全判定摘要：来源、建议、标签、置信度、命中词，全部映射成中文。 */
function ModerationVerdict({ check }: { check: ModerationCheck }) {
  const m = zhCN.communityAdmin.moderationCheck;
  const label = (value: string | null) => (value ? m.labels[value as keyof typeof m.labels] ?? value : m.none);
  return <dl className="admin-facts moderation-verdict">
    <div><dt>{m.provider}</dt><dd>{m.providers[check.provider as keyof typeof m.providers] ?? check.provider}</dd></div>
    <div><dt>{m.suggestion}</dt><dd>{check.suggestion ? m.suggestions[check.suggestion as keyof typeof m.suggestions] ?? check.suggestion : m.none}</dd></div>
    <div><dt>{m.label}</dt><dd>{label(check.label)}{check.subLabel ? ` · ${check.subLabel}` : ''}</dd></div>
    {check.score !== null && <div><dt>{m.score}</dt><dd>{check.score}</dd></div>}
    {check.keywords.length > 0 && <div><dt>{m.keywords}</dt><dd>{check.keywords.join('、')}</dd></div>}
    <div><dt>{m.reason}</dt><dd>{m.reasons[check.reason as keyof typeof m.reasons] ?? check.reason}</dd></div>
    <div><dt>{m.checkedAt}</dt><dd>{new Date(check.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</dd></div>
  </dl>;
}

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
    {target.changed && <Notice kind="warning">{target.targetType === 'work' ? g.workChanged : g.commentChanged}</Notice>}
    {target.snapshot && <PatternPreview pattern={target.snapshot.pattern} boardSize={getBoardProfile(target.snapshot.boardProfile).boardCols} />}
    {target.body !== null && <p className="governance-body">{target.body}</p>}
    {!target.snapshot && target.body === null && <p>{g.contentUnavailable}</p>}
    {target.publicUrl ? <Link href={target.publicUrl} className="btn-outline btn-sm">{g.openCurrentTarget}</Link> : <p className="admin-help">{g.notPublic}</p>}
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
  const hideReportedComment = async () => {
    if (!canDecide || target?.targetType !== 'comment' || target.currentVersion === null || !['pending_review', 'published'].includes(target.contentStatus ?? '')) return;
    await command.run({ url: `/api/admin/community/comments/${target.targetId}`, method: 'PATCH',
      body: { decision: 'hidden', expectedVersion: target.currentVersion, reason },
    }, async () => { setReason(''); await inspection.reload(); });
  };
  return <div className={`review-console governance-console${selected ? ' is-inspecting' : ''}`}>
    <section className="review-queue" aria-label={g.queue} tabIndex={-1} ref={queueRef}>
      <header><h2>{mode === 'comments' ? t.pendingComments : t.pendingReports}</h2><span>{queue.items.length}</span></header>
      {queue.error ? <div className="admin-form-stack"><Notice kind="danger">{queue.error}</Notice><Button variant="secondary" icon="refresh" onClick={() => void queue.reload()}>{c.reload}</Button></div>
        : queue.loading ? <p role="status" className="admin-empty">{c.loading}</p>
          : queue.items.length === 0 ? <AdminEmpty icon="check" title={g.empty} />
            : <ul>{queue.items.map((item) => <li key={item.id}><button type="button" disabled={command.locked} aria-current={selected?.id === item.id} onClick={() => select(item.id)}><span><strong>{item.body?.slice(0, 24) || `${states.target[item.targetType as keyof typeof states.target] ?? item.targetType} / ${item.category ? riskLabel(item.category) : t.unmarked}`}</strong><small>{statusLabel(item.status)} · v{item.version}</small></span></button></li>)}</ul>}
    </section>
    <section className="review-preview" aria-label={g.caseMaterial} tabIndex={-1} ref={detailRef}>{selected ? <>
      <Button variant="quiet" size="sm" icon="chevron-left" className="admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</Button>
      <header><span>{g.caseMaterial}</span><h2>{mode === 'comments' ? t.commentPlainText : t.reportFacts}</h2></header>
      <p className="governance-body">{selected.body || selected.details || t.noDetails}</p>
      <dl className="admin-facts governance-facts"><div><dt>{g.status}</dt><dd><StatusBadge kind={mode === 'comments' ? 'comment' : 'report'} value={selected.status} /></dd></div><div><dt>{g.risk}</dt><dd>{selected.riskCategories?.map(riskLabel).join(g.separator) || (selected.category ? riskLabel(selected.category) : t.unmarked)}</dd></div></dl>
      {mode === 'comments' && (selected.moderation ? <ModerationVerdict check={selected.moderation} /> : <p className="admin-help">{t.moderationCheck.missing}</p>)}
      {mode === 'comments' && selected.status === 'rejected' && <Notice kind="warning">{t.moderationCheck.rejectedHelp}</Notice>}
      {mode === 'reports' && (target ? <ReportMaterial target={target} /> : inspection.error ? <div className="admin-form-stack"><Notice kind="danger">{inspection.error}</Notice><Button variant="secondary" icon="refresh" onClick={() => void inspection.reload()}>{c.reload}</Button></div> : <p role="status" className="admin-empty">{g.loadingTarget}</p>)}
    </> : <AdminEmpty icon="eye" title={g.select} />}</section>
    <aside className="review-actions">
      {selected && <><h2>{g.action}</h2>
        <ReasonPanel label={g.reason} reason={reason} onReasonChange={setReason} disabled={command.locked}
          hint={mode === 'reports' ? g.caseDoesNotModerate : undefined}>
          {mode === 'reports' && target?.targetType === 'comment' && ['pending_review', 'published'].includes(target.contentStatus ?? '') && <Button variant="danger" icon="eye" disabled={!canDecide} onClick={() => void hideReportedComment()}>{g.hideCurrentComment}</Button>}
          {mode === 'reports' && target?.targetType === 'work' && <Link href={`/admin/works?work=${target.targetId}`} className="btn-outline">{g.manageReportedWork}</Link>}
          {mode === 'comments' ? <>
            {selected.status !== 'rejected' && <Button variant="danger" icon="eye" disabled={!canDecide} onClick={() => void decide('hidden')}>{t.actions.hide}</Button>}
            <Button variant="primary" icon="check" disabled={!canDecide} onClick={() => void decide('published')}>{selected.status === 'rejected' ? t.actions.publishRejected : t.actions.publish}</Button>
          </> : <>
            <Button variant="quiet" icon="close" disabled={!canDecide} onClick={() => void decide('dismissed')}>{t.actions.dismiss}</Button>
            {selected.status === 'accepted'
              ? <Button variant="primary" icon="check" disabled={!canDecide} onClick={() => void decide('resolved')}>{t.actions.resolve}</Button>
              : <Button variant="primary" icon="inbox" disabled={!canDecide} onClick={() => void decide('accepted')}>{t.actions.accept}</Button>}
          </>}
        </ReasonPanel></>}
      <AdminCommandNotice command={command} onRefresh={() => void refresh()} />
      {selected && queue.error && <div className="admin-form-stack"><Notice kind="danger">{queue.error}</Notice><Button variant="secondary" icon="refresh" onClick={() => void queue.reload()}>{c.reload}</Button></div>}
    </aside>
  </div>;
}
