// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PixelEditorCanvas from './PixelEditorCanvas';
import { makeSolid } from '@/lib/editor/ops';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteColor, Pattern } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };

function patternOf(W: number, H: number): Pattern {
  return {
    width: W,
    height: H,
    cells: Array.from({ length: W * H }, () => makeSolid(RED.hex, RED.code)),
  };
}

function setup(W = 3, H = 2, over: Partial<Parameters<typeof PixelEditorCanvas>[0]> = {}) {
  const onStatsChange = vi.fn();
  const onColorChange = vi.fn();
  render(
    <PixelEditorCanvas
      pattern={patternOf(W, H)}
      palette={[BLUE, RED]} // 默认画笔色为蓝色，避免与红色底图同色导致空操作
      defaultCellPx={10}
      onStatsChange={onStatsChange}
      onColorChange={onColorChange}
      {...over}
    />,
  );
  const canvas = screen.getByLabelText('图纸编辑画布');
  return { onStatsChange, onColorChange, canvas };
}

const pointer = (canvas: Element, type: string, props: Record<string, unknown> = {}) =>
  fireEvent[type as 'pointerDown'](canvas, { pointerType: 'mouse', ...props });

describe('PixelEditorCanvas', () => {
  it('初始统计正确上抛', () => {
    const { onStatsChange } = setup();
    expect(onStatsChange).not.toHaveBeenCalled(); // 初始不回调，仅编辑后
  });

  it('画笔点击改变格子并上抛统计', () => {
    const { onStatsChange, canvas } = setup();
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
    expect(onStatsChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ code: 'B', hex: '#0000FF', count: 1 }]),
      6,
    );
  });

  it('橡皮点击置透明，统计减一', () => {
    const { onStatsChange, canvas } = setup();
    fireEvent.click(screen.getByRole('button', { name: /橡皮/ }));
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
    expect(onStatsChange).toHaveBeenCalledWith([{ code: 'A', hex: '#FF0000', count: 5 }], 5);
  });

  it('吸管拾取颜色并回调', () => {
    const { onColorChange, canvas } = setup();
    fireEvent.click(screen.getByRole('button', { name: /吸管/ }));
    pointer(canvas, 'pointerDown', { clientX: 25, clientY: 15 });
    expect(onColorChange).toHaveBeenCalledWith({ hex: '#FF0000', code: 'A' });
  });

  it('油漆桶填充连通区域', () => {
    const { onStatsChange, canvas } = setup();
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    expect(onStatsChange).toHaveBeenCalledWith([{ code: 'B', hex: '#0000FF', count: 6 }], 6);
  });

  it('快捷键 B/E/G/I 切换工具；Ctrl+Z 撤销恢复统计', () => {
    const { onStatsChange, canvas } = setup();
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
    expect(onStatsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ code: 'B', hex: '#0000FF', count: 1 }]),
      6,
    );
    const wrapper = canvas.parentElement!;
    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true });
    expect(onStatsChange).toHaveBeenLastCalledWith([{ code: 'A', hex: '#FF0000', count: 6 }], 6);
    fireEvent.keyDown(wrapper, { key: 'e' });
    expect(screen.getByRole('button', { name: /橡皮/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(wrapper, { key: 'g' });
    expect(screen.getByRole('button', { name: /油漆桶/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(wrapper, { key: 'i' });
    expect(screen.getByRole('button', { name: /吸管/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(wrapper, { key: 'b' });
    expect(screen.getByRole('button', { name: /画笔/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('方向键移动光标：状态行显示行列与色号', () => {
    const { canvas } = setup();
    const wrapper = canvas.parentElement!;
    // 未按键：显示提示文案
    expect(screen.getByText(/方向键移动光标/)).toBeTruthy();
    // 初始光标 (0,0) → 右移 → 第 1 行第 2 列，该格为红色 A
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    expect(screen.getByText(/光标：第 1 行 第 2 列 · A（回车落笔）/)).toBeTruthy();
    // 下移越界被钳制在最后一行（3×2 图纸 → 第 2 行）
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(screen.getByText(/光标：第 2 行 第 2 列/)).toBeTruthy();
  });

  it('回车在光标格落笔并上抛统计', () => {
    const { onStatsChange, canvas } = setup();
    const wrapper = canvas.parentElement!;
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' }); // 光标到 (0,1)
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    // (0,1) 红 A → 蓝 B：统计 A 5 / B 1
    expect(onStatsChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ code: 'B', hex: '#0000FF', count: 1 }]),
      6,
    );
  });

  it('点击画布后编辑区获得焦点（方向键立即可用）', () => {
    const { canvas } = setup();
    const wrapper = canvas.parentElement!;
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
    expect(document.activeElement).toBe(wrapper);
  });

  it('触屏长按 500ms 吸色（fake timers）', () => {
    vi.useFakeTimers();
    const { onColorChange, canvas } = setup();
    fireEvent.pointerDown(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    expect(onColorChange).toHaveBeenCalledWith({ hex: '#FF0000', code: 'A' });
    vi.useRealTimers();
  });

  it('触屏点按落笔（未达长按阈值）', () => {
    vi.useFakeTimers();
    const { onStatsChange, canvas } = setup();
    fireEvent.pointerDown(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    expect(onStatsChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ code: 'B', hex: '#0000FF', count: 1 }]),
      6,
    );
    vi.useRealTimers();
  });

  it('颜色替换：命中显示数量，未命中显示提示（E23）', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /颜色替换/ }));
    const from = screen.getByLabelText('原色号');
    fireEvent.change(from, { target: { value: 'A' } });
    const to = screen.getByLabelText('替换为');
    fireEvent.change(to, { target: { value: '0' } }); // 蓝色（palette[0]）
    fireEvent.click(screen.getByRole('button', { name: /执行替换/ }));
    expect(screen.getByText(/已替换 6 格/)).toBeTruthy();
    // 再执行一次 → 无 A 色号
    fireEvent.click(screen.getByRole('button', { name: /执行替换/ }));
    expect(screen.getByText('图中没有该色号，未做任何修改')).toBeTruthy();
  });

  it('清除全部：先确认弹窗，确认后统计为 0，撤销恢复（E24）', () => {
    const { onStatsChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /清除全部/ }));
    // 未确认前不清除
    expect(onStatsChange).not.toHaveBeenCalledWith([], 0);
    const dialog = screen.getByRole('dialog', { name: '清除全部' });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /确认清除/ }));
    expect(onStatsChange).toHaveBeenCalledWith([], 0);
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(onStatsChange).toHaveBeenLastCalledWith([{ code: 'A', hex: '#FF0000', count: 6 }], 6);
  });

  it('清除全部：取消确认不清除', () => {
    const { onStatsChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /清除全部/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onStatsChange).not.toHaveBeenCalled();
  });

  it('旋转：宽高互换上抛，撤销恢复原尺寸（优化票 09）', () => {
    const onPatternChange = vi.fn();
    setup(3, 2, { onPatternChange });
    fireEvent.click(screen.getByTitle('顺时针旋转 90°'));
    expect(onPatternChange).toHaveBeenCalledTimes(1);
    expect(onPatternChange).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2, height: 3 }),
    );
    // Ctrl+Z 撤销 → 恢复 3×2
    const wrapper = screen.getByLabelText(zhCN.editor.editorRegion);
    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true });
    const lastCall = onPatternChange.mock.calls[onPatternChange.mock.calls.length - 1][0] as Pattern;
    expect(lastCall.width).toBe(3);
    expect(lastCall.height).toBe(2);
  });

  it('镜像：尺寸不变、可撤销（优化票 09）', () => {
    const onPatternChange = vi.fn();
    setup(3, 2, { onPatternChange });
    fireEvent.click(screen.getByTitle('左右翻转'));
    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.width).toBe(3);
    expect(emitted.height).toBe(2);
    expect(onPatternChange).toHaveBeenCalledTimes(1);
  });
});
