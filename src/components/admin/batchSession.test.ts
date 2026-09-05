import { describe, expect, it, vi } from 'vitest';
import { BatchSession, type BatchGeneration, type StoredBatch } from './batchSession';
import type { CommunitySnapshotV1 } from '@/lib/community/snapshot';

const snapshot = { version: 1, engineVersion: 'test', boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 }, params: { targetWidth: 20, targetColorCount: 2, mode: 'dominant', brightness: 0, contrast: 0, dithering: false, backgroundRemoval: false, bgTolerance: 8, backgroundPrototype: null }, pattern: { width: 1, height: 1, cells: [{ hex: '#FFFFFF', code: 'A1', transparent: false }] } } as CommunitySnapshotV1;
const file = (name = 'private.png') => ({ name, size: 100, type: 'image/png' }) as File;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const row = (status = 'running', version = 1) => ({ id: 'batch-1', status, version });
const saved = { revisionId: 'revision-1', workId: 'work-1', status: 'draft' };
const flush = async () => { for (let n = 0; n < 15; n++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const generation = (): BatchGeneration => ({ promise: Promise.resolve(structuredClone(snapshot)), cancel: vi.fn() });

describe('local official batch session', () => {
  it('bounds concurrency and never dispatches the same pending item twice', async () => {
    const finishes: Array<(snapshot: CommunitySnapshotV1) => void> = [];
    const generate = vi.fn(() => ({ promise: new Promise<CommunitySnapshotV1>((done) => { finishes.push(done); }), cancel: vi.fn() }));
    const fetcher = vi.fn(async (url: string) => response(url.endsWith('/drafts') ? { ...saved, revisionId: crypto.randomUUID() } : row()));
    const session = new BatchSession({ fetcher, generate, concurrency: 2 }); session.selectFiles([file(), file(), file()]);
    await session.start(); await session.start(); expect(generate).toHaveBeenCalledTimes(2);
    finishes[0](snapshot); await flush(); expect(generate).toHaveBeenCalledTimes(3);
    session.dispose(); finishes[1](snapshot); finishes[2](snapshot); await flush();
  });

  it('freezes publishing selection through an uncertain reply, and releases it only after identical replay', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({ batch: row('completed', 5) }));
    const session = new BatchSession({ fetcher, generate: generation, concurrency: 1 });
    session.restore({ ...row('completed', 4), createdAt: '2026-09-01', successCount: 1, failureCount: 0, itemCount: 1, drafts: [{ id: saved.revisionId, workId: saved.workId, title: '真实草稿', status: 'draft', preview: { version: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, cells: ['#FFFFFF'], colorBand: ['#FFFFFF'] } }] } as StoredBatch);
    const item = session.getSnapshot().items[0]; expect(item.selected).toBe(false);
    await session.publish(); expect(fetcher).not.toHaveBeenCalled();
    session.updateItem(item.localId, { selected: true }); await session.publish();
    session.updateItem(item.localId, { selected: false }); await session.publish();
    expect(session.getSnapshot().items[0].selected).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    await session.retryCommand();
    expect(fetcher.mock.calls[0][1].body).toEqual(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers).toEqual(fetcher.mock.calls[1][1].headers);
    expect(session.getSnapshot().items[0]).toMatchObject({ selected: false, status: 'published' });
  });

  it('waits for uncertain saves before cancelling server state, then replays the save before cancelling', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(row())).mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response(row('cancelled', 2)));
    const session = new BatchSession({ fetcher, generate: generation, concurrency: 1 }); session.selectFiles([file()]); await session.start(); await flush();
    await session.cancel(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().items[0].status).toBe('save_unknown');
    await session.retryItem(session.getSnapshot().items[0].localId); await flush();
    expect(session.getSnapshot().batch?.status).toBe('cancelled'); expect(session.getSnapshot().items[0].status).toBe('saved');
    expect(JSON.parse(fetcher.mock.calls[3][1].body).action).toBe('cancel');
  });

  it('completes cancellation when an in-flight save is definitely rejected', async () => {
    let rejectSave!: (value: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(row())).mockImplementationOnce(() => new Promise<Response>((done) => { rejectSave = done; }))
      .mockResolvedValueOnce(response(row('cancelled', 2)));
    const session = new BatchSession({ fetcher, generate: generation, concurrency: 1 }); session.selectFiles([file()]); await session.start(); await flush();
    await session.cancel(); rejectSave(response({ error: { message: 'rejected' } }, 400)); await flush();
    expect(session.getSnapshot().batch?.status).toBe('cancelled'); expect(session.getSnapshot().items[0].status).toBe('cancelled');
    expect(session.retainedSaveCount).toBe(0);
  });

  it('allows explicit skip after a definite save rejection without treating it as a saved work', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(row())).mockResolvedValueOnce(response({ error: { message: 'invalid graph' } }, 400))
      .mockResolvedValueOnce(response(row('completed', 2)));
    const session = new BatchSession({ fetcher, generate: generation, concurrency: 1 }); session.selectFiles([file()]); await session.start(); await flush();
    const item = session.getSnapshot().items[0]; expect(item.status).toBe('failed'); expect(session.retainedSaveCount).toBe(1);
    session.cancelItem(item.localId); await flush(); expect(session.retainedSaveCount).toBe(0); expect(session.getSnapshot().items[0].status).toBe('cancelled');
    expect(session.getSnapshot().batch?.status).toBe('completed');
  });

  it('times out a write after 15 seconds and preserves its exact request for recovery', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))));
      const session = new BatchSession({ fetcher, generate: generation, concurrency: 1 }); session.selectFiles([file()]);
      const start = session.start(); await vi.advanceTimersByTimeAsync(15000); await start;
      expect(session.getSnapshot().uncertain).toBe(true); expect(session.getSnapshot().busy).toBe(false); session.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('freezes unknown creation requests and blocks replacement/duplicate starts until same-key recovery', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(row()))
      .mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response(row('completed', 2)));
    const generate = vi.fn(generation); const session = new BatchSession({ fetcher, generate, concurrency: 1 });
    session.selectFiles([file()]); await session.start();
    expect(session.getSnapshot().uncertain).toBe(true);
    session.selectFiles([file('replacement.png')]); session.setReason('changed reason'); await session.start();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await session.retryCommand(); await flush();
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers).toEqual(fetcher.mock.calls[1][1].headers);
    expect(session.getSnapshot().items[0].localName).toBe('private.png');
    expect(session.getSnapshot().items[0].file).toBeNull();
    expect(session.getSnapshot().batch?.status).toBe('completed');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries a frozen save without regenerating, uploading filename, or automatically selecting publication', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(row())).mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response(row('completed', 2)));
    const generate = vi.fn(generation); const session = new BatchSession({ fetcher, generate, concurrency: 2 });
    session.selectFiles([file()]); await session.start(); await flush();
    const item = session.getSnapshot().items[0];
    expect(item.status).toBe('save_unknown'); expect(item.file).not.toBeNull();
    await session.retryItem(item.localId); await flush();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(fetcher.mock.calls[1][1].headers).toEqual(fetcher.mock.calls[2][1].headers);
    expect(fetcher.mock.calls[2][1].body).not.toContain('private.png');
    expect(session.getSnapshot().items[0].selected).toBe(false);
    expect(session.getSnapshot().items[0].status).toBe('saved');
    expect(session.getSnapshot().items[0].file).toBeNull();
    expect(session.retainedSaveCount).toBe(0);
  });

  it('pauses new dispatch, lets the running item save, and resumes the remaining item once', async () => {
    let complete!: (value: CommunitySnapshotV1) => void;
    const generate = vi.fn().mockImplementationOnce(() => ({ promise: new Promise((resolve) => { complete = resolve; }), cancel: vi.fn() })).mockImplementation(generation);
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/drafts')) return response({ ...saved, revisionId: crypto.randomUUID() });
      const action = JSON.parse(String(init.body)).action;
      return response(row(action === 'pause' ? 'paused' : action === 'finish' ? 'completed' : 'running', action === 'pause' ? 2 : action === 'resume' ? 3 : action === 'finish' ? 4 : 1));
    });
    const session = new BatchSession({ fetcher, generate, concurrency: 1 });
    session.selectFiles([file(), file('second.png')]); await session.start(); await session.pause();
    complete(snapshot); await flush(); expect(generate).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().items[1].status).toBe('pending');
    await session.resume(); await flush(); expect(generate).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().batch?.status).toBe('completed');
  });

  it('cancels during decoding and permits a cancelled pre-start item to be retried', async () => {
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(new DOMException('cancel', 'AbortError')));
    const generate = vi.fn(() => ({ promise: new Promise<CommunitySnapshotV1>((_, fail) => { reject = fail; }), cancel }));
    const fetcher = vi.fn().mockResolvedValueOnce(response(row())).mockResolvedValueOnce(response(row('cancelled', 2)));
    const session = new BatchSession({ fetcher, generate, concurrency: 1 });
    session.selectFiles([file(), file('second.png')]); const id = session.getSnapshot().items[0].localId;
    session.cancelItem(id); expect(session.getSnapshot().items[0].status).toBe('cancelled');
    await session.retryItem(id); expect(session.getSnapshot().items[0].status).toBe('pending');
    await session.start(); await session.cancel(); await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().items.every((item) => item.status === 'cancelled')).toBe(true);
    expect(session.getSnapshot().batch?.status).toBe('cancelled');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/drafts'))).toBe(false);
  });

  it('never reports partial failures as full success and retries only the selected failed item', async () => {
    const generate = vi.fn().mockReturnValueOnce({ promise: Promise.reject(new Error('bad image')), cancel: vi.fn() }).mockImplementation(generation);
    let version = 1;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/drafts')) return response({ ...saved, revisionId: crypto.randomUUID() });
      const action = JSON.parse(String(init.body)).action;
      return response(row(action === 'finish' ? 'completed' : 'running', action ? ++version : version));
    });
    const session = new BatchSession({ fetcher, generate, concurrency: 1 });
    session.selectFiles([file(), file('second.png')]); await session.start(); await flush();
    expect(session.getSnapshot().items.map((item) => item.status)).toEqual(['failed', 'saved']);
    expect(session.getSnapshot().notice).toContain('1');
    await session.retryItem(session.getSnapshot().items[0].localId); await flush();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().items.every((item) => item.status === 'saved')).toBe(true);
  });

  it('disposes active work without dispatching more or retaining files', async () => {
    let resolve!: (value: CommunitySnapshotV1) => void;
    const cancel = vi.fn(); const generate = vi.fn(() => ({ promise: new Promise<CommunitySnapshotV1>((done) => { resolve = done; }), cancel }));
    const fetcher = vi.fn().mockResolvedValue(response(row()));
    const session = new BatchSession({ fetcher, generate, concurrency: 1 });
    session.selectFiles([file(), file()]); await session.start(); session.dispose(); resolve(snapshot); await flush();
    expect(cancel).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().items).toEqual([]);
  });
});
