// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import Home from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('首页', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
  });

  it('渲染标题、引导与上传入口', async () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: '豆谱' })).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent('正在检查登录状态…');
    expect(screen.getByText(/拖拽图片到此处/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '工作台' })).toBeTruthy();
    await screen.findByRole('link', { name: '登录' }); // 等待登录态探测完成
  });

  it('主导航包含全部入口且地址正确（未登录时显示登录按钮）', async () => {
    render(<Home />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    const expectLink = (name: string, href: string) => {
      const link = screen.getByRole('link', { name });
      expect(nav.contains(link)).toBe(true);
      expect(link.getAttribute('href')).toBe(href);
    };
    expectLink('工作台', '/app');
    expectLink('我的设计', '/designs');
    expectLink('色板管理', '/palettes');
    expectLink('帮助', '/help');
    expectLink('关于', '/about');
    await screen.findByRole('link', { name: '登录' });
    expectLink('登录', '/login');
  });

  it('已登录时显示邮箱与退出登录，不再显示登录按钮', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ email: 'wqa527520@qq.com', emailVerified: true }), { status: 200 }));
    render(<Home />);
    expect(await screen.findByText('wqa527520@qq.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '登录' })).toBeNull();
  });

  it('点击退出登录调用登出接口并回到未登录显示', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<Home />);
    await screen.findByRole('button', { name: '退出登录' });
    await act(async () => {
      screen.getByRole('button', { name: '退出登录' }).click();
    });
    await screen.findByRole('link', { name: '登录' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('页脚包含源码、作者与隐私入口', async () => {
    render(<Home />);
    expect(screen.getByText(/开源软件/)).toBeTruthy();
    expect(screen.getByText(/作者：wuqian/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '隐私政策' })).toBeTruthy();
    await screen.findByRole('link', { name: '登录' }); // 等待登录态探测完成
  });
});
