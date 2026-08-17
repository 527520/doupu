import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueBackgroundSync, enqueueDesignSync, hasPendingSync, withDesignStorageLock } from './queue';
import { ApiError, type SyncOutcome } from './clientAdapter';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

function storage(records: Awaited<ReturnType<StorageAdapter['getAll']>> = []): StorageAdapter {
  const meta = new Map<string, string>();
  return {
    async getAll() { return records; }, async put() {}, async delete() {},
    async getMeta(key) { return meta.get(key) ?? null; },
    async setMeta(key, value) { meta.set(key, value); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('background sync queue', () => {
  it('holds a browser-wide Web Lock for the whole sync transaction', async () => {
    let insideLock = false;
    const request = vi.fn(async (_name: string, callback: () => Promise<string>) => {
      insideLock = true;
      try { return await callback(); } finally { insideLock = false; }
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const adapter = storage();

    await expect(enqueueBackgroundSync(adapter, async () => {
      expect(insideLock).toBe(true);
      return 'done';
    })).resolves.toBe('done');

    expect(request).toHaveBeenCalledWith('doupu-design-sync-v2', expect.any(Function));
  });

  it('keeps the storage lock until the active-session outcome callback has finished', async () => {
    let insideLock = false;
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      insideLock = true;
      try { return await callback(); } finally { insideLock = false; }
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const onOutcome = vi.fn(async () => {
      expect(insideLock).toBe(true);
    });
    const api = {
      me: vi.fn(async () => ({ state: 'verified' as const, email: 'a@b.com', createdAt: '2026-08-17T00:00:00.000Z' })),
      listDesignsPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    };

    await enqueueDesignSync(storage(), api as never, onOutcome);

    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(insideLock).toBe(false);
  });

  it('fallback lock serializes a local save behind an active sync', async () => {
    vi.stubGlobal('navigator', {});
    let release!: () => void;
    const events: string[] = [];
    const sync = withDesignStorageLock(async () => {
      events.push('sync-start');
      await new Promise<void>((resolve) => { release = resolve; });
      events.push('sync-end');
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const save = withDesignStorageLock(async () => { events.push('save'); });
    await Promise.resolve();
    expect(events).toEqual(['sync-start']);
    release();
    await Promise.all([sync, save]);
    expect(events).toEqual(['sync-start', 'sync-end', 'save']);
  });

  it('marks durable pending state before work and clears it only after success', async () => {
    const adapter = storage();
    const result = { pushed: 1 };
    let release!: (value: typeof result) => void;
    const run = vi.fn(() => new Promise<typeof result>((resolve) => { release = resolve; }));
    const pending = enqueueBackgroundSync(adapter, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(await hasPendingSync(adapter)).toBe(true);
    release(result);
    await expect(pending).resolves.toBe(result);
    expect(await hasPendingSync(adapter)).toBe(false);
  });

  it('coalesces concurrent enqueue calls across adapter wrappers and retains pending after failure', async () => {
    const adapter = storage();
    const secondWrapper = storage();
    const run = vi.fn(async () => { throw new TypeError('offline'); });
    const first = enqueueBackgroundSync(adapter, run);
    const second = enqueueBackgroundSync(secondWrapper, run);
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('offline');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await hasPendingSync(adapter)).toBe(true);
  });

  it('a save arriving after the active pass started always schedules one tail pass', async () => {
    const adapter = storage();
    let release!: () => void;
    const firstRun = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve('first');
    }));
    const tailRun = vi.fn(async () => 'tail');

    const first = enqueueBackgroundSync(adapter, firstRun);
    await vi.waitFor(() => expect(firstRun).toHaveBeenCalledTimes(1));
    const second = enqueueBackgroundSync(adapter, tailRun);
    expect(first).toBe(second);
    release();

    await expect(first).resolves.toBe('tail');
    expect(tailRun).toHaveBeenCalledTimes(1);
    expect(await hasPendingSync(adapter)).toBe(false);
  });

  it('replays an active no-callback pass outcome before a Workbench tail can hide its conflict', async () => {
    const updatedAt = '2026-08-17T00:00:00.000Z';
    const localProject: ProjectFile = {
      format: 'doupu-project', version: 2, engineVersion: '2.0.0', name: '本地',
      createdAt: updatedAt, updatedAt,
      palette: { kind: 'builtin', brand: 'MARD' },
      params: { targetWidth: 20, targetColorCount: 2, dithering: false, mode: 'dominant', brightness: 0, contrast: 0, backgroundRemoval: false, bgTolerance: 8 },
      pattern: { width: 1, height: 1, cells: [{ hex: '#000000', code: 'A', transparent: false }] },
    };
    const remoteProject = { ...localProject, name: '云端' };
    const records = new Map<string, DesignRecord>([['original', {
      id: 'original', name: localProject.name, projectJson: JSON.stringify(localProject),
      thumbnail: null, updatedAt, revision: 0, syncState: 'dirty' as const,
    }]]);
    const adapter: StorageAdapter = {
      ...storage(),
      async getAll() { return [...records.values()]; },
      async put(record) { records.set(record.id, structuredClone(record)); },
      async delete(id) { records.delete(id); },
    };
    let release!: () => void;
    let firstPut = true;
    const api = {
      me: vi.fn(async () => ({ state: 'verified' as const, email: 'a@b.com', createdAt: updatedAt })),
      listDesignsPage: vi.fn(async () => ({
        items: [{ id: 'original', name: '云端', width: 1, height: 1, updatedAt, deleted: false, revision: 1 }],
        nextCursor: null,
      })),
      getDesign: vi.fn(async (id: string) => id === 'original'
        ? { id, name: '云端', project: remoteProject, updatedAt, revision: 1 }
        : null),
      putDesign: vi.fn(async (_id: string, _name: string, _project: ProjectFile, _baseRevision: number) => {
        if (firstPut) {
          firstPut = false;
          await new Promise<void>((resolve) => { release = resolve; });
          throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
        }
        return { updatedAt, revision: 1 };
      }),
      deleteDesign: vi.fn(),
    };
    const observed: SyncOutcome[] = [];
    const first = enqueueDesignSync(adapter, api as never);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const tail = enqueueDesignSync(adapter, api as never, (outcome) => { observed.push(outcome); });
    expect(first).toBe(tail);
    release();
    await first;

    expect(observed).toHaveLength(2);
    expect(observed[0].conflictCopies).toHaveLength(1);
    expect(observed[1].conflictCopies).toEqual([]);
    expect(observed[1].pushed).toBe(1);
  });

  it('only talks to cloud for a verified account; network failure remains pending for retry', async () => {
    const guestStorage = storage();
    const guestApi = { me: vi.fn(async () => ({ state: 'guest' as const })), listDesignsPage: vi.fn() };
    await enqueueDesignSync(guestStorage, guestApi as never);
    expect(guestApi.listDesignsPage).not.toHaveBeenCalled();
    expect(await hasPendingSync(guestStorage)).toBe(false);

    const offlineStorage = storage();
    const offlineApi = { me: vi.fn(async () => { throw new TypeError('offline'); }), listDesignsPage: vi.fn() };
    await expect(enqueueDesignSync(offlineStorage, offlineApi as never)).rejects.toThrow('offline');
    expect(await hasPendingSync(offlineStorage)).toBe(true);
  });

  it('retains pending state when a completed sync pass reports per-design errors', async () => {
    const adapter = storage([{
      id: 'broken', name: '损坏设计', projectJson: '{}', thumbnail: null,
      updatedAt: '2026-08-17T00:00:00.000Z', revision: 0, syncState: 'dirty',
    }]);
    const api = {
      me: vi.fn(async () => ({ state: 'verified' as const, email: 'a@b.com', createdAt: '2026-08-17T00:00:00.000Z' })),
      listDesignsPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    };

    await expect(enqueueDesignSync(adapter, api as never)).rejects.toThrow('同步未完整完成');
    expect(await hasPendingSync(adapter)).toBe(true);
  });

  it('replays a conflict created by a partially failed pass before a later retry', async () => {
    const updatedAt = '2026-08-17T00:00:00.000Z';
    const localProject: ProjectFile = {
      format: 'doupu-project', version: 2, engineVersion: '2.0.0', name: '本地',
      createdAt: updatedAt, updatedAt,
      palette: { kind: 'builtin', brand: 'MARD' },
      params: { targetWidth: 20, targetColorCount: 2, dithering: false, mode: 'dominant', brightness: 0, contrast: 0, backgroundRemoval: false, bgTolerance: 8 },
      pattern: { width: 1, height: 1, cells: [{ hex: '#000000', code: 'A', transparent: false }] },
    };
    const records = new Map<string, DesignRecord>([
      ['conflict', {
        id: 'conflict', name: localProject.name, projectJson: JSON.stringify(localProject),
        thumbnail: null, updatedAt, revision: 0, syncState: 'dirty' as const,
      }],
      ['broken', {
        id: 'broken', name: '损坏', projectJson: '{}', thumbnail: null,
        updatedAt, revision: 0, syncState: 'dirty' as const,
      }],
    ]);
    const adapter: StorageAdapter = {
      ...storage(),
      async getAll() { return [...records.values()]; },
      async put(record) { records.set(record.id, structuredClone(record)); },
      async delete(id) { records.delete(id); },
    };
    const api = {
      me: vi.fn(async () => ({ state: 'verified' as const, email: 'a@b.com', createdAt: updatedAt })),
      listDesignsPage: vi.fn(async () => ({
        items: [{ id: 'conflict', name: '云端', width: 1, height: 1, updatedAt, deleted: false, revision: 1 }],
        nextCursor: null,
      })),
      getDesign: vi.fn(async (id: string) => id === 'conflict'
        ? { id, name: '云端', project: { ...localProject, name: '云端' }, updatedAt, revision: 1 }
        : null),
      putDesign: vi.fn(async (id: string) => {
        if (id === 'conflict') throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
        return { updatedAt, revision: 1 };
      }),
      deleteDesign: vi.fn(),
    };

    await expect(enqueueDesignSync(adapter, api as never)).rejects.toThrow('同步未完整完成');
    expect([...records.keys()].some((id) => id !== 'conflict' && id !== 'broken')).toBe(true);
    records.delete('broken');
    const observed: SyncOutcome[] = [];
    await enqueueDesignSync(adapter, api as never, (outcome) => { observed.push(outcome); });

    expect(observed[0].conflictCopies).toHaveLength(1);
    expect(observed[0].conflictCopies[0].originalId).toBe('conflict');
  });
});
