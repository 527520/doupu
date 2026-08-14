// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditorToolbar from './EditorToolbar';
import type { BrushSize, ToolId } from '@/lib/editor/ops';

function setup(over: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const props = {
    tool: 'brush' as ToolId,
    brushSize: 1 as BrushSize,
    canUndo: false,
    canRedo: false,
    onToolChange: vi.fn(),
    onBrushSizeChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onReplaceOpen: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
  render(<EditorToolbar {...props} />);
  return props;
}

describe('EditorToolbar', () => {
  it('渲染全部工具并高亮当前工具（aria-pressed）', () => {
    setup();
    expect(screen.getByRole('button', { name: /画笔/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /橡皮/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /油漆桶/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /吸管/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /撤销/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /重做/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /清除全部/ })).toBeTruthy();
  });

  it('工具点击触发 onToolChange', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /橡皮/ }));
    expect(props.onToolChange).toHaveBeenCalledWith('eraser');
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    expect(props.onToolChange).toHaveBeenCalledWith('fill');
  });

  it('画笔模式下显示尺寸选择，切换尺寸触发回调', () => {
    const props = setup({ tool: 'brush' });
    const size3 = screen.getByRole('button', { name: '3' });
    fireEvent.click(size3);
    expect(props.onBrushSizeChange).toHaveBeenCalledWith(3);
  });

  it('非画笔模式不显示尺寸选择', () => {
    setup({ tool: 'fill' });
    expect(screen.queryByRole('button', { name: '2' })).toBeNull();
  });

  it('撤销/重做按钮禁用态受 props 控制', () => {
    setup({ canUndo: true, canRedo: false });
    const undo = screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: /重做/ }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);
    fireEvent.click(undo);
    fireEvent.click(redo); // disabled 点击不触发
  });

  it('清除按钮触发 onClear；替换按钮触发 onReplaceOpen', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /清除全部/ }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /颜色替换/ }));
    expect(props.onReplaceOpen).toHaveBeenCalledTimes(1);
  });
});
