// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorksManager from './WorksManager';
vi.mock('@/components/preview/PatternPreview', () => ({ default: () => <p>完整作品材料</p> }));
vi.mock('@/components/community/CommunityPreviewCanvas', () => ({ default: () => <span>缩略图</span> }));
const row = { id: 'work-one', title: '红色小猫', version: 3, lifecycleStatus: 'active', commentsLocked: false, featured: false, displayName: '豆友', preview: {} };
const detail = { ...row, isPublic: true, canRestore: true, removedReason: null, counts: { likes: 2, comments: 0, reuses: 1 }, latestRevision: { id: 'revision-one', status: 'published', revisionNumber: 1 }, material: { id: 'revision-one', title: row.title, revisionNumber: 1, status: 'published', snapshot: { pattern: {}, boardProfile: '5mm-29' } } };
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/work-one') ? detail : { items: [row], nextCursor: null })))));
it('inspects the frozen work and requires a second confirmation before removal', async () => {
  render(<WorksManager />);
  expect(screen.queryByRole('textbox', { name: '操作理由' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /红色小猫/ }));
  await screen.findByText('完整作品材料');
  fireEvent.change(screen.getByRole('textbox', { name: '操作理由' }), { target: { value: '复核确定需要下架' } });
  fireEvent.click(screen.getByRole('button', { name: '下架作品' }));
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  expect(screen.getByRole('button', { name: '确认下架作品' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /红色小猫.*下架/ }));
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '确认下架作品' }));
  await screen.findByRole('button', { name: '重试确认上次操作' });
  expect(screen.getByRole('textbox', { name: '操作理由' })).toBeDisabled();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
  fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
  await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ action: 'remove', expectedVersion: 3 });
});
it('offers restore only when an approved revision exists', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/work-one') ? { ...detail, lifecycleStatus: 'removed', isPublic: false, canRestore: false } : { items: [{ ...row, lifecycleStatus: 'removed' }], nextCursor: null })));
  render(<WorksManager />); fireEvent.click(await screen.findByRole('button', { name: /红色小猫/ }));
  await screen.findByText('完整作品材料');
  expect(screen.queryByRole('button', { name: '恢复已批准版本' })).not.toBeInTheDocument();
  expect(screen.getByText('没有可恢复的已批准版本，不能绕过审核发布。')).toBeInTheDocument();
});
