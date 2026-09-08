// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActionOverflow from './ActionOverflow';

describe('ActionOverflow', () => {
  it('触发器是豆粒按钮；面板打开后 ↓/↑ 在项目间循环，Home/End 跳首尾，Esc 关闭并还焦', async () => {
    const user = userEvent.setup();
    render(<ActionOverflow label="更多操作" actions={<>
      <a href="/a">甲</a>
      <button type="button">乙</button>
      <hr aria-hidden="true" />
      <button type="button" data-tone="danger">丙</button>
    </>} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    expect(trigger.className).toContain('btn-bead');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(screen.getByRole('link', { name: '甲' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '乙' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '丙' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: '甲' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: '丙' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('link', { name: '甲' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('点击任一项后关闭面板并把焦点还给触发器', async () => {
    const user = userEvent.setup();
    render(<ActionOverflow label="更多操作" actions={<button type="button">乙</button>} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '乙' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
