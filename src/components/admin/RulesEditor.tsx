'use client';

import { useEffect, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

interface Rule { literal: string; category: 'harm' | 'harassment' | 'sexual' | 'spam'; risk: 'review' }
interface Version { id: string; version: number; rules: Rule[]; active: boolean; reason: string; createdAt: string }

export default function RulesEditor() {
  const t = zhCN.communityAdmin.rules;
  const [versions, setVersions] = useState<Version[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [literal, setLiteral] = useState('');
  const [category, setCategory] = useState<Rule['category']>('spam');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    const response = await fetch('/api/admin/moderation-rules');
    const body = await response.json();
    if (response.ok) setVersions(body.items);
  };
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/moderation-rules').then(async (response) => {
      const body = await response.json();
      if (active && response.ok) setVersions(body.items);
    });
    return () => { active = false; };
  }, []);
  const publish = async () => {
    const response = await fetch('/api/admin/moderation-rules', { method: 'POST', headers: {
      'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(),
    }, body: JSON.stringify({ rules, reason }) });
    const body = await response.json().catch(() => null);
    setMessage(response.ok ? `规则版本 v${body.version} 已启用。` : body?.error?.message ?? t.saveFailed);
    if (response.ok) { setRules([]); setReason(''); await load(); }
  };
  return <div className="admin-proof-grid">
    <section className="admin-panel"><header><h2>{t.newVersion}</h2><span>{t.literalOnly}</span></header>
      <div className="admin-form-stack"><label>{t.literal}<input value={literal} maxLength={80} onChange={(event) => setLiteral(event.target.value)} /></label><label>{t.category}<select value={category} onChange={(event) => setCategory(event.target.value as Rule['category'])}><option value="harm">{t.harm}</option><option value="harassment">{t.harassment}</option><option value="sexual">{t.sexual}</option><option value="spam">{t.spam}</option></select></label><button className="btn-secondary" type="button" disabled={!literal.trim()} onClick={() => { setRules((current) => [...current, { literal: literal.trim(), category, risk: 'review' }]); setLiteral(''); }}>{t.add}</button>
        <ul>{rules.map((rule, index) => <li key={`${rule.category}:${rule.literal}`}><code>{rule.literal}</code> · {t[rule.category]} <button type="button" onClick={() => setRules((current) => current.filter((_, item) => item !== index))}>{t.remove}</button></li>)}</ul>
        <label>{t.reason}<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><button className="btn-primary" type="button" disabled={rules.length === 0 || reason.trim().length < 3} onClick={() => void publish()}>{t.publish}</button>{message && <p role="status" className="notice">{message}</p>}
      </div>
    </section>
    <section className="admin-panel"><header><h2>{t.historyTitle}</h2><span>{versions.length}</span></header><table><thead><tr><th>{t.version}</th><th>{t.ruleCount}</th><th>{t.status}</th><th>{t.reasonColumn}</th></tr></thead><tbody>{versions.map((version) => <tr key={version.id}><td>v{version.version}</td><td>{version.rules.length}</td><td>{version.active ? t.current : t.history}</td><td>{version.reason}</td></tr>)}</tbody></table></section>
  </div>;
}
