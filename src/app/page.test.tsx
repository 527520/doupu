// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Home from './page';
import { resetAuthStatusCache } from '@/components/account/useAuthStatus';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('首页', () => {
  beforeEach(() => {
    // 登录态探测在组件间共享（J-1）：用例之间必须清掉共享的在途结果。
    resetAuthStatusCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
  });

  it('渲染标题、引导与上传入口', async () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: '开始创作' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /把喜欢，\s*一颗颗拼出来。/ })).toBeTruthy();
    expect(screen.getByText('正在检查登录状态…').closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择图片文件' })).toHaveTextContent('选择图片，开始制作');
    expect(within(screen.getByTestId('workspace-sidebar')).getByRole('link', { name: '工作台' })).toBeTruthy();
    await screen.findByRole('link', { name: '登录' }); // 等待登录态探测完成
  });

  it('主导航包含全部入口且地址正确（未登录时显示登录按钮）', async () => {
    render(<Home />);
    const nav = within(screen.getByTestId('workspace-sidebar')).getByRole('navigation', { name: '主导航' });
    const expectLink = (name: string, href: string) => {
      const link = within(nav).getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
    };
    expectLink('工作台', '/app');
    expectLink('我的设计', '/designs');
    expectLink('色板管理', '/palettes');
    expectLink('帮助与教程', '/help');
    expectLink('关于', '/about');
    expect(within(screen.getByTestId('workspace-sidebar')).getByRole('link', { name: '账户与状态' })).toHaveAttribute('href', '/account');
    await screen.findByRole('link', { name: '登录' });
    expect(screen.getByRole('link', { name: '登录' }).getAttribute('href')).toBe('/login');
  });

  it('已登录时只保留账号入口，不重复展示邮箱与退出操作', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ email: 'wqa527520@qq.com', emailVerified: true }), { status: 200 }));
    render(<Home />);
    await screen.findByText('wqa527520');
    expect(screen.queryByText('wqa527520@qq.com')).toBeNull();
    expect(screen.queryByRole('button', { name: '退出登录' })).toBeNull();
    expect(screen.queryByRole('link', { name: '登录' })).toBeNull();
  });

  it('页脚包含源码、作者与隐私入口', async () => {
    render(<Home />);
    expect(screen.getByText(/开源软件/)).toBeTruthy();
    expect(screen.getByText(/作者：wuqian/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '隐私政策' })).toBeTruthy();
    await screen.findByRole('link', { name: '登录' }); // 等待登录态探测完成
  });
});
