// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UsersManager from './UsersManager';

const user = { userId: 'target-user', username: '小豆', maskedEmail: 'a***z@example.test', role: 'user', accountStatus: 'active', governanceVersion: 4, emailVerified: true, createdAt: '2026-09-05T00:00:00Z' };
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [user] })))));
it('keeps all high risk controls tied to one explicitly selected and confirmed user', async () => {
  render(<UsersManager currentUserId="current-admin" />);
  expect(screen.queryByRole('textbox', { name: '操作理由' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /小豆/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '操作理由' }), { target: { value: '多次垃圾推广' } });
  expect(screen.getByRole('button', { name: '暂停账号' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '目标 userId 二次确认' }), { target: { value: user.userId } });
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '暂停账号' }));
  await screen.findByRole('button', { name: '重试确认上次操作' });
  expect(screen.getByRole('textbox', { name: '操作理由' })).toHaveValue('多次垃圾推广');
  expect(screen.getByRole('textbox', { name: '目标 userId 二次确认' })).toBeDisabled();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
  fireEvent.click(screen.getByRole('button', { name: '重试确认上次操作' }));
  await waitFor(() => expect(screen.getByText('操作已完成。')).toBeInTheDocument());
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes).toHaveLength(2); expect(writes[0][0]).toBe(writes[1][0]);
  expect(writes[1][1]).toMatchObject({ method: writes[0][1]?.method, body: writes[0][1]?.body, headers: writes[0][1]?.headers });
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ accountStatus: 'suspended', expectedVersion: 4, targetConfirmation: user.userId, reason: '多次垃圾推广' });
});
it('offers no self-governance action and never changes an anonymized account', async () => {
  render(<UsersManager currentUserId={user.userId} />);
  fireEvent.click(await screen.findByRole('button', { name: /小豆/ }));
  expect(screen.getByText('这是当前登录账号，不能修改自己的角色或暂停自己。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '暂停账号' })).not.toBeInTheDocument();
});
