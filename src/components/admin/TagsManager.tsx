'use client';

import { useEffect, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
interface Tag { id: string; name: string; slug: string; sortOrder: number; active: boolean; mergedIntoTagId: string | null; version: number }

export default function TagsManager() {
  const t = zhCN.communityAdmin.tags;
  const [items, setItems] = useState<Tag[]>([]);
  const [name, setName] = useState(''); const [slug, setSlug] = useState(''); const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { const response = await fetch('/api/admin/community/tags'); if (response.ok) setItems((await response.json()).items); };
  useEffect(() => { let active = true; void fetch('/api/admin/community/tags').then(async (response) => { if (active && response.ok) setItems((await response.json()).items); }); return () => { active = false; }; }, []);
  const create = async () => {
    const response = await fetch('/api/admin/community/tags', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ name, slug, reason }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? t.created : body?.error?.message ?? t.createFailed);
    if (response.ok) { setName(''); setSlug(''); await load(); }
  };
  const update = async (tag: Tag, changes: Partial<Tag>) => {
    const response = await fetch(`/api/admin/community/tags/${tag.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: tag.version, reason, ...changes }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? t.updated : body?.error?.message ?? t.updateFailed); if (response.ok) await load();
  };
  const merge = async (tag: Tag, targetTagId: string) => {
    if (!targetTagId) return; const response = await fetch(`/api/admin/community/tags/${tag.id}/merge`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ targetTagId, expectedVersion: tag.version, reason }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? t.merged : body?.error?.message ?? t.mergeFailed); if (response.ok) await load();
  };
  return <section className="admin-panel"><header><h2>{t.title}</h2><span>{items.length}</span></header><div className="admin-form-stack tag-create"><label>{t.name}<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>{t.slug}<input value={slug} onChange={(event) => setSlug(event.target.value)} /></label><label>{t.reason}<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="btn-primary" disabled={!name || !slug || reason.trim().length < 3} onClick={() => void create()}>{t.create}</button></div>{message && <p role="status" className="notice">{message}</p>}<table><thead><tr><th>{t.name}</th><th>{t.slug}</th><th>{t.sort}</th><th>{t.status}</th><th>{t.action}</th></tr></thead><tbody>{items.map((tag) => <tr key={tag.id}><td>{tag.name}</td><td><code>{tag.slug}</code></td><td>{tag.sortOrder}</td><td>{tag.mergedIntoTagId ? t.mergedState : tag.active ? t.enabled : t.disabled}</td><td><div className="table-actions"><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => void update(tag, { active: !tag.active })}>{tag.active ? t.disabled : t.enabled}</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => void update(tag, { sortOrder: tag.sortOrder - 1 })}>{t.moveUp}</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => void update(tag, { sortOrder: tag.sortOrder + 1 })}>{t.moveDown}</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => { const value = window.prompt(t.renamePrompt, tag.name); if (value) void update(tag, { name: value }); }}>{t.rename}</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => { const value = window.prompt(t.mergePrompt); if (value) void merge(tag, value); }}>{t.merge}</button></div></td></tr>)}</tbody></table></section>;
}
