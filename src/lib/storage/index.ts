/**
 * 本地设计仓库（spec §F8 本地部分）：IndexedDB 薄适配层 + 纯函数辅助。
 * 本地库不设数量上限；写入失败（配额满 E39 / 隐私模式不可用）以类型化错误上抛，
 * 由 UI 层提示导出项目文件兜底。
 */
import { importProjectFile } from '@/lib/project/parse';
import { conflictName } from '@/lib/project/parse';
import { drawPattern } from '@/lib/render/draw';
import type { Pattern, ProjectFile } from '@/lib/types';

// ---------- 类型 ----------

export interface DesignRecord {
  id: string;
  name: string;
  /** 项目文件 JSON（ProjectFile 序列化） */
  projectJson: string;
  /** ≤256px 缩略图 data URL；生成失败时为 null */
  thumbnail: string | null;
  updatedAt: string;
}

export interface StorageAdapter {
  /** 全部设计记录，按 updatedAt 降序。 */
  getAll(): Promise<DesignRecord[]>;
  put(record: DesignRecord): Promise<void>;
  delete(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
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
const DB_VERSION = 1;
const STORE_DESIGNS = 'designs';
const STORE_META = 'meta';

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
    async put(record) {
      const tx = db.transaction(STORE_DESIGNS, 'readwrite');
      await wrapRequest(tx.objectStore(STORE_DESIGNS).put(record));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(toStorageError(tx.error));
        tx.onabort = () => reject(toStorageError(tx.error));
      });
    },
    async delete(id) {
      const tx = db.transaction(STORE_DESIGNS, 'readwrite');
      await wrapRequest(tx.objectStore(STORE_DESIGNS).delete(id));
    },
    async getMeta(key) {
      const tx = db.transaction(STORE_META, 'readonly');
      const result = await wrapRequest(tx.objectStore(STORE_META).get(key));
      return (result as { value?: string } | undefined)?.value ?? null;
    },
    async setMeta(key, value) {
      const tx = db.transaction(STORE_META, 'readwrite');
      await wrapRequest(tx.objectStore(STORE_META).put({ key, value }));
    },
  };
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
export function renderThumbnail(pattern: Pattern, maxSide = 256): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const { cellPx, width, height } = buildThumbnailSize(pattern.width, pattern.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawPattern(ctx, pattern, { cellPx, showGrid: false, showSeams: true, showLabels: false });
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
  const result = importProjectFile(json);
  return result.ok ? result.project : null;
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
