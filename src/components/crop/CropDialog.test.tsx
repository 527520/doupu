// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CropDialog from './CropDialog';
import { zhCN } from '@/messages/zh-CN';

it('裁剪对话框跟随可见视口缩小和偏移，保留取消与键盘焦点', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const view = Object.assign(new EventTarget(), { width: 350, height: 640, offsetTop: 0, offsetLeft: 0 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: view });
  const onCancel = vi.fn();
  try {
    const { unmount } = render(<CropDialog image={{ data: new Uint8ClampedArray(16), width: 2, height: 2, mime: 'image/png' }} onConfirm={vi.fn()} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: zhCN.crop.title });
    expect(dialog).toHaveStyle({ width: '350px', height: '640px', top: '0px', left: '0px' });
    act(() => {
      Object.assign(view, { width: 290, height: 300, offsetTop: 35, offsetLeft: 20 });
      view.dispatchEvent(new Event('resize'));
    });
    expect(dialog).toHaveStyle({ width: '290px', height: '300px', top: '35px', left: '20px' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
  } finally {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else delete (window as { visualViewport?: VisualViewport }).visualViewport;
  }
});
