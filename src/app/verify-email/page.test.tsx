// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import VerifyEmailPage from './page';
import { zhCN } from '@/messages/zh-CN';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('verify-email 页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // 页面直接读取 window.location.search（dev 下 useSearchParams 可能挂起）
    window.history.pushState({}, '', '/verify-email?token=abc123');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/verify-email');
  });

  it('令牌有效 → 成功态并携带登录入口', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(zhCN.authPages.verifySuccess));
    expect(screen.getByText(zhCN.authPages.goLogin)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'abc123' }) }),
    );
  });

  it('令牌失效/过期 → 统一文案 + 重发入口（spec E30）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION', message: zhCN.auth.linkInvalid } }), { status: 400 }));
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(zhCN.auth.linkInvalid));
    expect(screen.getByText(zhCN.authPages.resendTitle)).toBeTruthy();
  });

  it('重发后进入 60s 冷却（按钮禁用并显示倒计时）', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: {} }), { status: 400 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByText(zhCN.authPages.resendTitle)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(zhCN.authPages.email), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByText(zhCN.authPages.resendSent)).toBeTruthy());
    const button = screen.getByRole('button', { name: /秒后再试/ });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
