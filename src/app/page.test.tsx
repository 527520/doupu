// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Home from './page';

describe('首页', () => {
  it('渲染标题、引导与上传入口', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: '豆谱' })).toBeTruthy();
    expect(screen.getByText(/拖拽图片到此处/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '工作台' })).toBeTruthy();
  });

  it('主导航包含全部入口且地址正确', () => {
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
    expectLink('登录', '/login');
  });

  it('页脚包含源码、作者与隐私入口', () => {
    render(<Home />);
    expect(screen.getByText(/开源软件/)).toBeTruthy();
    expect(screen.getByText(/作者：wuqian/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '隐私政策' })).toBeTruthy();
  });
});
