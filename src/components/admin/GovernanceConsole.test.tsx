// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GovernanceConsole from './GovernanceConsole';

describe('governance task state', () => {
  const item = { id: 'comment-one', workId: 'work-one', status: 'pending_review', version: 3, body: '待审纯文本', riskCategories: ['spam'] };
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [item] })))));
  it('selects material before showing reasons and retains it through failed writes', async () => {
    render(<GovernanceConsole mode="comments" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /待审纯文本/ }));
    const reason = screen.getByRole('textbox');
    fireEvent.change(reason, { target: { value: '经过人工检查' } });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '公开' }));
    await screen.findByRole('button', { name: '重试确认上次操作' });
    expect(reason).toHaveValue('经过人工检查');
    expect(reason).toBeDisabled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
    fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
    await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(writes).toHaveLength(2); expect(writes[0][0]).toBe(writes[1][0]);
    expect(writes[1][1]).toMatchObject({ method: writes[0][1]?.method, body: writes[0][1]?.body, headers: writes[0][1]?.headers });
  });
  it('does not confuse a failed queue with no pending work', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    render(<GovernanceConsole mode="reports" />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled();
  });
  it('hides the inspected current comment without silently closing its report', async () => {
    const report = { id: 'report-one', targetType: 'comment', targetId: 'comment-one', status: 'accepted', version: 2, category: 'spam', details: '人工举报' };
    const target = { reportId: report.id, targetType: 'comment', targetId: 'comment-one', reportedVersion: 1, currentVersion: 4, contentVersion: 4, contentStatus: 'published', changed: true, title: '被举报作品', workId: 'work-one', workStatus: 'active', body: '当前待处置正文', snapshot: null, publicUrl: '/community/work-one#comment-comment-one' };
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/report-one') ? target : { items: [report] })));
    render(<GovernanceConsole mode="reports" />);
    fireEvent.click(await screen.findByRole('button', { name: /评论 \/ 垃圾推广/ }));
    await screen.findByText('当前待处置正文');
    fireEvent.change(screen.getByRole('textbox', { name: '处置理由' }), { target: { value: '核对当前版本确认有害' } });
    fireEvent.click(screen.getByRole('button', { name: '隐藏当前评论版本' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const write = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(write[0]).toBe('/api/admin/community/comments/comment-one');
    expect(JSON.parse(String(write[1]?.body))).toEqual({ decision: 'hidden', expectedVersion: 4, reason: '核对当前版本确认有害' });
    expect(screen.getByRole('button', { name: '结案' })).toBeInTheDocument();
  });
});
