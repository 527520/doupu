// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import WorkbenchProjectBar from './WorkbenchProjectBar';

describe('WorkbenchProjectBar', () => {
  it('独立承载设计上下文、保存操作与游客菜单，不依赖 SiteHeader', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProjectBar
        context={<input aria-label="设计名称" defaultValue="蓝花" />}
        actions={<button type="button">保存</button>}
        overflowActions={<button type="button">登录</button>}
      />,
    );

    const bar = screen.getByRole('region', { name: '当前设计操作' });
    expect(within(bar).getByLabelText('设计名称')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '保存' })).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: '更多操作' }));
    expect(within(bar).getByRole('button', { name: '登录' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(within(bar).getByRole('button', { name: '更多操作' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(bar).getByRole('button', { name: '更多操作' })).toHaveFocus();
  });
});
