import { describe, expect, it } from 'vitest';
import { applyBrightnessContrast } from './brightness';
import { buildLut, clearLutCache, lutCacheKey, lutIndex } from './lut';
import { floydSteinberg } from './dither';
import { sampleCells } from './sample';
import { mergeByTargetCount } from './merge';
import { removeBackground } from './background';
import { downscaleBox } from './downscale';
import { clamp255, type ImageDataLike } from './types';
import { BRANDS, type PaletteColor, type PatternCell } from '@/lib/types';
import { getAvailableColors } from '@/lib/palettes';
import { hexToRgb, oklabSquaredDistance, rgbToOklab } from './color';

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

  it('缓存键包含色号：hex 相同但色号不同的色板不共享匹配表（A-09）', () => {
    // 纯键比较：每个 Lut 的精确表是 32 MiB，测试里不实际构建多套。
    const sameHexDifferentCodes = [
      { hex: '#000000', code: 'C-01' },
      { hex: '#FFFFFF', code: 'C-02' },
      { hex: '#FF0000', code: 'C-03' },
    ];
    expect(lutCacheKey(palette)).not.toBe(lutCacheKey(sameHexDifferentCodes));
    expect(lutCacheKey(palette)).toBe(lutCacheKey([...palette]));
    expect(lutCacheKey([{ hex: '#000000', code: null }])).toBe('#000000:');
  });

  it.each(BRANDS)('%s 的每个可用色精确匹配自身', (brand) => {
    clearLutCache();
    const brandPalette = getAvailableColors(brand);
    const brandLut = buildLut(brandPalette);
    for (const [expectedIndex, color] of brandPalette.entries()) {
      const rgb = hexToRgb(color.hex)!;
      expect(lutIndex(brandLut, rgb.r, rgb.g, rgb.b), `${brand} ${color.code} ${color.hex}`).toBe(
        expectedIndex,
      );
    }
  });

  it('固定种子随机 RGB 与精确 Oklab 全扫描 oracle 完全一致', () => {
    clearLutCache();
    const brandPalette = getAvailableColors('MARD');
    const brandLut = buildLut(brandPalette);
    const paletteLabs = brandPalette.map((color) => rgbToOklab(hexToRgb(color.hex)!));
    let state = 0x12345678;
    const nextByte = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state >>> 24;
    };

    for (let sample = 0; sample < 512; sample++) {
      const rgb = { r: nextByte(), g: nextByte(), b: nextByte() };
      const target = rgbToOklab(rgb);
      let expected = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < paletteLabs.length; index++) {
        const distance = oklabSquaredDistance(target, paletteLabs[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          expected = index;
        }
      }
      expect(lutIndex(brandLut, rgb.r, rgb.g, rgb.b), JSON.stringify(rgb)).toBe(expected);
    }
  });

  it('自定义 500 色板的每个真实颜色精确匹配自身', () => {
    clearLutCache();
    const customPalette: PaletteColor[] = Array.from({ length: 500 }, (_, index) => {
      const value = (index * 7919) & 0xffffff;
      return { hex: `#${value.toString(16).padStart(6, '0').toUpperCase()}`, code: `C${index}` };
    });
    const customLut = buildLut(customPalette);

    for (const [expectedIndex, color] of customPalette.entries()) {
      const rgb = hexToRgb(color.hex)!;
      expect(lutIndex(customLut, rgb.r, rgb.g, rgb.b)).toBe(expectedIndex);
    }
  });
});

describe('floydSteinberg（E16）', () => {
  const palette: PaletteColor[] = [
    { hex: '#000000', code: null },
    { hex: '#FFFFFF', code: null },
  ];
  const lut = buildLut(palette);

  const fullBufferOracle = (input: ImageDataLike): ImageDataLike => {
    const { data: src, width, height } = input;
    const out = new Uint8ClampedArray(src.length);
    const accumulator = Float64Array.from(src);
    const diffuse = (index: number, weight: number, red: number, green: number, blue: number): void => {
      accumulator[index] += red * weight;
      accumulator[index + 1] += green * weight;
      accumulator[index + 2] += blue * weight;
    };
    for (let y = 0; y < height; y++) {
      const leftToRight = y % 2 === 0;
      for (let offset = 0; offset < width; offset++) {
        const x = leftToRight ? offset : width - 1 - offset;
        const index = (y * width + x) * 4;
        if (src[index + 3] < 128) {
          out.set(src.subarray(index, index + 4), index);
          continue;
        }
        const red = clamp255(Math.round(accumulator[index]));
        const green = clamp255(Math.round(accumulator[index + 1]));
        const blue = clamp255(Math.round(accumulator[index + 2]));
        const paletteIndex = lutIndex(lut, red, green, blue);
        const target = lut.paletteRgbs[paletteIndex];
        out.set([target.r, target.g, target.b, src[index + 3]], index);
        const error = [red - target.r, green - target.g, blue - target.b] as const;
        const direction = leftToRight ? 1 : -1;
        const sameRow = leftToRight ? x + 1 < width : x - 1 >= 0;
        const nextRow = y + 1 < height;
        if (sameRow) diffuse(index + 4 * direction, 7 / 16, ...error);
        if (nextRow) {
          const previousColumn = leftToRight ? x - 1 >= 0 : x + 1 < width;
          if (previousColumn) diffuse(index + width * 4 - 4 * direction, 3 / 16, ...error);
          diffuse(index + width * 4, 5 / 16, ...error);
          if (sameRow) diffuse(index + width * 4 + 4 * direction, 1 / 16, ...error);
        }
      }
    }
    return { data: out, width, height };
  };

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

  it('滚动误差行与全图 Float64 oracle 在固定种子含透明输入上逐字节一致', () => {
    let state = 0xabcdef01;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state >>> 24;
    };
    const img = image(17, 13, () => [next(), next(), next(), next() % 5 === 0 ? 0 : 255]);
    expect(floydSteinberg(img, lut).data).toEqual(fullBufferOracle(img).data);
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

  it('dominant 使用量化频率与感知代表色，不选全部唯一 RGB 中的左上离群点', () => {
    const pixels: Array<[number, number, number, number]> = [
      [240, 20, 20, 255],
      [100, 100, 100, 255],
      [101, 100, 100, 255],
      [102, 100, 100, 255],
      [103, 100, 100, 255],
    ];
    const img = image(5, 1, (x) => pixels[x]);
    const cells = sampleCells(img, 1, 1, 'dominant');

    expect(cells[0].hex).not.toBe('#F01414');
    expect(['#646464', '#656464', '#666464', '#676464']).toContain(cells[0].hex);
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

  it('不可整除的格边界按连续覆盖面积分配，不重复计入边界像素', () => {
    const img = image(5, 1, (x) => [x * 40, 0, 0, 255]);
    const cells = sampleCells(img, 2, 1, 'average');
    expect(cells).toHaveLength(2);
    // 左格 [0, 2.5]：0*1 + 40*1 + 80*0.5 = 80，/2.5 = 32
    // 右格 [2.5, 5]：80*0.5 + 120*1 + 160*1 = 320，/2.5 = 128
    expect(cells[0].hex).toBe('#200000');
    expect(cells[1].hex).toBe('#800000');
  });

  it('average 按连续 alpha 覆盖计权，而不是把半透明像素当作完全不透明', () => {
    const img = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128]));
    const cells = sampleCells(img, 1, 1, 'average');

    // 权重 1 : 128/255，得到约 (170, 0, 85)。
    expect(cells[0]).toMatchObject({ hex: '#AA0055', transparent: false });
  });

  it('dominant 的桶频率同样按 alpha 权重累计', () => {
    const img = image(2, 1, (x) => (x === 0 ? [0, 0, 255, 128] : [255, 0, 0, 255]));
    expect(sampleCells(img, 1, 1, 'dominant')[0].hex).toBe('#FF0000');
  });

  it('property：每个源像素分配到整行目标格的总覆盖权重守恒', () => {
    for (let sourceWidth = 2; sourceWidth <= 9; sourceWidth++) {
      for (let targetWidth = 1; targetWidth <= 11; targetWidth++) {
        const cellArea = sourceWidth / targetWidth;
        for (let sourcePixel = 0; sourcePixel < sourceWidth; sourcePixel++) {
          const img = image(sourceWidth, 1, (x) =>
            x === sourcePixel ? [255, 0, 0, 255] : [0, 0, 0, 255],
          );
          const cells = sampleCells(img, targetWidth, 1, 'average');
          const reconstructedWeight = cells.reduce(
            (sum, item) => sum + hexToRgb(item.hex!)!.r * cellArea,
            0,
          );
          // 每格 RGB 落盘会四舍五入，累计误差上界为 0.5 * 总面积。
          expect(
            Math.abs(reconstructedWeight - 255),
            `source=${sourceWidth} target=${targetWidth} pixel=${sourcePixel}`,
          ).toBeLessThanOrEqual(sourceWidth / 2 + 1e-9);
        }
      }
    }
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

  it('阈值结果非单调时仍返回穷举 oracle 的最小可行阈值', () => {
    const nonMonotonicPalette: PaletteColor[] = [
      { hex: '#000055', code: 'A' },
      { hex: '#000077', code: 'B' },
      { hex: '#002266', code: 'C' },
      { hex: '#220088', code: 'D' },
    ];
    const frequencies = [40, 30, 20, 10];
    const cells = nonMonotonicPalette.flatMap((color, index) =>
      Array.from({ length: frequencies[index] }, () => ({
        hex: color.hex,
        code: color.code,
        transparent: false,
      })),
    );

    const result = mergeByTargetCount(cells, nonMonotonicPalette, 2);
    expect(new Set(result.cells.map((item) => item.hex)).size).toBeLessThanOrEqual(2);
    expect(result.thresholdUsed).toBe(6); // θ=6 可行，θ=7 反而回到 3 色，二分会错过 6
  });

  it('固定种子随机小色板与独立穷举阈值 oracle 一致', () => {
    let state = 0x5eed1234;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let trial = 0; trial < 40; trial++) {
      const size = 3 + Math.floor(random() * 6);
      const randomPalette: PaletteColor[] = Array.from({ length: size }, (_, index) => {
        const value = ((trial + 1) * 104729 + index * 7919) & 0xffffff;
        return { hex: `#${value.toString(16).padStart(6, '0').toUpperCase()}`, code: `C${index}` };
      });
      const frequencies = randomPalette.map(() => 1 + Math.floor(random() * 12));
      const cells = randomPalette.flatMap((color, index) =>
        Array.from({ length: frequencies[index] }, () => ({
          hex: color.hex,
          code: color.code,
          transparent: false,
        })),
      );
      const target = 1 + Math.floor(random() * (size - 1));
      const ordered = randomPalette
        .map((color, index) => ({ ...color, frequency: frequencies[index] }))
        .sort((a, b) => b.frequency - a.frequency || a.hex.localeCompare(b.hex));
      const labs = ordered.map((color) => rgbToOklab(hexToRgb(color.hex)!));
      const oracleDistinct = (theta: number): number => {
        const replaced = new Set<number>();
        for (let i = 0; i < ordered.length; i++) {
          if (replaced.has(i)) continue;
          for (let j = i + 1; j < ordered.length; j++) {
            if (replaced.has(j)) continue;
            const distance = Math.sqrt(oklabSquaredDistance(labs[i], labs[j])) * 100;
            if (distance < theta) replaced.add(j);
          }
        }
        return ordered.length - replaced.size;
      };
      let expectedThreshold = 60;
      for (let theta = 0; theta <= 60; theta++) {
        if (oracleDistinct(theta) <= target) {
          expectedThreshold = theta;
          break;
        }
      }

      expect(mergeByTargetCount(cells, randomPalette, target).thresholdUsed, `trial=${trial}`).toBe(
        expectedThreshold,
      );
    }
  });

  it('透明格不参与合并统计', () => {
    const cells: PatternCell[] = [cell('#000000'), { hex: null, code: null, transparent: true }];
    const result = mergeByTargetCount(cells, palette, 2);
    expect(result.thresholdUsed).toBe(0);
    expect(result.cells[1].transparent).toBe(true);
  });

  it('已识别的 external 背景不参与频率或颜色合并', () => {
    const cells: PatternCell[] = [
      ...Array.from({ length: 20 }, () => ({ ...cell('#FFFFFF'), external: true })),
      cell('#000000'),
      cell('#010101'),
    ];
    const result = mergeByTargetCount(cells, palette, 1);

    expect(result.cells.slice(0, 20).every((item) => item.hex === '#FFFFFF' && item.external)).toBe(true);
    expect(result.cells.slice(20).every((item) => item.hex !== '#FFFFFF')).toBe(true);
  });
});

describe('removeBackground（E18）', () => {
  it('自动背景采用角落多数共识，不把单个前景角落当作背景种子', () => {
    const cells = Array.from({ length: 9 }, () => cell('#FFFFFF'));
    cells[0] = cell('#FF0000');
    cells[4] = cell('#FF0000');

    const out = removeBackground(cells, 3, 3, 8);

    expect(out[0].external).toBeUndefined();
    expect(out[4].external).toBeUndefined();
    expect(out.filter((item) => item.external)).toHaveLength(7);
  });

  it('洪泛始终比较固定背景原型，不沿渐变逐格漂移到前景', () => {
    const shades = ['#FFFFFF', '#DCDCDC', '#B9B9B9', '#969696'];
    const cells = Array.from({ length: 49 }, (_, index) => {
      const x = index % 7;
      const y = Math.floor(index / 7);
      const layer = Math.min(x, y, 6 - x, 6 - y);
      return cell(shades[layer]);
    });

    const out = removeBackground(cells, 7, 7, 12);

    expect(out[3 * 7 + 3].external).toBeUndefined();
    expect(out[0].external).toBe(true);
  });

  it('角落没有多数共识时自动模式不删除；显式 prototype 可确定背景', () => {
    const cells = [cell('#FFFFFF'), cell('#FF0000'), cell('#0000FF'), cell('#000000')];

    expect(removeBackground(cells, 2, 2, 8).every((item) => !item.external)).toBe(true);
    const manual = removeBackground(cells, 2, 2, 8, '#FFFFFF');
    expect(manual[0].external).toBe(true);
    expect(manual.slice(1).every((item) => !item.external)).toBe(true);
  });

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

  it('RGB 按 alpha 预乘权重混合，并保留区域平均 alpha', () => {
    const img = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128]));
    const out = downscaleBox(img, 1);

    expect(Array.from(out.data)).toEqual([170, 0, 85, 192]);
  });
});
