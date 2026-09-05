'use client';

import { useEffect, useRef, useState } from 'react';
import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import { getBuiltinPalette } from '@/lib/palettes';
import { createImageDecoder } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { createGenerateWorkerClient, type GenerateTask } from '@/lib/engine/runGenerate';
import { officialBatchConcurrency, validateOfficialBatchFiles } from '@/lib/community/batchClient';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

type ItemStatus = 'pending' | 'running' | 'saved' | 'published' | 'failed' | 'cancelled';
interface Item { localId: string; file: File | null; localName: string; title: string; cropInset: number; paramsOverride: Partial<GenerationParams>; status: ItemStatus; progress: number; error: string | null; revisionId: string | null; selected: boolean }
interface BatchState { id: string; version: number; status: string }

function countBucket(count: number): '1' | '2-5' | '6-10' | '11-25' | '26-50' {
  return count === 1 ? '1' : count <= 5 ? '2-5' : count <= 10 ? '6-10' : count <= 25 ? '11-25' : '26-50';
}

function resolveParams(defaults: GenerationParams, override: Partial<GenerationParams>): GenerationParams {
  return { ...defaults, ...override };
}

function BatchParamsEditor({ value, inherited, onChange }: {
  value: Partial<GenerationParams>;
  inherited?: GenerationParams;
  onChange: (value: Partial<GenerationParams>) => void;
}) {
  const t = zhCN.communityAdmin.batch;
  const number = (key: 'targetWidth' | 'targetColorCount' | 'brightness' | 'contrast' | 'bgTolerance', min: number, max: number) => (
    <input type="number" min={min} max={max} value={value[key] ?? ''} placeholder={inherited ? String(inherited[key]) : undefined}
      onChange={(event) => {
        const next = { ...value };
        if (event.target.value === '') delete next[key];
        else next[key] = Math.min(max, Math.max(min, Number(event.target.value)));
        onChange(next);
      }} />
  );
  const bool = (key: 'dithering' | 'backgroundRemoval') => (
    <select value={value[key] === undefined ? '' : String(value[key])} onChange={(event) => {
      const next = { ...value };
      if (!event.target.value) delete next[key];
      else next[key] = event.target.value === 'true';
      onChange(next);
    }}><option value="">{inherited ? t.inherit : t.disabled}</option><option value="true">{t.enabled}</option><option value="false">{t.disabled}</option></select>
  );
  return <div className="batch-params-grid">
    <label>{t.width}{number('targetWidth', 20, 200)}</label>
    <label>{t.colors}{number('targetColorCount', 2, 128)}</label>
    <label>{t.mode}<select value={value.mode ?? ''} onChange={(event) => {
      const next = { ...value };
      if (!event.target.value) delete next.mode;
      else next.mode = event.target.value as GenerationParams['mode'];
      onChange(next);
    }}><option value="">{inherited ? t.inherit : t.dominant}</option><option value="dominant">{t.dominant}</option><option value="average">{t.average}</option></select></label>
    <label>{t.dithering}{bool('dithering')}</label>
    <label>{t.brightness}{number('brightness', -100, 100)}</label>
    <label>{t.contrast}{number('contrast', -100, 100)}</label>
    <label>{t.backgroundRemoval}{bool('backgroundRemoval')}</label>
    <label>{t.bgTolerance}{number('bgTolerance', 0, 40)}</label>
    <label>{t.backgroundPrototype}<input value={value.backgroundPrototype ?? ''} placeholder={inherited?.backgroundPrototype ?? '#FFFFFF'} onChange={(event) => {
      const next = { ...value };
      if (!event.target.value) delete next.backgroundPrototype;
      else next.backgroundPrototype = event.target.value;
      onChange(next);
    }} /></label>
  </div>;
}

export default function OfficialBatchStudio() {
  const t = zhCN.communityAdmin.batch;
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [defaultParams, setDefaultParams] = useState<GenerationParams>({ ...DEFAULT_GENERATION_PARAMS });
  const [reason, setReason] = useState<string>(t.defaultReason);
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
        localId: `restored:${draft.id}`, file: null, localName: t.restoredDraft(index + 1),
        title: draft.title, cropInset: 0, paramsOverride: {}, status: draft.status === 'draft' ? 'saved' : 'published', progress: 100, error: null, revisionId: draft.id, selected: false,
      }));
      itemsRef.current = restored; setItems(restored); setBatch({ id: latest.id, version: latest.version, status: latest.status });
      setMessage(t.restored);
    });
    return () => { mounted = false; activeTasks.forEach((task) => task.cancel()); };
  }, [t]);

  const replaceItems = (next: Item[] | ((current: Item[]) => Item[])) => {
    // Worker completions can settle in the same React batch. Update the mutable
    // scheduling source synchronously so dispatch() never evaluates completion
    // against a queued (stale) state updater.
    const value = typeof next === 'function' ? next(itemsRef.current) : next;
    itemsRef.current = value;
    setItems(value);
  };
  const patchItem = (localId: string, change: Partial<Item>) => replaceItems((current) => current.map((item) => item.localId === localId ? { ...item, ...change } : item));
  const api = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init); const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? t.actionFailed); return body;
  };

  const selectFiles = (files: FileList | null) => {
    if (!files) return; const selected = [...files]; const error = validateOfficialBatchFiles(selected);
    if (error) { setMessage(error); return; }
    const next = selected.map((file, index): Item => ({
      localId: crypto.randomUUID(), file, localName: file.name,
      title: t.defaultTitle(index + 1), cropInset: 0, paramsOverride: {},
      status: 'pending', progress: 0, error: null, revisionId: null, selected: false,
    }));
    setBatch(null); replaceItems(next); setMessage(t.localOnly);
  };

  const processItem = async (item: Item, batchId: string) => {
    if (!item.file) return;
    const decoder = createImageDecoder(); const generator = createGenerateWorkerClient();
    try {
      patchItem(item.localId, { status: 'running', progress: 2, error: null });
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const type = sniffImageType(bytes); if (type === 'unknown') throw new Error(t.unknownImage);
      const loaded = await decoder.load(bytes, type); if (!loaded.ok) throw new Error(loaded.code);
      const naturalWidth = loaded.image.naturalWidth ?? loaded.image.width; const naturalHeight = loaded.image.naturalHeight ?? loaded.image.height;
      if (naturalWidth * naturalHeight > LIMITS.maxPixels) throw new Error('IMAGE_TOO_LARGE');
      const inset = Math.min(.4, Math.max(0, item.cropInset / 100));
      const rect = { x: Math.round(naturalWidth * inset), y: Math.round(naturalHeight * inset), width: Math.max(1, Math.round(naturalWidth * (1 - inset * 2))), height: Math.max(1, Math.round(naturalHeight * (1 - inset * 2))) };
      const region = await decoder.region(rect, LIMITS.generationSourceDimension); if (!region.ok) throw new Error(region.code);
      decoder.clear();
      const params = resolveParams(defaultParams, item.paramsOverride);
      const task = generator.run({ src: region.image, params, palette: [...getBuiltinPalette('MARD').engineColors] }, (progress) => patchItem(item.localId, { progress }));
      active.current.set(item.localId, task);
      const output = await task.promise; active.current.delete(item.localId);
      const snapshot = { version: 1, engineVersion: ENGINE_VERSION, boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 }, params: { ...params, backgroundPrototype: params.backgroundPrototype ?? null }, pattern: output.pattern };
      const saved = await api(`/api/admin/batches/${batchId}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': item.localId }, body: JSON.stringify({ title: item.title, snapshot, reason }) });
      patchItem(item.localId, { status: 'saved', progress: 100, revisionId: saved.revisionId, file: null, selected: false });
      track({ name: 'official_batch_item_succeeded', properties: {} });
    } catch (error) {
      active.current.delete(item.localId);
      const cancelled = error instanceof Error && error.name === 'AbortError';
      patchItem(item.localId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : (error instanceof Error ? error.message : t.generationFailed) });
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
    if (!control.current.paused && !control.current.cancelled && current.every((item) => ['saved', 'published', 'failed'].includes(item.status))) {
      const failures = current.filter((item) => item.status === 'failed').length;
      setMessage(failures ? t.partialFinished(failures) : t.finished);
    }
  };

  const start = async () => {
    if (items.length === 0 || reason.trim().length < 3) return; control.current = { paused: false, cancelled: false };
    try {
      const created = await api('/api/admin/batches', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ itemCount: items.length, defaultParams, engineVersion: ENGINE_VERSION, reason }) });
      setBatch({ id: created.id, version: created.version, status: created.status });
      track({ name: 'official_batch_started', properties: { itemCountBucket: countBucket(items.length) } });
      await dispatch(created.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : t.startFailed); }
  };

  const transition = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!batch) return; if (action === 'pause') control.current.paused = true;
    if (action === 'cancel') { control.current.cancelled = true; active.current.forEach((task) => task.cancel()); replaceItems((current) => current.map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' } : item)); }
    try {
      const updated = await api(`/api/admin/batches/${batch.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action, expectedVersion: batch.version, reason }) });
      setBatch({ id: updated.id, version: updated.version, status: updated.status });
      if (action === 'resume') { control.current = { paused: false, cancelled: false }; await dispatch(batch.id); }
      if (action === 'cancel') track({ name: 'official_batch_completed', properties: { result: 'cancelled', itemCountBucket: countBucket(items.length) } });
    } catch (error) { setMessage(error instanceof Error ? error.message : t.transitionFailed); }
  };

  const retry = async (item: Item) => {
    if (!batch || batch.status !== 'running' || !item.file) return;
    patchItem(item.localId, { status: 'pending', error: null });
    await processItem({ ...item, status: 'pending', error: null }, batch.id);
  };
  const cancelItem = (item: Item) => {
    const task = active.current.get(item.localId);
    if (task) task.cancel(); else if (item.status === 'pending') patchItem(item.localId, { status: 'cancelled' });
  };
  const publish = async () => {
    if (!batch) return;
    const revisionIds = items.filter((item) => item.status === 'saved' && item.selected && item.revisionId).map((item) => item.revisionId!);
    if (revisionIds.length === 0) return;
    try { const result = await api(`/api/admin/batches/${batch.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ revisionIds, expectedVersion: batch.version, reason }) }); setBatch({ id: result.batch.id, version: result.batch.version, status: result.batch.status }); replaceItems((current) => current.map((item) => item.revisionId && revisionIds.includes(item.revisionId) ? { ...item, status: 'published', selected: false } : item)); if (result.batch.status === 'completed' && batch.status !== 'completed') track({ name: 'official_batch_completed', properties: { result: 'succeeded', itemCountBucket: countBucket(items.length) } }); setMessage(t.published(revisionIds.length)); } catch (error) { setMessage(error instanceof Error ? error.message : t.publishFailed); }
  };

  return <section className="batch-studio"><header><div><span className="studio-eyebrow">{t.eyebrow}</span><h2>{t.title}</h2></div><label className="btn-secondary">{t.selectFiles}<input className="sr-only" type="file" accept="image/*,.heic,.heif" multiple onChange={(event) => selectFiles(event.target.files)} /></label></header><p>{t.privacy}</p><details open><summary>{t.uniformParams}</summary><BatchParamsEditor value={defaultParams} onChange={(value) => setDefaultParams(resolveParams(DEFAULT_GENERATION_PARAMS, value))} /></details><label>{t.reason}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>{message && <p className="notice" role="status">{message}</p>}
    <div className="batch-toolbar"><button className="btn-primary" type="button" disabled={items.length === 0 || Boolean(batch)} onClick={() => void start()}>{t.start}</button><button type="button" disabled={!batch || batch.status !== 'running'} onClick={() => void transition('pause')}>{t.pause}</button><button type="button" disabled={!batch || batch.status !== 'paused'} onClick={() => void transition('resume')}>{t.resume}</button><button className="btn-danger-outline" type="button" disabled={!batch || !['running', 'paused'].includes(batch.status)} onClick={() => void transition('cancel')}>{t.cancel}</button><button className="btn-primary" type="button" disabled={!batch || !items.some((item) => item.status === 'saved' && item.selected)} onClick={() => void publish()}>{t.publishSelected}</button></div>
    <ol className="batch-items">{items.map((item, index) => <li key={item.localId}><div><strong>{String(index + 1).padStart(2, '0')} · {item.localName}</strong><small>{t.status[item.status]} · {item.progress}{t.percent} {item.error && `· ${item.error}`}</small></div><label>{t.publicTitle}<input value={item.title} disabled={item.status !== 'pending'} onChange={(event) => patchItem(item.localId, { title: event.target.value })} /></label><label>{t.crop}<input type="number" min="0" max="40" value={item.cropInset} disabled={item.status !== 'pending'} onChange={(event) => patchItem(item.localId, { cropInset: Number(event.target.value) })} /><span>{t.percent}</span></label>{item.status === 'pending' && <details><summary>{t.itemOverrides}</summary><BatchParamsEditor value={item.paramsOverride} inherited={defaultParams} onChange={(paramsOverride) => patchItem(item.localId, { paramsOverride })} /><button type="button" className="btn-ghost" onClick={() => patchItem(item.localId, { paramsOverride: {} })}>{t.resetOverrides}</button></details>}<div className="table-actions">{item.status === 'saved' && <label><input type="checkbox" checked={item.selected} disabled={!batch} onChange={(event) => patchItem(item.localId, { selected: event.target.checked })} />{t.selectPublish}</label>}{['pending', 'running'].includes(item.status) && <button type="button" onClick={() => cancelItem(item)}>{t.cancelItem}</button>}{['failed', 'cancelled'].includes(item.status) && item.file && batch?.status === 'running' && <button type="button" onClick={() => void retry(item)}>{t.retry}</button>}</div></li>)}</ol>
  </section>;
}
