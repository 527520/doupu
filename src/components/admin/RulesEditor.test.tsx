// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import RulesEditor from './RulesEditor';

const version = { id: 'version-one', version: 3, active: true, reason: '现行词表', createdAt: '2026-09-05T00:00:00Z', rules: [{ literal: '测试词', category: 'spam', risk: 'review' }] };
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [version] })))));
it('starts from the active rule set, rejects duplicate rules and explicitly confirms full replacement', async () => {
  render(<RulesEditor />);
  expect(screen.queryByRole('textbox', { name: '启用理由' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: '基于当前版本编辑' }));
  expect(screen.getByRole('button', { name: '移除 测试词' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '字面词' }), { target: { value: '测试词' } });
  expect(screen.getByRole('button', { name: '加入版本' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '字面词' }), { target: { value: '新词' } });
  fireEvent.click(screen.getByRole('button', { name: '加入版本' }));
  fireEvent.change(screen.getByRole('textbox', { name: '启用理由' }), { target: { value: '补充明确垃圾推广规则' } });
  const publish = screen.getByRole('button', { name: '创建并启用不可变版本' });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /完整词表替换/ }));
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(publish);
  await screen.findByRole('button', { name: '重试确认上次操作' });
  expect(screen.getByRole('textbox', { name: '启用理由' })).toBeDisabled();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{"version":4}'));
  fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
  await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  const body = JSON.parse(String(writes[0][1]?.body));
  expect(body.expectedVersion).toBe(3); expect(body.rules).toHaveLength(2);
});
it('does not allow drafting against unknown current rules after a read error', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  render(<RulesEditor />); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '基于当前版本编辑' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled();
});
