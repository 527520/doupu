// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import Modal from './Modal';

afterEach(() => cleanup());

describe('Modal', () => {
  it('裁剪上方的确认弹窗独占 Escape，不连带关闭底层裁剪', async () => {
    const closeCrop = vi.fn();
    const closeConfirm = vi.fn();
    render(<>
      <Modal label="裁剪" onClose={closeCrop}><button>裁剪操作</button></Modal>
      <Modal label="覆盖确认" onClose={closeConfirm}><button>取消覆盖</button></Modal>
    </>);
    await userEvent.keyboard('{Escape}');
    expect(closeConfirm).toHaveBeenCalledOnce();
    expect(closeCrop).not.toHaveBeenCalled();
  });

  it('将焦点限制在弹窗中，并在关闭后恢复到触发控件', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = '打开';
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal label="测试弹窗" onClose={onClose}>
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </Modal>,
    );

    expect(await screen.findByRole('button', { name: '第一个' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '最后一个' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '第一个' })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('打开时使背景不可交互，关闭后恢复背景原状态', () => {
    const { container, unmount } = render(
      <>
        <main aria-label="页面内容">背景</main>
        <Modal label="测试弹窗" onClose={() => {}}>
          <button type="button">关闭</button>
        </Modal>
      </>,
    );

    expect(container).toHaveAttribute('inert');
    expect(container).toHaveAttribute('aria-hidden', 'true');

    unmount();
    expect(container).not.toHaveAttribute('inert');
    expect(container).not.toHaveAttribute('aria-hidden');
  });

  it('弹窗语义没有 axe 严重或关键问题', async () => {
    render(
      <Modal label="导出设置" onClose={() => {}}>
        <label htmlFor="export-name">文件名</label>
        <input id="export-name" />
        <button type="button">导出</button>
      </Modal>,
    );

    const results = await axe.run(document.body, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
    });
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  });
});
