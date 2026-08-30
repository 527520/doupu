// @vitest-environment jsdom
/**
 * 跟拼视图（G-1/G-2）：标记、整行操作、坐标与进度播报、清空确认。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StitchView from './StitchView';
import { zhCN } from '@/messages/zh-CN';
import { createStitchProgress, setRowDone, type StitchProgress } from '@/lib/progress/stitchProgress';
import type { Pattern } from '@/lib/types';

const pattern: Pattern = {
  width: 3,
  height: 2,
  cells: [
    { hex: '#FF0000', code: 'A1', transparent: false },
    { hex: '#00FF00', code: 'B2', transparent: false },
    { hex: '#0000FF', code: 'C3', transparent: false },
    { hex: '#FFFF00', code: 'D4', transparent: false },
    { hex: '#FF00FF', code: 'E5', transparent: false },
    { hex: null, code: null, transparent: true },
  ],
};

function solidPattern(width: number, height: number): Pattern {
  return {
    width,
    height,
    cells: Array.from({ length: width * height }, () => ({
      hex: '#FF0000',
      code: 'A1',
      transparent: false,
    })),
  };
}

function setup(
  progress: StitchProgress = createStitchProgress(3, 2),
  currentPattern: Pattern = pattern,
  boardSize?: number,
) {
  const onChange = vi.fn();
  const view = render(
    <StitchView
      pattern={currentPattern}
      progress={progress}
      onChange={onChange}
      boardSize={boardSize}
      testCellPx={20}
    />,
  );
  return { onChange, view };
}

describe('StitchView', () => {
  it('按下只进入待确认状态，短点释放后才标记一格', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('拖动超过阈值只浏览，不修改跟拼进度', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 30, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 30, clientY: 10 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('斜向拖动超过阈值也只平移，不修改跟拼进度', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });

    fireEvent.pointerDown(canvas, { pointerId: 21, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 21, pointerType: 'touch', clientX: 24, clientY: 24 });
    fireEvent.pointerUp(canvas, { pointerId: 21, pointerType: 'touch', clientX: 24, clientY: 24 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('第二根手指介入后只缩放和平移，不提交候选格', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });

    fireEvent.pointerDown(canvas, { pointerId: 31, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerDown(canvas, { pointerId: 32, pointerType: 'touch', clientX: 30, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 32, pointerType: 'touch', clientX: 42, clientY: 18 });
    fireEvent.pointerUp(canvas, { pointerId: 32, pointerType: 'touch', clientX: 42, clientY: 18 });
    fireEvent.pointerUp(canvas, { pointerId: 31, pointerType: 'touch', clientX: 10, clientY: 10 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('pointercancel 取消待确认点按，即使随后收到 pointerup 也零写入', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });

    fireEvent.pointerDown(canvas, { pointerId: 41, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(canvas, { pointerId: 41, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 41, pointerType: 'touch', clientX: 10, clientY: 10 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('播报进度：透明格不计入分母', () => {
    setup();
    // 6 格里 5 格需要拼
    expect(screen.getByText(zhCN.stitch.progress(0, 5, 0))).toBeTruthy();
  });

  it('已拼数量与百分比随进度更新', () => {
    setup(setRowDone(createStitchProgress(3, 2), 0, true));
    expect(screen.getByText(zhCN.stitch.progress(3, 5, 60))).toBeTruthy();
  });

  it('整行标记会上抛新进度，并把当前行推进到下一行', () => {
    const { onChange } = setup();
    expect(screen.getByText(zhCN.stitch.rowLabel(1, 2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.markRowDone }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as StitchProgress;
    expect([...next.done]).toEqual([1, 1, 1, 0, 0, 0]);
    expect(screen.getByText(zhCN.stitch.rowLabel(2, 2))).toBeTruthy();
  });

  it('完成本行只修改当前 29×29 板内的局部行', () => {
    const widePattern = solidPattern(58, 1);
    const { onChange } = setup(createStitchProgress(58, 1), widePattern);

    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.markRowDone }));

    const next = onChange.mock.calls[0][0] as StitchProgress;
    expect([...next.done.slice(0, 29)]).toEqual(Array.from({ length: 29 }, () => 1));
    expect([...next.done.slice(29)]).toEqual(Array.from({ length: 29 }, () => 0));
  });

  it('2.6mm / 50×50 规格只完成当前 50 格板内的局部行', () => {
    const widePattern = solidPattern(100, 1);
    const { onChange } = setup(createStitchProgress(100, 1), widePattern, 50);

    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.markRowDone }));

    const next = onChange.mock.calls[0][0] as StitchProgress;
    expect([...next.done.slice(0, 50)]).toEqual(Array.from({ length: 50 }, () => 1));
    expect([...next.done.slice(50)]).toEqual(Array.from({ length: 50 }, () => 0));
    expect(screen.getByText(zhCN.stitch.boardLabel(2, 2))).toBeTruthy();
  });

  it('当前板最后一条有效行完成后推进到右侧下一板', () => {
    const widePattern = solidPattern(58, 1);
    setup(createStitchProgress(58, 1), widePattern);

    expect(screen.getByText(zhCN.stitch.boardLabel(1, 2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.markRowDone }));

    expect(screen.getByText(zhCN.stitch.boardLabel(2, 2))).toBeTruthy();
    expect(screen.getByText(zhCN.stitch.localRowLabel(1))).toBeTruthy();
  });

  it('撤销恢复上一份跟拼进度并再次上抛', () => {
    const { onChange } = setup();
    const canvas = screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) });
    fireEvent.pointerDown(canvas, { pointerId: 51, pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 51, pointerType: 'mouse', clientX: 10, clientY: 10 });

    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.undo }));

    expect(onChange).toHaveBeenCalledTimes(2);
    const restored = onChange.mock.calls[1][0] as StitchProgress;
    expect([...restored.done]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('重新进入时根据已有进度定位到首个未完成板块与格子', () => {
    const widePattern = solidPattern(58, 1);
    const restored = createStitchProgress(58, 1);
    restored.done.fill(1, 0, 30);

    setup(restored, widePattern);

    expect(screen.getByText(zhCN.stitch.boardLabel(2, 2))).toBeTruthy();
    expect(screen.getByText(zhCN.stitch.localRowLabel(1))).toBeTruthy();
    expect(screen.getByText(zhCN.stitch.colCoordinate(31))).toBeTruthy();
  });

  it('制作规格变化后按同一格重新计算板号，不保留越界旧板号', async () => {
    const widePattern = solidPattern(100, 1);
    const restored = createStitchProgress(100, 1);
    restored.done.fill(1, 0, 87);
    const { onChange, view } = setup(restored, widePattern, 29);

    expect(screen.getByText(zhCN.stitch.boardLabel(4, 4))).toBeTruthy();
    expect(screen.getByText(zhCN.stitch.colCoordinate(88))).toBeTruthy();

    view.rerender(
      <StitchView
        pattern={widePattern}
        progress={restored}
        onChange={onChange}
        boardSize={50}
        testCellPx={20}
      />,
    );

    await waitFor(() => expect(screen.getByText(zhCN.stitch.boardLabel(2, 2))).toBeTruthy());
    expect(screen.getByText(zhCN.stitch.colCoordinate(88))).toBeTruthy();
  });

  it('图纸缩小时把焦点钳制到新边界并重新计算板内坐标', async () => {
    const widePattern = solidPattern(100, 1);
    const restored = createStitchProgress(100, 1);
    restored.done.fill(1, 0, 87);
    const { onChange, view } = setup(restored, widePattern, 29);

    const smallPattern = solidPattern(20, 1);
    const smallProgress = createStitchProgress(20, 1);
    view.rerender(
      <StitchView
        pattern={smallPattern}
        progress={smallProgress}
        onChange={onChange}
        boardSize={29}
        testCellPx={20}
      />,
    );

    await waitFor(() => expect(screen.getByText(zhCN.stitch.boardLabel(1, 1))).toBeTruthy());
    expect(screen.getByText(zhCN.stitch.colCoordinate(20))).toBeTruthy();
    expect(screen.getByText(zhCN.stitch.localRowLabel(1))).toBeTruthy();
  });

  it('上一行/下一行不会越界', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.prevRow }));
    expect(screen.getByText(zhCN.stitch.rowLabel(1, 2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.nextRow }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.nextRow }));
    expect(screen.getByText(zhCN.stitch.rowLabel(2, 2))).toBeTruthy();
  });

  it('画布对读屏可见，含尺寸与完成百分比', () => {
    setup();
    expect(screen.getByRole('img', { name: zhCN.stitch.canvasAria(3, 2, 0) })).toBeTruthy();
  });

  it('全部拼完给出完成提示', () => {
    let progress = setRowDone(createStitchProgress(3, 2), 0, true);
    progress = setRowDone(progress, 1, true);
    setup(progress);
    expect(screen.getByText(zhCN.stitch.finished)).toBeTruthy();
  });

  it('清空进度需要确认；取消则不动进度', async () => {
    const { onChange } = setup(setRowDone(createStitchProgress(3, 2), 0, true));
    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.reset }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.common.cancel }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: zhCN.stitch.reset }));
    const confirmButton = await screen.findByRole('button', { name: zhCN.stitch.resetAction });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const cleared = onChange.mock.calls[0][0] as StitchProgress;
    expect([...cleared.done].every((value) => value === 0)).toBe(true);
  });
});
