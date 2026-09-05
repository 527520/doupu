import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/sync/clientAdapter';
import { isDefiniteCommunityRejection, postCommunityCommand } from './communityCommand';
import { zhCN } from '@/messages/zh-CN';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('explains a browser network failure without exposing its internal English message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(postCommunityCommand('/command', 'key', {})).rejects.toThrow(zhCN.communityAdmin.mineActions.unknown);
});
it('15 秒后终止挂起请求，作为未知结果而非确定拒绝', async () => {
  vi.useFakeTimers();
  const request = vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
  vi.stubGlobal('fetch', request);
  const outcome = postCommunityCommand('/command', 'key', { expectedVersion: 1 }).catch((error) => error);
  await vi.advanceTimersByTimeAsync(15_000);
  const error = await outcome;
  expect(error).toBeInstanceOf(Error); expect(isDefiniteCommunityRejection(error)).toBe(false);
  expect(request.mock.calls[0][1].signal!.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([400, 401, 403, 404, 409, 422])('确定拒绝 %i 可解锁', (status) => {
  expect(isDefiniteCommunityRejection(new ApiError(status, 'UNKNOWN', 'failed'))).toBe(true);
});
it.each([408, 429, 500, 503])('不确定响应 %i 保留请求', (status) => {
  expect(isDefiniteCommunityRejection(new ApiError(status, 'UNKNOWN', 'failed'))).toBe(false);
});
it.each(['null', '[]', '"ok"', '{'])('不接受无有效对象的成功正文 %s', async (body) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  await expect(postCommunityCommand('/command', 'key', {})).rejects.toThrow();
});
