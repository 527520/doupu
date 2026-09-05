// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';
import { zhCN } from '@/messages/zh-CN';
import { isStoredBatch } from './batchSession';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('rejects malformed batch history before rendering a selectable recovery action', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: crypto.randomUUID(), status: 'completed' }] })))
    .mockResolvedValueOnce(new Response('{"items":[]}')));
  const { result } = renderHook(() => useAdminCollection('/api/admin/batches', isStoredBatch));
  await waitFor(() => expect(result.current.error).toBe(zhCN.communityAdmin.queueLoadFailed));
  expect(result.current.items).toEqual([]);
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBeNull();
});
it.each([
  { name: 'list', useRead: () => useAdminCollection('/api/admin/example') },
  { name: 'inspection', useRead: () => useAdminInspection('/api/admin/example/id') },
])('a malformed or failed $name read never exposes browser/JSON internals', async ({ useRead }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{')).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response('{"error":{"message":"对象版本已变化"}}', { status: 409 })));
  const { result } = renderHook<{ error: string | null; reload: () => Promise<void> }, void>(useRead);
  await waitFor(() => expect(result.current.error).toBe(zhCN.communityAdmin.queueLoadFailed));
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBe(zhCN.communityAdmin.queueLoadFailed);
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBe('对象版本已变化');
});
it.each([
  { name: 'list', useRead: () => useAdminCollection('/api/admin/example') },
  { name: 'inspection', useRead: () => useAdminInspection('/api/admin/example/id') },
])('a stalled $name becomes an explicit retryable error instead of loading forever', async ({ useRead }) => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))); })));
  const { result } = renderHook<{ error: string | null; reload: () => Promise<void> }, void>(useRead);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.error).toBeTruthy();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{"items":[],"id":"one"}'));
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBeNull();
});
