// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import LoginPage from './page';
import { zhCN } from '@/messages/zh-CN';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function fill(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
}

describe('login 页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    push.mockReset();
  });

  it('渲染登录表单', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: zhCN.authPages.loginTitle })).toBeTruthy();
    expect(screen.getByLabelText('邮箱')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
  });

  it('非法邮箱本地拦截，不发起请求', async () => {
    render(<LoginPage />);
    fill('not-an-email', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401/400 显示统一文案（防枚举，spec E28/E31）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: zhCN.auth.invalidCredentials } }), { status: 401 }));
    render(<LoginPage />);
    fill('a@b.com', 'wrong-pass');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.auth.invalidCredentials));
  });

  it('429 显示限流文案', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429 }));
    render(<LoginPage />);
    fill('a@b.com', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.auth.tooManyRequests));
  });

  it('成功跳转 /designs', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 }));
    render(<LoginPage />);
    fill('a@b.com', '12345678');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/designs'));
  });
});
