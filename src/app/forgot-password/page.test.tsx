// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({}));

import ForgotPasswordPage from './page';
import { zhCN } from '@/messages/zh-CN';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('forgot-password 页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('非法邮箱本地拦截', async () => {
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('提交后恒成功提示（防枚举，spec E28）', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(zhCN.authPages.forgotSent));
  });

  it('网络失败同样恒成功（不泄露账号是否存在）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(zhCN.authPages.forgotSent));
  });

  it('提交后进入 60s 冷却', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.authPages.submit }));
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /秒后再试/ });
      expect(button.hasAttribute('disabled')).toBe(true);
    });
  });
});
