'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Switch from '@/components/ui/Switch';
import SegmentedControl from '@/components/ui/SegmentedControl';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import { batchGenerationFailureMessage, officialBatchConcurrency } from '@/lib/community/batchClient';
import { ApiError } from '@/lib/sync/clientAdapter';
import { createImageDecoder, type DecodedImage } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { LIMITS } from '@/lib/appInfo';
import { getBoardProfile } from '@/lib/boardProfiles';
import type { CommunityRevisionInspection } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';
import CropDialog from '@/components/crop/CropDialog';
import Modal from '@/components/ui/Modal';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import OriginalPreview from '@/components/community/OriginalPreview';
import PatternPreview from '@/components/preview/PatternPreview';
import { BatchSession, isStoredBatch, RETRYABLE_STATUSES, type BatchItem, type BatchItemStatus, type StoredBatch } from './batchSession';
import { generateBatchItem } from './batchGeneration';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';

const t = zhCN.communityAdmin.batch;
const c = zhCN.communityAdmin.command;

/** 卡片状态筛选：把十来种内部状态收成使用者关心的五类。 */
type StatusFilter = 'all' | 'pending' | 'running' | 'saved' | 'failed' | 'published';
const FILTER_STATUSES: Record<Exclude<StatusFilter, 'all'>, readonly BatchItemStatus[]> = {
  pending: ['pending'],
  running: ['running', 'saving', 'uploading', 'save_unknown'],
  saved: ['saved'],
  failed: ['failed', 'cancelled', 'upload_failed', 'unavailable'],
  published: ['published'],
};
const STATUS_TONE: Record<BatchItemStatus, 'neutral' | 'progress' | 'ok' | 'warn' | 'danger'> = {
  pending: 'neutral', running: 'progress', saving: 'progress', uploading: 'progress', save_unknown: 'warn', upload_failed: 'warn',
  saved: 'ok', published: 'ok', failed: 'danger', cancelled: 'neutral', unavailable: 'neutral',
};

function BatchParamsEditor({ value, inherited, onChange }: { value: Partial<GenerationParams>; inherited?: GenerationParams; onChange: (value: Partial<GenerationParams>) => void }) {
  const number = (key: 'targetWidth' | 'targetColorCount' | 'brightness' | 'contrast' | 'bgTolerance', min: number, max: number) => <input type="number" min={min} max={max} step={1} value={value[key] ?? ''} placeholder={inherited ? String(inherited[key]) : undefined} onChange={(event) => {
    const next = { ...value }; if (event.target.value === '') delete next[key]; else next[key] = Number(event.target.value); onChange(next);
  }} />;
  const bool = (key: 'dithering' | 'backgroundRemoval') => inherited ? <ResponsiveSelect label={t[key]} value={value[key] === undefined ? '' : String(value[key])} onValueChange={raw => {
    const next = { ...value }; if (!raw) delete next[key]; else next[key] = raw === 'true'; onChange(next);
  }} options={[{value:'',label:t.inherit},{value:'true',label:t.enabled},{value:'false',label:t.disabled}]} /> : <Switch label={t[key]} checked={value[key]??false} onChange={checked=>onChange({...value,[key]:checked})} />;
  return <div className="batch-params-grid">
    <label>{t.width}{number('targetWidth', 20, 200)}</label><label>{t.colors}{number('targetColorCount', 2, 128)}</label>
    {inherited ? <ResponsiveSelect label={t.mode} value={value.mode ?? ''} onValueChange={raw=>{const next={...value};if(!raw)delete next.mode;else next.mode=raw as GenerationParams['mode'];onChange(next);}} options={[{value:'',label:t.inherit},{value:'dominant',label:t.dominant},{value:'average',label:t.average}]} /> : <SegmentedControl label={t.mode} value={value.mode ?? 'dominant'} onValueChange={mode=>onChange({...value,mode:mode as GenerationParams['mode']})} options={[{value:'dominant',label:t.dominant},{value:'average',label:t.average}]} />}
    {bool('dithering')}<label>{t.brightness}{number('brightness', -100, 100)}</label><label>{t.contrast}{number('contrast', -100, 100)}</label>
    {bool('backgroundRemoval')}<label>{t.bgTolerance}{number('bgTolerance', 0, 40)}</label>
    <label>{t.backgroundPrototype}<input value={value.backgroundPrototype ?? ''} placeholder={inherited?.backgroundPrototype ?? t.autoBackground} maxLength={7} onChange={(event) => onChange({ ...value, backgroundPrototype: event.target.value || null })} /></label>
  </div>;
}

function BatchCropEditor({ item, session, onClose }: { item: BatchItem; session: BatchSession; onClose: () => void }) {
  const [image, setImage] = useState<DecodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; const decoder = createImageDecoder();
    void (async () => {
      try {
        if (!item.file) throw new Error(t.noOriginal);
        const bytes = new Uint8Array(await item.file.arrayBuffer()); if (!alive) return;
        const type = sniffImageType(bytes); if (type === 'unknown') throw new Error(t.unknownImage);
        const loaded = await decoder.load(bytes, type); if (!alive) return; if (!loaded.ok) throw new Error(zhCN.errors[loaded.code]);
        if ((loaded.image.naturalWidth ?? loaded.image.width) * (loaded.image.naturalHeight ?? loaded.image.height) > LIMITS.maxPixels) throw new Error(zhCN.errors.TOO_MANY_PIXELS);
        setImage(loaded.image);
      } catch (caught) { if (alive) setError(batchGenerationFailureMessage(caught)); }
      finally { decoder.dispose(); }
    })();
    return () => { alive = false; decoder.dispose(); };
  }, [item.file]);
  return image ? <CropDialog image={image} initialRect={item.crop ?? undefined} onCancel={onClose} onConfirm={(crop) => { session.updateItem(item.localId, { crop }); onClose(); }} />
    : <Modal label={t.cropTitle} onClose={onClose} panelClassName="batch-dialog"><h2>{t.cropTitle}</h2><p role={error ? 'alert' : 'status'}>{error || c.loading}</p><button type="button" className="btn-outline" onClick={onClose}>{zhCN.common.close}</button></Modal>;
}

function DraftInspection({ item, onClose }: { item: BatchItem; onClose: () => void }) {
  const inspection = useAdminInspection<CommunityRevisionInspection>(`/api/admin/community/revisions/${item.revisionId}`);
  return <Modal label={t.inspectTitle} onClose={onClose} panelClassName="batch-inspection"><header><h2>{item.title}</h2><button type="button" className="btn-outline" onClick={onClose}>{zhCN.common.close}</button></header>
    {inspection.error ? <><p role="alert">{inspection.error}</p><button type="button" onClick={() => void inspection.reload()}>{c.reload}</button></> : inspection.data ? <><p>{inspection.data.snapshot.pattern.width}×{inspection.data.snapshot.pattern.height} · {getBoardProfile(inspection.data.snapshot.boardProfile).displayName}</p><div className="review-material-pair"><PatternPreview pattern={inspection.data.snapshot.pattern} boardSize={getBoardProfile(inspection.data.snapshot.boardProfile).boardCols} />{item.revisionId && <OriginalPreview revisionId={item.revisionId} title={item.title} />}</div><p className="admin-id">{t.draftId} {item.revisionId}</p></> : <p role="status">{c.loading}</p>}
  </Modal>;
}

function BatchItemCard({ item, index, session, editable, onCrop, onInspect }: { item: BatchItem; index: number; session: BatchSession; editable: boolean; onCrop: () => void; onInspect: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const busy = ['running', 'saving', 'uploading'].includes(item.status);
  const retryable = RETRYABLE_STATUSES.includes(item.status) && (item.file || session.hasSave(item.localId));
  const needsOriginalFile = item.status === 'upload_failed' && !item.file && item.revisionId;
  return <li className="batch-card" data-tone={STATUS_TONE[item.status]} data-status={item.status} aria-label={t.itemLabel(index + 1)}>
    <div className="batch-card-media">
      {item.preview ? <CommunityPreviewCanvas preview={item.preview} label={t.previewLabel(item.title)} /> : <div className="batch-card-placeholder">{busy ? `${item.progress}%` : t.noPreview}</div>}
      {busy && <div className="batch-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress}><span style={{ width: `${item.progress}%` }} /></div>}
    </div>
    <div className="batch-card-body">
      <header><span className="batch-card-index">{String(index + 1).padStart(2, '0')}</span><span className="batch-card-status">{t.status[item.status]}</span></header>
      <label>{t.publicTitle}<input value={item.title} maxLength={80} disabled={!editable} onChange={(event) => session.updateItem(item.localId, { title: event.target.value })} /></label>
      <p className="batch-card-file">{item.localName}{item.preview && ` · ${item.preview.originalWidth}×${item.preview.originalHeight}`}{item.hasOriginal && item.status !== 'published' ? ` · ${t.originalReady}` : ''}</p>
      {item.file && editable && <div className="batch-card-crop"><button type="button" className="btn-outline btn-sm" onClick={onCrop}>{item.crop ? t.recrop : t.cropTitle}</button><span>{item.crop ? t.cropSummary(item.crop.width, item.crop.height) : t.uncropped}</span>{item.crop && <button type="button" className="btn-quiet btn-sm" onClick={() => session.updateItem(item.localId, { crop: null })}>{t.resetCrop}</button>}</div>}
      {editable && <details><summary>{t.itemOverrides}</summary><BatchParamsEditor value={item.paramsOverride} inherited={state.defaults} onChange={(paramsOverride) => session.updateItem(item.localId, { paramsOverride })} /><button type="button" className="btn-quiet btn-sm" onClick={() => session.updateItem(item.localId, { paramsOverride: {} })}>{t.resetOverrides}</button></details>}
      {item.error && <p role="alert" className="notice notice-danger">{item.error}</p>}
      {item.status === 'save_unknown' && <p className="notice notice-warning">{t.saveUnknown}</p>}
    </div>
    <footer className="batch-card-actions">
      {item.status === 'saved' && <label className="admin-checkbox"><input type="checkbox" checked={item.selected} disabled={session.locked} onChange={(event) => session.updateItem(item.localId, { selected: event.target.checked })} />{t.selectPublish}</label>}
      {item.revisionId && ['saved', 'published', 'upload_failed'].includes(item.status) && <button type="button" className="btn-outline btn-sm" onClick={onInspect}>{t.inspectTitle}</button>}
      {['pending', 'running', 'failed'].includes(item.status) && <button type="button" className="btn-outline btn-sm" disabled={session.locked} onClick={() => session.cancelItem(item.localId)}>{t.cancelItem}</button>}
      {retryable && <button type="button" className="btn-outline btn-sm" disabled={session.locked || session.processing || state.conflict} onClick={() => void session.retryItem(item.localId)}>{item.status === 'upload_failed' ? t.retryUpload : session.hasSave(item.localId) ? t.retrySave : t.retry}</button>}
      {needsOriginalFile && <label className="btn-outline btn-sm batch-select-files" data-disabled={session.locked}>{t.attachOriginal}<input className="sr-only" type="file" accept="image/*,.heic,.heif" disabled={session.locked} onChange={(event) => { const file = event.target.files?.[0]; if (file) void session.attachOriginal(item.localId, file); event.target.value = ''; }} /></label>}
      {item.status === 'published' && item.workId && <a href={`/community/${item.workId}`} target="_blank" rel="noreferrer">{t.openPublic}</a>}
    </footer>
  </li>;
}

export default function OfficialBatchStudio() {
  const [session] = useState(() => new BatchSession({ generate: generateBatchItem, concurrency: officialBatchConcurrency(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency, typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory) }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const history = useAdminCollection<StoredBatch>('/api/admin/batches', isStoredBatch);
  const cleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cropId, setCropId] = useState<string | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<{ files: File[] } | { batch: StoredBatch } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  useEffect(() => {
    // Strict Mode re-subscribes immediately. Dispose only when the page actually
    // leaves; no session/file state is ever written to browser storage.
    if (cleanup.current) clearTimeout(cleanup.current);
    return () => { cleanup.current = setTimeout(() => session.dispose(), 0); };
  }, [session]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.processing || session.locked || session.retainedSaveCount || session.getSnapshot().items.some((item) => item.file)) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [session]);
  const { items, batch } = state;
  const selected = items.filter((item) => item.status === 'saved' && item.selected);
  const publishable = items.filter((item) => item.status === 'saved');
  const editable = !batch && !session.locked;
  const cropItem = items.find((item) => item.localId === cropId);
  const inspected = items.find((item) => item.localId === inspectionId);
  const visibleItems = filter === 'all' ? items : items.filter((item) => FILTER_STATUSES[filter].includes(item.status));
  const countFor = (key: StatusFilter) => key === 'all' ? items.length : items.filter((item) => FILTER_STATUSES[key].includes(item.status)).length;
  const choose = (choice: { files: File[] } | { batch: StoredBatch }) => {
    if (!session.replaceable) return;
    if (items.some((item) => item.file)) { setReplacement(choice); return; }
    if ('files' in choice) session.selectFiles(choice.files); else session.restore(choice.batch);
    setConfirmPublish(false); setConfirmed(false); setFilter('all');
  };
  const refresh = async () => {
    if (session.locked || session.processing || !batch) return;
    setRefreshError(null); const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/admin/batches', { cache: 'no-store', signal: controller.signal }); const body = await response.json();
      if (!response.ok) throw new ApiError(response.status, 'UNKNOWN', body?.error?.message || c.refreshFailed);
      if (!Array.isArray(body?.items) || !body.items.every(isStoredBatch)) throw new Error();
      const current = body.items.find((entry: StoredBatch) => entry.id === batch.id); if (!current) { setRefreshError(t.batchNotFound); return; }
      if (session.locked || session.processing) return;
      session.refreshState(current); setConfirmPublish(false); setConfirmed(false); await history.reload();
    } catch (error) { setRefreshError(controller.signal.aborted ? c.readTimeout : error instanceof ApiError ? error.message : c.refreshFailed); }
    finally { window.clearTimeout(timeout); }
  };
  const retryableCount = items.filter((item) => RETRYABLE_STATUSES.includes(item.status) && (item.file || session.hasSave(item.localId))).length;
  return <section className="batch-studio">
    <header><div><span className="studio-eyebrow">{t.eyebrow}</span><h2>{t.title}</h2></div><label className="btn-primary batch-select-files" data-disabled={!session.replaceable}>{t.selectFiles}<input className="sr-only" type="file" disabled={!session.replaceable} accept="image/*,.heic,.heif" multiple onChange={(event) => { if (event.target.files?.length) choose({ files: [...event.target.files] }); event.target.value = ''; }} /></label></header>
    <p className="admin-help">{t.privacy}</p><p className="notice">{t.workflow}</p>
    {!items.length && state.error && <p role="alert" className="notice notice-danger">{state.error}</p>}
    <details className="batch-history"><summary>{t.history}</summary><p>{t.localOnly}</p><button type="button" className="btn-outline btn-sm" disabled={history.loading} onClick={() => void history.reload()}>{c.reload}</button>
      {history.error ? <p role="alert">{history.error}</p> : history.loading ? <p role="status">{c.loading}</p> : history.items.length === 0 ? <p>{t.noHistory}</p> : <ul>{history.items.map((entry) => <li key={entry.id}><button type="button" className="btn-outline btn-sm" disabled={!session.replaceable} onClick={() => choose({ batch: entry })}>{t.historyEntry(new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), entry.successCount, entry.itemCount)} · {t.batchStatus[entry.status]}</button><small className="admin-id">{t.batchId} {entry.id}</small></li>)}</ul>}
    </details>
    {!items.length && !batch ? <p className="admin-empty">{t.empty}</p> : <>
      <details key={batch ? "frozen" : "editable"}><summary>{t.uniformParams} · {state.defaults.targetWidth} {t.widthUnit} · {state.defaults.targetColorCount} {t.colorUnit}</summary><p>{t.fixedSpecification}</p><fieldset disabled={!editable}><BatchParamsEditor value={state.defaults} onChange={(value) => session.setDefaults({ ...DEFAULT_GENERATION_PARAMS, ...value })} /></fieldset></details>
      <label>{t.reason}<input value={state.reason} disabled={!editable} maxLength={500} onChange={(event) => session.setReason(event.target.value)} /></label>
      {batch && <p className="batch-summary">{t.batchStatus[batch.status]} · {t.counts(items.filter((item) => ['saved', 'published'].includes(item.status)).length, items.length)}<span className="admin-id">{t.batchId} {batch.id}</span></p>}
      {state.error && <p role="alert" className="notice notice-danger">{state.error}</p>}{state.uncertain && <div className="notice notice-warning"><p>{c.uncertain}</p><button type="button" className="btn-outline" disabled={state.busy} onClick={() => void session.retryCommand()}>{c.retry}</button></div>}
      {state.notice && <p role="status" className="notice">{state.notice}</p>}
      {state.conflict && <p className="notice notice-warning">{t.conflictHelp}</p>}{refreshError && <p role="alert">{refreshError}</p>}
      <div className="batch-toolbar batch-toolbar-sticky">
        {!batch && <button className="btn-primary" type="button" disabled={session.locked || Boolean(cropItem) || !items.some((item) => item.status === 'pending')} onClick={() => void session.start()}>{state.busy ? t.working : t.start}</button>}
        {batch && <>
          {batch.status === 'running' && state.mode === 'running' && <button className="btn-outline" type="button" disabled={session.locked} onClick={() => void session.pause()}>{t.pause}</button>}
          {state.mode !== 'running' && items.some((item) => item.status === 'pending') && <button className="btn-outline" type="button" disabled={session.locked || session.processing || state.conflict} onClick={() => void session.resume()}>{t.resume}</button>}
          {['running', 'paused'].includes(batch.status) && <><button className="btn-danger-outline" type="button" disabled={session.locked} onClick={() => void session.cancel()}>{t.cancel}</button><button className="btn-outline" type="button" disabled={session.locked || session.processing || Boolean(session.retainedSaveCount) || state.conflict || items.some((item) => item.status === 'pending')} onClick={() => void session.finish()}>{t.finishBatch}</button></>}
          <button className="btn-outline" type="button" disabled={session.locked || session.processing} onClick={() => void refresh()}>{c.refresh}</button>
          {retryableCount > 0 && <button className="btn-outline" type="button" disabled={session.locked || session.processing || state.conflict} onClick={() => void session.retryAllFailed()}>{t.retryAll} · {retryableCount}</button>}
          <span className="batch-toolbar-spacer" />
          <span className="batch-toolbar-summary">{t.selectedSummary(selected.length, publishable.length)}</span>
          <button className="btn-outline" type="button" disabled={session.locked || publishable.length === 0 || selected.length === publishable.length} onClick={() => session.selectAll()}>{t.selectAll}</button>
          {selected.length > 0 && <button className="btn-quiet" type="button" disabled={session.locked} onClick={() => session.clearSelection()}>{t.clearSelection}</button>}
          <button className="btn-primary" type="button" disabled={session.locked || session.processing || Boolean(session.retainedSaveCount) || state.conflict || !selected.length} onClick={(event) => { event.currentTarget.focus(); setConfirmPublish(true); setConfirmed(false); }}>{t.publishSelected} · {selected.length}</button>
        </>}
      </div>
      <div className="batch-filter" role="group" aria-label={t.filterLabel}>
        {(['all', 'pending', 'running', 'saved', 'failed', 'published'] as StatusFilter[]).map((key) => <button key={key} type="button" className="batch-filter-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === 'all' ? t.filterAll : t.filters[key]}<small>{countFor(key)}</small></button>)}
      </div>
      <ol className="batch-cards">{visibleItems.map((item) => <BatchItemCard key={item.localId} item={item} index={items.indexOf(item)} session={session} editable={editable} onCrop={() => setCropId(item.localId)} onInspect={() => setInspectionId(item.localId)} />)}</ol>
      {visibleItems.length === 0 && <p className="admin-empty">{t.filterEmpty}</p>}
    </>}
    {cropItem && <BatchCropEditor item={cropItem} session={session} onClose={() => setCropId(null)} />}
    {inspected && <DraftInspection item={inspected} onClose={() => setInspectionId(null)} />}
    {replacement && <Modal label={t.replaceTitle} onClose={() => setReplacement(null)} panelClassName="batch-dialog"><h2>{t.replaceTitle}</h2><p>{t.replaceHelp}</p><button type="button" className="btn-outline" onClick={() => setReplacement(null)}>{t.keepFiles}</button><button type="button" className="btn-danger-outline" onClick={() => { if ('files' in replacement) session.selectFiles(replacement.files); else session.restore(replacement.batch); setReplacement(null); setConfirmPublish(false); setFilter('all'); }}>{t.replaceConfirm}</button></Modal>}
    {confirmPublish && <Modal label={t.publishSelected} onClose={() => { if (!session.locked) setConfirmPublish(false); }} panelClassName="batch-dialog"><h2>{t.publishSelected}</h2><p>{t.publishHelp}</p><ul>{selected.map((item) => <li key={item.localId}>{item.title}</li>)}</ul><label className="admin-checkbox"><input type="checkbox" checked={confirmed} disabled={session.locked} onChange={(event) => setConfirmed(event.target.checked)} />{t.confirmPublication}</label>
      {state.error && <p role="alert">{state.error}</p>}{state.uncertain && <><p>{c.uncertain}</p><button type="button" className="btn-outline" disabled={state.busy} onClick={() => void session.retryCommand().then(() => { if (!session.locked && !session.getSnapshot().error) setConfirmPublish(false); })}>{c.retry}</button></>}
      <div className="table-actions"><button type="button" className="btn-outline" disabled={session.locked} onClick={() => setConfirmPublish(false)}>{t.backToDrafts}</button><button type="button" className="btn-primary" disabled={!confirmed || session.locked || !selected.length} onClick={() => void session.publish().then(() => { if (!session.locked && !session.getSnapshot().error) setConfirmPublish(false); })}>{t.confirmPublish}</button></div>
    </Modal>}
  </section>;
}
