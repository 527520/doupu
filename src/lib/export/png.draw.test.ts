// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPngBlob } from './png';
import type { Pattern } from '@/lib/types';

afterEach(() => vi.restoreAllMocks());

describe('exportPngBlob 真实布局路径', () => {
  it('先用纯白色铺满整个画布，透明格、外部格与图例间隙都保持不透明', async () => {
    const fills: Array<{ fillStyle: string; args: number[] }> = [];
    let fillStyle = '';
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'fillStyle') return fillStyle;
        if (prop === 'fillRect') return (...args: number[]) => fills.push({ fillStyle, args });
        if (prop === 'measureText') return () => ({ width: 60 });
        if (typeof prop === 'string' && ['strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].includes(prop)) return vi.fn();
        return Reflect.get(target, prop);
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = String(value);
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const pattern: Pattern = {
      width: 3,
      height: 1,
      cells: [
        { hex: '#112233', code: 'A01', transparent: false },
        { hex: null, code: null, transparent: true },
        { hex: '#445566', code: null, transparent: false, external: true },
      ],
    };

    const result = await exportPngBlob(pattern, '不透明', {
      cellPx: 8,
      cropToContent: false,
      includeLegend: true,
    });

    expect(result.ok).toBe(true);
    expect(fills[0]).toEqual({ fillStyle: '#ffffff', args: [0, 0, 960, expect.any(Number)] });
  });

  it('8px 图纸也用至少 16px 的独立图例正文与至少 24px 色块', async () => {
    const fonts: string[] = [];
    const swatches: Array<number[]> = [];
    let fillStyle = '';
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'fillStyle') return fillStyle;
        if (prop === 'measureText') return () => ({ width: 80 });
        if (prop === 'fillRect') return (...args: number[]) => {
          if (fillStyle === '#123456') swatches.push(args);
        };
        if (typeof prop === 'string' && ['strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].includes(prop)) return vi.fn();
        return Reflect.get(target, prop);
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = String(value);
        if (prop === 'font') fonts.push(String(value));
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: '#123456', code: 'A01', transparent: false }],
    };

    await exportPngBlob(pattern, '图例', { cellPx: 8, includeLegend: true });

    expect(fonts.some((font) => /16px/.test(font))).toBe(true);
    expect(swatches.some(([, , width, height]) => width >= 24 && height >= 24)).toBe(true);
  });

  it('合并超限时返回图纸与图例两张可编码 PNG，而不是缩小图例', async () => {
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 18 });
        if (typeof prop === 'string' && ['fillText', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke'].includes(prop)) return vi.fn();
        return Reflect.get(target, prop);
      },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob([`${this.width}x${this.height}`], { type: 'image/png' }));
    };
    const pattern: Pattern = {
      width: 200,
      height: 200,
      cells: Array.from({ length: 40_000 }, (_, index) => {
        const color = index % 500;
        return {
          hex: `#${(color + 1).toString(16).padStart(6, '0')}`,
          code: `LONG-COLOR-${color.toString().padStart(9, '0')}`,
          transparent: false,
        };
      }),
    };

    const result = await exportPngBlob(pattern, '超限拆分', {
      cellPx: 20,
      cropToContent: false,
      includeLegend: true,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'split',
      pattern: { fileName: '豆谱-超限拆分-200x200-图纸.png' },
      legend: { fileName: '豆谱-超限拆分-200x200-图例.png' },
    });
  });

  it.each([
    { boardSize: 50, width: 101, seams: [400, 800], foreignSeam: 416 },
    { boardSize: 52, width: 105, seams: [416, 832], foreignSeam: 400 },
  ])('按 $boardSize×$boardSize 制作规格绘制 PNG 板缝并输出可编码产物', async ({
    boardSize,
    width,
    seams,
    foreignSeam,
  }) => {
    const moveTo = vi.fn();
    const noop = vi.fn();
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, prop) {
        if (prop === 'moveTo') return moveTo;
        if (typeof prop === 'string' && ['fillRect', 'strokeRect', 'beginPath', 'lineTo', 'stroke', 'fillText'].includes(prop)) return noop;
        return Reflect.get(target, prop);
      },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const pattern: Pattern = {
      width,
      height: 1,
      cells: Array.from({ length: width }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    };

    const result = await exportPngBlob(pattern, 'mini', { cellPx: 8, cropToContent: false, boardSize });

    for (const seam of seams) expect(moveTo).toHaveBeenCalledWith(seam, 0);
    expect(moveTo).not.toHaveBeenCalledWith(foreignSeam, 0);
    expect(result).toMatchObject({
      ok: true,
      kind: 'single',
      artifact: {
        fileName: `豆谱-mini-${width}x1.png`,
        blob: expect.objectContaining({ type: 'image/png' }),
      },
    });
  });

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
    const result = await exportPngBlob(pattern, '极限图纸', { cellPx: 32, includeLegend: true });
    expect(result.ok).toBe(true);
    expect(encodedSize.width).toBeLessThanOrEqual(8192);
    expect(encodedSize.height).toBeGreaterThan(32);
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

  it('规划或统计抛错时也在公共边界返回 ENCODE_FAILED', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: '#000000', code: null, transparent: false }],
    };

    await expect(exportPngBlob(pattern, '规划失败')).resolves.toEqual({
      ok: false,
      code: 'ENCODE_FAILED',
    });
    expect(createElement).not.toHaveBeenCalledWith('canvas');
  });

  it('绘制抛错时释放已分配 Canvas，并在公共边界返回 ENCODE_FAILED', async () => {
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get(_target, prop) {
        if (prop === 'fillRect') return () => { throw new Error('draw failed'); };
        return vi.fn();
      },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const created: HTMLCanvasElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreate(tagName);
      if (tagName === 'canvas') created.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: '#000000', code: 'A01', transparent: false }],
    };

    await expect(exportPngBlob(pattern, '绘制失败')).resolves.toEqual({
      ok: false,
      code: 'ENCODE_FAILED',
    });
    expect(created).toHaveLength(1);
    expect(created[0].width).toBe(1);
    expect(created[0].height).toBe(1);
  });

  it('toBlob 抛错时仍释放 Canvas，并返回 ENCODE_FAILED', async () => {
    const noop = vi.fn();
    const context = new Proxy({} as CanvasRenderingContext2D, {
      get() { return noop; },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.toBlob = function toBlob() {
      throw new Error('encode failed');
    };
    const created: HTMLCanvasElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreate(tagName);
      if (tagName === 'canvas') created.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);
    const pattern: Pattern = {
      width: 1,
      height: 1,
      cells: [{ hex: '#000000', code: 'A01', transparent: false }],
    };

    await expect(exportPngBlob(pattern, '编码失败')).resolves.toEqual({
      ok: false,
      code: 'ENCODE_FAILED',
    });
    expect(created).toHaveLength(1);
    expect(created[0].width).toBe(1);
    expect(created[0].height).toBe(1);
  });

  it('拆分导出在第二张图绘制失败时释放两个 Canvas', async () => {
    const noop = vi.fn();
    const patternContext = new Proxy({} as CanvasRenderingContext2D, {
      get() { return noop; },
      set() { return true; },
    });
    const legendContext = new Proxy({} as CanvasRenderingContext2D, {
      get(_target, prop) {
        if (prop === 'fillText') return () => { throw new Error('legend draw failed'); };
        return noop;
      },
      set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce(patternContext)
      .mockReturnValueOnce(legendContext);
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };
    const created: HTMLCanvasElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreate(tagName);
      if (tagName === 'canvas') created.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);
    const pattern: Pattern = {
      width: 200,
      height: 200,
      cells: Array.from({ length: 40_000 }, (_, index) => {
        const color = index % 500;
        return {
          hex: `#${(color + 1).toString(16).padStart(6, '0')}`,
          code: `LONG-COLOR-${color.toString().padStart(9, '0')}`,
          transparent: false,
        };
      }),
    };

    await expect(exportPngBlob(pattern, '拆分失败', {
      cellPx: 20,
      cropToContent: false,
      includeLegend: true,
    })).resolves.toEqual({ ok: false, code: 'ENCODE_FAILED' });
    expect(created).toHaveLength(2);
    expect(created.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
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
    expect(legendCalls).toHaveLength(2);
    expect(legendCalls[0][0]).toBe('A × 1');
    expect(legendCalls[1][0]).toBe('B × 1');
    expect(legendCalls[0][2]).toBe(legendCalls[1][2]);
    expect(Number(legendCalls[1][1]) - Number(legendCalls[0][1])).toBeGreaterThan(100);
    expect(legendCalls.every((call) => Number(call[3]) >= 1)).toBe(true);
  });
});
