// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AuditExplorer from './AuditExplorer';

afterEach(() => vi.unstubAllGlobals());
it('reads before selection, inspects whitelisted state and applies explicit filters', async () => {
  const entry = { id: 'audit-1', actorUserId: null, actorRole: 'admin', action: 'community.approved', targetType: 'community_revision', targetId: 'revision-1', requestId: 'request-1', reason: '核对完成', createdAt: '2026-09-01T01:00:00Z', beforeState: { status: 'pending_review' }, afterState: { status: 'published' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [entry], nextCursor: 'next' }))).mockResolvedValueOnce(new Response('{"items":[],"nextCursor":null}'));
  vi.stubGlobal('fetch', fetcher);
  render(<AuditExplorer />);
  await screen.findByRole('button', { name: /community.approved/ });
  expect(screen.queryByText('pending_review')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /community.approved/ }));
  expect(screen.getByText('pending_review')).toBeTruthy();
  expect(screen.getByText('published')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回队列' }));
  fireEvent.change(screen.getByLabelText('搜索动作、目标 ID 或请求 ID'), { target: { value: 'request-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查询审计' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(String(fetcher.mock.calls[1][0])).toContain('q=request-1');
  expect(screen.queryByText('pending_review')).toBeNull();
});

it('shows read failure without claiming that audit history is empty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<AuditExplorer />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy();
  expect(screen.queryByText('暂无符合条件的记录。')).toBeNull();
});
