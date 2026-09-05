// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewConsole from './ReviewConsole';
vi.mock('@/components/preview/PatternPreview', () => ({ default: () => <p>完整图纸预览</p> }));
vi.mock('@/components/community/CommunityPreviewCanvas', () => ({ default: () => <span>缩略图</span> }));
const row = { revisionId: 'revision-one', workId: 'work-one', revisionNumber: 2, title: '待审小猫', version: 1, width: 100, height: 100, colorCount: 2, boardProfile: '5mm-29', submittedAt: null, author: { displayName: '豆友' }, preview: { colorBand: ['#ffffff'] } };
describe('review task flow', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/revision-one') ? { id: row.revisionId, version: 1, lifecycleStatus: 'active', status: 'pending_review', snapshot: { boardProfile: '5mm-29', pattern: {} }, previous: null } : { items: [row] })))));
  it('requires selecting and loading full material before the action form', async () => {
    render(<ReviewConsole />);
    expect(screen.queryByLabelText('审核理由')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /待审小猫/ }));
    await screen.findByText('完整图纸预览');
    expect(screen.getByRole('button', { name: '批准发布' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('审核理由'), { target: { value: '看过完整冻结图纸' } });
    expect(screen.getByRole('button', { name: '批准发布' })).toBeEnabled();
  });
  it('shows load failures with retry instead of a false empty queue', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    render(<ReviewConsole />);
    await screen.findByRole('alert');
    expect(screen.queryByText('队列已清空。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByRole('button', { name: /待审小猫/ });
  });
  it('retains the selected object, reason and identical request through an uncertain response', async () => {
    render(<ReviewConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /待审小猫/ }));
    await screen.findByText('完整图纸预览');
    fireEvent.change(screen.getByLabelText('审核理由'), { target: { value: '需要重新审核' } });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '批准发布' }));
    await screen.findByRole('button', { name: '重试确认上次操作' });
    expect(screen.getByLabelText('审核理由')).toHaveValue('需要重新审核');
    expect(screen.getByLabelText('审核理由')).toBeDisabled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
    fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
    await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
  });
});
