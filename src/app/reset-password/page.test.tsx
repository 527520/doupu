// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ResetPasswordPage from './page';
import { zhCN } from '@/messages/zh-CN';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function fill(password: string, confirm: string): void {
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: confirm } });
}

describe('reset-password 页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // 页面直接读取 window.location.search（dev 下 useSearchParams 可能挂起）
    window.history.pushState({}, '', '/reset-password?token=reset-token');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/reset-password');
  });

  it('密码不一致本地拦截', async () => {
    render(<ResetPasswordPage />);
    fill('12345678', '87654321');
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.authPages.passwordMismatch));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('密码过短本地拦截（8–72 边界）', async () => {
    render(<ResetPasswordPage />);
    fill('short', 'short');
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('成功 → 提示旧会话失效并携带 token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<ResetPasswordPage />);
    fill('12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(zhCN.authPages.resetSuccess));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      expect.objectContaining({ body: JSON.stringify({ token: 'reset-token', password: '12345678' }) }),
    );
  });

  it('令牌失效 → 统一文案（spec E30/E32）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION', message: zhCN.auth.linkInvalid } }), { status: 400 }));
    render(<ResetPasswordPage />);
    fill('12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.auth.linkInvalid));
  });
});
