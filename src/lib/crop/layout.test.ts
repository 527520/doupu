import { describe, expect, it } from 'vitest';
import {
  applyAspectLock,
  buildCropPreview,
  clampCropRect,
  cropImageData,
  fitCropPreviewSize,
  MIN_CROP_SIZE,
  resizeEdge,
  type AspectAnchor,
  type Rect,
} from './layout';

describe('clampCropRect', () => {
  it('完全在界内的矩形原样返回（整数）', () => {
    expect(clampCropRect({ x: 10, y: 20, width: 30, height: 40 }, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('越界矩形被拉回界内', () => {
    expect(clampCropRect({ x: -10, y: -20, width: 50, height: 50 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    expect(clampCropRect({ x: 90, y: 90, width: 50, height: 50 }, 100, 100)).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
  });

  it('宽高超过图像时收缩到图像尺寸（E7 1×1 图）', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 999, height: 999 }, 1, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('零尺寸与负宽高被强制到最小尺寸', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 0, height: 0 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: MIN_CROP_SIZE,
      height: MIN_CROP_SIZE,
    });
    expect(clampCropRect({ x: 5, y: 5, width: -10, height: -10 }, 100, 100)).toEqual({
      x: 5,
      y: 5,
      width: MIN_CROP_SIZE,
      height: MIN_CROP_SIZE,
    });
  });

  it('非整数输入四舍五入', () => {
    expect(clampCropRect({ x: 1.6, y: 2.4, width: 10.4, height: 10.5 }, 100, 100)).toEqual({
      x: 2,
      y: 2,
      width: 10,
      height: 11,
    });
  });

  it('最小尺寸大于图像时收缩到图像尺寸（3×2 图）', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 4, height: 4 }, 3, 2)).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
  });

  it('极宽图（100:1，E9）正常约束', () => {
    expect(clampCropRect({ x: -5, y: -5, width: 50, height: 50 }, 1000, 10)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 10,
    });
  });

  it('0×0 图像安全', () => {
    expect(clampCropRect({ x: 5, y: 5, width: 10, height: 10 }, 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('applyAspectLock', () => {
  const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });
  const anchors: AspectAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

  it('1:1 锁从每个锚点收缩（宽>高）', () => {
    const r = rect(0, 0, 100, 50);
    expect(applyAspectLock(r, 1, 'top-left')).toEqual(rect(0, 0, 50, 50));
    expect(applyAspectLock(r, 1, 'top-right')).toEqual(rect(50, 0, 50, 50));
    expect(applyAspectLock(r, 1, 'bottom-left')).toEqual(rect(0, 0, 50, 50));
    expect(applyAspectLock(r, 1, 'bottom-right')).toEqual(rect(50, 0, 50, 50));
    expect(applyAspectLock(r, 1, 'center')).toEqual(rect(25, 0, 50, 50));
  });

  it('1:1 锁从每个锚点收缩（高>宽）', () => {
    const r = rect(10, 10, 40, 80);
    expect(applyAspectLock(r, 1, 'top-left')).toEqual(rect(10, 10, 40, 40));
    expect(applyAspectLock(r, 1, 'top-right')).toEqual(rect(10, 10, 40, 40));
    expect(applyAspectLock(r, 1, 'bottom-left')).toEqual(rect(10, 50, 40, 40));
    expect(applyAspectLock(r, 1, 'bottom-right')).toEqual(rect(10, 50, 40, 40));
    expect(applyAspectLock(r, 1, 'center')).toEqual(rect(10, 30, 40, 40));
  });

  it('原始比例锁（ratio = 宽/高）保持形状', () => {
    const r = rect(0, 0, 40, 20); // 原始 2:1，当前已是 2:1
    expect(applyAspectLock(r, 2, 'center')).toEqual(rect(0, 0, 40, 20));
    const off = rect(0, 0, 30, 30); // 方形 → 2:1，中心锚点：宽 30 高 15，y = round((30-15)/2) = 8
    expect(applyAspectLock(off, 2, 'center')).toEqual(rect(0, 8, 30, 15));
  });

  it('非法 ratio 原样返回（取整）', () => {
    const r = rect(1.4, 2.6, 10, 20);
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(applyAspectLock(r, bad, 'center')).toEqual(rect(1, 3, 10, 20));
    }
  });

  it('零尺寸矩形安全（不小于 1×1）', () => {
    expect(applyAspectLock(rect(0, 0, 0, 0), 1, 'center')).toEqual(rect(0, 0, 1, 1));
  });

  it('所有锚点在比例锁后保持不变（属性验证）', () => {
    for (const anchor of anchors) {
      const r = rect(7, 9, 64, 33);
      const locked = applyAspectLock(r, 3, anchor);
      expect(locked.width / locked.height).toBeCloseTo(3, 0);
    }
  });
});

describe('cropImageData', () => {
  /** 构造 width×height 图像，每个像素 RGBA = (x, y, 128, 255)。 */
  function makeImage(width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = x % 256;
        data[i + 1] = y % 256;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    return { data, width, height };
  }

  it('精确提取子区域像素（含 alpha）', () => {
    const img = makeImage(10, 10);
    const out = cropImageData(img, { x: 2, y: 3, width: 4, height: 2 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    // 输出 (0,0) 对应源 (2,3)
    expect(out.data[0]).toBe(2);
    expect(out.data[1]).toBe(3);
    expect(out.data[2]).toBe(128);
    expect(out.data[3]).toBe(255);
    // 输出 (3,1) 对应源 (5,4)
    const i = (1 * 4 + 3) * 4;
    expect(out.data[i]).toBe(5);
    expect(out.data[i + 1]).toBe(4);
  });

  it('越界矩形自动钳制到图像范围', () => {
    const img = makeImage(10, 10);
    const out = cropImageData(img, { x: 8, y: 8, width: 10, height: 10 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
  });

  it('整图裁剪 = 原图逐字节一致', () => {
    const img = makeImage(7, 5);
    const out = cropImageData(img, { x: 0, y: 0, width: 7, height: 5 });
    expect(out.width).toBe(7);
    expect(out.height).toBe(5);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });

  it('1×1 图像裁剪安全', () => {
    const img = makeImage(1, 1);
    const out = cropImageData(img, { x: 0, y: 0, width: 1, height: 1 });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(255);
  });

  it('超大裁剪可直接缩到工作分辨率，不分配完整裁剪缓冲', () => {
    const img = makeImage(400, 200);
    const out = cropImageData(img, { x: 0, y: 0, width: 400, height: 200 }, 40);

    expect(out.width).toBe(40);
    expect(out.height).toBe(20);
    expect(out.data).toHaveLength(40 * 20 * 4);
    expect(out.data.byteLength).toBeLessThan(img.data.byteLength / 50);
    expect(out.data[3]).toBe(255);
  });

  it('有上限的缩放使用 alpha 加权，透明像素不会污染可见颜色', () => {
    const img = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 0,
      ]),
    };
    const out = cropImageData(img, { x: 0, y: 0, width: 2, height: 1 }, 1);

    expect(out).toEqual({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 128]),
    });
  });

  it('大比例缩小时按完整覆盖区域平均，边缘条纹不会因点采样消失', () => {
    const data = new Uint8ClampedArray(8 * 4);
    for (let x = 0; x < 8; x++) {
      const value = x === 0 || x === 7 ? 255 : 0;
      data[x * 4] = value;
      data[x * 4 + 1] = value;
      data[x * 4 + 2] = value;
      data[x * 4 + 3] = 255;
    }
    const out = cropImageData({ data, width: 8, height: 1 }, { x: 0, y: 0, width: 8, height: 1 }, 1);
    expect([...out.data]).toEqual([64, 64, 64, 255]);
  });
});

describe('fitCropPreviewSize', () => {
  it.each([{ input: [1, 2], expected: [1, 2, 0, 0] }, { input: [1, 2, 3, 4, 5, 6], expected: [1, 2, 3, 4] }])('keeps preview byte length bounded for $input', ({ input, expected }) => {
    // Extra bytes remain excluded and absent channels retain the old zero fill.
    const preview = buildCropPreview({ width: 1, height: 1, data: new Uint8ClampedArray(input) }, 1, 1);
    expect([...preview.data]).toEqual(expected);
  });
  it('copies an already bounded preview without per-pixel reads and keeps output isolated', () => {
    const data = new Uint8ClampedArray(800 * 800 * 4).fill(173);
    let reads = 0;
    const preview = buildCropPreview({ width: 800, height: 800, get data() { reads++; return data; } }, 800, 800);
    expect(reads).toBeLessThanOrEqual(2);
    expect(preview.data === data).toBe(false);
    expect(preview.data.length).toBe(data.length);
    expect(preview.data.every((value) => value === 173)).toBe(true);
    preview.data[0] = 0;
    expect(data[0]).toBe(173);
  });
  it('超大正方形与极窄长图均限制在 800×800 预览内', () => {
    expect(fitCropPreviewSize(8000, 8000, 800, 800)).toEqual({ width: 800, height: 800 });
    expect(fitCropPreviewSize(100, 8000, 800, 800)).toEqual({ width: 10, height: 800 });
    expect(fitCropPreviewSize(8000, 100, 800, 800)).toEqual({ width: 800, height: 10 });
  });

  it('预览仅分配目标像素并保留 RGBA 采样', () => {
    const image = {
      width: 4,
      height: 2,
      data: new Uint8ClampedArray([
        1, 2, 3, 4, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33,
        40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 62, 63, 70, 71, 72, 73,
      ]),
    };
    const preview = buildCropPreview(image, 2, 1);
    expect(preview).toEqual({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4, 20, 21, 22, 23]),
    });
  });
});

describe('resizeEdge（边框手柄缩放）', () => {
  const rect: Rect = { x: 40, y: 30, width: 80, height: 40 };

  it('自由模式：拖顶边只改上沿（对边与宽度不变）', () => {
    expect(resizeEdge(rect, 'top', { x: 80, y: 20 }, null)).toEqual({ x: 40, y: 20, width: 80, height: 50 });
  });

  it('自由模式：拖右边只改右沿（对边与高度不变）', () => {
    expect(resizeEdge(rect, 'right', { x: 140, y: 50 }, null)).toEqual({ x: 40, y: 30, width: 100, height: 40 });
  });

  it('自由模式：拖左边/底边', () => {
    expect(resizeEdge(rect, 'left', { x: 20, y: 50 }, null)).toEqual({ x: 20, y: 30, width: 100, height: 40 });
    expect(resizeEdge(rect, 'bottom', { x: 80, y: 90 }, null)).toEqual({ x: 40, y: 30, width: 80, height: 60 });
  });

  it('比例锁定 1:1：拖顶边 → 高度决定宽度，对边固定、水平居中', () => {
    const out = resizeEdge(rect, 'top', { x: 80, y: 20 }, 1);
    // 高 50 → 宽 50，水平居中：x = 40 + (80-50)/2 = 55
    expect(out).toEqual({ x: 55, y: 20, width: 50, height: 50 });
  });

  it('比例锁定 2:1：拖右边 → 宽度决定高度，对边固定、垂直居中', () => {
    const out = resizeEdge(rect, 'right', { x: 140, y: 50 }, 2);
    // 宽 100 → 高 50，垂直居中：y = 30 + (40-50)/2 = 25
    expect(out).toEqual({ x: 40, y: 25, width: 100, height: 50 });
  });

  it('比例锁定 1:1：拖底边 → 高度决定宽度，对边固定、水平居中', () => {
    const out = resizeEdge(rect, 'bottom', { x: 80, y: 90 }, 1);
    // 高 60 → 宽 60，水平居中：x = 40 + (80-60)/2 = 50
    expect(out).toEqual({ x: 50, y: 30, width: 60, height: 60 });
  });

  it('比例锁定 2:1：拖底边保持水平居中', () => {
    const out = resizeEdge(rect, 'bottom', { x: 80, y: 90 }, 2);
    // 高 60 → 宽 120，围绕原中心 x=80 展开
    expect(out).toEqual({ x: 20, y: 30, width: 120, height: 60 });
  });

  it('比例锁定拖底边贴到图像边界时整体收缩，不由通用钳制破坏比例', () => {
    const nearEdge: Rect = { x: 20, y: 10, width: 60, height: 30 };
    const out = resizeEdge(nearEdge, 'bottom', { x: 50, y: 90 }, 2, { width: 100, height: 100 });
    // 原始中心 x=50；受左右边界约束，最大宽 100、高 50，顶边仍固定在 y=10。
    expect(out).toEqual({ x: 0, y: 10, width: 100, height: 50 });
  });

  it('比例锁定四条边贴边时均保持对边/中心线和 2:1', () => {
    const bounded: Rect = { x: 20, y: 35, width: 60, height: 30 };
    const bounds = { width: 100, height: 100 };
    expect(resizeEdge(bounded, 'top', { x: 50, y: 0 }, 2, bounds))
      .toEqual({ x: 0, y: 15, width: 100, height: 50 });
    expect(resizeEdge(bounded, 'bottom', { x: 50, y: 100 }, 2, bounds))
      .toEqual({ x: 0, y: 35, width: 100, height: 50 });
    expect(resizeEdge(bounded, 'left', { x: 0, y: 50 }, 2, bounds))
      .toEqual({ x: 0, y: 30, width: 80, height: 40 });
    expect(resizeEdge(bounded, 'right', { x: 100, y: 50 }, 2, bounds))
      .toEqual({ x: 20, y: 30, width: 80, height: 40 });
  });

  it('非法比例退化为自由模式', () => {
    expect(resizeEdge(rect, 'bottom', { x: 80, y: 90 }, NaN)).toEqual({ x: 40, y: 30, width: 80, height: 60 });
  });
});
