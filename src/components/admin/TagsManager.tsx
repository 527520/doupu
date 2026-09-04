'use client';

import { useEffect, useState } from 'react';
interface Tag { id: string; name: string; slug: string; sortOrder: number; active: boolean; mergedIntoTagId: string | null; version: number }

export default function TagsManager() {
  const [items, setItems] = useState<Tag[]>([]);
  const [name, setName] = useState(''); const [slug, setSlug] = useState(''); const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { const response = await fetch('/api/admin/community/tags'); if (response.ok) setItems((await response.json()).items); };
  useEffect(() => { let active = true; void fetch('/api/admin/community/tags').then(async (response) => { if (active && response.ok) setItems((await response.json()).items); }); return () => { active = false; }; }, []);
  const create = async () => {
    const response = await fetch('/api/admin/community/tags', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ name, slug, reason }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? '标签已创建。' : body?.error?.message ?? '创建失败');
    if (response.ok) { setName(''); setSlug(''); await load(); }
  };
  const update = async (tag: Tag, changes: Partial<Tag>) => {
    const response = await fetch(`/api/admin/community/tags/${tag.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: tag.version, reason, ...changes }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? '标签已更新。' : body?.error?.message ?? '更新失败'); if (response.ok) await load();
  };
  const merge = async (tag: Tag, targetTagId: string) => {
    if (!targetTagId) return; const response = await fetch(`/api/admin/community/tags/${tag.id}/merge`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ targetTagId, expectedVersion: tag.version, reason }) });
    const body = await response.json().catch(() => null); setMessage(response.ok ? '标签已合并，旧标签保留指向。' : body?.error?.message ?? '合并失败'); if (response.ok) await load();
  };
  return <section className="admin-panel"><header><h2>正式标签</h2><span>{items.length}</span></header><div className="admin-form-stack tag-create"><label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Slug<input value={slug} onChange={(event) => setSlug(event.target.value)} /></label><label>操作理由<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="btn-primary" disabled={!name || !slug || reason.trim().length < 3} onClick={() => void create()}>创建</button></div>{message && <p role="status" className="notice">{message}</p>}<table><thead><tr><th>名称</th><th>Slug</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map((tag) => <tr key={tag.id}><td>{tag.name}</td><td><code>{tag.slug}</code></td><td>{tag.sortOrder}</td><td>{tag.mergedIntoTagId ? '已合并' : tag.active ? '启用' : '停用'}</td><td><div className="table-actions"><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => void update(tag, { active: !tag.active })}>{tag.active ? '停用' : '启用'}</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => { const value = window.prompt('输入新名称', tag.name); if (value) void update(tag, { name: value }); }}>改名</button><button type="button" disabled={reason.trim().length < 3 || Boolean(tag.mergedIntoTagId)} onClick={() => { const value = window.prompt('输入目标标签 ID'); if (value) void merge(tag, value); }}>合并</button></div></td></tr>)}</tbody></table></section>;
}
