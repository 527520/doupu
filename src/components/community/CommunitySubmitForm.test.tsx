// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommunitySubmitForm from './CommunitySubmitForm';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const state = vi.hoisted(() => ({ push: vi.fn(), list: vi.fn(), get: vi.fn(), fetch: vi.fn(), pending: null as null | { bytes: ArrayBuffer; type: string; name: string; sourceRevisionId?: string } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/lib/sync/api', () => ({ createDoupuApi: () => ({ listDesigns: state.list, getDesign: state.get }) }));
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }));
vi.mock('@/lib/storage/pendingOriginals', () => ({
  takePendingOriginal: async () => { const value = state.pending; state.pending = null; return value ? { ...value, designId: id, createdAt: Date.now() } : null; },
  discardPendingOriginal: async () => undefined,
}));
const id = '00000000-0000-4000-a000-000000000001';
const revisionId = '00000000-0000-4000-a000-000000000002';
// 1×1 PNG：通过魔数、尺寸与动图校验
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAgAB/wdYqHkAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
const project = { format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: '红色花朵',
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', params: DEFAULT_GENERATION_PARAMS,
  paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
  pattern: { width: 1, height: 1, cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const normal = async (url: string) => url.endsWith('/original') ? json({ revisionId, mimeType: 'image/png', byteSize: PNG.length, width: 1, height: 1 }, 201)
  : json({ workId: id, revisionId, version: url.endsWith('/submit') ? 2 : 1, status: url.endsWith('/submit') ? 'pending_review' : 'draft' });
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = null;
  state.list.mockResolvedValue([{ id, name: '红色花朵', revision: 3, deleted: false }]);
  state.get.mockResolvedValue({ id, name: '红色花朵', revision: 3, project });
  state.fetch.mockImplementation(normal);
  vi.stubGlobal('fetch', state.fetch);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined }));
});
const renderForm = (initialDesignId = id, workId?: string) => render(<CommunitySubmitForm initialDesignId={initialDesignId} displayName="小豆" workId={workId} />);
const pickOriginal = async () => {
  const input = screen.getByLabelText(/选择原图文件/);
  const file = new File([PNG], 'photo.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('photo.png');
  fireEvent.click(screen.getByRole('checkbox', { name: /同意将上述原图上传/ }));
};
const confirm = async () => {
  await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  fireEvent.click(screen.getByRole('checkbox', { name: /合法发布权/ }));
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
};
it('从自己的云端设计选源并预览，许可默认未勾选，不要求输入私人 ID', async () => {
  renderForm();
  await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  expect(screen.getByText('公开作者：小豆')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /合法发布权/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交审核' })).toBeDisabled();
  expect(screen.queryByLabelText('私人设计 ID')).not.toBeInTheDocument();
});
it('首次投稿必须选择原图并同意上传条款；提交时先建草稿、再上传原图、再送审', async () => {
  renderForm();
  await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  fireEvent.click(screen.getByRole('checkbox', { name: /合法发布权/ }));
  expect(screen.getByRole('button', { name: '提交审核' })).toBeDisabled();
  await pickOriginal();
  expect(screen.getByRole('button', { name: '提交审核' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith('/community/mine'));
  const urls = state.fetch.mock.calls.map((call) => String(call[0]));
  expect(urls).toEqual(['/api/community/works', `/api/community/revisions/${revisionId}/original`, `/api/community/revisions/${revisionId}/submit`]);
  const upload = state.fetch.mock.calls[1][1] as RequestInit;
  expect(upload.method).toBe('PUT');
  expect((upload.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
});
it('工作台交接的会话原图自动带入，不必重新选择文件', async () => {
  state.pending = { bytes: PNG.buffer.slice(0), type: 'png', name: 'session.png' };
  renderForm();
  expect(await screen.findByText('session.png')).toBeVisible();
  expect(screen.getByText(/来自当前工作台会话/)).toBeVisible();
});
it('上下文设计不属于云端列表时明确报错，不悄悄换成其他设计', async () => {
  renderForm('missing');
  expect(await screen.findByRole('alert')).toHaveTextContent('未同步、已删除或不属于当前账号');
  expect(state.get).not.toHaveBeenCalled();
  expect(screen.getByLabelText('选择云端设计')).toHaveValue('');
});
it('创建成功而提交失败时保留草稿，重试不创建另一个作品也不重复上传原图', async () => {
  let failures = 1;
  state.fetch.mockImplementation(async (url: string) => url.endsWith('/submit') && failures-- > 0 ? json({ error: { message: '审核提交暂时失败' } }, 503) : normal(url));
  renderForm(); await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  await pickOriginal(); await confirm();
  expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
  fireEvent.click(screen.getByRole('button', { name: '重试提交审核' }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith('/community/mine'));
  expect(state.fetch.mock.calls.filter((call) => call[0] === '/api/community/works')).toHaveLength(1);
  expect(state.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/original'))).toHaveLength(1);
  const submissions = state.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/submit'));
  expect(submissions[0][1].headers['idempotency-key']).toBe(submissions[1][1].headers['idempotency-key']);
});
it.each(['network', '408', 'malformed'])('创建响应丢失（%s）后按原请求重试，保护许可确认的图纸版本', async (failure) => {
  let failures = 1;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/works') && failures-- > 0) {
      if (failure === 'malformed') return json({ workId: id, revisionId: 'wrong', version: 1, status: 'draft' });
      if (failure === '408') return json({ error: { message: 'timeout' } }, 408);
      throw new Error('offline');
    }
    return normal(url);
  });
  renderForm(); await waitFor(() => expect(screen.getByLabelText('公开作品标题')).toHaveValue('红色花朵'));
  await pickOriginal(); await confirm(); await screen.findByRole('alert');
  expect(screen.getByLabelText('公开作品标题')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原投稿' }));
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  const creations = state.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/works'));
  expect(creations).toHaveLength(2);
  expect(creations[0][1].body).toEqual(creations[1][1].body);
  expect(creations[0][1].headers).toEqual(creations[1][1].headers);
  expect(JSON.parse(creations[0][1].body)).toMatchObject({ designId: id, expectedDesignRevision: 3 });
});
it('修改重提调用同一作品的新修订接口，默认沿用上一版原图，不创建新的公开身份', async () => {
  renderForm(id, 'work'); await confirm();
  await waitFor(() => expect(state.push).toHaveBeenCalled());
  expect(state.fetch.mock.calls.some((call) => call[0] === '/api/community/works/work/revisions')).toBe(true);
  expect(state.fetch.mock.calls.some((call) => call[0] === '/api/community/works')).toBe(false);
  expect(state.fetch.mock.calls.some((call) => String(call[0]).endsWith('/original'))).toBe(false);
});
it('服务端要求原图时保留草稿并提示补选原图，补选后重试成功', async () => {
  let rejected = false;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/submit') && !rejected) { rejected = true; return json({ error: { code: 'ORIGINAL_REQUIRED', message: '公开作品必须附带原图' } }, 409); }
    return normal(url);
  });
  renderForm(id, 'work'); await confirm();
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.some((alert) => alert.textContent?.includes('必须附带原图'))).toBe(true);
  expect(screen.getByRole('button', { name: '重试提交审核' })).toBeDisabled();
  await pickOriginal();
  fireEvent.click(screen.getByRole('button', { name: '重试提交审核' }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith('/community/mine'));
  expect(state.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/original'))).toHaveLength(1);
});
