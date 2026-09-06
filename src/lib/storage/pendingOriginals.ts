/**
 * 原图交接（D49）：在同一浏览器内把完整原图从一个页面带到另一个页面。
 *
 * 场景：
 * - 工作台「公开到豆社」→ 投稿页：原图只活在工作台的解码会话里，投稿页要上传它；
 * - 豆社「用这张制作」成功 → 工作台：引用者取回作者原图，绑定到新设计以继续裁剪 / 调参。
 *
 * 独立于设计库的 IndexedDB 数据库：取用即删（一次性），24 小时未取用自动过期；
 * 另有一张 designId → 来源修订 的持久映射，供工作台日后「从豆社取回原图」使用。
 * 这里保存的字节永不进入项目文件、同步 API 或分析事件。
 */
import type { ImageType } from '@/lib/image/sniff';

const DB_NAME = 'doupu-pending-originals';
const DB_VERSION = 1;
const STORE = 'originals';
const SOURCES = 'sources';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingOriginal {
  designId: string;
  bytes: ArrayBuffer;
  type: ImageType;
  name: string;
  /** 来自豆社引用时的来源修订；作者本人投稿时为空。 */
  sourceRevisionId?: string;
  createdAt: number;
}

const OPEN_TIMEOUT_MS = 5000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    // 打开卡死（Safari 隐私模式、存储被锁）不能拖住工作台恢复设计。
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'designId' });
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: 'designId' });
    };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error('IndexedDB open failed')); };
    request.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB open blocked')); };
  });
}

/**
 * 同一页面内串行使用这个库：首次创建库的 versionchange 事务与并发 open 在 WebKit 上会互相卡住
 * （引用成功后「记来源」与「放原图」两次写、工作台恢复时「取原图」与「查来源」两次读）。
 */
let queue: Promise<unknown> = Promise.resolve();
function withDb<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await open();
    try { return await work(db); } finally { db.close(); }
  });
  queue = next.catch(() => undefined);
  return next;
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function putPendingOriginal(record: Omit<PendingOriginal, 'createdAt'>): Promise<void> {
  await withDb(async (db) => {
    await run(db, STORE, 'readwrite', (store) => store.put({ ...record, createdAt: Date.now() } satisfies PendingOriginal));
    if (record.sourceRevisionId) {
      await run(db, SOURCES, 'readwrite', (store) => store.put({ designId: record.designId, revisionId: record.sourceRevisionId }));
    }
  });
}

/** 取出并删除；过期记录同样删除并返回 null。 */
export async function takePendingOriginal(designId: string): Promise<PendingOriginal | null> {
  try {
    return await withDb(async (db) => {
      const record = await run<PendingOriginal | undefined>(db, STORE, 'readonly', (store) => store.get(designId));
      if (!record) return null;
      await run(db, STORE, 'readwrite', (store) => store.delete(designId));
      return Date.now() - record.createdAt > TTL_MS ? null : record;
    });
  } catch { return null; }
}

export async function discardPendingOriginal(designId: string): Promise<void> {
  try { await withDb((db) => run(db, STORE, 'readwrite', (store) => store.delete(designId))); } catch { /* 交接记录尽力清理 */ }
}

/** 引用来源：工作台据此判断能否从豆社重新取回原图。 */
export async function rememberOriginalSource(designId: string, revisionId: string): Promise<void> {
  try { await withDb((db) => run(db, SOURCES, 'readwrite', (store) => store.put({ designId, revisionId }))); } catch { /* 映射缺失只影响便捷入口 */ }
}

export async function lookupOriginalSource(designId: string): Promise<string | null> {
  try {
    return await withDb(async (db) => {
      const record = await run<{ designId: string; revisionId: string } | undefined>(db, SOURCES, 'readonly', (store) => store.get(designId));
      return record?.revisionId ?? null;
    });
  } catch { return null; }
}
