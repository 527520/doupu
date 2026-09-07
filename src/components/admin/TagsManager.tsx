'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Switch from '@/components/ui/Switch';

import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import AdminCommandNotice from './AdminCommandNotice';
import AdminQueueState from './AdminQueueState';
import { ReasonPanel } from './AdminPrimitives';
import Button from '@/components/ui/Button';
import Disclosure from '@/components/ui/Disclosure';
import NumberField from '@/components/ui/NumberField';
import Badge from '@/components/ui/Badge';
import { useAdminCollection } from './useAdminCollection';
import { useAdminCommand } from './useAdminCommand';
import { useAdminTaskFocus } from './useAdminTaskFocus';

interface Tag { id: string; name: string; slug: string; sortOrder: number; active: boolean; mergedIntoTagId: string | null; version: number; workCount?: number }

/** 标签维护台：改名、排序、停用与合并。日常打标在作品管理里直接输入名称完成。 */
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
  const [order, setOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const target = queue.items.find((tag) => tag.id === mergeTarget && tag.active && !tag.mergedIntoTagId);
  const editable = !command.locked && !queue.loading && !queue.error && !selected?.mergedIntoTagId;
  const validReason = reason.trim().length >= 3;
  const validFields = name.trim().length > 0 && name.trim().length <= 30
    && order.trim() !== '' && Number.isInteger(Number(order)) && Number(order) >= -2147483648 && Number(order) <= 2147483647;
  const changed = creating || (selected && (name.trim() !== selected.name || Number(order) !== selected.sortOrder || active !== selected.active));
  const select = (tag: Tag | 'new' | null) => {
    if (command.locked) return;
    const item = typeof tag === 'object' ? tag : null;
    setSelectedId(tag === 'new' ? 'new' : item?.id ?? null);
    setName(item?.name ?? ''); setOrder(String(item?.sortOrder ?? 0));
    setActive(item?.active ?? true); setReason(''); setMergeTarget(''); setMergeConfirmed(false); command.resetNotice();
  };
  const completed = async () => { setSelectedId(null); setReason(''); await queue.reload(); };
  const save = async () => {
    if (!editable || !validReason || !validFields || !changed) return;
    const fields = { name: name.trim(), sortOrder: Number(order), reason };
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
      <header><h2>{t.title}</h2><Button variant="primary" size="sm" icon="plus" disabled={command.locked || queue.loading || Boolean(queue.error)} onClick={() => select('new')}>{t.create}</Button></header>
      <p className="admin-help admin-queue-help">{t.quickHelp}</p>
      <AdminQueueState {...queue} empty={queue.items.length === 0}>
        <ul className="admin-object-list">{queue.items.map((tag) => <li key={tag.id}><button type="button" disabled={command.locked} aria-current={selected?.id === tag.id} onClick={() => select(tag)}>
          <strong>{tag.name}</strong><span>{tag.mergedIntoTagId ? <Badge tone="neutral">{t.mergedState}</Badge> : <Badge tone={tag.active ? 'ok' : 'warn'}>{tag.active ? t.enabled : t.disabled}</Badge>}<small>{t.usage(tag.workCount ?? 0)} · {t.sort} {tag.sortOrder}</small></span>
        </button></li>)}</ul>
      </AdminQueueState>
    </section>
    <section className="admin-panel admin-task-detail" tabIndex={-1} ref={detailRef} aria-label={t.action}>
      {inspecting ? <div className="admin-form-stack">
        <Button variant="quiet" size="sm" icon="chevron-left" className="admin-back-to-queue" disabled={command.locked} onClick={() => select(null)}>{c.back}</Button>
        <h2>{creating ? t.createTitle : selected!.name}</h2>
        {selected?.mergedIntoTagId ? <p>{t.mergedTo} {queue.items.find((tag) => tag.id === selected.mergedIntoTagId)?.name ?? selected.mergedIntoTagId}</p> : <>
          <label>{t.name}<input value={name} maxLength={30} disabled={!editable} onChange={(event) => setName(event.target.value)} /></label>
          <NumberField label={t.sort} value={order.trim() === '' ? undefined : Number(order)} disabled={!editable} onValueChange={(value) => setOrder(value === undefined ? '' : String(value))} description={t.slugHelp} />
          {!creating && <Switch label={t.enabled} checked={active} disabled={!editable} onChange={setActive} />}
          <ReasonPanel reason={reason} onReasonChange={setReason} disabled={command.locked}>
            <Button variant="primary" icon={creating ? 'plus' : 'check'} disabled={!editable || !validFields || !validReason || !changed} onClick={() => void save()}>{creating ? t.create : c.save}</Button>
          </ReasonPanel>
          {selected && <Disclosure compact icon="copy" summary={t.merge}><div className="admin-form-stack" style={{ padding: 0 }}>
            <p className="admin-help">{t.mergeHelp}</p>
            <ResponsiveSelect label={t.mergeTarget} value={mergeTarget} disabled={!editable} onValueChange={value=>{setMergeTarget(value);setMergeConfirmed(false);}} options={[{value:'',label:t.chooseTarget},...queue.items.filter(tag=>tag.id!==selected.id&&tag.active&&!tag.mergedIntoTagId).map(tag=>({value:tag.id,label:tag.name}))]} />
            {target && <label className="admin-check"><input type="checkbox" checked={mergeConfirmed} disabled={!editable} onChange={(event) => setMergeConfirmed(event.target.checked)} />{t.confirmMerge(selected.name, target.name)}</label>}
            <Button variant="danger" icon="copy" disabled={!editable || !target || !mergeConfirmed || !validReason} onClick={() => void merge()}>{t.mergeSubmit}</Button>
          </div></Disclosure>}
        </>}
      </div> : <p className="admin-empty">{c.select}</p>}
    </section>
    <div className="admin-task-notice"><AdminCommandNotice command={command} onRefresh={() => void queue.reload()} />{inspecting && queue.error && <AdminQueueState {...queue} empty={false}>{null}</AdminQueueState>}</div>
  </div>;
}
