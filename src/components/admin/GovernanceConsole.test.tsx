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
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  });
  it('does not confuse a failed queue with no pending work', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    render(<GovernanceConsole mode="reports" />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled();
  });
});
