// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommunitySubmitForm from './CommunitySubmitForm';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const state = vi.hoisted(() => ({ push: vi.fn(), list: vi.fn(), get: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/lib/sync/api', () => ({ createDoupuApi: () => ({ listDesigns: state.list, getDesign: state.get }) }));
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }));
const id = '00000000-0000-4000-a000-000000000001';
const project = { format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: '红色花朵',
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', params: DEFAULT_GENERATION_PARAMS,
  paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
  pattern: { width: 1, height: 1, cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockResolvedValue([{ id, name: '红色花朵', revision: 3, deleted: false }]);
  state.get.mockResolvedValue({ id, name: '红色花朵', revision: 3, project });
  state.fetch.mockImplementation(async (url: string) => url.endsWith('/tags') ? json({ items: [] }) : json({ revisionId: 'revision', version: url.endsWith('/submit') ? 2 : 1, status: url.endsWith('/submit') ? 'pending_review' : 'draft' }));
  vi.stubGlobal('fetch', state.fetch);
});
const renderForm = (initialDesignId = id, workId?: string) => render(<CommunitySubmitForm initialDesignId={initialDesignId} displayName="小豆" workId={workId} />);
const confirm = async () => {
  await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '冻结快照并提交审核' }));
};
it('从自己的云端设计选源并预览，许可默认未勾选，不要求输入私人 ID', async () => {
  renderForm();
  await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  expect(screen.getByText('公开作者：小豆')).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '冻结快照并提交审核' })).toBeDisabled();
  expect(screen.queryByLabelText('私人设计 ID')).not.toBeInTheDocument();
});
it('上下文设计不属于云端列表时明确报错，不悄悄换成其他设计', async () => {
  renderForm('missing');
  expect(await screen.findByRole('alert')).toHaveTextContent('未同步、已删除或不属于当前账号');
  expect(state.get).not.toHaveBeenCalled();
  expect(screen.getByLabelText('选择云端设计')).toHaveValue('');
});
it('创建成功而提交失败时保留草稿，重试不创建另一个作品', async () => {
  let failures = 1;
  state.fetch.mockImplementation(async (url: string) => url.endsWith('/tags') ? json({ items: [] })
    : url.endsWith('/submit') && failures-- > 0 ? json({ error: { message: '审核提交暂时失败' } }, 503) : json({ revisionId: 'revision', version: url.endsWith('/submit') ? 2 : 1, status: url.endsWith('/submit') ? 'pending_review' : 'draft' }));
  renderForm(); await confirm();
  expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
  fireEvent.click(screen.getByRole('button', { name: '重试提交审核' }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith('/community/mine'));
  expect(state.fetch.mock.calls.filter((call) => call[0] === '/api/community/works')).toHaveLength(1);
  const submissions = state.fetch.mock.calls.filter((call) => call[0].endsWith('/submit'));
  expect(submissions[0][1].headers['idempotency-key']).toBe(submissions[1][1].headers['idempotency-key']);
});
it.each(['network', '408'])('创建响应丢失（%s）后按原请求重试，保护许可确认的图纸版本', async (failure) => {
  let failures = 1;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/tags')) return json({ items: [] });
    if (url.endsWith('/works') && failures-- > 0) {
      if (failure === '408') return json({ error: { message: 'timeout' } }, 408);
      throw new Error('offline');
    }
    return json({ revisionId: 'revision', version: url.endsWith('/submit') ? 2 : 1, status: url.endsWith('/submit') ? 'pending_review' : 'draft' });
  });
  renderForm(); await confirm(); await screen.findByRole('alert');
  expect(screen.getByLabelText('公开作品标题')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原投稿' }));
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  const creations = state.fetch.mock.calls.filter((call) => call[0].endsWith('/works'));
  expect(creations).toHaveLength(2);
  expect(creations[0][1].body).toEqual(creations[1][1].body);
  expect(creations[0][1].headers).toEqual(creations[1][1].headers);
  expect(JSON.parse(creations[0][1].body)).toMatchObject({ designId: id, expectedDesignRevision: 3 });
});
it('修改重提调用同一作品的新修订接口，不创建新的公开身份', async () => {
  renderForm(id, 'work'); await confirm();
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  expect(state.fetch.mock.calls.some((call) => call[0] === '/api/community/works/work/revisions')).toBe(true);
  expect(state.fetch.mock.calls.some((call) => call[0] === '/api/community/works')).toBe(false);
});
