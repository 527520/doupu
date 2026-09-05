// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AccountPage from './page';
const state = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock('@/lib/sync/api', () => ({ createDoupuApi: () => ({ me: state.me }) }));
vi.mock('@/components/layout/SiteHeader', () => ({ default: () => <h1>账号</h1> }));
vi.mock('@/components/account/AccountMenu', () => ({ default: ({ me }: { me: { state?: string } | string }) => <p>{typeof me === 'string' ? me : me.state}</p> }));
beforeEach(() => state.me.mockReset());
it('账号读取失败不会伪报游客或仅本机状态，重试后恢复真实账号', async () => {
  state.me.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ state: 'verified', email: 'a@b.test' });
  render(<AccountPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('账号信息暂时无法读取');
  expect(screen.queryByText('guest')).toBeNull();
  expect(screen.queryByText('仅保存在这台设备')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('verified')).toBeVisible();
});
