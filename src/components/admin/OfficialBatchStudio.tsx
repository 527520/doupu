'use client';

import { useEffect, useRef, useState } from 'react';
import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { getBuiltinPalette } from '@/lib/palettes';
import { createImageDecoder } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { createGenerateWorkerClient, type GenerateTask } from '@/lib/engine/runGenerate';
import { officialBatchConcurrency, validateOfficialBatchFiles } from '@/lib/community/batchClient';
import { track } from '@/lib/analytics/client';

type ItemStatus = 'pending' | 'running' | 'saved' | 'failed' | 'cancelled';
interface Item { localId: string; file: File | null; localName: string; title: string; cropInset: number; status: ItemStatus; progress: number; error: string | null; revisionId: string | null; selected: boolean }
interface BatchState { id: string; version: number; status: string }

function countBucket(count: number): '1' | '2-5' | '6-10' | '11-25' | '26-50' {
  return count === 1 ? '1' : count <= 5 ? '2-5' : count <= 10 ? '6-10' : count <= 25 ? '11-25' : '26-50';
}

export default function OfficialBatchStudio() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [reason, setReason] = useState('官方内容批量生产');
  const [message, setMessage] = useState<string | null>(null);
  const control = useRef({ paused: false, cancelled: false });
  const active = useRef(new Map<string, GenerateTask>());

  useEffect(() => {
    let mounted = true;
    const activeTasks = active.current;
    void fetch('/api/admin/batches').then(async (response) => {
      const body = await response.json();
      if (!mounted || !response.ok) return;
      const latest = body.items?.find((item: { drafts?: unknown[] }) => item.drafts?.length);
      if (!latest) return;
      const restored: Item[] = latest.drafts.map((draft: { id: string; title: string; status: string }, index: number) => ({
        localId: `restored:${draft.id}`, file: null, localName: `已保存草稿 ${String(index + 1).padStart(2, '0')}`,
        title: draft.title, cropInset: 0, status: 'saved', progress: 100, error: null, revisionId: draft.id, selected: false,
      }));
      itemsRef.current = restored; setItems(restored); setBatch({ id: latest.id, version: latest.version, status: latest.status });
      setMessage('已恢复服务器中的成功草稿；本地原图任务不会在刷新后恢复。');
    });
    return () => { mounted = false; activeTasks.forEach((task) => task.cancel()); };
  }, []);

  const replaceItems = (next: Item[] | ((current: Item[]) => Item[])) => {
    setItems((current) => { const value = typeof next === 'function' ? next(current) : next; itemsRef.current = value; return value; });
  };
  const patchItem = (localId: string, change: Partial<Item>) => replaceItems((current) => current.map((item) => item.localId === localId ? { ...item, ...change } : item));
  const api = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init); const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? '批次操作失败'); return body;
  };

  const selectFiles = (files: FileList | null) => {
    if (!files) return; const selected = [...files]; const error = validateOfficialBatchFiles(selected);
    if (error) { setMessage(error); return; }
    const next = selected.map((file, index): Item => ({
      localId: crypto.randomUUID(), file, localName: file.name,
      title: `官方作品 ${String(index + 1).padStart(2, '0')}`, cropInset: 0,
      status: 'pending', progress: 0, error: null, revisionId: null, selected: false,
    }));
    setBatch(null); replaceItems(next); setMessage('文件只保留在当前浏览器内存中；刷新后只能恢复已保存草稿。');
  };

  const processItem = async (item: Item, batchId: string) => {
    if (!item.file) return;
    const decoder = createImageDecoder(); const generator = createGenerateWorkerClient();
    try {
      patchItem(item.localId, { status: 'running', progress: 2, error: null });
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const type = sniffImageType(bytes); if (type === 'unknown') throw new Error('图片内容格式无法识别');
      const loaded = await decoder.load(bytes, type); if (!loaded.ok) throw new Error(loaded.code);
      const naturalWidth = loaded.image.naturalWidth ?? loaded.image.width; const naturalHeight = loaded.image.naturalHeight ?? loaded.image.height;
      if (naturalWidth * naturalHeight > LIMITS.maxPixels) throw new Error('IMAGE_TOO_LARGE');
      const inset = Math.min(.4, Math.max(0, item.cropInset / 100));
      const rect = { x: Math.round(naturalWidth * inset), y: Math.round(naturalHeight * inset), width: Math.max(1, Math.round(naturalWidth * (1 - inset * 2))), height: Math.max(1, Math.round(naturalHeight * (1 - inset * 2))) };
      const region = await decoder.region(rect, LIMITS.generationSourceDimension); if (!region.ok) throw new Error(region.code);
      decoder.clear();
      const task = generator.run({ src: region.image, params: DEFAULT_GENERATION_PARAMS, palette: [...getBuiltinPalette('MARD').engineColors] }, (progress) => patchItem(item.localId, { progress }));
      active.current.set(item.localId, task);
      const output = await task.promise; active.current.delete(item.localId);
      const snapshot = { version: 1, engineVersion: ENGINE_VERSION, boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 }, params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: DEFAULT_GENERATION_PARAMS.backgroundPrototype ?? null }, pattern: output.pattern };
      const saved = await api(`/api/admin/batches/${batchId}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': item.localId }, body: JSON.stringify({ title: item.title, snapshot, reason }) });
      patchItem(item.localId, { status: 'saved', progress: 100, revisionId: saved.revisionId, file: null, selected: false });
      track({ name: 'official_batch_item_succeeded', properties: {} });
    } catch (error) {
      active.current.delete(item.localId);
      const cancelled = error instanceof Error && error.name === 'AbortError';
      patchItem(item.localId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : (error instanceof Error ? error.message : '生成失败') });
      if (!cancelled) track({ name: 'official_batch_item_failed', properties: { errorCode: 'BATCH_ITEM_FAILED' } });
    } finally {
      decoder.dispose(); generator.dispose();
    }
  };

  const dispatch = async (batchId: string) => {
    const pendingIds = itemsRef.current.filter((item) => item.status === 'pending').map((item) => item.localId);
    let cursor = 0; const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const workerCount = Math.min(pendingIds.length, officialBatchConcurrency(navigator.hardwareConcurrency, deviceMemory));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (!control.current.paused && !control.current.cancelled) {
        const localId = pendingIds[cursor++]; if (!localId) return;
        const item = itemsRef.current.find((candidate) => candidate.localId === localId);
        if (item?.status === 'pending') await processItem(item, batchId);
      }
    }));
    const current = itemsRef.current;
    if (!control.current.paused && !control.current.cancelled && current.every((item) => ['saved', 'failed'].includes(item.status))) {
      const failures = current.filter((item) => item.status === 'failed').length;
      setMessage(failures ? `生成完成，${failures} 项失败，可逐项重试。` : '生成完成，请勾选草稿后批量发布。');
    }
  };

  const start = async () => {
    if (items.length === 0 || reason.trim().length < 3) return; control.current = { paused: false, cancelled: false };
    try {
      const created = await api('/api/admin/batches', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ itemCount: items.length, defaultParams: DEFAULT_GENERATION_PARAMS, engineVersion: ENGINE_VERSION, reason }) });
      setBatch({ id: created.id, version: created.version, status: created.status });
      track({ name: 'official_batch_started', properties: { itemCountBucket: countBucket(items.length) } });
      await dispatch(created.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : '批次启动失败'); }
  };

  const transition = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!batch) return; if (action === 'pause') control.current.paused = true;
    if (action === 'cancel') { control.current.cancelled = true; active.current.forEach((task) => task.cancel()); replaceItems((current) => current.map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' } : item)); }
    try {
      const updated = await api(`/api/admin/batches/${batch.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action, expectedVersion: batch.version, reason }) });
      setBatch({ id: updated.id, version: updated.version, status: updated.status });
      if (action === 'resume') { control.current = { paused: false, cancelled: false }; replaceItems((current) => current.map((item) => item.status === 'cancelled' ? { ...item, status: 'pending' } : item)); await dispatch(batch.id); }
      if (action === 'cancel') track({ name: 'official_batch_completed', properties: { result: 'cancelled', itemCountBucket: countBucket(items.length) } });
    } catch (error) { setMessage(error instanceof Error ? error.message : '批次状态修改失败'); }
  };

  const retry = async (item: Item) => {
    if (!batch || !item.file) return; patchItem(item.localId, { status: 'pending', error: null }); await processItem({ ...item, status: 'pending', error: null }, batch.id);
  };
  const cancelItem = (item: Item) => {
    const task = active.current.get(item.localId);
    if (task) task.cancel(); else if (item.status === 'pending') patchItem(item.localId, { status: 'cancelled' });
  };
  const publish = async () => {
    if (!batch) return; const revisionIds = items.filter((item) => item.status === 'saved' && item.selected && item.revisionId).map((item) => item.revisionId!);
    try { const result = await api(`/api/admin/batches/${batch.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ revisionIds, expectedVersion: batch.version, reason }) }); setBatch({ id: result.batch.id, version: result.batch.version, status: result.batch.status }); const failed = items.some((item) => item.status === 'failed'); track({ name: 'official_batch_completed', properties: { result: failed ? 'partial' : 'succeeded', itemCountBucket: countBucket(items.length) } }); setMessage(`已发布 ${revisionIds.length} 个官方作品。`); } catch (error) { setMessage(error instanceof Error ? error.message : '发布失败'); }
  };

  return <section className="batch-studio"><header><div><span className="studio-eyebrow">LOCAL BATCH LAB</span><h2>浏览器本地批量生产</h2></div><label className="btn-secondary">选择图片<input className="sr-only" type="file" accept="image/*,.heic,.heif" multiple onChange={(event) => selectFiles(event.target.files)} /></label></header><p>最多 50 个文件、单个 20 MiB、合计 200 MiB。原图、文件名与裁剪源不会上传服务器。</p><label>审计理由<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>{message && <p className="notice" role="status">{message}</p>}
    <div className="batch-toolbar"><button className="btn-primary" type="button" disabled={items.length === 0 || Boolean(batch)} onClick={() => void start()}>开始生成</button><button type="button" disabled={!batch || batch.status !== 'running'} onClick={() => void transition('pause')}>暂停派发</button><button type="button" disabled={!batch || batch.status !== 'paused'} onClick={() => void transition('resume')}>继续</button><button className="btn-danger-outline" type="button" disabled={!batch || !['running', 'paused'].includes(batch.status)} onClick={() => void transition('cancel')}>取消批次</button><button className="btn-primary" type="button" disabled={!batch || !items.some((item) => item.status === 'saved' && item.selected)} onClick={() => void publish()}>发布已勾选草稿</button></div>
    <ol className="batch-items">{items.map((item, index) => <li key={item.localId}><div><strong>{String(index + 1).padStart(2, '0')} · {item.localName}</strong><small>{item.status} · {item.progress}% {item.error && `· ${item.error}`}</small></div><label>公开标题<input value={item.title} disabled={item.status !== 'pending'} onChange={(event) => patchItem(item.localId, { title: event.target.value })} /></label><label>四边裁剪<input type="number" min="0" max="40" value={item.cropInset} disabled={item.status !== 'pending'} onChange={(event) => patchItem(item.localId, { cropInset: Number(event.target.value) })} /><span>%</span></label><div className="table-actions">{item.status === 'saved' && <label><input type="checkbox" checked={item.selected} onChange={(event) => patchItem(item.localId, { selected: event.target.checked })} />发布</label>}{['pending', 'running'].includes(item.status) && <button type="button" onClick={() => cancelItem(item)}>取消此项</button>}{['failed', 'cancelled'].includes(item.status) && item.file && batch && ['running', 'paused'].includes(batch.status) && <button type="button" onClick={() => void retry(item)}>重试</button>}</div></li>)}</ol>
  </section>;
}
