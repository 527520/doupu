// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PatternPreview from './PatternPreview';
import type { Pattern } from '@/lib/types';

const pattern: Pattern = {
  width: 3,
  height: 2,
  cells: [
    { hex: '#000000', code: 'A', transparent: false },
    { hex: '#FFFFFF', code: 'B', transparent: false },
    { hex: '#FF0000', code: 'C', transparent: false },
    { hex: '#00FF00', code: 'D', transparent: false },
    { hex: '#0000FF', code: 'E', transparent: false },
    { hex: null, code: null, transparent: true },
  ],
};

describe('PatternPreview', () => {
  it('渲染缩放与开关控件', () => {
    render(<PatternPreview pattern={pattern} defaultCellPx={10} />);
    expect(screen.getByLabelText('缩放')).toBeTruthy();
    expect(screen.getByText('网格线')).toBeTruthy();
    expect(screen.getByText('板缝线')).toBeTruthy();
    expect(screen.getByText('色号标注')).toBeTruthy();
  });

  it('缩放按钮受 [50%,1600%] 钳制', () => {
    render(<PatternPreview pattern={pattern} defaultCellPx={10} />);
    const zoomLabel = screen.getByLabelText('缩放');
    const minus = screen.getByText('−');
    const plus = screen.getByText('+');
    for (let i = 0; i < 20; i++) fireEvent.click(minus);
    expect(zoomLabel.textContent).toBe('50%');
    for (let i = 0; i < 20; i++) fireEvent.click(plus);
    expect(zoomLabel.textContent).toBe('1600%');
  });

  it('悬停发出格子信息（桌面指针移动）', () => {
    const onHover = vi.fn();
    render(<PatternPreview pattern={pattern} defaultCellPx={10} onCellHover={onHover} />);
    const canvas = document.querySelector('canvas')!;
    fireEvent.pointerMove(canvas, { clientX: 0, clientY: 0, pointerType: 'mouse' });
    expect(onHover).toHaveBeenCalledWith({ row: 0, col: 0, cell: pattern.cells[0] });
    fireEvent.pointerLeave(canvas);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('开关切换改变复选框状态', () => {
    render(<PatternPreview pattern={pattern} defaultCellPx={10} />);
    const grid = screen.getByText('网格线').querySelector('input')!;
    expect(grid.checked).toBe(true);
    fireEvent.click(grid);
    expect(grid.checked).toBe(false);
  });

  it('透明格悬停信息 cell 为透明格', () => {
    const onHover = vi.fn();
    render(<PatternPreview pattern={pattern} defaultCellPx={10} onCellHover={onHover} />);
    const canvas = document.querySelector('canvas')!;
    // 最后一格（row 1 col 2）：x=20..30, y=10..20
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 15, pointerType: 'mouse' });
    expect(onHover).toHaveBeenCalledWith(
      expect.objectContaining({ row: 1, col: 2, cell: expect.objectContaining({ transparent: true }) }),
    );
  });
});
