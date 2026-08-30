// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pattern } from '@/lib/types';
import { renderThumbnail } from './index';

afterEach(() => vi.restoreAllMocks());

describe('renderThumbnail 制作规格板缝', () => {
  it.each([
    { boardSize: 50, seams: [500, 1000], foreignSeam: 520 },
    { boardSize: 52, seams: [520, 1040], foreignSeam: 500 },
  ])('按 $boardSize×$boardSize 参数绘制可观察板缝', ({ boardSize, seams, foreignSeam }) => {
    const moveTo = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,dGh1bWI=');
    const pattern: Pattern = {
      width: 105,
      height: 1,
      cells: Array.from({ length: 105 }, () => ({
        hex: '#112233',
        code: 'A01',
        transparent: false,
      })),
    };

    const result = renderThumbnail(pattern, 1050, boardSize);

    expect(result).toBe('data:image/png;base64,dGh1bWI=');
    for (const seam of seams) expect(moveTo).toHaveBeenCalledWith(seam, 0);
    expect(moveTo).not.toHaveBeenCalledWith(foreignSeam, 0);
  });
});
