// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommunityMineActions from './CommunityMineActions';
const state = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks(); state.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/works/') ? { workId: 'work', lifecycleStatus: 'withdrawn', version: 5 } : { revisionId: 'revision', status: url.endsWith('/submit') ? 'pending_review' : 'withdrawn', version: 3 })));
  vi.stubGlobal('fetch', state.fetch);
});
const view = (status: 'draft' | 'pending_review' | 'published' = 'pending_review') => render(<CommunityMineActions workId="work" version={4} hasPublished revision={{ id: 'revision', version: 2, status, sourceDesignId: 'source' }} />);
it('撤回本次审核不会调用撤回整件作品，操作先确认', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: '撤回本次审核' }));
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('原公开作品保持不变');
  fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch.mock.calls[0][0]).toBe('/api/community/revisions/revision/withdraw');
});
it('整件作品撤回明确说明公开版与待审版都会隐藏，失败保留弹窗可重试', async () => {
  state.fetch.mockRejectedValueOnce(new Error('网络暂时不可用'));
  view(); fireEvent.click(screen.getByRole('button', { name: '撤回整件作品' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('隐藏公开作品，并终止本次待审或草稿');
  fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用');
  fireEvent.click(screen.getByRole('button', { name: '重试确认本次操作' }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch.mock.calls[0][1].body).toEqual(state.fetch.mock.calls[1][1].body);
  expect(state.fetch.mock.calls[0][1].headers).toEqual(state.fetch.mock.calls[1][1].headers);
});
it('草稿可直接提交已确认许可的冻结内容，重复点击只发送一次', async () => {
  view('draft'); const button = screen.getByRole('button', { name: '提交草稿审核' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0][0]).toBe('/api/community/revisions/revision/submit');
});
it('已发布版本提供修改重提入口，并携带私有选源上下文', () => {
  view('published'); expect(screen.getByRole('link', { name: '修改并重新投稿' })).toHaveAttribute('href', '/community/submit?workId=work&designId=source');
});

it('不把不完整成功响应当成已完成，保留原动作并阻止切换撤回范围', async () => {
  state.fetch.mockResolvedValueOnce(new Response('{}'));
  view(); fireEvent.click(screen.getByRole('button', { name: '撤回本次审核' })); fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await screen.findByRole('alert'); expect(state.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '暂不撤回' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试确认本次操作' }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch.mock.calls[0][1].body).toBe(state.fetch.mock.calls[1][1].body);
  expect(state.fetch.mock.calls[0][1].headers).toEqual(state.fetch.mock.calls[1][1].headers);
});

it('未知提交的目标和基准版本不随新 props 改变，禁止切换为撤回', async () => {
  state.fetch.mockResolvedValueOnce(new Response('{}', { status: 408 }));
  const rendered = view('draft'); fireEvent.click(screen.getByRole('button', { name: '提交草稿审核' }));
  await screen.findByRole('alert');
  rendered.rerender(<CommunityMineActions workId="work" version={8} hasPublished revision={{ id: 'other', version: 9, status: 'draft', sourceDesignId: 'source' }} />);
  expect(screen.getByRole('button', { name: '撤回草稿后修改' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试确认本次操作' }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch.mock.calls[1][0]).toBe(state.fetch.mock.calls[0][0]);
  expect(state.fetch.mock.calls[1][1].body).toBe(state.fetch.mock.calls[0][1].body);
  expect(state.fetch.mock.calls[1][1].headers).toEqual(state.fetch.mock.calls[0][1].headers);
});

it('确定的版本冲突允许关闭，不复用失败动作的键', async () => {
  state.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'STATE_CONFLICT', message: '版本已变化' } }), { status: 409 }));
  view(); fireEvent.click(screen.getByRole('button', { name: '撤回本次审核' })); fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '暂不撤回' }));
  fireEvent.click(screen.getByRole('button', { name: '撤回整件作品' })); fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  expect(state.fetch.mock.calls[1][1].headers['idempotency-key']).not.toBe(state.fetch.mock.calls[0][1].headers['idempotency-key']);
});

it('确认成功后刷新失败也不允许重放写操作', async () => {
  state.refresh.mockImplementationOnce(() => { throw new Error('refresh failed'); });
  view('draft'); fireEvent.click(screen.getByRole('button', { name: '提交草稿审核' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '提交草稿审核' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '重试确认本次操作' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
