// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountMenu from './AccountMenu';
import { ApiError } from '@/lib/sync/clientAdapter';
import type { DoupuApi, MeInfo } from '@/lib/sync/api';

afterEach(() => {
  vi.useRealTimers();
});

class FakeAuthApi implements DoupuApi {
  resendCalls: string[] = [];
  changeCalls: Array<{ current: string; next: string }> = [];
  profileCalls: string[] = [];
  deleteCalls: string[] = [];
  logoutCalls = 0;
  constructor(
    public currentPassword = '正确密码',
    public accountPassword = '正确密码',
  ) {}
  async me(): Promise<MeInfo> {
    return { state: 'guest' };
  }
  async listDesigns() {
    return [];
  }
  async listDesignsPage() {
    return { items: [], nextCursor: null };
  }
  async getDesign() {
    return null;
  }
  async putDesign() {
    return { updatedAt: new Date().toISOString(), revision: 1 };
  }
  async deleteDesign() {
    return { updatedAt: new Date().toISOString(), revision: 2 };
  }
  async resendVerification(email: string) {
    this.resendCalls.push(email);
  }
  async changePassword(current: string, next: string) {
    if (current !== this.currentPassword) {
      throw new ApiError(400, 'VALIDATION', '当前密码不正确。', 'currentPassword');
    }
    this.changeCalls.push({ current, next });
  }
  async updateProfile(username: string) {
    this.profileCalls.push(username);
  }
  async deleteAccount(password: string) {
    if (password !== this.accountPassword) {
      throw new ApiError(400, 'VALIDATION', '当前密码不正确。', 'password');
    }
    this.deleteCalls.push(password);
  }
  async logout() {
    this.logoutCalls++;
  }
}

describe('AccountMenu', () => {
  it('退出失败明确提示，不触发退出成功或误切游客；可以重试', async () => {
    const api = new FakeAuthApi();
    const logout = vi.spyOn(api, 'logout').mockRejectedValueOnce(new Error('网络不可用'));
    const changed = vi.fn();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'u@e.com', username: null, createdAt: '2026-08-15T00:00:00Z' }} onAuthChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('退出登录失败');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('注销进行中不能通过 Esc 关闭且重复提交只调用一次，保留公开作品边界可见', async () => {
    const api = new FakeAuthApi();
    let resolve!: () => void;
    const deletion = vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const changed = vi.fn();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'u@e.com', username: null, createdAt: '2026-08-15T00:00:00Z' }} onAuthChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '注销账号' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('公开作品和引用事实保留');
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    const form = screen.getByRole('button', { name: '确认注销' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(deletion).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(changed).toHaveBeenCalledOnce();
  });
  it('游客态：显示登录/注册入口', () => {
    render(<AccountMenu api={new FakeAuthApi()} me={{ state: 'guest' }} onAuthChanged={() => {}} />);
    expect(screen.getByRole('link', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '注册' })).toBeTruthy();
  });

  it('已验证：显示邮箱与操作按钮；退出登录调用 API 并通知', async () => {
    const api = new FakeAuthApi();
    const onChanged = vi.fn();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'user@example.com', username: null, createdAt: '2026-08-15T00:00:00.000Z' }} onAuthChanged={onChanged} />);
    expect(screen.getByText(/user@example.com/)).toBeTruthy();
    expect(screen.getByText(/已验证/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await waitFor(() => expect(api.logoutCalls).toBe(1));
    expect(onChanged).toHaveBeenCalled();
  });

  it('已验证：可修改用于展示的用户名', async () => {
    const api = new FakeAuthApi();
    const onChanged = vi.fn();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'user@example.com', username: '豆豆', createdAt: '2026-08-15T00:00:00.000Z' }} onAuthChanged={onChanged} />);
    expect(screen.getByDisplayValue('豆豆')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存用户名' }));
    await waitFor(() => expect(api.profileCalls).toEqual(['新名字']));
    expect(onChanged).toHaveBeenCalled();
  });

  it('未验证：重发验证邮件 + 60 秒冷却', async () => {
    vi.useFakeTimers();
    const api = new FakeAuthApi();
    render(<AccountMenu api={api} me={{ state: 'unverified' }} onAuthChanged={() => {}} />);
    expect(screen.getByText('邮箱未验证')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } });
    // 用 act 冲刷异步链（resend → setCooldown/setInterval），避免 waitFor 与假计时器互斥
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重发验证邮件' }));
    });
    expect(api.resendCalls).toEqual(['user@example.com']);
    expect(screen.getByRole('button', { name: /秒后再试/ })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: '重发验证邮件' })).toBeEnabled();
    vi.useRealTimers();
  });

  it('修改密码：错误当前密码显示服务端错误；正确则关闭对话框', async () => {
    const api = new FakeAuthApi('正确密码');
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'u@e.com', username: null, createdAt: '2026-08-15T00:00:00.000Z' }} onAuthChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: '错误' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpassword1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('当前密码不正确。');
    expect(dialog).toBeTruthy();

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: '正确密码' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.changeCalls).toEqual([{ current: '正确密码', next: 'newpassword1' }]);
  });

  it('修改密码：两次新密码不一致在客户端拦截', async () => {
    const api = new FakeAuthApi();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'u@e.com', username: null, createdAt: '2026-08-15T00:00:00.000Z' }} onAuthChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: '正确密码' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpassword2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('两次输入的密码不一致。');
    expect(api.changeCalls).toEqual([]);
  });

  it('注销账号：错误密码报错；正确密码成功后通知', async () => {
    const api = new FakeAuthApi('x', '正确密码');
    const onChanged = vi.fn();
    render(<AccountMenu api={api} me={{ state: 'verified', email: 'u@e.com', username: null, createdAt: '2026-08-15T00:00:00.000Z' }} onAuthChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: '注销账号' }));

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: '错误' } });
    fireEvent.click(screen.getByRole('button', { name: '确认注销' }));
    await screen.findByText('当前密码不正确。');

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: '正确密码' } });
    fireEvent.click(screen.getByRole('button', { name: '确认注销' }));
    await waitFor(() => expect(api.deleteCalls).toEqual(['正确密码']));
    expect(onChanged).toHaveBeenCalled();
  });
});
