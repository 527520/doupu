// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLEAR_GENERATION_SOURCE,
  createLocalGenerationSource,
  openIndexedDb,
  PRESERVE_GENERATION_SOURCE,
  replaceGenerationSource,
  type DesignRecord,
} from './index';

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
  private settled = false;
  private completionScheduled = false;
  private readonly snapshots: Map<FakeStore, Map<string, unknown>>;
  /** 测试注入：请求成功后事务以该错误收尾（模拟提交时配额满）。 */
  errorName: string | null = null;
  constructor(private readonly stores: Map<string, FakeStore>) {
    this.snapshots = new Map(
      [...stores.values()].map((store) => [store, structuredClone(store.data)]),
    );
  }
  objectStore(name: string): FakeStore {
    const store = this.stores.get(name)!;
    store.currentTx = this;
    return store;
  }
  track(): void {
    this.pending++;
  }
  fail(error: DOMException): void {
    this.error ??= error;
  }
  abort(): void {
    if (this.settled) return;
    this.error ??= new DOMException('aborted', 'AbortError');
    this.finish(false);
  }
  release(): void {
    this.pending--;
    if (this.pending > 0 || this.completionScheduled || this.settled) return;
    this.completionScheduled = true;
    // setTimeout：等 wrapRequest 的 promise 续体先挂上 oncomplete/onerror
    setTimeout(() => {
      this.completionScheduled = false;
      if (this.pending > 0 || this.settled) return;
      if (this.errorName) {
        this.error = new DOMException('quota', this.errorName);
      }
      this.finish(!this.error);
    }, 0);
  }
  private finish(success: boolean): void {
    if (this.settled) return;
    this.settled = true;
    if (success) {
      this.oncomplete?.();
      return;
    }
    for (const [store, snapshot] of this.snapshots) {
      store.data.clear();
      for (const [key, value] of snapshot) store.data.set(key, structuredClone(value));
    }
    this.onabort?.();
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
        tx.fail(request.error!);
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

function makeIndexedDb(existingVersion1 = false): { factory: object; db: FakeDB; failNextOpen: () => void } {
  const db = new FakeDB();
  if (existingVersion1) {
    db.createObjectStore('designs', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
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

  it('v1 数据库升级到 v2 后保留原设计并可读取新增的本地生成源仓', async () => {
    const idb = makeIndexedDb(true);
    idb.db.stores.get('designs')!.data.set('old', makeRecord('old', '旧设计', '2026-01-01'));
    vi.stubGlobal('indexedDB', idb.factory);

    const adapter = await openIndexedDb();

    expect((await adapter.getAll()).map((record) => record.id)).toEqual(['old']);
    expect(await adapter.getGenerationSource('old')).toBeNull();
    expect(idb.db.stores.has('generation-sources')).toBe(true);
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

  it('最大 800×800 本地生成源可与设计原子写入并完整往返', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const pixels = new Uint8ClampedArray(800 * 800 * 4);
    pixels[0] = 17;
    pixels[pixels.length - 1] = 231;
    const source = createLocalGenerationSource({ data: pixels, width: 800, height: 800 });

    await adapter.put(
      makeRecord('maximum', '最大源', '2026-01-01'),
      replaceGenerationSource(source),
    );

    const restored = await adapter.getGenerationSource('maximum');
    expect(restored).toMatchObject({ version: 1, width: 800, height: 800 });
    expect(restored?.rgba.byteLength).toBe(800 * 800 * 4);
    expect(new Uint8Array(restored!.rgba)[0]).toBe(17);
    expect(new Uint8Array(restored!.rgba).at(-1)).toBe(231);
  });

  it('读取时校验持久化数据，损坏或越界的本地生成源按不存在处理', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    idb.db.stores.get('generation-sources')!.data.set('broken', {
      designId: 'broken',
      version: 1,
      width: 801,
      height: 1,
      rgba: new ArrayBuffer(4),
    });

    expect(await adapter.getGenerationSource('broken')).toBeNull();
  });

  it('普通 put 与显式 preserve 都保留既有本地生成源', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([7, 8, 9, 10]),
      width: 1,
      height: 1,
    });
    await adapter.put(makeRecord('kept', '初版', '2026-01-01'), replaceGenerationSource(source));

    await adapter.put(makeRecord('kept', '改名', '2026-01-02'));
    await adapter.put(makeRecord('kept', '再改', '2026-01-03'), PRESERVE_GENERATION_SOURCE);

    expect([...new Uint8Array((await adapter.getGenerationSource('kept'))!.rgba)]).toEqual([7, 8, 9, 10]);
  });

  it('显式 replace 原子替换既有本地生成源', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const first = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1,
    });
    const second = createLocalGenerationSource({
      data: new Uint8ClampedArray([5, 6, 7, 8]), width: 1, height: 1,
    });
    await adapter.put(makeRecord('replace', '初版', '2026-01-01'), replaceGenerationSource(first));

    await adapter.put(makeRecord('replace', '新版', '2026-01-02'), replaceGenerationSource(second));

    expect([...new Uint8Array((await adapter.getGenerationSource('replace'))!.rgba)]).toEqual([5, 6, 7, 8]);
  });

  it('显式 clear 与设计写入处于同一操作并清除既有源', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1,
    });
    await adapter.put(makeRecord('clear', '有源', '2026-01-01'), replaceGenerationSource(source));

    await adapter.put(makeRecord('clear', '无源', '2026-01-02'), CLEAR_GENERATION_SOURCE);

    expect(await adapter.getGenerationSource('clear')).toBeNull();
    expect((await adapter.getAll()).find((record) => record.id === 'clear')?.name).toBe('无源');
  });

  it('delete 在同一事务中级联删除设计及本地生成源', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([9, 8, 7, 6]), width: 1, height: 1,
    });
    await adapter.put(makeRecord('cascade', '待删除', '2026-01-01'), replaceGenerationSource(source));

    await adapter.delete('cascade');

    expect((await adapter.getAll()).some((record) => record.id === 'cascade')).toBe(false);
    expect(await adapter.getGenerationSource('cascade')).toBeNull();
  });

  it('source replace 请求失败时设计与旧源都保持原状，且配额错误上抛', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const original = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1,
    });
    const replacement = createLocalGenerationSource({
      data: new Uint8ClampedArray([5, 6, 7, 8]), width: 1, height: 1,
    });
    await adapter.put(makeRecord('atomic', '原设计', '2026-01-01'), replaceGenerationSource(original));
    expect(await adapter.getGenerationSource('atomic')).not.toBeNull();
    idb.db.stores.get('generation-sources')!.nextFail = 'QuotaExceededError';

    await expect(adapter.put(
      makeRecord('atomic', '不应提交', '2026-01-02'),
      replaceGenerationSource(replacement),
    )).rejects.toMatchObject({ code: 'QUOTA' });

    expect((await adapter.getAll()).find((record) => record.id === 'atomic')?.name).toBe('原设计');
    expect([...new Uint8Array((await adapter.getGenerationSource('atomic'))!.rgba)]).toEqual([1, 2, 3, 4]);
  });

  it('级联删除第二个请求失败时整笔回滚且错误不静默', async () => {
    const idb = makeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const adapter = await openIndexedDb();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([8, 7, 6, 5]), width: 1, height: 1,
    });
    await adapter.put(makeRecord('delete-atomic', '保留', '2026-01-01'), replaceGenerationSource(source));
    idb.db.stores.get('generation-sources')!.nextFail = 'DataError';

    await expect(adapter.delete('delete-atomic')).rejects.toMatchObject({ code: 'UNKNOWN' });

    expect((await adapter.getAll()).some((record) => record.id === 'delete-atomic')).toBe(true);
    expect(await adapter.getGenerationSource('delete-atomic')).not.toBeNull();
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
    // 请求成功但事务提交失败：整笔写入回滚，调用方收到错误后可安全重试。
    expect((await adapter.getAll()).some((record) => record.id === 'a')).toBe(false);
  });
});
