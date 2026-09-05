// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdminCollection } from './useAdminCollection';
import { useAdminInspection } from './useAdminInspection';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
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
