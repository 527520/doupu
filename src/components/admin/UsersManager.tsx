'use client';

import { useEffect, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
interface UserRow { userId: string; maskedEmail: string | null; username: string | null; role: 'user' | 'moderator' | 'admin'; accountStatus: 'active' | 'suspended' | 'anonymized'; governanceVersion: number; emailVerified: boolean; createdAt: string }

export default function UsersManager() {
  const t = zhCN.communityAdmin.users;
  const states = zhCN.communityAdmin.states;
  const [items, setItems] = useState<UserRow[]>([]); const [q, setQ] = useState(''); const [reason, setReason] = useState(''); const [confirmation, setConfirmation] = useState(''); const [message, setMessage] = useState<string | null>(null);
  const load = async (search = q) => { const response = await fetch(`/api/admin/users?q=${encodeURIComponent(search)}`); const body = await response.json(); if (response.ok) setItems(body.items); else setMessage(body?.error?.message ?? t.loadFailed); };
  useEffect(() => { let active = true; void fetch('/api/admin/users').then(async (response) => { const body = await response.json(); if (active && response.ok) setItems(body.items); }); return () => { active = false; }; }, []);
  const update = async (user: UserRow, change: { role?: UserRow['role']; accountStatus?: 'active' | 'suspended' }) => {
    const response = await fetch(`/api/admin/users/${user.userId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ ...change, expectedVersion: user.governanceVersion, targetConfirmation: confirmation, reason }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? t.updated : body?.error?.message ?? t.updateFailed); if (response.ok) { setConfirmation(''); await load(); }
  };
  return <section className="admin-panel"><header><h2>{t.title}</h2><span>{items.length}</span></header><div className="admin-form-stack user-filters"><label>{t.search}<input value={q} onChange={(event) => setQ(event.target.value)} /></label><button type="button" className="btn-secondary" onClick={() => void load()}>{t.query}</button><label>{t.reason}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><label>{t.confirmation}<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label></div>{message && <p className="notice" role="status">{message}</p>}<div className="admin-table-scroll"><table><thead><tr><th>{t.account}</th><th>{t.role}</th><th>{t.status}</th><th>{t.action}</th></tr></thead><tbody>{items.map((user) => <tr key={user.userId}><td><strong>{user.username || user.maskedEmail || t.anonymized}</strong><small className="mono-id">{user.userId}</small></td><td>{states.role[user.role]}</td><td>{states.account[user.accountStatus]}{!user.emailVerified && t.unverified}</td><td><div className="table-actions"><button type="button" disabled={reason.trim().length < 3 || confirmation !== user.userId || user.accountStatus === 'anonymized'} onClick={() => void update(user, { role: user.role === 'user' ? 'moderator' : 'user' })}>{user.role === 'user' ? t.promote : t.demote}</button><button type="button" disabled={reason.trim().length < 3 || confirmation !== user.userId || user.accountStatus === 'anonymized'} onClick={() => void update(user, { accountStatus: user.accountStatus === 'suspended' ? 'active' : 'suspended' })}>{user.accountStatus === 'suspended' ? t.restore : t.suspend}</button></div></td></tr>)}</tbody></table></div></section>;
}
