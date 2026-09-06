// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AuditExplorer from './AuditExplorer';

afterEach(() => vi.unstubAllGlobals());
it('reads before selection, shows actions and states in Chinese, and applies explicit filters', async () => {
  const entry = { id: 'audit-1', actorUserId: null, actorRole: 'admin', action: 'community.revision_published', targetType: 'community_revision', targetId: 'revision-1', requestId: 'request-1', reason: '核对完成', createdAt: '2026-09-01T01:00:00Z', beforeState: { revisionStatus: 'pending_review' }, afterState: { revisionStatus: 'published' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [entry], nextCursor: 'next' }))).mockResolvedValueOnce(new Response('{"items":[],"nextCursor":null}'));
  vi.stubGlobal('fetch', fetcher);
  render(<AuditExplorer />);
  await screen.findByRole('button', { name: /批准作品发布/ });
  expect(screen.getByText(/作品版本/)).toBeTruthy();
  expect(screen.queryByText('待审核')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /批准作品发布/ }));
  expect(screen.getByText('待审核')).toBeTruthy();
  expect(screen.getByText('已发布')).toBeTruthy();
  expect(screen.getAllByText('版本状态')).toHaveLength(2);
  // 原始动作名仍以代码形式保留，便于对照日志
  expect(screen.getByText('community.revision_published')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
  fireEvent.change(screen.getByLabelText('搜索操作名称、对象编号或请求编号'), { target: { value: 'request-1' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(String(fetcher.mock.calls[1][0])).toContain('q=request-1');
  expect(screen.queryByText('待审核')).toBeNull();
});

it('shows read failure without claiming that audit history is empty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<AuditExplorer />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy();
  expect(screen.queryByText('暂无符合条件的记录。')).toBeNull();
});
