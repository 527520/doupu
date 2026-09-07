'use client';

import { useState } from 'react';
import type { AdminAuditEntry } from '@/lib/admin/queries';
import { zhCN } from '@/messages/zh-CN';
import DatePicker from '@/components/ui/DatePicker';
import Button from '@/components/ui/Button';
import AdminQueueState from './AdminQueueState';
import { FilterBar, Pagination } from './AdminPrimitives';
import { useAdminCollection } from './useAdminCollection';
import { useAdminTaskFocus } from './useAdminTaskFocus';

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value));

/** 审计动作、对象类型与状态字段全部映射成中文；未知值原样展示，避免遮盖新事实。 */
const audit = zhCN.communityAdmin.audit;
const actionLabel = (action: string) => audit.actions[action as keyof typeof audit.actions] ?? action;
const targetLabel = (type: string) => audit.targets[type as keyof typeof audit.targets] ?? type;
const stateKeyLabel = (key: string) => audit.stateKeys[key as keyof typeof audit.stateKeys] ?? key;
const states = zhCN.communityAdmin.states;
const stateValueLabel = (key: string, value: string | number | boolean | null): string => {
  if (value === null) return audit.empty;
  if (typeof value === 'boolean') return value ? audit.booleans.true : audit.booleans.false;
  const text = String(value);
  const maps: Record<string, Record<string, string>> = {
    role: states.role, accountStatus: states.account, revisionStatus: states.revision, lifecycleStatus: states.work, reportStatus: states.report,
    status: { ...states.revision, ...states.comment, ...states.report, ...states.account, ...audit.batchStatuses },
    decision: { ...states.revision, ...states.comment, ...states.report },
  };
  return maps[key]?.[text] ?? text;
};

export default function AuditExplorer() {
  const t = zhCN.communityAdmin.audit;
  const c = zhCN.communityAdmin.command;
  const [fields, setFields] = useState({ q: '', from: '', to: '' });
  const [filter, setFilter] = useState(fields);
  const [cursors, setCursors] = useState(['']);
  const query = new URLSearchParams(filter);
  if (cursors.at(-1)) query.set('cursor', cursors.at(-1)!);
  const queue = useAdminCollection<AdminAuditEntry>(`/api/admin/audit?${query}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.items.find((item) => item.id === selectedId) ?? null;
  const { queueRef, detailRef } = useAdminTaskFocus(selected?.id ?? null);
  const move = (next: string[]) => { setSelectedId(null); setCursors(next); };
  const stateView = (state: AdminAuditEntry['beforeState']) => state && Object.keys(state).length > 0
    ? <dl className="admin-evidence-list">{Object.entries(state).map(([key, value]) => <div key={key}><dt>{stateKeyLabel(key)}</dt><dd>{stateValueLabel(key, value)}</dd></div>)}</dl>
    : <p className="admin-help">{t.noState}</p>;
  return <div className={`admin-task-layout${selected ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" ref={queueRef} tabIndex={-1} aria-label={t.queue}>
      <header><h2>{t.queue}</h2><span>{zhCN.communityAdmin.works.page(cursors.length)}</span></header>
      <FilterBar submitLabel={t.query} disabled={queue.loading || Boolean(fields.from && fields.to && fields.from > fields.to)} onSubmit={(event) => { event.preventDefault(); move(['']); setFilter({ ...fields }); if (JSON.stringify(fields) === JSON.stringify(filter) && cursors.length === 1) void queue.reload(); }}>
        <label>{t.search}<input value={fields.q} maxLength={120} onChange={(event) => setFields({ ...fields, q: event.target.value })} /></label>
        <DatePicker label={t.from} value={fields.from} max={fields.to || undefined} onValueChange={(from) => setFields({ ...fields, from })} />
        <DatePicker label={t.to} value={fields.to} min={fields.from || undefined} onValueChange={(to) => setFields({ ...fields, to })} />
      </FilterBar>
      <p className="admin-help admin-queue-help">{t.queryHelp}</p>
      <AdminQueueState {...queue} empty={queue.items.length === 0}><ul className="admin-object-list">{queue.items.map((item) => <li key={item.id}><button type="button" aria-current={selectedId === item.id} onClick={() => setSelectedId(item.id)}><strong>{actionLabel(item.action)}</strong><span>{formatDate(item.createdAt)} · {zhCN.communityAdmin.states.role[item.actorRole]} · {targetLabel(item.targetType)}</span><small className="mono-id">{item.targetId}</small></button></li>)}</ul></AdminQueueState>
      <Pagination page={cursors.length} hasPrevious={cursors.length > 1} hasNext={Boolean(queue.nextCursor)} disabled={queue.loading} onPrevious={() => move(cursors.slice(0, -1))} onNext={() => move([...cursors, queue.nextCursor!])} />
    </section>
    <section className="admin-panel admin-task-detail" ref={detailRef} tabIndex={-1} aria-label={t.detail}>
      {selected ? <div className="admin-form-stack"><Button variant="quiet" size="sm" icon="chevron-left" className="admin-back-to-queue" onClick={() => setSelectedId(null)}>{c.back}</Button><h2>{t.detail}</h2>
        <dl className="admin-evidence-list">
          <div><dt>{t.time}</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>{t.action}</dt><dd>{actionLabel(selected.action)}<br /><code>{selected.action}</code></dd></div>
          <div><dt>{t.target}</dt><dd>{targetLabel(selected.targetType)}<br /><code>{selected.targetId}</code></dd></div><div><dt>{t.role}</dt><dd>{zhCN.communityAdmin.states.role[selected.actorRole]}</dd></div>
          <div><dt>{t.actor}</dt><dd><code>{selected.actorUserId ?? t.anonymized}</code></dd></div><div><dt>{t.request}</dt><dd><code>{selected.requestId}</code></dd></div>
          <div><dt>{t.reason}</dt><dd className="governance-body">{selected.reason}</dd></div>
        </dl><section><h3>{t.before}</h3>{stateView(selected.beforeState)}</section><section><h3>{t.after}</h3>{stateView(selected.afterState)}</section><p className="admin-help">{t.readOnly}</p>
      </div> : <p className="admin-empty">{t.select}</p>}
    </section>
  </div>;
}
