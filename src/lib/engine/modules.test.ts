import { describe, expect, it } from 'vitest';
import { applyBrightnessContrast } from './brightness';
import { buildLut, lutIndex } from './lut';
import { floydSteinberg } from './dither';
import { sampleCells } from './sample';
import { mergeByTargetCount } from './merge';
import { removeBackground } from './background';
import { downscaleBox } from './downscale';
import type { ImageDataLike } from './types';
import type { PaletteColor, PatternCell } from '@/lib/types';

function image(w: number, h: number, fill: (x: number, y: number, i: number) => [number, number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fill(x, y, i);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

const cell = (hex: string): PatternCell => ({ hex, code: null, transparent: false });

describe('applyBrightnessContrast', () => {
  it('零参数时返回同一对象（性能路径）', () => {
    const img = image(2, 2, () => [10, 20, 30, 255]);
    expect(applyBrightnessContrast(img, 0, 0)).toBe(img);
  });

  it('公式正确且钳制（E17）：b=100,c=100 输出合法', () => {
    const img = image(2, 1, (x) => (x === 0 ? [0, 128, 255, 255] : [255, 0, 128, 255]));
    const out = applyBrightnessContrast(img, 100, 100);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(255);
    }
    expect(out.data[3]).toBe(255); // alpha 不变
    // b=100 → +128 偏移：128 输入 → 256 → 钳制 255
    expect(out.data[1]).toBe(255);
  });
});

describe('buildLut / lutIndex', () => {
  const palette: PaletteColor[] = [
    { hex: '#000000', code: 'B' },
    { hex: '#FFFFFF', code: 'W' },
    { hex: '#FF0000', code: 'R' },
  ];

  it('精确命中与近似命中', () => {
    const lut = buildLut(palette);
    expect(lut.palette[lutIndex(lut, 0, 0, 0)].hex).toBe('#000000');
    expect(lut.palette[lutIndex(lut, 255, 255, 255)].hex).toBe('#FFFFFF');
    expect(lut.palette[lutIndex(lut, 250, 10, 10)].hex).toBe('#FF0000');
  });

  it('空色板抛错', () => {
    expect(() => buildLut([])).toThrow('palette is empty');
  });

  it('非法 hex 抛错', () => {
    expect(() => buildLut([{ hex: 'bad', code: null }])).toThrow();
  });
});

describe('floydSteinberg（E16）', () => {
  const palette: PaletteColor[] = [
    { hex: '#000000', code: null },
    { hex: '#FFFFFF', code: null },
  ];
  const lut = buildLut(palette);

  it('全透明图：输出与输入一致，无 NaN', () => {
    const img = image(4, 4, () => [128, 128, 128, 0]);
    const out = floydSteinberg(img, lut);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });

  it('灰图量化后仅含色板色，且均值误差有界（误差守恒）', () => {
    const img = image(8, 8, () => [128, 128, 128, 255]);
    const out = floydSteinberg(img, lut);
    let sum = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const v = out.data[i];
      expect(v === 0 || v === 255).toBe(true);
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
    }
    const inputSum = 128 * 64;
    expect(Math.abs(sum - inputSum)).toBeLessThanOrEqual(255 * 4);
  });

  it('蛇形扫描确定性：两次运行结果一致', () => {
    const img = image(8, 8, (x, y) => [(x * 31 + y * 17) % 256, (x * 7 + y * 53) % 256, (x * 97 + y * 13) % 256, 255]);
    const a = floydSteinberg(img, lut);
    const b = floydSteinberg(img, lut);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe('sampleCells', () => {
  it('2×2 图 W=2 M=2 逐像素对应', () => {
    const img = image(2, 2, (x, y) => (y === 0 ? (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : x === 0 ? [0, 0, 255, 255] : [255, 255, 255, 255]));
    const cells = sampleCells(img, 2, 2, 'dominant');
    expect(cells.map((c) => c.hex)).toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF']);
  });

  it('dominant 平票取先出现者', () => {
    // 单行 4 像素：红绿红绿 → 平票 → 取先出现的红
    const img = image(4, 1, (x) => (x % 2 === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
    const cells = sampleCells(img, 1, 1, 'dominant');
    expect(cells[0].hex).toBe('#FF0000');
  });

  it('average 模式取平均色', () => {
    const img = image(2, 1, (x) => (x === 0 ? [10, 10, 10, 255] : [20, 20, 20, 255]));
    const cells = sampleCells(img, 1, 1, 'average');
    expect(cells[0].hex).toBe('#0F0F0F');
  });

  it('全透明格 → transparent（E10/E11）', () => {
    const img = image(3, 3, (x, y) => (x === 1 && y === 1 ? [1, 2, 3, 0] : [10, 20, 30, 255]));
    const cells = sampleCells(img, 3, 3, 'dominant');
    expect(cells[4].transparent).toBe(true);
    expect(cells[4].hex).toBeNull();
    expect(cells.filter((c) => !c.transparent)).toHaveLength(8);
  });

  it('不可整除的格边界（5px 宽 W=2 → 3+3 重叠边界）', () => {
    const img = image(5, 1, (x) => [x * 40, 0, 0, 255]);
    const cells = sampleCells(img, 2, 1, 'dominant');
    expect(cells).toHaveLength(2);
    // 左格像素 0..2（色 0/40/80 各一次，平票取先出现者 0），右格像素 2..4（80/120/160，取 80）
    expect(cells[0].hex).toBe('#000000');
    expect(cells[1].hex).toBe('#500000');
  });

  it('图小于格数时不除零（1×1 图 W=200 直接调用）', () => {
    const img = image(1, 1, () => [9, 9, 9, 255]);
    const cells = sampleCells(img, 200, 200, 'dominant');
    expect(cells).toHaveLength(40000);
    expect(cells.every((c) => c.hex === '#090909')).toBe(true);
  });
});

describe('mergeByTargetCount（E15）', () => {
  const palette: PaletteColor[] = [
    { hex: '#000000', code: 'A' },
    { hex: '#010101', code: 'B' }, // 与黑极近
    { hex: '#FFFFFF', code: 'C' },
    { hex: '#FEFEFE', code: 'D' }, // 与白极近
  ];

  it('K ≥ distinct 不合并（thresholdUsed=0，返回原数组）', () => {
    const cells = [cell('#000000'), cell('#FFFFFF')];
    const result = mergeByTargetCount(cells, palette, 2);
    expect(result.thresholdUsed).toBe(0);
    expect(result.cells).toBe(cells);
  });

  it('K=2 时低频并入高频：黑白组各自合并，高频存活', () => {
    // 模拟真实管线输出（cells 带色板 code）：黑 3 次、白 5 次、近黑 1 次、近白 2 次
    const mk = (hex: string, code: string): PatternCell => ({ hex, code, transparent: false });
    const cells = [
      mk('#000000', 'A'),
      mk('#000000', 'A'),
      mk('#000000', 'A'),
      mk('#FFFFFF', 'C'),
      mk('#FFFFFF', 'C'),
      mk('#FFFFFF', 'C'),
      mk('#FFFFFF', 'C'),
      mk('#FFFFFF', 'C'),
      mk('#010101', 'B'),
      mk('#FEFEFE', 'D'),
      mk('#FEFEFE', 'D'),
    ];
    const result = mergeByTargetCount(cells, palette, 2);
    const hexes = new Set(result.cells.map((c) => c.hex));
    expect(hexes).toEqual(new Set(['#000000', '#FFFFFF']));
    expect(result.thresholdUsed).toBeGreaterThan(0);
    // 合并后的 code 来自存活色（黑→A、白→C）
    expect(result.cells.every((c) => c.code === 'A' || c.code === 'C')).toBe(true);
  });

  it('确定性：两次结果完全一致', () => {
    const cells = Array.from({ length: 40 }, (_, i) => cell(Object.values(palette)[i % 4].hex));
    const a = mergeByTargetCount(cells, palette, 2);
    const b = mergeByTargetCount(cells, palette, 2);
    expect(a.thresholdUsed).toBe(b.thresholdUsed);
    expect(a.cells.map((c) => c.hex)).toEqual(b.cells.map((c) => c.hex));
  });

  it('θ=60 仍不达标时取可达最小值并报告 60', () => {
    // 黑白距离 = 100 > 60，K=1 永远无法合并
    const farPalette: PaletteColor[] = [
      { hex: '#000000', code: null },
      { hex: '#FFFFFF', code: null },
    ];
    const cells = [cell('#000000'), cell('#FFFFFF')];
    const result = mergeByTargetCount(cells, farPalette, 1);
    expect(result.thresholdUsed).toBe(60);
    const hexes = new Set(result.cells.map((c) => c.hex));
    expect(hexes.size).toBe(2); // 仍无法合并到 1
  });

  it('透明格不参与合并统计', () => {
    const cells: PatternCell[] = [cell('#000000'), { hex: null, code: null, transparent: true }];
    const result = mergeByTargetCount(cells, palette, 2);
    expect(result.thresholdUsed).toBe(0);
    expect(result.cells[1].transparent).toBe(true);
  });
});

describe('removeBackground（E18）', () => {
  it('全图同色 → 全部 external', () => {
    const cells = Array.from({ length: 9 }, () => cell('#123456'));
    const out = removeBackground(cells, 3, 3, 8);
    expect(out.every((c) => c.external === true)).toBe(true);
  });

  it('中心孤岛颜色差异大时不被标记；差异小时被标记', () => {
    // 差异大：黑环 + 白岛（距离 100 ≫ τ=8）
    const farIsland = Array.from({ length: 9 }, (_, i) => (i === 4 ? cell('#FFFFFF') : cell('#000000')));
    const tight = removeBackground(farIsland, 3, 3, 8);
    expect(tight[4].external).toBeUndefined();
    // 差异小：#303030 环 + #202020 岛（Oklab 距离 ≈ 6.9 < τ=8；注意纯黑附近灰阶距离被拉伸）
    const nearIsland = Array.from({ length: 9 }, (_, i) => (i === 4 ? cell('#202020') : cell('#303030')));
    const loose = removeBackground(nearIsland, 3, 3, 8);
    expect(loose[4].external).toBe(true);
  });

  it('透明格不参与连通（边界种子跳过透明；被透明包围的色块不入队）', () => {
    // 4×3 网格：
    // 行0 全透明；行1 [透明, 黑, 透明, 透明]；行2 [黑, 透明, 黑, 黑]
    const T: PatternCell = { hex: null, code: null, transparent: true };
    const B = cell('#000000');
    const cells: PatternCell[] = [T, T, T, T, T, B, T, T, B, T, B, B];
    const out = removeBackground(cells, 4, 3, 60);
    // 底部黑色块是边界种子 → external；被透明四面围住的 (1,1) 黑格不受影响
    expect(out[8].external).toBe(true);
    expect(out[10].external).toBe(true);
    expect(out[11].external).toBe(true);
    expect(out[5].external).toBeUndefined();
    expect(out[9].transparent).toBe(true);
  });

  it('不修改原数组（返回新数组，仅被标记格为新对象）', () => {
    const cells = Array.from({ length: 4 }, () => cell('#101010'));
    const out = removeBackground(cells, 2, 2, 8);
    expect(out).not.toBe(cells);
    expect(cells.every((c) => c.external === undefined)).toBe(true);
    expect(out.every((c) => c.external === true)).toBe(true);
  });
});

describe('downscaleBox', () => {
  it('不超过 maxDim 时不处理（返回同一对象）', () => {
    const img = image(10, 10, () => [1, 2, 3, 255]);
    expect(downscaleBox(img, 10)).toBe(img);
  });

  it('等比缩小且尺寸 ≤ maxDim', () => {
    const img = image(100, 50, (x, y) => [(x + y) % 256, 0, 0, 255]);
    const out = downscaleBox(img, 20);
    expect(out.width).toBeLessThanOrEqual(20);
    expect(out.height).toBeLessThanOrEqual(20);
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });

  it('平均色正确（2×2 → 1×1）', () => {
    const img = image(2, 2, (x, y) => [x * 10 + y, 0, 0, 255]);
    const out = downscaleBox(img, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    // (0+1+10+11)/4 = 5.5 → 6
    expect(out.data[0]).toBe(6);
    expect(out.data[3]).toBe(255);
  });

  it('全透明区域输出透明', () => {
    const img = image(2, 2, () => [1, 2, 3, 0]);
    const out = downscaleBox(img, 1);
    expect(out.data[3]).toBe(0);
  });
});
