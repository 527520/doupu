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

function setup(progress: StitchProgress = createStitchProgress(3, 2)) {
  const onChange = vi.fn();
  const view = render(<StitchView pattern={pattern} progress={progress} onChange={onChange} />);
  return { onChange, view };
}

describe('StitchView', () => {
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
