'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Switch from '@/components/ui/Switch';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import AdminCommandNotice from './AdminCommandNotice';
import AdminQueueState from './AdminQueueState';
import { useAdminCollection } from './useAdminCollection';
import { useAdminCommand } from './useAdminCommand';
import { useAdminTaskFocus } from './useAdminTaskFocus';

interface Tag { id: string; name: string; slug: string; sortOrder: number; active: boolean; mergedIntoTagId: string | null; version: number }

export default function TagsManager() {
  const t = zhCN.communityAdmin.tags;
  const c = zhCN.communityAdmin.command;
  const queue = useAdminCollection<Tag>('/api/admin/community/tags');
  const command = useAdminCommand();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.items.find((tag) => tag.id === selectedId) ?? null;
  const creating = selectedId === 'new';
  const inspecting = creating || selected !== null;
  const { queueRef, detailRef } = useAdminTaskFocus(inspecting ? selectedId : null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [order, setOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const target = queue.items.find((tag) => tag.id === mergeTarget && tag.active && !tag.mergedIntoTagId);
  const editable = !command.locked && !queue.loading && !queue.error && !selected?.mergedIntoTagId;
  const validReason = reason.trim().length >= 3;
  const validFields = name.trim().length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    && order.trim() !== '' && Number.isInteger(Number(order)) && Number(order) >= -2147483648 && Number(order) <= 2147483647;
  const changed = creating || (selected && (name.trim() !== selected.name || slug !== selected.slug || Number(order) !== selected.sortOrder || active !== selected.active));
  const select = (tag: Tag | 'new' | null) => {
    if (command.locked) return;
    const item = typeof tag === 'object' ? tag : null;
    setSelectedId(tag === 'new' ? 'new' : item?.id ?? null);
    setName(item?.name ?? ''); setSlug(item?.slug ?? ''); setOrder(String(item?.sortOrder ?? 0));
    setActive(item?.active ?? true); setReason(''); setMergeTarget(''); setMergeConfirmed(false); command.resetNotice();
  };
  const completed = async () => { setSelectedId(null); setReason(''); await queue.reload(); };
  const save = async () => {
    if (!editable || !validReason || !validFields || !changed) return;
    const fields = { name: name.trim(), slug, sortOrder: Number(order), reason };
    await command.run(creating
      ? { url: '/api/admin/community/tags', method: 'POST', body: { ...fields, expectedVersion: 0 } }
      : { url: `/api/admin/community/tags/${selected!.id}`, method: 'PATCH', body: { ...fields, active, expectedVersion: selected!.version } }, completed);
  };
  const merge = async () => {
    if (!selected || !target || !editable || !validReason || !mergeConfirmed) return;
    await command.run({ url: `/api/admin/community/tags/${selected.id}/merge`, method: 'POST',
      body: { targetTagId: target.id, expectedVersion: selected.version, reason } }, completed);
  };
  return <div className={`admin-task-layout${inspecting ? ' is-inspecting' : ''}`}>
    <section className="admin-panel admin-task-queue" tabIndex={-1} ref={queueRef} aria-label={t.title}>
      <header><h2>{t.title}</h2><button type="button" className="btn-outline" disabled={command.locked || queue.loading || Boolean(queue.error)} onClick={() => select('new')}>{t.create}</button></header>
      <AdminQueueState {...queue} empty={queue.items.length === 0}>
        <ul className="admin-object-list">{queue.items.map((tag) => <li key={tag.id}><button type="button" disabled={command.locked} aria-current={selected?.id === tag.id} onClick={() => select(tag)}>
          <strong>{tag.name}</strong><span>{tag.mergedIntoTagId ? t.mergedState : tag.active ? t.enabled : t.disabled} · {t.sort} {tag.sortOrder}</span>
        </button></li>)}</ul>
      </AdminQueueState>
    </section>
    <section className="admin-panel admin-task-detail" tabIndex={-1} ref={detailRef} aria-label={t.action}>
      {inspecting ? <div className="admin-form-stack">
        <button type="button" className="btn-outline admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</button>
        <h2>{creating ? t.createTitle : selected!.name}</h2>
        {selected?.mergedIntoTagId ? <p>{t.mergedTo} {queue.items.find((tag) => tag.id === selected.mergedIntoTagId)?.name ?? selected.mergedIntoTagId}</p> : <>
          <label>{t.name}<input value={name} maxLength={30} disabled={!editable} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t.slug}<input value={slug} maxLength={50} disabled={!editable} onChange={(event) => setSlug(event.target.value)} aria-describedby="tag-slug-help" /></label>
          <p id="tag-slug-help" className="admin-help">{t.slugHelp}</p>
          <label>{t.sort}<input type="number" step="1" value={order} disabled={!editable} onChange={(event) => setOrder(event.target.value)} /></label>
          {!creating && <Switch label={t.enabled} checked={active} disabled={!editable} onChange={setActive} />}
          <label>{t.reason}<textarea value={reason} maxLength={500} disabled={command.locked} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="button" className="btn-primary" disabled={!editable || !validFields || !validReason || !changed} onClick={() => void save()}>{creating ? t.create : c.save}</button>
          {selected && <details><summary>{t.merge}</summary><div className="admin-form-stack">
            <p>{t.mergeHelp}</p>
            <ResponsiveSelect label={t.mergeTarget} value={mergeTarget} disabled={!editable} onValueChange={value=>{setMergeTarget(value);setMergeConfirmed(false);}} options={[{value:'',label:t.chooseTarget},...queue.items.filter(tag=>tag.id!==selected.id&&tag.active&&!tag.mergedIntoTagId).map(tag=>({value:tag.id,label:tag.name}))]} />
            {target && <label className="admin-check"><input type="checkbox" checked={mergeConfirmed} disabled={!editable} onChange={(event) => setMergeConfirmed(event.target.checked)} />{t.confirmMerge(selected.name, target.name)}</label>}
            <button type="button" className="btn-danger-outline" disabled={!editable || !target || !mergeConfirmed || !validReason} onClick={() => void merge()}>{t.mergeSubmit}</button>
          </div></details>}
        </>}
      </div> : <p className="admin-empty">{c.select}</p>}
    </section>
    <div className="admin-task-notice"><AdminCommandNotice command={command} onRefresh={() => void queue.reload()} />{inspecting && queue.error && <AdminQueueState {...queue} empty={false}>{null}</AdminQueueState>}</div>
  </div>;
}
