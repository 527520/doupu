// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPngBlob } from './png';
import type { Pattern } from '@/lib/types';

afterEach(() => vi.restoreAllMocks());

describe('exportPngBlob 真实布局路径', () => {
  it('20 字符色号使用单元格内宽度绘制，不覆盖相邻格', async () => {
    const fillText = vi.fn();
    const noop = vi.fn();
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'fillText') return fillText;
        if (typeof prop === 'string' && ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke'].includes(prop)) return noop;
        return Reflect.get(target, prop);
      },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const code = 'ABCDEFGHIJKLMNOPQRST';
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: '#000000', code, transparent: false }],
    };

    await exportPngBlob(pattern, '长色号', { cellPx: 24 });

    expect(fillText).toHaveBeenCalledWith(code, 12, 12, 22);
  });

  it('200×1 长色号图例换行，Canvas 不超过跨浏览器安全宽度', async () => {
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 20 });
        if (prop === 'fillText' || prop === 'fillRect' || prop === 'strokeRect') return vi.fn();
        if (prop === 'beginPath' || prop === 'moveTo' || prop === 'lineTo' || prop === 'stroke') return vi.fn();
        return Reflect.get(target, prop);
      },
      set() {
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    let encodedSize = { width: 0, height: 0 };
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      encodedSize = { width: this.width, height: this.height };
      callback(new Blob(['png'], { type: 'image/png' }));
    };

    const pattern: Pattern = {
      width: 200,
      height: 1,
      cells: Array.from({ length: 200 }, (_, index) => ({
        hex: `#${index.toString(16).padStart(6, '0')}`,
        code: '中'.repeat(20),
        transparent: false,
      })),
    };
    const result = await exportPngBlob(pattern, '极限图纸', { cellPx: 48, includeLegend: true });
    expect(result.ok).toBe(true);
    expect(encodedSize.width).toBeLessThanOrEqual(65_535);
    expect(encodedSize.height).toBeGreaterThan(48);
  });

  it('超过像素上限时在编码前返回类型化错误', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    const pattern: Pattern = {
      width: 200,
      height: 200,
      cells: Array.from({ length: 40_000 }, () => ({ hex: '#000000', code: 'A01', transparent: false })),
    };
    await expect(exportPngBlob(pattern, '超大图纸', { cellPx: 48 }))
      .resolves.toEqual({ ok: false, code: 'CANVAS_TOO_LARGE' });
    expect(createElement).not.toHaveBeenCalledWith('canvas');
  });

  it('图例文本按行排在图纸下方的精确坐标', async () => {
    const fillText = vi.fn();
    const noop = vi.fn();
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'measureText') return () => ({ width: 80 });
        if (prop === 'fillText') return fillText;
        if (typeof prop === 'string' && ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke'].includes(prop)) return noop;
        return Reflect.get(target, prop);
      },
      set() {
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const pattern: Pattern = {
      width: 2,
      height: 1,
      cells: [
        { hex: '#000000', code: 'A', transparent: false },
        { hex: '#ffffff', code: 'B', transparent: false },
      ],
    };
    await exportPngBlob(pattern, '坐标', { cellPx: 48, includeLegend: true });
    const legendCalls = fillText.mock.calls.filter(([text]) => String(text).includes('×'));
    expect(legendCalls).toEqual([
      ['A × 1', 56, 91],
      ['B × 1', 56, 145],
    ]);
  });
});
