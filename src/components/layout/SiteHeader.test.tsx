// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SiteHeader from './SiteHeader';

describe('SiteHeader', () => {
  it('提供唯一页面标题、主导航和移动端可展开的操作入口', async () => {
    const user = userEvent.setup();
    render(
      <SiteHeader
        title="我的设计"
        currentPath="/designs"
        primaryActions={<button type="button">新建设计</button>}
        overflowActions={<button type="button">退出登录</button>}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('我的设计');
    expect(screen.getByRole('button', { name: '新建设计' })).toBeTruthy();
    const more = screen.getByRole('button', { name: '菜单与账户' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByTestId('site-overflow-panel')).getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '我的设计' }).some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
  });
});
