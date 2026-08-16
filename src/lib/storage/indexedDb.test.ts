// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openIndexedDb, type DesignRecord } from './index';

/**
 * 内存版 IndexedDB 假实现：异步回调（queueMicrotask/setTimeout）模拟真实时序，
 * 支持注入请求级/事务级/打开级错误，专测 openIndexedDb 适配层（spec §F8 本地部分）。
 */

class FakeRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;
  private pending = 0;
  /** 测试注入：请求成功后事务以该错误收尾（模拟提交时配额满）。 */
  errorName: string | null = null;
  constructor(private readonly stores: Map<string, FakeStore>) {}
  objectStore(name: string): FakeStore {
    const store = this.stores.get(name)!;
    store.currentTx = this;
    return store;
  }
  track(): void {
    this.pending++;
  }
  release(): void {
    this.pending--;
    if (this.pending > 0) return;
    // setTimeout：等 wrapRequest 的 promise 续体先挂上 oncomplete/onerror
    setTimeout(() => {
      if (this.errorName) {
        this.error = new DOMException('quota', this.errorName);
        this.onerror?.();
      } else {
        this.oncomplete?.();
      }
    }, 0);
  }
}

class FakeStore {
  readonly data = new Map<string, unknown>();
  /** 测试注入：下一个请求以该 DOMException name 失败。 */
  nextFail: string | null = null;
  currentTx: FakeTransaction | null = null;
  constructor(readonly keyPath: string) {}

  private do(result: unknown, fail: string | null): FakeRequest {
    const tx = this.currentTx!;
    const request = new FakeRequest();
    tx.track();
    if (fail) {
      request.error = new DOMException('boom', fail);
      queueMicrotask(() => {
        request.onerror?.();
        tx.release();
      });
    } else {
      request.result = result;
      queueMicrotask(() => {
        request.onsuccess?.();
        tx.release();
      });
    }
    return request;
  }

  getAll(): FakeRequest {
    const fail = this.nextFail;
    this.nextFail = null;
    return this.do([...this.data.values()], fail);
  }
  put(record: { [k: string]: unknown }): FakeRequest {
    const fail = this.nextFail;
    this.nextFail = null;
    const key = record[this.keyPath];
    if (!fail) this.data.set(String(key), record);
    return this.do(key, fail);
  }
  delete(key: string): FakeRequest {
    const fail = this.nextFail;
    this.nextFail = null;
    if (!fail) this.data.delete(key);
    return this.do(undefined, fail);
  }
  get(key: string): FakeRequest {
    const fail = this.nextFail;
    this.nextFail = null;
    return this.do(this.data.get(key), fail);
  }
}

class FakeDB {
  readonly stores = new Map<string, FakeStore>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  /** 测试注入：下一个事务以该错误收尾。 */
  nextTxError: string | null = null;
  createObjectStore(name: string, opts: { keyPath: string }): FakeStore {
    const store = new FakeStore(opts.keyPath);
    this.stores.set(name, store);
    return store;
  }
  transaction(_names: string | string[], _mode: IDBTransactionMode): FakeTransaction {
    void _names;
    void _mode;
    const tx = new FakeTransaction(this.stores);
    tx.errorName = this.nextTxError;
    this.nextTxError = null;
    return tx;
  }
}

function makeIndexedDb(): { factory: object; db: FakeDB; failNextOpen: () => void } {
  const db = new FakeDB();
  let failOpen = false;
  const factory = {
    open(_name: string, _version: number) {
      void _name;
      void _version;
      const request = Object.assign(new FakeRequest(), {
        onupgradeneeded: null as (() => void) | null,
      });
      if (failOpen) {
        failOpen = false;
        request.error = new DOMException('blocked', 'SecurityError');
        queueMicrotask(() => request.onerror?.());
        return request;
      }
      queueMicrotask(() => {
        // 真实 IndexedDB：onupgradeneeded 期间 request.result 已是数据库实例
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory, db, failNextOpen: () => { failOpen = true; } };
}

function makeRecord(id: string, name: string, updatedAt: string): DesignRecord {
  return { id, name, projectJson: '{}', thumbnail: null, updatedAt };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openIndexedDb 适配层（假 IndexedDB）', () => {
  it('环境无 indexedDB → UNAVAILABLE（jsdom 默认无实现）', async () => {
    await expect(openIndexedDb()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('打开失败（onerror）→ UNAVAILABLE', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    idb.failNextOpen();
    await expect(openIndexedDb()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('增删查改完整回路：put/getAll 排序/delete/getMeta/setMeta', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();

    await adapter.put(makeRecord('a', '早', '2026-01-01T00:00:00.000Z'));
    await adapter.put(makeRecord('b', '晚', '2026-02-02T00:00:00.000Z'));

    const all = await adapter.getAll();
    expect(all.map((r) => r.id)).toEqual(['b', 'a']); // updatedAt 降序

    await adapter.setMeta('k', 'v');
    expect(await adapter.getMeta('k')).toBe('v');
    expect(await adapter.getMeta('missing')).toBeNull();

    await adapter.delete('a');
    expect((await adapter.getAll()).map((r) => r.id)).toEqual(['b']);
  });

  it('put 请求配额满 → StorageError QUOTA', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();

    idb.db.stores.get('designs')!.nextFail = 'QuotaExceededError';
    await expect(adapter.put(makeRecord('a', 'x', '2026-01-01'))).rejects.toMatchObject({
      code: 'QUOTA',
    });
  });

  it('请求其他错误 → StorageError UNKNOWN', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();

    idb.db.stores.get('designs')!.nextFail = 'DataError';
    await expect(adapter.put(makeRecord('a', 'x', '2026-01-01'))).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });

  it('事务提交时配额满（请求成功、commit 失败）→ QUOTA，不吞错', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();

    idb.db.nextTxError = 'QuotaExceededError';
    await expect(adapter.put(makeRecord('a', 'x', '2026-01-01'))).rejects.toMatchObject({
      code: 'QUOTA',
    });
    // 请求成功但事务失败：数据不得静默丢失——put 已写入但上抛了（调用方可重试/提示）
    expect(idb.db.stores.get('designs')!.data.has('a')).toBe(true);
  });
});
