// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { drawPattern } from './draw';
import type { Pattern } from '@/lib/types';

class ImageDataStub {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

function withImageData<T>(run: () => T): T {
  const previous = globalThis.ImageData;
  if (typeof ImageData === 'undefined') {
    globalThis.ImageData = ImageDataStub as unknown as typeof ImageData;
  }
  try {
    return run();
  } finally {
    if (previous) globalThis.ImageData = previous;
    else delete (globalThis as { ImageData?: typeof ImageData }).ImageData;
  }
}

function solidPattern(overrides: Array<{
  hex?: string;
  code?: string;
  transparent?: boolean;
  external?: boolean;
}> = []): Pattern {
  const cells = Array.from({ length: 2500 }, () => ({
    hex: '#112233',
    code: 'A1',
    transparent: false,
  }));
  for (const [index, cell] of overrides.entries()) {
    if (cell) cells[index] = { ...cells[index], ...cell };
  }
  return { width: 50, height: 50, cells };
}

describe('drawPattern ImageData 路径', () => {
  it('格子足够多时走 ImageData blit，不再逐格 fillRect', () => {
    withImageData(() => {
      const fillRect = vi.fn();
      const drawImage = vi.fn();
      const context = {
        clearRect: vi.fn(),
        fillRect,
        drawImage,
        imageSmoothingEnabled: true,
      } as unknown as CanvasRenderingContext2D;

      drawPattern(context, solidPattern([
        { transparent: true },
        { hex: '#gg0000' },
        { hex: '#445566', external: true },
      ]), {
        cellPx: 2,
        showGrid: false,
        showSeams: false,
        showLabels: false,
      });

      expect(fillRect).not.toHaveBeenCalled();
      expect(drawImage).toHaveBeenCalledTimes(1);
    });
  });

  it('离屏 canvas 拿不到 2d 上下文时回退 fillRect', () => {
    withImageData(() => {
      const realCreate = document.createElement.bind(document);
      const spy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        const element = realCreate(tagName, options as ElementCreationOptions);
        if (String(tagName).toLowerCase() === 'canvas') {
          (element as HTMLCanvasElement).getContext = () => null;
        }
        return element;
      });
      try {
        const fillRect = vi.fn();
        drawPattern(
          { clearRect: vi.fn(), fillRect } as unknown as CanvasRenderingContext2D,
          solidPattern(),
          { cellPx: 2, showGrid: false, showSeams: false, showLabels: false },
        );
        expect(fillRect).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('大图纸网格用 createPattern 铺瓷砖，而不是逐条 stroke', () => {
    withImageData(() => {
      const fillRect = vi.fn();
      const createPattern = vi.fn(() => ({} as CanvasPattern));
      const moveTo = vi.fn();
      drawPattern(
        {
          clearRect: vi.fn(),
          fillRect,
          createPattern,
          beginPath: vi.fn(),
          moveTo,
          lineTo: vi.fn(),
          stroke: vi.fn(),
          imageSmoothingEnabled: true,
        } as unknown as CanvasRenderingContext2D,
        solidPattern(),
        { cellPx: 4, showGrid: true, showSeams: false, showLabels: false, phase: 'overlay' },
      );
      expect(createPattern).toHaveBeenCalled();
      expect(fillRect).toHaveBeenCalled();
    });
  });
});
