'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Switch from '@/components/ui/Switch';
import SegmentedControl from '@/components/ui/SegmentedControl';

import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import { batchGenerationFailureMessage, officialBatchConcurrency } from '@/lib/community/batchClient';
import type { OfficialBatchSpec } from '@/lib/community/batchDefaults';
import { ApiError } from '@/lib/sync/clientAdapter';
import { createImageDecoder, type DecodedImage } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { LIMITS } from '@/lib/appInfo';
import { compatibleBoardProfilesForPalette, defaultBoardProfileForPalette, getBoardProfile } from '@/lib/boardProfiles';
import { KIT_TIERS, isKitTierAvailableForPalette, projectPaletteEngineColorCount } from '@/lib/kitTiers';
import { getBuiltinPalette, isBuiltinPaletteId, listBuiltinPalettes } from '@/lib/palettes';
import type { CommunityRevisionInspection } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';
import CropDialog from '@/components/crop/CropDialog';
import Modal from '@/components/ui/Modal';
import Badge, { type BadgeTone } from '@/components/ui/Badge';
import Button, { ButtonLink } from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Chip from '@/components/ui/Chip';
import Disclosure from '@/components/ui/Disclosure';
import EmptyState from '@/components/ui/EmptyState';
import Icon from '@/components/ui/Icon';
import IconButton from '@/components/ui/IconButton';
import Notice from '@/components/ui/Notice';
import NumberField from '@/components/ui/NumberField';
import TextField from '@/components/ui/TextField';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import OriginalPreview from '@/components/community/OriginalPreview';
import PatternPreview from '@/components/preview/PatternPreview';
import { BatchSession, isStoredBatch, RETRYABLE_STATUSES, type BatchItem, type BatchItemStatus, type StoredBatch } from './batchSession';
import { generateBatchItem } from './batchGeneration';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';
import { AdminSkeleton } from './AdminPrimitives';

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
const STATUS_TONE: Record<BatchItemStatus, BadgeTone> = {
  pending: 'neutral', running: 'progress', saving: 'progress', uploading: 'progress', save_unknown: 'warn', upload_failed: 'warn',
  saved: 'ok', published: 'ok', failed: 'danger', cancelled: 'neutral', unavailable: 'neutral',
};
const STEPS = ['select', 'configure', 'generate', 'publish'] as const;
type Step = typeof STEPS[number];

function BatchSteps({ current }: { current: Step }) {
  const index = STEPS.indexOf(current);
  return <ol className="batch-steps" aria-label={t.stepLabel(index + 1, STEPS.length)}>
    {STEPS.map((step, position) => <li key={step} aria-current={step === current ? 'step' : undefined} data-done={position < index || undefined}>
      <span className="batch-step-dot">{position < index ? <Icon name="check" size={14} /> : position + 1}</span>
      <span>{t.steps[step]}</span>
    </li>)}
  </ol>;
}

/** 制作规格：色板 → 兼容底板 → 可用套装档位。换色板时自动校正不兼容的底板与档位。 */
function SpecPicker({ spec, onChange, disabled }: { spec: OfficialBatchSpec; onChange: (spec: OfficialBatchSpec) => void; disabled: boolean }) {
  const palette = spec.paletteSelection.palette;
  const brand = palette.kind === 'builtin' ? palette.brand : null;
  const boards = compatibleBoardProfilesForPalette(palette);
  const engineCount = projectPaletteEngineColorCount(palette);
  const tiers = KIT_TIERS.filter((tier) => isKitTierAvailableForPalette(tier, palette));
  const summary = brand ? getBuiltinPalette(brand) : null;
  return <div className="batch-spec">
    <ResponsiveSelect label={t.specPalette} value={brand ?? ''} disabled={disabled} onValueChange={(value) => {
      if (!isBuiltinPaletteId(value)) return;
      const projectPalette = { kind: 'builtin' as const, brand: value };
      const kitTier = isKitTierAvailableForPalette(spec.paletteSelection.kitTier, projectPalette) ? spec.paletteSelection.kitTier : 0;
      onChange({ boardProfile: defaultBoardProfileForPalette(projectPalette, spec.boardProfile), paletteSelection: { palette: projectPalette, kitTier } });
    }} options={listBuiltinPalettes().map((entry) => ({ value: entry.id, label: entry.label, description: `${entry.brand} · ${entry.engineColorCount} 色` }))} />
    <ResponsiveSelect label={t.specBoard} value={spec.boardProfile} disabled={disabled || boards.length <= 1} onValueChange={(value) => { const board = boards.find((entry) => entry.id === value); if (board) onChange({ ...spec, boardProfile: board.id }); }}
      options={boards.map((board) => ({ value: board.id, label: board.displayName }))} />
    <ResponsiveSelect label={t.specKit} value={String(spec.paletteSelection.kitTier)} disabled={disabled} onValueChange={(value) => { const tier = Number(value); if (isKitTierAvailableForPalette(tier, palette)) onChange({ ...spec, paletteSelection: { ...spec.paletteSelection, kitTier: tier } }); }}
      options={tiers.map((tier) => ({ value: String(tier), label: tier === 0 ? t.specKitAll(engineCount) : t.specKitOption(tier) }))} />
    {summary && <div className="batch-spec-band" aria-hidden="true">{summary.engineColors.slice(0, 28).map((color) => <i key={color.hex} style={{ backgroundColor: color.hex }} />)}</div>}
  </div>;
}

function specSummary(spec: OfficialBatchSpec): string {
  const palette = spec.paletteSelection.palette;
  const paletteLabel = palette.kind === 'builtin' ? getBuiltinPalette(palette.brand).label : zhCN.share.customPalette(palette.colors.length);
  const kit = spec.paletteSelection.kitTier === 0 ? t.specKitAll(projectPaletteEngineColorCount(palette)) : t.specKitOption(spec.paletteSelection.kitTier);
  return t.specSummary(getBoardProfile(spec.boardProfile).displayName, paletteLabel, kit);
}

function BatchParamsEditor({ value, inherited, onChange, disabled = false }: { value: Partial<GenerationParams>; inherited?: GenerationParams; onChange: (value: Partial<GenerationParams>) => void; disabled?: boolean }) {
  const labels = { targetWidth: t.width, targetColorCount: t.colors, brightness: t.brightness, contrast: t.contrast, bgTolerance: t.bgTolerance } as const;
  const number = (key: keyof typeof labels, min: number, max: number) => <NumberField compact label={labels[key]} value={value[key]} min={min} max={max} disabled={disabled} placeholder={inherited ? String(inherited[key]) : undefined} onValueChange={(next) => {
    const copy = { ...value }; if (next === undefined) delete copy[key]; else copy[key] = next; onChange(copy);
  }} />;
  const bool = (key: 'dithering' | 'backgroundRemoval') => inherited ? <ResponsiveSelect size="sm" label={t[key]} value={value[key] === undefined ? '' : String(value[key])} disabled={disabled} onValueChange={raw => {
    const next = { ...value }; if (!raw) delete next[key]; else next[key] = raw === 'true'; onChange(next);
  }} options={[{value:'',label:t.inherit},{value:'true',label:t.enabled},{value:'false',label:t.disabled}]} /> : <Switch compact label={t[key]} checked={value[key]??false} disabled={disabled} onChange={checked=>onChange({...value,[key]:checked})} />;
  // 参数网格是工具行：全部控件统一 36 高，标签锁高，同一行底边对齐。
  return <div className="batch-params-grid form-row">
    {number('targetWidth', 20, 200)}{number('targetColorCount', 2, 128)}
    {inherited ? <ResponsiveSelect size="sm" label={t.mode} value={value.mode ?? ''} disabled={disabled} onValueChange={raw=>{const next={...value};if(!raw)delete next.mode;else next.mode=raw as GenerationParams['mode'];onChange(next);}} options={[{value:'',label:t.inherit},{value:'dominant',label:t.dominant},{value:'average',label:t.average}]} /> : <SegmentedControl size="sm" showLabel label={t.mode} value={value.mode ?? 'dominant'} disabled={disabled} onValueChange={mode=>onChange({...value,mode:mode as GenerationParams['mode']})} options={[{value:'dominant',label:t.dominant},{value:'average',label:t.average}]} />}
    {bool('dithering')}{number('brightness', -100, 100)}{number('contrast', -100, 100)}
    {bool('backgroundRemoval')}{number('bgTolerance', 0, 40)}
    <TextField size="sm" mono label={t.backgroundPrototype} value={value.backgroundPrototype ?? ''} disabled={disabled} placeholder={inherited?.backgroundPrototype ?? t.autoBackground} maxLength={7} onChange={(event) => onChange({ ...value, backgroundPrototype: event.target.value || null })} />
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
    : <Modal label={t.cropTitle} onClose={onClose} panelClassName="batch-dialog"><h2>{t.cropTitle}</h2>{error ? <Notice kind="danger">{error}</Notice> : <AdminSkeleton rows={2} label={c.loading} />}<div className="modal-actions"><Button variant="secondary" onClick={onClose}>{zhCN.common.close}</Button></div></Modal>;
}

function DraftInspection({ item, onClose }: { item: BatchItem; onClose: () => void }) {
  const inspection = useAdminInspection<CommunityRevisionInspection>(`/api/admin/community/revisions/${item.revisionId}`);
  return <Modal label={t.inspectTitle} onClose={onClose} panelClassName="batch-inspection"><header><h2>{item.title}</h2><IconButton icon="close" size="sm" label={zhCN.common.close} onClick={onClose} /></header>
    {inspection.error ? <><Notice kind="danger">{inspection.error}</Notice><div className="admin-form-actions"><Button variant="secondary" size="sm" icon="refresh" onClick={() => void inspection.reload()}>{c.reload}</Button></div></> : inspection.data ? <><div className="review-material-pair"><PatternPreview variant="compact" caption={`${inspection.data.snapshot.pattern.width}×${inspection.data.snapshot.pattern.height} · ${getBoardProfile(inspection.data.snapshot.boardProfile).displayName}`} pattern={inspection.data.snapshot.pattern} boardSize={getBoardProfile(inspection.data.snapshot.boardProfile).boardCols} />{item.revisionId && <OriginalPreview revisionId={item.revisionId} title={item.title} />}</div><p className="mono-id">{t.draftId} {item.revisionId}</p></> : <AdminSkeleton rows={3} label={c.loading} />}
  </Modal>;
}

/** 卡片：已保存的草稿用服务端带格线缩略图（D52），生成中的项目才用本地派生预览。 */
/**
 * 卡片按 item 引用做 memo：会话每次进度刷新都会产生新的 state，但只有被修改的那一项会拿到新的 item 对象，
 * 其余 49 张卡片不重渲染（50 项批次此前每次进度更新都要重画全部卡片）。
 */
const BatchItemCard = memo(function BatchItemCard({ item, index, session, editable, serverThumbnails, defaults, locked, processing, conflict, hasSave, onCrop, onInspect }: {
  item: BatchItem; index: number; session: BatchSession; editable: boolean; serverThumbnails: boolean; defaults: GenerationParams;
  locked: boolean; processing: boolean; conflict: boolean; hasSave: boolean; onCrop: (id: string) => void; onInspect: (id: string) => void;
}) {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const busy = ['running', 'saving', 'uploading'].includes(item.status);
  const retryable = RETRYABLE_STATUSES.includes(item.status) && (item.file || hasSave);
  const needsOriginalFile = item.status === 'upload_failed' && !item.file && item.revisionId;
  const overrideCount = Object.keys(item.paramsOverride).length;
  return <li className="batch-card" data-tone={STATUS_TONE[item.status]} data-status={item.status} aria-label={t.itemLabel(index + 1)}>
    <div className="batch-card-media pegboard">
      {item.revisionId && item.preview && serverThumbnails
        ? <CommunityThumbnail revisionId={item.revisionId} width={item.preview.originalWidth} height={item.preview.originalHeight} label={t.previewLabel(item.title)} />
        : item.preview ? <CommunityPreviewCanvas preview={item.preview} label={t.previewLabel(item.title)} />
        : <div className="batch-card-placeholder">{busy ? <span className="batch-card-percent">{item.progress}<small>{t.percent}</small></span> : <><Icon name="image" size={22} /><span>{t.noPreview}</span></>}</div>}
      {busy && <div className="batch-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress}><span style={{ width: `${item.progress}%` }} /></div>}
      <span className="batch-card-index">{String(index + 1).padStart(2, '0')}</span>
    </div>
    <div className="batch-card-body">
      <header><Badge tone={STATUS_TONE[item.status]}>{t.status[item.status]}</Badge>{item.hasOriginal && item.status !== 'published' && <Badge tone="ok" dot={false}><Icon name="check" size={12} />{t.originalReady}</Badge>}</header>
      <TextField size="sm" className="batch-card-title" label={t.publicTitle} value={item.title} maxLength={80} disabled={!editable} onChange={(event) => session.updateItem(item.localId, { title: event.target.value })} />
      <p className="batch-card-file"><Icon name="image" size={13} />{item.localName}{item.preview && ` · ${item.preview.originalWidth}×${item.preview.originalHeight}`}</p>
      {item.file && editable && <div className="batch-card-crop"><Button variant="secondary" size="xs" icon="crop" onClick={() => onCrop(item.localId)}>{item.crop ? t.recrop : t.cropTitle}</Button><span>{item.crop ? t.cropSummary(item.crop.width, item.crop.height) : t.uncropped}</span>{item.crop && <Button variant="quiet" size="xs" onClick={() => session.updateItem(item.localId, { crop: null })}>{t.resetCrop}</Button>}</div>}
      {/* 覆盖参数编辑器只在展开时挂载：50 张卡片各带一套数字输入会拖慢每次进度刷新。 */}
      {editable && <Disclosure compact icon="sliders" summary={t.itemOverrides} meta={overrideCount > 0 ? `${overrideCount}` : undefined} expanded={overridesOpen} onExpandedChange={setOverridesOpen}>{overridesOpen && <><BatchParamsEditor value={item.paramsOverride} inherited={defaults} onChange={(paramsOverride) => session.updateItem(item.localId, { paramsOverride })} />{overrideCount > 0 && <div className="admin-form-actions"><Button variant="quiet" size="xs" icon="close" onClick={() => session.updateItem(item.localId, { paramsOverride: {} })}>{t.resetOverrides}</Button></div>}</>}</Disclosure>}
      {item.error && <Notice kind="danger" compact>{item.error}</Notice>}
      {item.status === 'save_unknown' && <Notice kind="warning" compact>{t.saveUnknown}</Notice>}
    </div>
    <footer className="batch-card-actions">
      {item.status === 'saved' && <Checkbox compact className="admin-checkbox" label={t.selectPublish} checked={item.selected} disabled={locked} onChange={(checked) => session.updateItem(item.localId, { selected: checked })} />}
      {item.revisionId && ['saved', 'published', 'upload_failed'].includes(item.status) && <Button variant="secondary" size="xs" icon="eye" onClick={() => onInspect(item.localId)}>{t.inspectTitle}</Button>}
      {['pending', 'running', 'failed'].includes(item.status) && <Button variant="quiet" size="xs" icon="close" disabled={locked} onClick={() => session.cancelItem(item.localId)}>{t.cancelItem}</Button>}
      {retryable && <Button variant="secondary" size="xs" icon="refresh" disabled={locked || processing || conflict} onClick={() => void session.retryItem(item.localId)}>{item.status === 'upload_failed' ? t.retryUpload : hasSave ? t.retrySave : t.retry}</Button>}
      {needsOriginalFile && <label className="btn-outline btn-xs batch-select-files" data-disabled={locked}>{t.attachOriginal}<input className="sr-only" type="file" accept="image/*,.heic,.heif" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; if (file) void session.attachOriginal(item.localId, file); event.target.value = ''; }} /></label>}
      {item.status === 'published' && item.workId && <ButtonLink external variant="quiet" size="xs" icon="external" iconPosition="end" href={`/community/${item.workId}`} target="_blank" rel="noreferrer">{t.openPublic}</ButtonLink>}
    </footer>
  </li>;
});

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
  const [dragging, setDragging] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(true);
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
  const processed = items.filter((item) => !['pending', 'running', 'saving', 'uploading'].includes(item.status)).length;
  const generating = Boolean(batch) && (state.mode === 'running' || items.some((item) => ['running', 'saving', 'uploading', 'pending'].includes(item.status)) ) && !['completed', 'cancelled'].includes(batch?.status ?? '');
  const step: Step = !items.length && !batch ? 'select' : !batch ? 'configure' : generating && items.some((item) => ['pending', 'running', 'saving', 'uploading'].includes(item.status)) ? 'generate' : 'publish';
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
  // 选图入口在各阶段都是同一个 label + input：选图阶段是钉板落区里的主按钮，之后收成顶部的一行摘要。
  const intake = <div className={`batch-intake${step === 'select' ? ' is-open pegboard' : ' is-compact'}${dragging ? ' is-active' : ''}`}
    onDragOver={(event) => { if (session.replaceable) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); const files = [...event.dataTransfer.files]; if (files.length && session.replaceable) choose({ files }); }}>
    {step === 'select'
      ? <><span className="upload-dropzone-icon"><Icon name="images" size={22} /></span><p><strong>{t.dropTitle}</strong><small>{t.dropHint}</small></p></>
      : <p className="batch-intake-summary"><Icon name="images" size={16} />{t.itemsTitle(items.length)}{batch && <span className="batch-summary">{t.batchStatus[batch.status]} · {t.counts(items.filter((item) => ['saved', 'published'].includes(item.status)).length, items.length)}</span>}</p>}
    <label className={`${step === 'select' ? 'btn-primary' : 'btn-outline btn-sm'} batch-select-files`} data-disabled={!session.replaceable}><Icon name={step === 'select' ? 'upload' : 'refresh'} size={step === 'select' ? 18 : 14} />{t.selectFiles}<input className="sr-only" type="file" disabled={!session.replaceable} accept="image/*,.heic,.heif" multiple onChange={(event) => { if (event.target.files?.length) choose({ files: [...event.target.files] }); event.target.value = ''; }} /></label>
  </div>;
  const historyList = <div className="batch-history">
    <div className="batch-history-head"><p className="admin-help">{t.localOnly}</p><Button variant="quiet" size="sm" icon="refresh" disabled={history.loading} onClick={() => void history.reload()}>{c.reload}</Button></div>
    {history.error ? <Notice kind="danger">{history.error}</Notice> : history.loading ? <AdminSkeleton rows={2} label={c.loading} /> : history.items.length === 0 ? <p className="admin-help">{t.noHistory}</p> : <ul className="stagger">{history.items.map((entry, index) => <li key={entry.id} style={{ '--i': index } as CSSProperties}>
      <Button variant="secondary" size="sm" icon="clock" disabled={!session.replaceable} onClick={() => choose({ batch: entry })}>{t.historyEntry(new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), entry.successCount, entry.itemCount)} · {t.batchStatus[entry.status]}</Button>
      <small className="mono-id">{t.batchId} {entry.id}</small>
    </li>)}</ul>}
  </div>;

  return <section className="batch-studio">
    <BatchSteps current={step} />
    {!items.length && state.error && <Notice kind="danger">{state.error}</Notice>}
    {intake}
    {step === 'select' && <div className="batch-stage-select">
      <p className="admin-help">{t.privacy}</p>
      <section className="admin-panel batch-panel" aria-label={t.spec}><header><h2>{t.spec}</h2><span>{specSummary(state.spec)}</span></header><div className="batch-panel-body"><SpecPicker spec={state.spec} onChange={(spec) => session.setSpec(spec)} disabled={!editable} /></div></section>
      <section className="admin-panel batch-panel" aria-label={t.history}><header><h2>{t.history}</h2></header>{historyList}</section>
    </div>}
    {step !== 'select' && <>
      <section className="admin-panel batch-panel batch-config" aria-label={t.configureTitle}>
        <header><h2>{t.configureTitle}</h2>{batch && <p className="mono-id">{t.batchId} {batch.id}</p>}</header>
        <div className="batch-panel-body">
          <Disclosure compact icon="palette" summary={t.spec} meta={specSummary(state.spec)} expanded={specOpen} onExpandedChange={setSpecOpen}>{specOpen && <><SpecPicker spec={state.spec} onChange={(spec) => session.setSpec(spec)} disabled={!editable} /><p className="admin-help">{t.specFrozen}</p></>}</Disclosure>
          <Disclosure compact icon="sliders" summary={`${t.uniformParams} · ${state.defaults.targetWidth} ${t.widthUnit} · ${state.defaults.targetColorCount} ${t.colorUnit}`} expanded={paramsOpen && !batch} onExpandedChange={setParamsOpen}>{paramsOpen && !batch && <fieldset disabled={!editable} className="batch-fieldset"><BatchParamsEditor value={state.defaults} disabled={!editable} onChange={(value) => session.setDefaults({ ...DEFAULT_GENERATION_PARAMS, ...value })} /></fieldset>}</Disclosure>
          <TextField className="batch-reason" label={t.reason} value={state.reason} disabled={!editable} maxLength={500} onChange={(event) => session.setReason(event.target.value)} />
          {!batch && <Disclosure compact icon="clock" summary={t.history}>{historyList}</Disclosure>}
        </div>
      </section>
      {state.error && <Notice kind="danger">{state.error}</Notice>}{state.uncertain && <div className="admin-command-notice animate-rise"><Notice kind="warning" as="div"><span>{c.uncertain}</span><Button variant="secondary" size="sm" icon="refresh" disabled={state.busy} onClick={() => void session.retryCommand()}>{c.retry}</Button></Notice></div>}
      {state.notice && <Notice kind="info" role="status">{state.notice}</Notice>}
      {state.conflict && <Notice kind="warning">{t.conflictHelp}</Notice>}{refreshError && <Notice kind="danger">{refreshError}</Notice>}
      <div className="batch-toolbar batch-toolbar-sticky">
        {!batch && <Button variant="primary" icon="play" loading={state.busy} disabled={session.locked || Boolean(cropItem) || !items.some((item) => item.status === 'pending')} onClick={() => void session.start()}>{state.busy ? t.working : t.start}</Button>}
        {batch && <>
          {step === 'generate' && <span className="batch-toolbar-progress"><Icon name="clock" size={16} />{t.progressTitle(processed, items.length)}</span>}
          {batch.status === 'running' && state.mode === 'running' && <Button variant="secondary" icon="pause" disabled={session.locked} onClick={() => void session.pause()}>{t.pause}</Button>}
          {state.mode !== 'running' && items.some((item) => item.status === 'pending') && <Button variant="secondary" icon="play" disabled={session.locked || session.processing || state.conflict} onClick={() => void session.resume()}>{t.resume}</Button>}
          {['running', 'paused'].includes(batch.status) && <><Button variant="danger" icon="stop" disabled={session.locked} onClick={() => void session.cancel()}>{t.cancel}</Button><Button variant="secondary" icon="check" disabled={session.locked || session.processing || Boolean(session.retainedSaveCount) || state.conflict || items.some((item) => item.status === 'pending')} onClick={() => void session.finish()}>{t.finishBatch}</Button></>}
          <Button variant="quiet" icon="refresh" disabled={session.locked || session.processing} onClick={() => void refresh()}>{c.refresh}</Button>
          {retryableCount > 0 && <Button variant="secondary" icon="refresh" disabled={session.locked || session.processing || state.conflict} onClick={() => void session.retryAllFailed()}>{t.retryAll} · {retryableCount}</Button>}
          <span className="batch-toolbar-spacer" />
          <span className="batch-toolbar-summary">{t.selectedSummary(selected.length, publishable.length)}</span>
          <Button variant="secondary" disabled={session.locked || publishable.length === 0 || selected.length === publishable.length} onClick={() => session.selectAll()}>{t.selectAll}</Button>
          {selected.length > 0 && <Button variant="quiet" disabled={session.locked} onClick={() => session.clearSelection()}>{t.clearSelection}</Button>}
          <Button variant="primary" icon="send" disabled={session.locked || session.processing || Boolean(session.retainedSaveCount) || state.conflict || !selected.length} onClick={(event) => { event.currentTarget.focus(); setConfirmPublish(true); setConfirmed(false); }}>{t.publishSelected} · {selected.length}</Button>
        </>}
      </div>
      {step === 'generate' && <p className="admin-help">{t.generatingHint}</p>}
      {step === 'publish' && publishable.length > 0 && <p className="admin-help">{t.reviewHint}</p>}
      {batch && <div className="batch-filter" role="group" aria-label={t.filterLabel}>
        {(['all', 'pending', 'running', 'saved', 'failed', 'published'] as StatusFilter[]).map((key) => <Chip key={key} className="batch-filter-chip" pressed={filter === key} count={countFor(key)} onClick={() => setFilter(key)}>{key === 'all' ? t.filterAll : t.filters[key]}</Chip>)}
      </div>}
      {/* 生成期间卡片用本地派生预览，批次停下后再换成服务端带格线缩略图，避免 50 张 PNG 渲染与草稿保存抢同一个服务器。 */}
      <ol className="batch-cards">{visibleItems.map((item) => <BatchItemCard key={item.localId} item={item} index={items.indexOf(item)} session={session} editable={editable} serverThumbnails={!(batch && state.mode === 'running')} defaults={state.defaults} locked={session.locked} processing={session.processing} conflict={state.conflict} hasSave={session.hasSave(item.localId)} onCrop={setCropId} onInspect={setInspectionId} />)}</ol>
      {visibleItems.length === 0 && <EmptyState compact align="start" icon="filter" title={t.filterEmpty} />}
    </>}
    {cropItem && <BatchCropEditor item={cropItem} session={session} onClose={() => setCropId(null)} />}
    {inspected && <DraftInspection item={inspected} onClose={() => setInspectionId(null)} />}
    {replacement && <Modal label={t.replaceTitle} onClose={() => setReplacement(null)} panelClassName="batch-dialog"><h2>{t.replaceTitle}</h2><p className="modal-copy">{t.replaceHelp}</p><div className="modal-actions"><Button variant="quiet" onClick={() => setReplacement(null)}>{t.keepFiles}</Button><Button variant="dangerSolid" onClick={() => { if ('files' in replacement) session.selectFiles(replacement.files); else session.restore(replacement.batch); setReplacement(null); setConfirmPublish(false); setFilter('all'); }}>{t.replaceConfirm}</Button></div></Modal>}
    {confirmPublish && <Modal label={t.publishSelected} onClose={() => { if (!session.locked) setConfirmPublish(false); }} panelClassName="batch-dialog"><h2>{t.publishSelected}</h2><p className="modal-copy">{t.publishHelp}</p><ul>{selected.map((item) => <li key={item.localId}>{item.title}</li>)}</ul><Checkbox className="admin-checkbox" label={t.confirmPublication} checked={confirmed} disabled={session.locked} onChange={setConfirmed} />
      {state.error && <Notice kind="danger">{state.error}</Notice>}{state.uncertain && <Notice kind="warning" as="div"><span>{c.uncertain}</span><Button variant="secondary" size="sm" icon="refresh" disabled={state.busy} onClick={() => void session.retryCommand().then(() => { if (!session.locked && !session.getSnapshot().error) setConfirmPublish(false); })}>{c.retry}</Button></Notice>}
      <div className="modal-actions"><Button variant="quiet" disabled={session.locked} onClick={() => setConfirmPublish(false)}>{t.backToDrafts}</Button><Button variant="primary" icon="send" disabled={!confirmed || session.locked || !selected.length} loading={state.busy && confirmed} onClick={() => void session.publish().then(() => { if (!session.locked && !session.getSnapshot().error) setConfirmPublish(false); })}>{t.confirmPublish}</Button></div>
    </Modal>}
  </section>;
}
