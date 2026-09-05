// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminCommand } from './useAdminCommand';

describe('admin command recovery', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  const input = { url: '/api/admin/example/one', method: 'PATCH' as const, body: { reason: '人工确认', expectedVersion: 1, decision: 'hidden' } };

  it('blocks duplicates and retries the identical uncertain command and key', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const success = vi.fn();
    const { result } = renderHook(useAdminCommand);
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(input, success); });
    await act(async () => { await result.current.run(input, success); });
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => { finish(new Response('{}', { status: 503 })); await pending; });
    expect(result.current.locked).toBe(true);
    expect(result.current.uncertain).toBe(true);
    const original = vi.mocked(fetch).mock.calls[0];
    await act(async () => { await result.current.run({ ...input, body: { ...input.body, decision: 'published' } }, success); });
    expect(fetch).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await act(async () => { await result.current.retry(); });
    expect(vi.mocked(fetch).mock.calls[1]).toEqual(original);
    expect(success).toHaveBeenCalledOnce();
    expect(result.current.locked).toBe(false);
  });

  it('keeps form data outside the command and exposes conflicts as recoverable errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"error":{"code":"STATE_CONFLICT","message":"版本已变化"}}', { status: 409 }));
    const { result } = renderHook(useAdminCommand);
    await act(async () => { await result.current.run(input, vi.fn()); });
    expect(result.current.error).toBe('版本已变化');
    expect(result.current.conflict).toBe(true);
    expect(result.current.locked).toBe(false);
  });

  it('does not call a failed request successful and permits retry after a network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const success = vi.fn();
    const { result } = renderHook(useAdminCommand);
    await act(async () => { await result.current.run(input, success); });
    expect(result.current.uncertain).toBe(true);
    expect(success).not.toHaveBeenCalled();
  });
});
