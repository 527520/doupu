// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PixelEditorCanvas from './PixelEditorCanvas';
import { makeSolid } from '@/lib/editor/ops';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteColor, Pattern } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };
const GREEN: PaletteColor = { hex: '#00FF00', code: 'C' };

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
  it('移动端默认手形浏览，单指拖动画布不会修改图纸', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 35, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 35, clientY: 5 });
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('autoFocus 会在进入编辑时聚焦编辑画布区域', () => {
    const { canvas } = setup(3, 2, { autoFocus: true });
    expect(document.activeElement).toBe(canvas.parentElement);
  });

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

  it('快速拖动会插值连续笔画，pointercancel 会完整回滚且不提交', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(8, 1, { onPatternChange });
    pointer(canvas, 'pointerDown', { clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { clientX: 71, clientY: 1 });
    fireEvent.pointerCancel(canvas, { pointerType: 'mouse' });

    expect(onPatternChange).not.toHaveBeenCalled();

    pointer(canvas, 'pointerDown', { clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { clientX: 71, clientY: 1 });
    pointer(canvas, 'pointerUp', { clientX: 71, clientY: 1 });
    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.every((cell) => cell.code === 'B')).toBe(true);
  });

  it('外部图纸替换会终止旧连续笔迹，迟到的取消与撤销不会污染新图纸', () => {
    const onPatternChange = vi.fn();
    const palette = [BLUE, RED];
    const replacement: Pattern = {
      width: 3,
      height: 1,
      cells: Array.from({ length: 3 }, () => makeSolid(GREEN.hex, GREEN.code)),
    };
    const { rerender } = render(
      <PixelEditorCanvas
        pattern={patternOf(3, 1)}
        palette={palette}
        defaultCellPx={10}
        onPatternChange={onPatternChange}
      />,
    );
    const canvas = screen.getByLabelText('图纸编辑画布');

    pointer(canvas, 'pointerDown', { pointerId: 1, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 1, clientX: 11, clientY: 1 });
    rerender(
      <PixelEditorCanvas
        pattern={replacement}
        palette={palette}
        defaultCellPx={10}
        onPatternChange={onPatternChange}
      />,
    );
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'mouse' });

    pointer(canvas, 'pointerDown', { pointerId: 2, clientX: 21, clientY: 1 });
    pointer(canvas, 'pointerUp', { pointerId: 2, clientX: 21, clientY: 1 });
    expect((onPatternChange.mock.calls.at(-1)?.[0] as Pattern).cells.map((cell) => cell.code))
      .toEqual(['C', 'C', 'B']);

    fireEvent.keyDown(canvas.parentElement!, { key: 'z', ctrlKey: true });
    expect((onPatternChange.mock.calls.at(-1)?.[0] as Pattern).cells.map((cell) => cell.code))
      .toEqual(['C', 'C', 'C']);
  });

  it('外部图纸替换后旧 pointer 迟到的 cancel 不得回滚新 pointer 的笔迹', () => {
    const onPatternChange = vi.fn();
    const palette = [BLUE, RED];
    const replacement: Pattern = {
      width: 3,
      height: 1,
      cells: Array.from({ length: 3 }, () => makeSolid(GREEN.hex, GREEN.code)),
    };
    const { rerender } = render(
      <PixelEditorCanvas
        pattern={patternOf(3, 1)}
        palette={palette}
        defaultCellPx={10}
        onPatternChange={onPatternChange}
      />,
    );
    const canvas = screen.getByLabelText('图纸编辑画布');

    pointer(canvas, 'pointerDown', { pointerId: 1, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 1, clientX: 11, clientY: 1 });
    rerender(
      <PixelEditorCanvas
        pattern={replacement}
        palette={palette}
        defaultCellPx={10}
        onPatternChange={onPatternChange}
      />,
    );

    pointer(canvas, 'pointerDown', { pointerId: 2, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 2, clientX: 11, clientY: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'mouse' });
    pointer(canvas, 'pointerUp', { pointerId: 2, clientX: 11, clientY: 1 });

    expect(onPatternChange).toHaveBeenCalledTimes(1);
    expect((onPatternChange.mock.calls[0][0] as Pattern).cells.map((cell) => cell.code))
      .toEqual(['B', 'B', 'C']);
  });

  it('外部图纸替换后忽略旧连续笔迹的迟到松手，旧历史不可撤销到新图纸', () => {
    const onPatternChange = vi.fn();
    const palette = [BLUE, RED];
    const replacement: Pattern = {
      width: 3,
      height: 1,
      cells: Array.from({ length: 3 }, () => makeSolid(GREEN.hex, GREEN.code)),
    };
    const { rerender } = render(
      <PixelEditorCanvas pattern={patternOf(3, 1)} palette={palette} defaultCellPx={10} onPatternChange={onPatternChange} />,
    );
    const canvas = screen.getByLabelText('图纸编辑画布');

    pointer(canvas, 'pointerDown', { pointerId: 1, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 1, clientX: 11, clientY: 1 });
    rerender(
      <PixelEditorCanvas pattern={replacement} palette={palette} defaultCellPx={10} onPatternChange={onPatternChange} />,
    );
    pointer(canvas, 'pointerUp', { pointerId: 1, clientX: 11, clientY: 1 });
    fireEvent.keyDown(canvas.parentElement!, { key: 'z', ctrlKey: true });

    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('外部图纸替换后忽略旧精准候选的迟到松手', () => {
    const onPatternChange = vi.fn();
    const palette = [BLUE, RED];
    const replacement: Pattern = {
      width: 3,
      height: 1,
      cells: Array.from({ length: 3 }, () => makeSolid(GREEN.hex, GREEN.code)),
    };
    const { rerender } = render(
      <PixelEditorCanvas
        pattern={patternOf(3, 1)}
        palette={palette}
        defaultCellPx={10}
        layout="mobile"
        onPatternChange={onPatternChange}
      />,
    );
    const canvas = screen.getByLabelText('图纸编辑画布');
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 1 });
    rerender(
      <PixelEditorCanvas
        pattern={replacement}
        palette={palette}
        defaultCellPx={10}
        layout="mobile"
        onPatternChange={onPatternChange}
      />,
    );
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 1 });

    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('可搜索选择未出现在图纸中的色板颜色', () => {
    const green: PaletteColor = { hex: '#00FF00', code: 'C99' };
    const onColorChange = vi.fn();
    setup(3, 2, { palette: [BLUE, RED, green], onColorChange });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索色板颜色' }), {
      target: { value: 'C99' },
    });
    fireEvent.click(screen.getByRole('button', { name: /C99/ }));

    expect(onColorChange).toHaveBeenLastCalledWith(green);
  });

  it('不可采购的无色号颜色不会出现在托盘、画笔或替换目标中', () => {
    const unavailable: PaletteColor = { hex: '#123456', code: null };
    const onColorChange = vi.fn();
    setup(3, 2, { palette: [unavailable, BLUE], onColorChange });

    expect(screen.queryByRole('button', { name: /#123456/ })).toBeNull();
    expect(screen.getByRole('button', { name: /B #0000FF/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /颜色替换/ }));
    expect(screen.getByLabelText('替换为')).toHaveTextContent('B');
    expect(screen.getByLabelText('替换为')).not.toHaveTextContent('#123456');
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
    pointer(canvas, 'pointerUp', { clientX: 25, clientY: 15 });
    expect(onColorChange).toHaveBeenCalledWith({ hex: '#FF0000', code: 'A' });
  });

  it('油漆桶填充连通区域', () => {
    const { onStatsChange, canvas } = setup();
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
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
    expect(screen.getByRole('button', { name: '画笔' }).getAttribute('aria-pressed')).toBe('true');
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

  it('橡皮模式下回车清空光标格', () => {
    const { onStatsChange, canvas } = setup();
    const wrapper = canvas.parentElement!;
    fireEvent.click(screen.getByRole('button', { name: /橡皮/ }));
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(onStatsChange).toHaveBeenCalledWith([{ code: 'A', hex: '#FF0000', count: 5 }], 5);
  });

  it('油漆桶模式下回车填充光标所在连通区域', () => {
    const { onStatsChange, canvas } = setup();
    const wrapper = canvas.parentElement!;
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(onStatsChange).toHaveBeenCalledWith([{ code: 'B', hex: '#0000FF', count: 6 }], 6);
  });

  it('吸管模式下回车拾取光标格颜色且不改图纸', () => {
    const onPatternChange = vi.fn();
    const { onColorChange, canvas } = setup(3, 2, { onPatternChange });
    const wrapper = canvas.parentElement!;
    fireEvent.click(screen.getByRole('button', { name: /吸管/ }));
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(onColorChange).toHaveBeenLastCalledWith(RED);
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('点击画布后编辑区获得焦点（方向键立即可用）', () => {
    const { canvas } = setup();
    const wrapper = canvas.parentElement!;
    pointer(canvas, 'pointerDown', { clientX: 0, clientY: 0 });
    pointer(canvas, 'pointerUp', { clientX: 0, clientY: 0 });
    expect(document.activeElement).toBe(wrapper);
  });

  it('画布接管触控手势，并通过明确的手形模式浏览', () => {
    const { canvas } = setup();
    expect(canvas).toHaveStyle({ touchAction: 'none' });
    expect(screen.getByRole('button', { name: /手形/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('触屏按住显示 7×7 放大镜，不再触发长按吸色', () => {
    const { onColorChange, canvas } = setup();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
    expect(screen.getByLabelText(/第 1 行，第 1 列，A/)).toBeTruthy();
    expect(onColorChange).not.toHaveBeenCalledWith(RED);
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
  });

  it('触屏点按落笔', () => {
    const { onStatsChange, canvas } = setup();
    fireEvent.pointerDown(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerType: 'touch', clientX: 5, clientY: 5 });
    expect(onStatsChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ code: 'B', hex: '#0000FF', count: 1 }]),
      6,
    );
  });

  it('桌面布局收到触摸拖动时仍默认精准落笔，只修改松手格', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { onPatternChange });

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });

    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.map((cell) => cell.code)).toEqual(['A', 'A', 'A', 'B']);
  });

  it('移动端画笔默认精准模式，拖动只在松手的最终格落笔', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });

    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.map((cell) => cell.code)).toEqual(['A', 'A', 'A', 'B']);
  });

  it('移动端可切换连续模式，快速拖动保持连续插值', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByRole('button', { name: '精准模式' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '连续模式' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });

    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.map((cell) => cell.code)).toEqual(['A', 'B', 'B', 'B']);
  });

  it('移动布局的精准开关只约束触摸，鼠标拖动仍连续绘制', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByRole('button', { name: '精准模式' })).toHaveAttribute('aria-pressed', 'true');

    pointer(canvas, 'pointerDown', { pointerId: 1, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 1, clientX: 31, clientY: 1 });
    pointer(canvas, 'pointerUp', { pointerId: 1, clientX: 31, clientY: 1 });

    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.map((cell) => cell.code)).toEqual(['A', 'B', 'B', 'B']);
  });

  it('移动端连续模式一旦越界会回滚整条未提交笔迹', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    fireEvent.click(screen.getByRole('button', { name: '连续模式' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 500 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });

    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('移动端连续模式在图内拖动后直接于图外松手也会回滚', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    fireEvent.click(screen.getByRole('button', { name: '连续模式' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 500 });

    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('第二根手指加入时完整回滚未提交笔迹', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { onPatternChange });
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 1 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 36, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 36, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 1 });
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('油漆桶拖动对准后在松手的最终格填充', () => {
    const onPatternChange = vi.fn();
    const pattern: Pattern = {
      width: 3,
      height: 1,
      cells: [makeSolid(BLUE.hex, BLUE.code), makeSolid(RED.hex, RED.code), makeSolid(RED.hex, RED.code)],
    };
    const { canvas } = setup(3, 1, { pattern, onPatternChange, layout: 'mobile', defaultCellPx: 20 });
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 1 });
    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.every((cell) => cell.code === 'B')).toBe(true);
  });

  it('桌面油漆桶拖动仍按点击语义取消，不在松手格执行破坏性填充', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(3, 1, { onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: /油漆桶/ }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 21, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 21, clientY: 1 });
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('吸管拖动时跟随放大镜目标，松手吸取最终格', () => {
    const pattern: Pattern = {
      width: 2,
      height: 1,
      cells: [makeSolid(RED.hex, RED.code), makeSolid(BLUE.hex, BLUE.code)],
    };
    const { onColorChange, canvas } = setup(2, 1, { pattern, layout: 'mobile', defaultCellPx: 20 });
    fireEvent.click(screen.getByRole('button', { name: /吸管/ }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 1 });
    expect(screen.getByLabelText(/第 1 行，第 2 列，B/)).toBeTruthy();
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    expect(onColorChange).toHaveBeenLastCalledWith(BLUE);
  });

  it('吸取透明或无色格保留当前颜色并明确提示', () => {
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: null, code: null, transparent: true }],
    };
    const { onColorChange, canvas } = setup(1, 1, { pattern, layout: 'mobile', defaultCellPx: 20 });
    fireEvent.click(screen.getByRole('button', { name: /吸管/ }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });

    expect(onColorChange).not.toHaveBeenCalledWith(null);
    expect(screen.getByText('该格没有可吸取颜色，已保留当前颜色')).toBeTruthy();
    expect(screen.getByRole('status', { name: '当前颜色: B' })).toBeTruthy();
  });

  it('精准模式手指越界后即使返回图纸也取消本次落笔', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(3, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 500 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 1 });
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('精准落笔在 pointercancel 或工具切换时不提交', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(3, 1, { layout: 'mobile', onPatternChange });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 11, clientY: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'touch' });
    expect(onPatternChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 11, clientY: 1 });
    fireEvent.click(screen.getByRole('button', { name: '橡皮' }));
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 11, clientY: 1 });
    expect(onPatternChange).not.toHaveBeenCalled();
  });

  it('吸管对准期间加入第二指会取消，不改变当前颜色', () => {
    const { onColorChange, canvas } = setup(3, 1, { layout: 'mobile', defaultCellPx: 20 });
    fireEvent.click(screen.getByRole('button', { name: /吸管/ }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 11, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 11, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    expect(onColorChange).not.toHaveBeenCalledWith(RED);
    expect(screen.getByRole('status', { name: '当前颜色: B' })).toBeTruthy();
  });

  it('pinch 只被参与该手势的 pointer cancel 终止', () => {
    const { canvas } = setup(20, 1, { layout: 'mobile', defaultCellPx: 10 });
    const scale = screen.getByLabelText('当前格子大小');

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 21, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 41, clientY: 1 });
    expect(scale).toHaveTextContent('20px');

    fireEvent.pointerCancel(canvas, { pointerId: 99, pointerType: 'touch' });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 61, clientY: 1 });
    expect(scale).toHaveTextContent('30px');

    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 81, clientY: 1 });
    expect(scale).toHaveTextContent('30px');
  });

  it('活跃笔迹上的撤销只取消本次未提交操作，不会额外撤销上一笔', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(3, 1, { onPatternChange });
    const wrapper = canvas.parentElement!;

    pointer(canvas, 'pointerDown', { pointerId: 1, clientX: 1, clientY: 1 });
    pointer(canvas, 'pointerUp', { pointerId: 1, clientX: 1, clientY: 1 });
    expect(onPatternChange).toHaveBeenCalledTimes(1);

    pointer(canvas, 'pointerDown', { pointerId: 2, clientX: 11, clientY: 1 });
    pointer(canvas, 'pointerMove', { pointerId: 2, clientX: 21, clientY: 1 });
    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true });
    expect(onPatternChange).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true });
    const reverted = onPatternChange.mock.calls.at(-1)?.[0] as Pattern;
    expect(reverted.cells.every((cell) => cell.code === 'A')).toBe(true);
  });

  it('手机选择编辑工具时自动放大到单格至少 20px', () => {
    setup(40, 40, { layout: 'mobile' });
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByLabelText('当前格子大小')).toHaveTextContent('20px');
    expect(screen.getByText('已放大到可编辑比例')).toBeTruthy();
  });

  it('触屏拖动在同格超过阈值也会落下首格', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(3, 1, { onPatternChange });
    fireEvent.pointerDown(canvas, { pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerType: 'touch', clientX: 8, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerType: 'touch', clientX: 8, clientY: 1 });
    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells[0].code).toBe('B');
  });

  it('触屏快速跨格拖动默认只修改松手格', () => {
    const onPatternChange = vi.fn();
    const { canvas } = setup(4, 1, { onPatternChange });
    fireEvent.pointerDown(canvas, { pointerType: 'touch', clientX: 1, clientY: 1 });
    fireEvent.pointerMove(canvas, { pointerType: 'touch', clientX: 31, clientY: 1 });
    fireEvent.pointerUp(canvas, { pointerType: 'touch', clientX: 31, clientY: 1 });
    const emitted = onPatternChange.mock.calls[0][0] as Pattern;
    expect(emitted.cells.map((cell) => cell.code)).toEqual(['A', 'A', 'A', 'B']);
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
