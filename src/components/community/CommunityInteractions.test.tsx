// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommunityInteractions from './CommunityInteractions';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const state = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn(), records: [] as unknown[], fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/lib/storage', async (original) => ({ ...(await original<object>()), openIndexedDb: async () => ({ getAll: async () => state.records }) }));
vi.mock('@/lib/sync/clientAdapter', async (original) => ({ ...(await original<object>()), createSyncClient: () => ({ pullDesign: state.pull }) }));
vi.mock('@/lib/sync/queue', () => ({ withDesignStorageLock: (run: () => unknown) => run() }));
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }));
const workId = '00000000-0000-4000-a000-000000000001';
const copyId = '00000000-0000-4000-a000-000000000002';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const record = { id: copyId, projectJson: JSON.stringify({
  format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: '私人副本',
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z',
  params: DEFAULT_GENERATION_PARAMS, paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
  pattern: { width: 1, height: 1, cells: [{ code: 'F02', hex: '#FC3D46', transparent: false }] },
}) };
beforeEach(() => {
  state.push.mockReset(); state.pull.mockReset(); state.fetch.mockReset(); state.records = [];
  state.pull.mockImplementation(async () => { state.records = [record]; });
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/like')) return json({ liked: init?.method !== 'DELETE', likeCount: init?.method === 'DELETE' ? 0 : 1 });
    if (url.endsWith('/comments')) return json({ items: [] });
    if (url.endsWith('/reuse')) return json({ designId: copyId, reuseCount: 1 });
    return json({ id: 'report' });
  });
  vi.stubGlobal('fetch', state.fetch);
});
const renderWork = () => render(<CommunityInteractions workId={workId} initialLikes={1} initialReuses={0} commentsLocked={false} />);

it('点赞只有一个切换按钮，并读取当前账号的真实状态', async () => {
  renderWork();
  const like = await screen.findByRole('button', { name: '取消赞' });
  expect(like).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(like);
  await waitFor(() => expect(screen.getByRole('button', { name: '点赞' })).toHaveAttribute('aria-pressed', 'false'));
  expect(state.fetch.mock.calls.find((call) => call[1]?.method === 'DELETE')?.[1].headers).toMatchObject({ 'content-type': 'application/json' });
});

it('引用只创建一次，保存本机后直接打开独立设计', async () => {
  renderWork();
  const reuse = screen.getByRole('button', { name: '用这张制作' });
  fireEvent.click(reuse); fireEvent.click(reuse);
  await waitFor(() => expect(state.push).toHaveBeenCalledWith(`/app?id=${copyId}&mode=edit`));
  expect(state.fetch.mock.calls.filter((call) => call[0].endsWith('/reuse'))).toHaveLength(1);
  expect(state.pull).toHaveBeenCalledWith(copyId);
  expect(screen.queryByText(new RegExp(copyId))).not.toBeInTheDocument();
});

it('引用响应不确定时保留幂等键重试，不创建重复副本', async () => {
  renderWork();
  const normal = state.fetch.getMockImplementation()!;
  let failures = 1;
  state.fetch.mockImplementation((url, init) => url.endsWith('/reuse') && failures-- > 0 ? Promise.reject(new Error('offline')) : normal(url, init));
  fireEvent.click(screen.getByRole('button', { name: '用这张制作' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '用这张制作' }));
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  const calls = state.fetch.mock.calls.filter((call) => call[0].endsWith('/reuse'));
  expect(calls).toHaveLength(2);
  expect(calls[0][1].headers['idempotency-key']).toBe(calls[1][1].headers['idempotency-key']);
});

it('副本已创建但下载失败时，重试只打开已有副本', async () => {
  state.pull.mockRejectedValueOnce(new Error('local unavailable'));
  renderWork();
  fireEvent.click(screen.getByRole('button', { name: '用这张制作' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('副本已保存在云端');
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '打开已创建的图纸' }));
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  expect(state.fetch.mock.calls.filter((call) => call[0].endsWith('/reuse'))).toHaveLength(1);
});

it('未登录时保留作品上下文，登录后不自动执行引用', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url, init) => url.endsWith('/reuse') ? Promise.resolve(json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)) : normal(url, init));
  renderWork(); fireEvent.click(screen.getByRole('button', { name: '用这张制作' }));
  const login = await screen.findByRole('link', { name: '登录后继续' });
  expect(new URL(login.getAttribute('href')!, 'http://local').searchParams.get('next')).toBe(`/community/${workId}`);
  expect(state.push).not.toHaveBeenCalled();
});

it('举报收进次级菜单，只有确认分类后才提交', async () => {
  renderWork();
  expect(screen.queryByRole('button', { name: '举报作品' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '作品更多操作' }));
  fireEvent.click(screen.getByRole('button', { name: '举报作品' }));
  expect(state.fetch.mock.calls.filter((call) => call[0] === '/api/community/reports')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('举报类别'), { target: { value: 'copyright' } });
  fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
  await waitFor(() => expect(state.fetch.mock.calls.filter((call) => call[0] === '/api/community/reports')).toHaveLength(1));
  expect(JSON.parse(state.fetch.mock.calls.find((call) => call[0] === '/api/community/reports')![1].body)).toMatchObject({ category: 'copyright', targetType: 'work', targetId: workId });
});

it('讨论网络失败可重试，不清空用户正在输入的正文', async () => {
  const normal = state.fetch.getMockImplementation()!;
  let failures = 1;
  state.fetch.mockImplementation((url, init) => url.endsWith('/comments') && failures-- > 0 ? Promise.reject(new Error('offline')) : normal(url, init));
  renderWork();
  fireEvent.change(screen.getByLabelText('发表评论'), { target: { value: '我的制作心得' } });
  expect(await screen.findByText('讨论加载失败，已有输入仍保留。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('还没有讨论，欢迎分享制作心得。')).toBeVisible();
  expect(screen.getByLabelText('发表评论')).toHaveValue('我的制作心得');
});

it('服务端新锁定评论后保留输入并禁止重复提交', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url, init) => url.endsWith('/comments') && init?.method === 'POST'
    ? Promise.resolve(json({ error: { code: 'COMMENTS_LOCKED', message: '作品评论已锁定' } }, 409)) : normal(url, init));
  renderWork();
  fireEvent.change(screen.getByLabelText('发表评论'), { target: { value: '保留这段输入' } });
  fireEvent.click(screen.getByRole('button', { name: '发布评论' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('作品评论已锁定');
  expect(screen.getByLabelText('发表评论')).toHaveValue('保留这段输入');
  expect(screen.getByRole('button', { name: '发布评论' })).toBeDisabled();
});

it('离开作品后迟到的引用响应不下载图纸也不强行导航', async () => {
  const normal = state.fetch.getMockImplementation()!;
  let resolve!: (value: Response) => void;
  const reply = new Promise<Response>((done) => { resolve = done; });
  state.fetch.mockImplementation((url, init) => url.endsWith('/reuse') ? reply : normal(url, init));
  const view = renderWork();
  fireEvent.click(screen.getByRole('button', { name: '用这张制作' }));
  view.unmount();
  resolve(json({ designId: copyId, reuseCount: 1 }));
  await reply;
  await new Promise((done) => setTimeout(done, 0));
  expect(state.pull).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});
