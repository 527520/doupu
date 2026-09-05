// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import TagsManager from './TagsManager';

const tags = [
  { id: 'source', name: '小猫', slug: 'cats', sortOrder: 0, active: true, mergedIntoTagId: null, version: 2 },
  { id: 'target', name: '动物', slug: 'animals', sortOrder: 1, active: true, mergedIntoTagId: null, version: 1 },
];
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: tags })))));
it('requires selecting a tag and explicitly confirms the named merge target', async () => {
  render(<TagsManager />);
  expect(screen.queryByRole('textbox', { name: '操作理由' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /小猫/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '操作理由' }), { target: { value: '统一相同分类' } });
  fireEvent.click(screen.getByText('合并重复标签'));
  fireEvent.change(screen.getByRole('combobox', { name: '合并到标签' }), { target: { value: 'target' } });
  expect(screen.getByRole('button', { name: '确认合并标签' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /小猫.*动物/ }));
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '确认合并标签' }));
  await screen.findByRole('button', { name: '重试确认上次操作' });
  expect(screen.getByRole('textbox', { name: '操作理由' })).toHaveValue('统一相同分类');
  expect(screen.getByRole('combobox', { name: '合并到标签' })).toBeDisabled();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
  fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
  await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ targetTagId: 'target', expectedVersion: 2 });
});
it('shows read failures with retry instead of a false empty list', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  render(<TagsManager />); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(await screen.findByRole('button', { name: /小猫/ })).toBeEnabled();
});
