// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

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
    window.history.replaceState(null, '', '/login');
  });

  it('渲染登录表单', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: zhCN.authPages.loginTitle })).toBeTruthy();
    expect(screen.getByLabelText('邮箱')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
  });

  it('服务端首屏尚未解析回跳时不展示可能误导的注册链接', () => {
    window.history.replaceState(null, '', '/login?next=%2Fadmin');
    expect(renderToString(<LoginPage />)).not.toContain('href="/register');
  });

  it.each(['/admin', '/admin/reviews?status=pending#queue'])('后台回跳 %s 提示授权而非注册，仍可找回密码', async (next) => {
    window.history.replaceState(null, '', `/login?next=${encodeURIComponent(next)}`);
    render(<LoginPage />);
    expect(await screen.findByText('管理员账号由现有管理员授权，无法自行注册')).toBeVisible();
    expect(screen.queryByRole('link', { name: zhCN.authPages.noAccount })).toBeNull();
    const forgot = screen.getByRole('link', { name: zhCN.authPages.forgotTitle });
    expect(new URL(forgot.getAttribute('href')!, 'http://local').searchParams.get('next')).toBe(next);
  });

  it('转注册和找回密码保留安全的原操作路径，不自动执行原操作', async () => {
    const next = '/community/submit?designId=00000000-0000-4000-a000-000000000001';
    window.history.replaceState(null, '', `/login?next=${encodeURIComponent(next)}`);
    render(<LoginPage />);
    const register = await screen.findByRole('link', { name: zhCN.authPages.noAccount });
    await waitFor(() => expect(new URL(register.getAttribute('href')!, 'http://local').searchParams.get('next')).toBe(next));
    const forgot = screen.getByRole('link', { name: zhCN.authPages.forgotTitle });
    expect(new URL(forgot.getAttribute('href')!, 'http://local').searchParams.get('next')).toBe(next);
    expect(push).not.toHaveBeenCalled();
  });

  it('登录请求中禁止重复提交，失败保留已输入的邮箱', async () => {
    let reject!: (error: Error) => void;
    fetchMock.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    render(<LoginPage />); fill('a@b.com', '12345678');
    const form = screen.getByRole('button', { name: '登录' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reject(new Error('offline'));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('邮箱')).toHaveValue('a@b.com');
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
