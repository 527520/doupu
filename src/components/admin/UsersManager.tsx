'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { USER_ROLES, type UserRole, type AccountStatus } from '@/lib/auth/authorization';
import AdminCommandNotice from './AdminCommandNotice';
import AdminQueueState from './AdminQueueState';
import { useAdminCollection } from './useAdminCollection';
import { useAdminCommand } from './useAdminCommand';
import { useAdminTaskFocus } from './useAdminTaskFocus';

interface UserRow { userId: string; maskedEmail: string | null; username: string | null; role: UserRole; accountStatus: AccountStatus; governanceVersion: number; emailVerified: boolean; createdAt: string }

export default function UsersManager({ currentUserId }: { currentUserId: string }) {
  const t = zhCN.communityAdmin.users;
  const c = zhCN.communityAdmin.command;
  const states = zhCN.communityAdmin.states;
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const queue = useAdminCollection<UserRow>(`/api/admin/users?q=${encodeURIComponent(search)}`);
  const command = useAdminCommand();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.items.find((item) => item.userId === selectedId) ?? null;
  const { queueRef, detailRef } = useAdminTaskFocus(selected?.userId ?? null);
  const [role, setRole] = useState<UserRole>('user');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const canGovern = selected && selected.userId !== currentUserId && selected.accountStatus !== 'anonymized';
  const ready = canGovern && !queue.loading && !queue.error && !command.locked && reason.trim().length >= 3 && confirmation === selected.userId;
  const select = (user: UserRow | null) => {
    if (command.locked) return;
    setSelectedId(user?.userId ?? null); setRole(user?.role ?? 'user'); setReason(''); setConfirmation(''); command.resetNotice();
  };
  const query = () => {
    if (command.locked) return;
    select(null);
    if (q.trim() === search) void queue.reload();
    else setSearch(q.trim());
  };
  const update = async (change: { role?: UserRole; accountStatus?: 'active' | 'suspended' }) => {
    if (!selected || !ready) return;
    await command.run({ url: `/api/admin/users/${selected.userId}`, method: 'PATCH',
      body: { ...change, expectedVersion: selected.governanceVersion, targetConfirmation: confirmation, reason },
    }, async () => { setSelectedId(null); setConfirmation(''); setReason(''); await queue.reload(); });
  };
  return <div className={`admin-task-layout${selected ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" tabIndex={-1} ref={queueRef} aria-label={t.title}>
      <header><h2>{t.title}</h2></header>
      <form className="admin-form-stack" onSubmit={(event) => { event.preventDefault(); query(); }}>
        <label>{t.search}<input value={q} maxLength={80} disabled={command.locked} onChange={(event) => setQ(event.target.value)} /></label>
        <button type="submit" className="btn-outline" disabled={command.locked || queue.loading}>{t.query}</button><p className="admin-help">{t.searchHelp}</p>
      </form>
      <AdminQueueState {...queue} empty={queue.items.length === 0}>
        <ul className="admin-object-list">{queue.items.map((user) => <li key={user.userId}><button type="button" disabled={command.locked} aria-current={selected?.userId === user.userId} onClick={() => select(user)}>
          <strong>{user.username || user.maskedEmail || t.anonymized}</strong><span>{states.role[user.role]} · {states.account[user.accountStatus]}</span><small className="mono-id">{user.userId}</small>
        </button></li>)}</ul>
      </AdminQueueState>
    </section>
    <section className="admin-panel admin-task-detail" tabIndex={-1} ref={detailRef} aria-label={t.action}>
      {selected ? <div className="admin-form-stack">
        <button type="button" className="btn-outline admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</button>
        <h2>{selected.username || selected.maskedEmail || t.anonymized}</h2>
        <dl className="admin-facts"><div><dt>{t.accountId}</dt><dd className="break-all">{selected.userId}</dd></div><div><dt>{t.email}</dt><dd>{selected.maskedEmail ?? t.anonymized}{!selected.emailVerified && t.unverified}</dd></div>
          <div><dt>{t.role}</dt><dd>{states.role[selected.role]}</dd></div><div><dt>{t.status}</dt><dd>{states.account[selected.accountStatus]}</dd></div></dl>
        {!canGovern ? <p className="notice">{selected.userId === currentUserId ? t.selfProtected : t.anonymizedProtected}</p> : <>
          <p className="notice notice-warning">{t.impact}</p>
          <label>{t.reason}<textarea value={reason} maxLength={500} disabled={command.locked} onChange={(event) => setReason(event.target.value)} /></label>
          <label>{t.confirmation}<input value={confirmation} disabled={command.locked} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <ResponsiveSelect label={t.nextRole} value={role} disabled={command.locked} onValueChange={value=>setRole(value as UserRole)} options={USER_ROLES.map(value=>({value,label:states.role[value]}))} />
          {role === 'admin' && selected.role !== 'admin' && <p className="notice notice-warning">{t.adminWarning}</p>}
          <button type="button" className="btn-primary" disabled={!ready || role === selected.role} onClick={() => void update({ role })}>{t.changeRole}</button>
          <button type="button" className="btn-danger-outline" disabled={!ready} onClick={() => void update({ accountStatus: selected.accountStatus === 'suspended' ? 'active' : 'suspended' })}>{selected.accountStatus === 'suspended' ? t.restore : t.suspend}</button>
        </>}
      </div> : <p className="admin-empty">{c.select}</p>}
    </section>
    <div className="admin-task-notice"><AdminCommandNotice command={command} onRefresh={() => void queue.reload()} />{selected && queue.error && <AdminQueueState {...queue} empty={false}>{null}</AdminQueueState>}</div>
  </div>;
}
