// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({}));

import RegisterPage from './page';
import { zhCN } from '@/messages/zh-CN';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function fill(email: string, password: string, confirm: string): void {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: confirm } });
}

describe('register 页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/register');
  });

  it('直接访问携带后台回跳的注册链接不会把后台带入注册后登录流程', async () => {
    window.history.replaceState(null, '', '/register?next=%2Fadmin%2Fusers');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    const login = await screen.findByRole('link', { name: zhCN.authPages.goLogin });
    expect(login).toHaveAttribute('href', '/login');
  });

  it('两次密码不一致本地拦截（spec E31 客户端校验）', async () => {
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '87654321');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.authPages.passwordMismatch));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('密码过短本地拦截', async () => {
    render(<RegisterPage />);
    fill('a@b.com', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('注册成功显示已发送验证邮件', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('用户名（选填）'), { target: { value: '  豆豆  ' } });
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(zhCN.authPages.registeredSent));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      body: JSON.stringify({ email: 'a@b.com', password: '12345678', username: '豆豆' }),
    }));
  });

  it('开发邮件模式：响应带 x-dev-mail-link 时展示可点击的验证链接', async () => {
    const link = 'http://localhost:3000/verify-email?token=dev-token-123';
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { 'x-dev-mail-link': link } }));
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    const shown = await screen.findByRole('link', { name: link });
    expect(shown.getAttribute('href')).toBe(link);
    expect(screen.getByText(zhCN.authPages.devMailHint)).toBeTruthy();
  });

  it('无 x-dev-mail-link 响应头时不显示开发链接（正式环境）', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.queryByText(zhCN.authPages.devMailHint)).toBeNull();
  });

  it('邮箱已存在（CONFLICT）显示对应文案', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: zhCN.auth.emailTaken } }), { status: 409 }));
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.auth.emailTaken));
  });

  it('400 字段级错误展示服务端消息', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'password: 密码至少 8 个字符' } }), { status: 400 }));
    render(<RegisterPage />);
    fill('a@b.com', '12345678', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('密码至少 8 个字符'));
  });
});
