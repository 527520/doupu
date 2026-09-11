import { describe, expect, it, vi } from 'vitest';
import { drawPattern } from './draw';
import type { Pattern } from '@/lib/types';

describe('drawPattern', () => {
  it('merges adjacent cells with the same rendered color into one row run', () => {
    const fillRect = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D;
    const pattern: Pattern = {
      width: 3,
      height: 2,
      cells: Array.from({ length: 6 }, () => ({
        hex: '#112233',
        code: 'A1',
        transparent: false,
      })),
    };

    drawPattern(context, pattern, {
      cellPx: 1,
      showGrid: false,
      showSeams: false,
      showLabels: false,
    });

    expect(fillRect.mock.calls).toEqual([
      [0, 0, 3, 1],
      [0, 1, 3, 1],
    ]);
  });

  it('uses the selected board size for seam placement', () => {
    const moveTo = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const pattern: Pattern = {
      width: 101,
      height: 1,
      cells: Array.from({ length: 101 }, () => ({
        hex: '#112233',
        code: 'A1',
        transparent: false,
      })),
    };

    drawPattern(context, pattern, {
      cellPx: 2,
      showGrid: false,
      showSeams: true,
      showLabels: false,
      boardSize: 50,
    });

    expect(moveTo).toHaveBeenCalledWith(100, 0);
    expect(moveTo).toHaveBeenCalledWith(200, 0);
  });

  it('cells 阶段只填色，overlay 阶段才画板缝', () => {
    const fillRect = vi.fn();
    const beginPath = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
      beginPath,
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const pattern: Pattern = {
      width: 2,
      height: 1,
      cells: [
        { hex: '#112233', code: 'A1', transparent: false },
        { hex: '#112233', code: 'A1', transparent: false },
      ],
    };
    const base = { cellPx: 2, showGrid: false, showSeams: true, showLabels: false, boardSize: 1 };

    drawPattern(context, pattern, { ...base, phase: 'cells' });
    expect(fillRect).toHaveBeenCalledWith(0, 0, 4, 2);
    expect(beginPath).not.toHaveBeenCalled();

    drawPattern(context, pattern, { ...base, phase: 'overlay' });
    expect(beginPath).toHaveBeenCalled();
  });

  it('node 环境没有 document 时，大图纸回退到 fillRect', () => {
    const fillRect = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D;
    const pattern: Pattern = {
      width: 50,
      height: 50,
      cells: Array.from({ length: 2500 }, () => ({
        hex: '#112233',
        code: 'A1',
        transparent: false,
      })),
    };

    drawPattern(context, pattern, {
      cellPx: 2,
      showGrid: false,
      showSeams: false,
      showLabels: false,
    });

    expect(fillRect).toHaveBeenCalled();
  });
});
