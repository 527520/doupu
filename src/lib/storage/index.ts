/**
 * 本地设计仓库（spec §F8 本地部分）：IndexedDB 薄适配层 + 纯函数辅助。
 * 本地库不设数量上限；写入失败（配额满 E39 / 隐私模式不可用）以类型化错误上抛，
 * 由 UI 层提示导出项目文件兜底。
 */
import { parseProjectFileValue } from '@/lib/schemas';
import { conflictName } from '@/lib/project/parse';
import { drawPattern } from '@/lib/render/draw';
import { LIMITS } from '@/lib/appInfo';
import type { ImageDataLike } from '@/lib/engine/types';
import { parseStitchProgress, type StitchProgress } from '@/lib/progress/stitchProgress';
import type { Pattern, ProjectFile } from '@/lib/types';
import { DEFAULT_BOARD_SIZE } from '@/lib/boardProfiles';

// ---------- 类型 ----------

export interface DesignRecord {
  id: string;
  name: string;
  /** 项目文件 JSON（ProjectFile 序列化） */
  projectJson: string;
  /** ≤256px 缩略图 data URL；生成失败时为 null */
  thumbnail: string | null;
  updatedAt: string;
  /** Last cloud revision observed. Zero means the row has never been created remotely. */
  revision?: number;
  /** Explicit dirty state avoids relying on clocks to detect unsynced local edits. */
  syncState?: 'dirty' | 'synced' | 'conflict';
}

export interface LocalGenerationSourceV1 {
  version: 1;
  width: number;
  height: number;
  /** 紧密 RGBA 字节；始终为独立持有的普通 ArrayBuffer。 */
  rgba: ArrayBuffer;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  try {
    ArrayBuffer.prototype.slice.call(value, 0, 0);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalGenerationSource(value: unknown): value is LocalGenerationSourceV1 {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<LocalGenerationSourceV1>;
  const { width, height, rgba } = source;
  return source.version === 1
    && Number.isInteger(width)
    && Number.isInteger(height)
    && (width ?? 0) >= 1
    && (height ?? 0) >= 1
    && (width ?? 0) <= LIMITS.generationSourceDimension
    && (height ?? 0) <= LIMITS.generationSourceDimension
    && isArrayBuffer(rgba)
    && rgba.byteLength === (width ?? 0) * (height ?? 0) * 4;
}

export function createLocalGenerationSource(image: ImageDataLike): LocalGenerationSourceV1 {
  const rgba = new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  ).slice().buffer;
  const source: LocalGenerationSourceV1 = { version: 1, width: image.width, height: image.height, rgba };
  if (!isValidLocalGenerationSource(source)) {
    throw new TypeError(`本地生成源必须是 1..${LIMITS.generationSourceDimension} 的紧密 RGBA 数据`);
  }
  return source;
}

export function imageDataFromLocalGenerationSource(source: LocalGenerationSourceV1): ImageDataLike {
  if (!isValidLocalGenerationSource(source)) throw new TypeError('本地生成源格式无效');
  return {
    data: new Uint8ClampedArray(source.rgba.slice(0)),
    width: source.width,
    height: source.height,
  };
}

export type GenerationSourceWrite =
  | { mode: 'preserve' }
  | { mode: 'replace'; source: LocalGenerationSourceV1 }
  | { mode: 'clear' };

export const PRESERVE_GENERATION_SOURCE = Object.freeze({ mode: 'preserve' } as const);
export const CLEAR_GENERATION_SOURCE = Object.freeze({ mode: 'clear' } as const);

export function replaceGenerationSource(source: LocalGenerationSourceV1): GenerationSourceWrite {
  if (!isValidLocalGenerationSource(source)) throw new TypeError('本地生成源格式无效');
  return { mode: 'replace', source };
}

export interface StorageAdapter {
  /** 全部设计记录，按 updatedAt 降序。 */
  getAll(): Promise<DesignRecord[]>;
  getGenerationSource(id: string): Promise<LocalGenerationSourceV1 | null>;
  put(record: DesignRecord, sourceWrite?: GenerationSourceWrite): Promise<void>;
  delete(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** 跟拼进度（G-1）：按设计 id 独立存放，删除设计时一并清除。 */
  getStitchProgress(designId: string): Promise<StitchProgress | null>;
  putStitchProgress(designId: string, progress: StitchProgress): Promise<void>;
  deleteStitchProgress(designId: string): Promise<void>;
}

export type StorageErrorCode = 'UNAVAILABLE' | 'QUOTA' | 'UNKNOWN';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

// ---------- IndexedDB 适配 ----------

const DB_NAME = 'doupu';
// v3：新增跟拼进度存储（G-1）。升级只加 store，不改动既有数据。
const DB_VERSION = 3;
const STORE_DESIGNS = 'designs';
const STORE_META = 'meta';
const STORE_GENERATION_SOURCES = 'generation-sources';
const STORE_STITCH_PROGRESS = 'stitch-progress';

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toStorageError(request.error));
  });
}

function toStorageError(error: DOMException | null): StorageError {
  if (error?.name === 'QuotaExceededError') {
    return new StorageError('QUOTA', '本地存储空间不足');
  }
  return new StorageError('UNKNOWN', error?.message ?? 'IndexedDB 错误');
}

/** 打开/创建本地库；环境不支持（隐私模式/SSR）时抛 UNAVAILABLE。 */
export async function openIndexedDb(): Promise<StorageAdapter> {
  if (typeof indexedDB === 'undefined') {
    throw new StorageError('UNAVAILABLE', '当前环境不支持 IndexedDB');
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_DESIGNS)) {
        database.createObjectStore(STORE_DESIGNS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(STORE_GENERATION_SOURCES)) {
        database.createObjectStore(STORE_GENERATION_SOURCES, { keyPath: 'designId' });
      }
      if (!database.objectStoreNames.contains(STORE_STITCH_PROGRESS)) {
        database.createObjectStore(STORE_STITCH_PROGRESS, { keyPath: 'designId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError('UNAVAILABLE', '无法打开本地数据库'));
  });

  return {
    async getAll() {
      const tx = db.transaction(STORE_DESIGNS, 'readonly');
      const records = await wrapRequest(tx.objectStore(STORE_DESIGNS).getAll());
      return (records as DesignRecord[]).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    async getGenerationSource(id) {
      const tx = db.transaction(STORE_GENERATION_SOURCES, 'readonly');
      const stored = await wrapRequest(tx.objectStore(STORE_GENERATION_SOURCES).get(id));
      if (!stored || typeof stored !== 'object') return null;
      const { designId: _designId, ...source } = stored as LocalGenerationSourceV1 & { designId: string };
      void _designId;
      if (!isValidLocalGenerationSource(source)) return null;
      return { ...source, rgba: source.rgba.slice(0) };
    },
    async put(record, sourceWrite = PRESERVE_GENERATION_SOURCE) {
      if (sourceWrite.mode === 'replace' && !isValidLocalGenerationSource(sourceWrite.source)) {
        throw new TypeError('本地生成源格式无效');
      }
      const tx = db.transaction([STORE_DESIGNS, STORE_GENERATION_SOURCES], 'readwrite');
      const completed = txComplete(tx);
      try {
        const store = tx.objectStore(STORE_DESIGNS);
        const existing = (await wrapRequest(store.get(record.id))) as DesignRecord | undefined;
        const next =
          record.syncState === 'dirty' && (record.revision ?? 0) === 0 && (existing?.revision ?? 0) > 0
            ? { ...record, revision: existing!.revision }
            : record;
        await wrapRequest(store.put(next));
        const sourceStore = tx.objectStore(STORE_GENERATION_SOURCES);
        if (sourceWrite.mode === 'replace') {
          const source = sourceWrite.source;
          await wrapRequest(sourceStore.put({
            designId: record.id,
            ...source,
            rgba: source.rgba.slice(0),
          }));
        } else if (sourceWrite.mode === 'clear') {
          await wrapRequest(sourceStore.delete(record.id));
        }
        await completed;
      } catch (error) {
        await abortTransaction(tx, completed, error);
      }
    },
    async delete(id) {
      const tx = db.transaction([STORE_DESIGNS, STORE_GENERATION_SOURCES, STORE_STITCH_PROGRESS], 'readwrite');
      const completed = txComplete(tx);
      try {
        await wrapRequest(tx.objectStore(STORE_DESIGNS).delete(id));
        await wrapRequest(tx.objectStore(STORE_GENERATION_SOURCES).delete(id));
        // 设计删了进度就没有意义，留着只会在同 id 复用时错位（G-1）
        await wrapRequest(tx.objectStore(STORE_STITCH_PROGRESS).delete(id));
        await completed;
      } catch (error) {
        await abortTransaction(tx, completed, error);
      }
    },
    async getMeta(key) {
      const tx = db.transaction(STORE_META, 'readonly');
      const result = await wrapRequest(tx.objectStore(STORE_META).get(key));
      return (result as { value?: string } | undefined)?.value ?? null;
    },
    async setMeta(key, value) {
      const tx = db.transaction(STORE_META, 'readwrite');
      const completed = txComplete(tx);
      try {
        await wrapRequest(tx.objectStore(STORE_META).put({ key, value }));
        await completed;
      } catch (error) {
        await abortTransaction(tx, completed, error);
      }
    },
    async getStitchProgress(designId) {
      const tx = db.transaction(STORE_STITCH_PROGRESS, 'readonly');
      const stored = await wrapRequest(tx.objectStore(STORE_STITCH_PROGRESS).get(designId));
      return parseStitchProgress(stored);
    },
    async putStitchProgress(designId, progress) {
      const tx = db.transaction(STORE_STITCH_PROGRESS, 'readwrite');
      const completed = txComplete(tx);
      try {
        // 复制一份再写：结构化克隆会共享 buffer，之后原地改动会污染已存数据。
        await wrapRequest(tx.objectStore(STORE_STITCH_PROGRESS).put({
          designId,
          ...progress,
          done: progress.done.slice(0),
        }));
        await completed;
      } catch (error) {
        await abortTransaction(tx, completed, error);
      }
    },
    async deleteStitchProgress(designId) {
      const tx = db.transaction(STORE_STITCH_PROGRESS, 'readwrite');
      const completed = txComplete(tx);
      try {
        await wrapRequest(tx.objectStore(STORE_STITCH_PROGRESS).delete(designId));
        await completed;
      } catch (error) {
        await abortTransaction(tx, completed, error);
      }
    },
  };
}

/** 等待读写事务完整提交：请求成功但事务 abort（如配额满）时也必须上抛，不得静默吞掉。 */
function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toStorageError(tx.error));
    tx.onabort = () => reject(toStorageError(tx.error));
  });
}

async function abortTransaction(tx: IDBTransaction, completed: Promise<void>, error: unknown): Promise<never> {
  try { tx.abort(); } catch { /* transaction may already be committing/aborting */ }
  await completed.catch(() => undefined);
  throw error;
}

// ---------- 纯函数辅助 ----------

/** 缩略图尺寸：最长边 ≤ maxSide 的格子像素与画布尺寸（至少 1×1）。 */
export function buildThumbnailSize(
  patternWidth: number,
  patternHeight: number,
  maxSide = 256,
): { cellPx: number; width: number; height: number } {
  const w = Math.max(1, Math.floor(patternWidth));
  const h = Math.max(1, Math.floor(patternHeight));
  const cellPx = Math.max(1, Math.floor(maxSide / Math.max(w, h)));
  return { cellPx, width: w * cellPx, height: h * cellPx };
}

/** 用 Canvas 渲染缩略图 data URL；任何失败（含 jsdom 无 canvas）返回 null。 */
export function renderThumbnail(
  pattern: Pattern,
  maxSide = 256,
  boardSize = DEFAULT_BOARD_SIZE,
): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const { cellPx, width, height } = buildThumbnailSize(pattern.width, pattern.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawPattern(ctx, pattern, {
      cellPx,
      showGrid: false,
      showSeams: true,
      showLabels: false,
      boardSize,
    });
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl === 'data:,' ? null : dataUrl;
  } catch {
    return null;
  }
}

/** 新设计的默认名：未命名设计 / 未命名设计 (2)…（复用冲突命名规则）。 */
export function nextDesignName(existingNames: readonly string[]): string {
  return conflictName('未命名设计', existingNames);
}

/** 解析存储的项目 JSON；失败返回 null。 */
export function parseStoredProject(json: string): ProjectFile | null {
  try {
    const result = parseProjectFileValue(JSON.parse(json));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/** 组装存储记录（thumbnail 渲染失败传 null 即可）；id 由调用方持有以保持跨保存稳定。 */
export function createDesignRecord(
  id: string,
  project: ProjectFile,
  thumbnail: string | null,
): DesignRecord {
  return {
    id,
    name: project.name,
    projectJson: JSON.stringify(project),
    thumbnail,
    updatedAt: project.updatedAt,
    revision: 0,
    syncState: 'dirty',
  };
}

export function newDesignId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 判定 StorageError/配额类异常。 */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof StorageError) return error.code === 'QUOTA';
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}
