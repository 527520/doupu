import { ENGINE_VERSION } from '@/lib/appInfo';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import { generationParamsSchema } from '@/lib/schemas';
import { batchGenerationFailureMessage, validateOfficialBatchFiles } from '@/lib/community/batchClient';
import { communityPreviewSchema, deriveCommunityPreview, type CommunityPreviewV1, type CommunitySnapshotV1 } from '@/lib/community/snapshot';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';
import { z } from 'zod';

export interface BatchCrop { x: number; y: number; width: number; height: number }
export interface BatchGeneration { promise: Promise<CommunitySnapshotV1>; cancel: () => void }
export type BatchItemStatus = 'pending' | 'running' | 'saving' | 'save_unknown' | 'saved' | 'published' | 'failed' | 'cancelled' | 'unavailable';
export interface BatchItem {
  localId: string; file: File | null; localName: string; title: string; crop: BatchCrop | null;
  paramsOverride: Partial<GenerationParams>; status: BatchItemStatus; progress: number;
  error: string | null; revisionId: string | null; workId: string | null; selected: boolean; preview: CommunityPreviewV1 | null;
}
export interface BatchRow { id: string; version: number; status: 'running' | 'paused' | 'completed' | 'cancelled'; failureCount?: number }
export interface StoredBatch extends BatchRow {
  createdAt: string; itemCount: number; successCount: number; failureCount: number;
  defaultParams?: unknown;
  drafts: Array<{ id: string; workId: string; title: string; status: string; preview: CommunityPreviewV1 }>;
}
interface State {
  items: BatchItem[]; batch: BatchRow | null; defaults: GenerationParams; reason: string;
  mode: 'idle' | 'running' | 'paused' | 'cancelled'; busy: boolean; uncertain: boolean; conflict: boolean;
  command: string | null; error: string | null; notice: string | null;
}
interface Attempt { url: string; method: 'POST' | 'PATCH'; body: string; key: string }
interface Command extends Attempt { name: string; accept: (body: unknown) => void }
interface Dependencies {
  generate: (input: { file: File; crop: BatchCrop | null; params: GenerationParams }, onProgress: (value: number) => void) => BatchGeneration;
  concurrency: 1 | 2; fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}
const t = zhCN.communityAdmin.batch;
const uuid = z.uuid();
const isUuid = (value: unknown): value is string => uuid.safeParse(value).success;
const isBatch = (value: unknown): value is BatchRow => Boolean(value && typeof value === 'object'
  && 'id' in value && isUuid(value.id) && 'version' in value && typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > 0
  && 'status' in value && ['running', 'paused', 'completed', 'cancelled'].includes(String(value.status))
  && (!('failureCount' in value) || typeof value.failureCount === 'number' && Number.isSafeInteger(value.failureCount) && value.failureCount >= 0));
const countBucket = (n: number) => n === 1 ? '1' : n <= 5 ? '2-5' : n <= 10 ? '6-10' : n <= 25 ? '11-25' : '26-50';
const storedBatchSchema = z.object({
  id: uuid, version: z.number().int().positive(), status: z.enum(['running', 'paused', 'completed', 'cancelled']),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  itemCount: z.number().int().min(1).max(50), successCount: z.number().int().min(0).max(50), failureCount: z.number().int().min(0).max(50),
  defaultParams: generationParamsSchema.optional(),
  drafts: z.array(z.object({ id: uuid, workId: uuid, title: z.string().min(1).max(80),
    status: z.enum(['draft', 'pending_review', 'published', 'rejected', 'withdrawn', 'superseded']), preview: communityPreviewSchema })).max(50),
}).refine((batch) => batch.successCount <= batch.itemCount && batch.failureCount <= batch.itemCount
  && batch.drafts.length <= batch.itemCount && new Set(batch.drafts.map((draft) => draft.id)).size === batch.drafts.length);
export const isStoredBatch = (value: unknown): value is StoredBatch => storedBatchSchema.safeParse(value).success;

/** One in-memory file set. Scheduling and immutable write attempts outlive React renders,
 * but never this page. Server state is recovered only through explicitly chosen history. */
export class BatchSession {
  private state: State = { items: [], batch: null, defaults: { ...DEFAULT_GENERATION_PARAMS }, reason: t.defaultReason, mode: 'idle', busy: false, uncertain: false, conflict: false, command: null, error: null, notice: null };
  private listeners = new Set<() => void>();
  private active = new Map<string, { cancel: () => void }>();
  private saves = new Map<string, Attempt>();
  private controllers = new Set<AbortController>();
  private attempt: Command | null = null;
  private disposed = false;
  constructor(private readonly deps: Dependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get retainedSaveCount() { return this.saves.size; }
  hasSave(id: string) { return this.saves.has(id); }
  get processing() { return this.active.size > 0; }
  get locked() { return this.state.busy || this.state.uncertain; }
  get replaceable() { return !this.locked && !this.processing && !this.saves.size && this.state.mode !== 'running'; }
  private emit(change: Partial<State>) { if (this.disposed) return; this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()); }
  private patch(id: string, change: Partial<BatchItem>) { this.emit({ items: this.state.items.map((item) => item.localId === id ? { ...item, ...change } : item) }); }
  private makeAttempt(url: string, method: Attempt['method'], body: object): Attempt { return { url, method, body: JSON.stringify(body), key: crypto.randomUUID() }; }
  private async request(attempt: Attempt): Promise<{ ok: true; body: unknown } | { ok: false; uncertain: boolean; conflict: boolean; message: string }> {
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await (this.deps.fetcher ?? fetch)(attempt.url, { method: attempt.method, headers: { 'content-type': 'application/json', 'idempotency-key': attempt.key }, body: attempt.body, signal: controller.signal });
      const body = await response.json();
      if (response.ok) return { ok: true, body };
      return { ok: false, uncertain: response.status >= 500 || response.status === 408, conflict: body?.error?.code === 'STATE_CONFLICT', message: body?.error?.message || t.actionFailed };
    } catch { return { ok: false, uncertain: true, conflict: false, message: zhCN.communityAdmin.command.network }; }
    finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  private async execute(command: Command) {
    if (this.state.busy || this.disposed) return;
    this.emit({ busy: true, uncertain: false, error: null, conflict: false, command: command.name });
    const result = await this.request(command);
    if (this.disposed) return;
    if (result.ok) {
      try {
        command.accept(result.body);
        this.attempt = null;
        this.emit({ busy: false, uncertain: false, command: null });
        this.pump();
        return;
      } catch { /* An unreadable success may already have committed. Replay only this attempt. */ }
    }
    const failure = result.ok ? { uncertain: true, conflict: false, message: t.actionFailed } : result;
    if (!failure.uncertain) this.attempt = null;
    this.emit({ busy: false, uncertain: failure.uncertain, conflict: failure.conflict, error: failure.message, mode: 'paused', command: failure.uncertain ? command.name : null });
  }
  private async command(name: string, url: string, method: Attempt['method'], body: object, accept: Command['accept']) {
    if (this.locked || this.attempt || this.disposed) return;
    this.attempt = { ...this.makeAttempt(url, method, body), name, accept };
    await this.execute(this.attempt);
  }
  retryCommand = async () => { if (this.attempt) await this.execute(this.attempt); };
  setDefaults(value: GenerationParams) { if (!this.state.batch && !this.locked) this.emit({ defaults: value }); }
  setReason(reason: string) { if (!this.state.batch && !this.locked) this.emit({ reason }); }
  selectFiles(files: File[]) {
    if (!this.replaceable) return;
    const error = validateOfficialBatchFiles(files); if (error) { this.emit({ error }); return; }
    this.emit({ batch: null, mode: 'idle', conflict: false, error: null, notice: t.localOnly, items: files.map((file, index) => ({ localId: crypto.randomUUID(), file, localName: file.name, title: t.defaultTitle(index + 1), crop: null, paramsOverride: {}, status: 'pending', progress: 0, error: null, revisionId: null, workId: null, selected: false, preview: null })) });
  }
  updateItem(id: string, change: Partial<Pick<BatchItem, 'title' | 'crop' | 'paramsOverride' | 'selected'>>) {
    if (this.locked) return;
    if (Object.keys(change).some((key) => key !== 'selected') && this.state.batch) return;
    this.patch(id, change);
  }
  async start() {
    if (this.state.batch || this.locked || !this.state.items.some((item) => item.status === 'pending')) return;
    if (this.state.reason.trim().length < 3 || this.state.reason.trim().length > 500 || !generationParamsSchema.safeParse(this.state.defaults).success
      || this.state.items.some((item) => !item.title.trim() || item.title.trim().length > 80 || !generationParamsSchema.safeParse({ ...this.state.defaults, ...item.paramsOverride }).success)) {
      this.emit({ error: t.invalidConfiguration }); return;
    }
    await this.command('create', '/api/admin/batches', 'POST', { itemCount: this.state.items.length, defaultParams: this.state.defaults, engineVersion: ENGINE_VERSION, reason: this.state.reason }, (body) => {
      if (!isBatch(body) || body.version !== 1 || body.status !== 'running') throw new Error();
      this.emit({ batch: body, mode: 'running', notice: null });
      track({ name: 'official_batch_started', properties: { itemCountBucket: countBucket(this.state.items.length) } });
    });
  }
  private pump() {
    if (!this.disposed && !this.locked && this.state.mode === 'cancelled' && !this.processing && !this.saves.size && this.state.batch && ['running', 'paused'].includes(this.state.batch.status)) { void this.transition('cancel'); return; }
    if (this.disposed || this.locked || this.state.conflict || this.state.mode !== 'running' || this.state.batch?.status !== 'running') return;
    while (this.active.size < this.deps.concurrency) {
      const item = this.state.items.find((entry) => entry.status === 'pending'); if (!item) break;
      this.active.set(item.localId, { cancel: () => undefined });
      this.patch(item.localId, { status: 'running', error: null, progress: 1 });
      void this.process(item);
    }
    if (!this.active.size && !this.saves.size && this.state.items.every((item) => item.status !== 'pending')) void this.finish();
  }
  private async process(item: BatchItem) {
    try {
      if (!item.file) throw new Error(t.generationFailed);
      const task = this.deps.generate({ file: item.file, crop: item.crop, params: { ...this.state.defaults, ...item.paramsOverride } }, (progress) => this.patch(item.localId, { progress }));
      this.active.set(item.localId, task);
      const snapshot = await task.promise;
      if (this.disposed || this.state.items.find((entry) => entry.localId === item.localId)?.status === 'cancelled') return;
      const attempt = this.makeAttempt(`/api/admin/batches/${this.state.batch!.id}/drafts`, 'POST', { title: item.title, snapshot, reason: this.state.reason });
      this.saves.set(item.localId, attempt);
      // Decoder/Worker buffers are already disposed. Keep the original File only
      // until save confirmation, and never regenerate an unresolved graph request.
      this.patch(item.localId, { preview: deriveCommunityPreview(snapshot.pattern), status: 'saving', progress: 100 });
      await this.save(item.localId, attempt);
    } catch (error) {
      if (!this.disposed) {
        const cancelled = error instanceof Error && error.name === 'AbortError';
        this.patch(item.localId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : batchGenerationFailureMessage(error) });
        if (!cancelled) track({ name: 'official_batch_item_failed', properties: { errorCode: 'BATCH_ITEM_FAILED' } });
      }
    } finally { this.active.delete(item.localId); this.emit({}); this.pump(); }
  }
  private async save(id: string, attempt: Attempt) {
    this.patch(id, { status: 'saving', error: null });
    const result = await this.request(attempt); if (this.disposed) return;
    const body = result.ok ? result.body as { batchId?: unknown; revisionId?: unknown; workId?: unknown; status?: unknown } | null : null;
    if (result.ok && body?.batchId === this.state.batch?.id && body?.status === 'draft' && isUuid(body?.revisionId) && isUuid(body?.workId)) {
      this.saves.delete(id); this.patch(id, { status: 'saved', file: null, revisionId: body.revisionId, workId: body.workId, selected: false, error: null });
      track({ name: 'official_batch_item_succeeded', properties: {} });
    } else {
      const uncertain = result.ok || result.uncertain;
      const cancelled = !uncertain && this.state.mode === 'cancelled';
      if (cancelled) this.saves.delete(id);
      this.patch(id, { status: cancelled ? 'cancelled' : uncertain ? 'save_unknown' : 'failed', error: cancelled ? null : result.ok ? t.actionFailed : result.message });
      if (!cancelled && !result.ok && result.conflict) this.emit({ conflict: true, mode: 'paused' });
    }
  }
  cancelItem(id: string) {
    const item = this.state.items.find((entry) => entry.localId === id);
    if (!item || !['pending', 'running', 'failed'].includes(item.status)) return;
    if (item.status === 'failed') this.saves.delete(id);
    this.patch(id, { status: 'cancelled', error: null, preview: null }); this.active.get(id)?.cancel(); this.pump();
  }
  private async transition(action: 'pause' | 'resume' | 'cancel' | 'finish') {
    const batch = this.state.batch; if (!batch) return;
    await this.command(action, `/api/admin/batches/${batch.id}`, 'PATCH', { action, expectedVersion: batch.version, reason: this.state.reason }, (body) => {
      const nextStatus = action === 'resume' ? 'running' : action === 'pause' ? 'paused' : action === 'finish' ? 'completed' : 'cancelled';
      if (!isBatch(body) || body.id !== batch.id || body.version !== batch.version + 1 || body.status !== nextStatus) throw new Error();
      this.emit({ batch: body, mode: action === 'resume' ? 'running' : action === 'cancel' ? 'cancelled' : 'paused' });
      if (action === 'finish' || action === 'cancel') {
        const failures = body.failureCount ?? this.state.items.filter((item) => ['failed', 'cancelled'].includes(item.status)).length;
        this.emit({ notice: action === 'cancel' ? t.cancelledHelp : failures ? t.partialFinished(failures) : t.finished });
        track({ name: 'official_batch_completed', properties: { result: action === 'cancel' ? 'cancelled' : failures ? 'partial' : 'succeeded', itemCountBucket: countBucket(this.state.items.length) } });
      }
    });
  }
  async pause() { if (this.locked || this.state.batch?.status !== 'running') return; this.emit({ mode: 'paused' }); await this.transition('pause'); }
  async resume() {
    if (this.locked || this.processing || this.state.conflict || !this.state.batch) return;
    if (this.state.batch.status !== 'running') await this.transition('resume');
    else { this.emit({ mode: 'running', error: null }); this.pump(); }
  }
  async cancel() {
    if (this.locked || !this.state.batch || !['running', 'paused'].includes(this.state.batch.status)) return;
    this.emit({ mode: 'cancelled', notice: t.cancelling });
    this.state.items.forEach((item) => this.cancelItem(item.localId));
    // A save may already have committed. Do not cancel the server batch while an
    // unresolved save could still need its original transaction to be replayed.
    if (this.processing || this.saves.size) return;
    await this.transition('cancel');
  }
  async finish() {
    if (this.locked || this.processing || this.saves.size || this.state.conflict || this.state.items.some((item) => item.status === 'pending') || !this.state.batch || !['running', 'paused'].includes(this.state.batch.status)) return;
    await this.transition('finish');
  }
  async retryItem(id: string) {
    if (this.locked || this.processing || this.state.conflict) return;
    const item = this.state.items.find((entry) => entry.localId === id); if (!item || !['failed', 'cancelled', 'save_unknown'].includes(item.status)) return;
    if (!this.state.batch) { if (item.file) this.patch(id, { status: 'pending', error: null }); return; }
    const attempt = this.saves.get(id);
    if (attempt) {
      if (item.status === 'failed' && this.state.batch.status !== 'running') {
        await this.resume(); if (this.locked || this.getSnapshot().batch?.status !== 'running') return;
      }
      this.active.set(id, { cancel: () => undefined });
      await this.save(id, attempt); this.active.delete(id); this.emit({}); this.pump(); return;
    }
    if (!item.file) return;
    this.patch(id, { status: 'pending', error: null, preview: null });
    await this.resume();
  }
  async publish() {
    if (this.locked || this.processing || this.saves.size || this.state.conflict || !this.state.batch) return;
    const revisionIds = this.state.items.filter((item) => item.status === 'saved' && item.selected && item.revisionId).map((item) => item.revisionId!);
    if (!revisionIds.length) return;
    const batch = this.state.batch;
    await this.command('publish', `/api/admin/batches/${batch.id}/publish`, 'POST', { revisionIds, expectedVersion: batch.version, reason: this.state.reason }, (body) => {
      const result = body as { batch?: unknown; publishedRevisionIds?: unknown } | null;
      const published = result?.publishedRevisionIds;
      if (!isBatch(result?.batch) || result.batch.id !== batch.id || result.batch.version !== batch.version + 1 || result.batch.status !== batch.status
        || !Array.isArray(published) || published.length !== revisionIds.length
        || new Set(published).size !== revisionIds.length || !revisionIds.every((id) => published.includes(id))) throw new Error();
      this.emit({ batch: result.batch, items: this.state.items.map((item) => item.revisionId && revisionIds.includes(item.revisionId) ? { ...item, status: 'published', selected: false } : item), notice: t.published(revisionIds.length) });
    });
  }
  restore(batch: StoredBatch) {
    if (!isStoredBatch(batch)) { this.emit({ error: zhCN.communityAdmin.queueLoadFailed }); return; }
    if (!this.replaceable) return;
    const parsedDefaults = generationParamsSchema.safeParse(batch.defaultParams);
    this.emit({ batch, defaults: parsedDefaults.success ? parsedDefaults.data : { ...DEFAULT_GENERATION_PARAMS }, mode: 'paused', error: null, conflict: false, notice: t.restored, items: batch.drafts.map((draft, index) => ({ localId: `restored:${draft.id}`, file: null, localName: t.restoredDraft(index + 1), title: draft.title, crop: null, paramsOverride: {}, status: draft.status === 'draft' ? 'saved' : draft.status === 'published' ? 'published' : 'unavailable', progress: 100, error: null, revisionId: draft.id, workId: draft.workId, selected: false, preview: draft.preview })) });
  }
  refreshState(batch: StoredBatch) {
    if (!isStoredBatch(batch)) { this.emit({ error: zhCN.communityAdmin.command.refreshFailed }); return; }
    if (this.locked || this.processing || batch.id !== this.state.batch?.id || batch.version < this.state.batch.version) return;
    this.emit({ batch, mode: 'paused', conflict: false, error: null, notice: t.refreshed, items: this.state.items.map((item) => {
      const draft = batch.drafts.find((entry) => entry.id === item.revisionId);
      return draft ? { ...item, selected: false, status: draft.status === 'draft' ? 'saved' : draft.status === 'published' ? 'published' : 'unavailable' } : { ...item, selected: false };
    }) });
  }
  dispose() {
    this.disposed = true; this.active.forEach((task) => task.cancel()); this.controllers.forEach((controller) => controller.abort());
    this.active.clear(); this.controllers.clear(); this.saves.clear(); this.attempt = null; this.state = { ...this.state, items: [] }; this.listeners.clear();
  }
}
