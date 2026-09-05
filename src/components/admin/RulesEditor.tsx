'use client';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { INITIAL_MODERATION_RULES, MODERATION_CATEGORIES, type ModerationRule, type ModerationCategory } from '@/lib/community/moderation';
import AdminCommandNotice from './AdminCommandNotice';
import AdminQueueState from './AdminQueueState';
import { useAdminCollection } from './useAdminCollection';
import { useAdminCommand } from './useAdminCommand';
import { useAdminTaskFocus } from './useAdminTaskFocus';

interface Version { id: string; version: number; rules: ModerationRule[]; active: boolean; reason: string; createdAt: string }

export default function RulesEditor() {
  const t = zhCN.communityAdmin.rules;
  const c = zhCN.communityAdmin.command;
  const queue = useAdminCollection<Version>('/api/admin/moderation-rules');
  const command = useAdminCommand();
  const [draft, setDraft] = useState<{ base: number; original: string; rules: ModerationRule[] } | null>(null);
  const [literal, setLiteral] = useState('');
  const [category, setCategory] = useState<ModerationCategory>('spam');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const current = queue.items.find((version) => version.active);
  const latestVersion = Math.max(0, ...queue.items.map((version) => version.version));
  const currentRules = current?.rules ?? INITIAL_MODERATION_RULES;
  const { queueRef, detailRef, rememberTrigger } = useAdminTaskFocus(draft ? 'editing' : null);
  const stale = draft !== null && draft.base !== latestVersion;
  const duplicate = draft?.rules.some((rule) => rule.category === category && rule.literal.toLocaleLowerCase('zh-CN') === literal.trim().toLocaleLowerCase('zh-CN'));
  const changed = draft && JSON.stringify(draft.rules) !== draft.original;
  const editable = !command.locked && !queue.error && !queue.loading && !stale;
  const start = () => {
    if (command.locked || queue.error || queue.loading) return;
    rememberTrigger();
    setDraft({ base: latestVersion, original: JSON.stringify(currentRules), rules: currentRules.map((rule) => ({ ...rule })) });
    setReason(''); setLiteral(''); setCategory('spam'); setConfirmed(false); command.resetNotice();
  };
  const publish = async () => {
    if (!draft || !editable || !changed || !confirmed || reason.trim().length < 3 || draft.rules.length === 0) return;
    await command.run({ url: '/api/admin/moderation-rules', method: 'POST',
      body: { rules: draft.rules, reason, expectedVersion: draft.base },
    }, async () => { setDraft(null); setReason(''); setConfirmed(false); await queue.reload(); });
  };
  return <div className={`admin-task-layout rules-task-layout${draft ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" ref={queueRef} tabIndex={-1} aria-label={t.historyTitle}>
      <header><h2>{t.current}</h2><span>{current ? `v${current.version}` : t.bundled}</span></header>
      <AdminQueueState {...queue} empty={false}>
        <div className="admin-form-stack">
          <p>{t.literalOnly}</p>
          <ul className="admin-rule-list">{currentRules.map((rule) => <li key={`${rule.category}:${rule.literal}`}><span>{rule.literal}</span><span>{t[rule.category]}</span></li>)}</ul>
          <button type="button" className="btn-primary" disabled={command.locked || draft !== null} onClick={start}>{t.editCurrent}</button>
          <h2>{t.historyTitle}</h2><p className="admin-help">{t.historyLimit}</p>
          {queue.items.map((version) => <details key={version.id}><summary>v{version.version} · {version.active ? t.current : t.history} · {version.rules.length} {t.ruleCount}</summary>
            <p>{version.reason}</p><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN')}</time>
            <ul className="admin-rule-list">{version.rules.map((rule) => <li key={`${rule.category}:${rule.literal}`}><span>{rule.literal}</span><span>{t[rule.category]}</span></li>)}</ul>
          </details>)}
        </div>
      </AdminQueueState>
    </section>
    <section className="admin-panel admin-task-detail" ref={detailRef} tabIndex={-1} aria-label={t.newVersion}>
      {draft ? <div className="admin-form-stack">
        <button type="button" className="btn-outline" disabled={command.locked} onClick={() => { setDraft(null); command.resetNotice(); }}>{c.cancel}</button>
        <h2>{t.newVersion}</h2><p>{t.baseVersion(draft.base)}</p>
        {stale && <div className="notice notice-warning"><p>{c.stale}</p><button type="button" className="btn-outline" disabled={command.locked} onClick={start}>{t.restart}</button></div>}
        <p className="notice">{t.replaceHelp}</p>
        <label>{t.literal}<input value={literal} maxLength={80} disabled={!editable} onChange={(event) => setLiteral(event.target.value)} /></label>
        <label>{t.category}<select value={category} disabled={!editable} onChange={(event) => setCategory(event.target.value as ModerationCategory)}>{MODERATION_CATEGORIES.map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></label>
        {duplicate && <p className="admin-help">{t.duplicate}</p>}
        <button type="button" className="btn-outline" disabled={!editable || !literal.trim() || duplicate || draft.rules.length >= 500} onClick={() => {
          setDraft({ ...draft, rules: [...draft.rules, { literal: literal.trim(), category, risk: 'review' }] }); setLiteral(''); setConfirmed(false);
        }}>{t.add}</button>
        <ul className="admin-rule-list">{draft.rules.map((rule, index) => <li key={`${rule.category}:${rule.literal}`}>
          <span>{rule.literal} · {t[rule.category]}</span><button type="button" className="btn-ghost" disabled={!editable} aria-label={`${t.remove} ${rule.literal}`} onClick={() => { setDraft({ ...draft, rules: draft.rules.filter((_, item) => item !== index) }); setConfirmed(false); }}>{t.remove}</button>
        </li>)}</ul>
        {draft.rules.length === 0 && <p className="notice notice-warning">{t.noEmpty}</p>}
        <label>{t.reason}<textarea value={reason} maxLength={500} disabled={command.locked} onChange={(event) => setReason(event.target.value)} /></label>
        <label className="admin-check"><input type="checkbox" checked={confirmed} disabled={!editable} onChange={(event) => setConfirmed(event.target.checked)} />{t.confirmReplace}</label>
        <button type="button" className="btn-primary" disabled={!editable || !changed || !confirmed || draft.rules.length === 0 || reason.trim().length < 3} onClick={() => void publish()}>{t.publish}</button>
      </div> : <p className="admin-empty">{t.select}</p>}
    </section>
    <div className="admin-task-notice"><AdminCommandNotice command={command} onRefresh={() => void queue.reload()} />{draft && queue.error && <AdminQueueState {...queue} empty={false}>{null}</AdminQueueState>}</div>
  </div>;
}
