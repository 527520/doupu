import { describe, expect, it } from 'vitest';
import { generatePattern, computeStats } from './generate';
import { clearLutCache } from './lut';
import type { ImageDataLike } from './types';
import { getBuiltinPalette } from '@/lib/palettes';
import {
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
  type PaletteColor,
  type PatternCell,
} from '@/lib/types';

/** 确定性伪随机数（mulberry32），保证属性测试可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomImage(seed: number, w: number, h: number, transparentRatio = 0.2): ImageDataLike {
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(rand() * 256);
    data[i + 1] = Math.floor(rand() * 256);
    data[i + 2] = Math.floor(rand() * 256);
    data[i + 3] = rand() < transparentRatio ? 0 : 255;
  }
  return { data, width: w, height: h };
}

function solidImage(w: number, h: number, r: number, g: number, b: number, a = 255): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

const MARD: PaletteColor[] = [...getBuiltinPalette('MARD').engineColors];
const MARD_HEXES = new Set(MARD.map((p) => p.hex));

const params = (over: Partial<GenerationParams> = {}): GenerationParams => ({ ...DEFAULT_GENERATION_PARAMS, ...over });

describe('generatePattern 边界（E14–E19）', () => {
  it('E14：W=20 生成 20×M 图纸，尺寸与比例正确', () => {
    const out = generatePattern(solidImage(40, 20, 200, 50, 30), params({ targetWidth: 20 }), MARD);
    expect(out.pattern.width).toBe(20);
    expect(out.pattern.height).toBe(10);
    expect(out.pattern.cells).toHaveLength(200);
  });

  it('E14：W=200 上限正常', () => {
    const out = generatePattern(solidImage(200, 200, 1, 2, 3), params({ targetWidth: 200 }), MARD);
    expect(out.pattern.width).toBe(200);
    expect(out.pattern.height).toBe(200);
  });

  it('E15：K=2 时输出颜色数 ≤ 2；K 大于实际颜色数时不合并', () => {
    const img = solidImage(30, 30, 250, 244, 200); // 单色
    const tight = generatePattern(img, params({ targetColorCount: 2 }), MARD);
    expect(computeStats(tight.pattern.cells)).toHaveLength(1);
    expect(tight.mergeThresholdUsed).toBe(0);
  });

  it('E16：抖动开 + 全透明图 → 全透明、无 NaN、统计为空', () => {
    const img = solidImage(16, 16, 128, 128, 128, 0);
    const out = generatePattern(img, params({ dithering: true }), MARD);
    expect(out.pattern.cells.every((c) => c.transparent)).toBe(true);
    expect(out.stats).toHaveLength(0);
    expect(out.totalBeadCount).toBe(0);
    for (const cell of out.pattern.cells) {
      expect(Number.isFinite(cell.hex === null ? 0 : 1)).toBe(true);
    }
  });

  it('E17：极端亮度/对比度输出仍全部为色板内合法色', () => {
    const img = randomImage(7, 32, 32, 0);
    const out = generatePattern(img, params({ brightness: 100, contrast: 100 }), MARD);
    for (const cell of out.pattern.cells) {
      if (!cell.transparent) expect(MARD_HEXES.has(cell.hex!)).toBe(true);
    }
  });

  it('E18：纯色图 + 背景去除 → 全部 external、统计为空', () => {
    const out = generatePattern(
      solidImage(20, 20, 123, 45, 67),
      params({ backgroundRemoval: true, bgTolerance: 8 }),
      MARD,
    );
    expect(out.pattern.cells.every((c) => c.external === true)).toBe(true);
    expect(out.stats).toHaveLength(0);
  });

  it('E18：先识别背景再合并，贴边前景不会因颜色数上限被并入背景', () => {
    const img = solidImage(3, 3, 255, 255, 255);
    for (const pixel of [0, 4]) {
      img.data[pixel * 4] = 255;
      img.data[pixel * 4 + 1] = 0;
      img.data[pixel * 4 + 2] = 0;
    }
    const palette: PaletteColor[] = [
      { hex: '#FFFFFF', code: 'W' },
      { hex: '#FF0000', code: 'R' },
    ];

    const out = generatePattern(
      img,
      params({
        targetWidth: 3,
        targetColorCount: 1,
        mode: 'dominant',
        dithering: false,
        backgroundRemoval: true,
        bgTolerance: 8,
      }),
      palette,
    );

    expect(out.totalBeadCount).toBe(2);
    expect(out.pattern.cells[0].hex).toBe('#FF0000');
    expect(out.pattern.cells[0].external).not.toBe(true);
    expect(out.pattern.cells[4].hex).toBe('#FF0000');
    expect(out.pattern.cells[4].external).not.toBe(true);
  });

  it('E18：四角无共识时可用手动背景原型只移除指定的连通背景', () => {
    const img = solidImage(20, 20, 255, 0, 0);
    const palette: PaletteColor[] = [
      { hex: '#FF0000', code: 'R' },
      { hex: '#00FF00', code: 'G' },
      { hex: '#0000FF', code: 'B' },
      { hex: '#FFFFFF', code: 'W' },
    ];
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const offset = (y * 20 + x) * 4;
        const rgb = x < 10
          ? (y < 10 ? [255, 0, 0] : [0, 0, 255])
          : (y < 10 ? [0, 255, 0] : [255, 255, 255]);
        img.data[offset] = rgb[0];
        img.data[offset + 1] = rgb[1];
        img.data[offset + 2] = rgb[2];
      }
    }

    const automatic = generatePattern(img, params({
      targetWidth: 20,
      targetColorCount: 4,
      backgroundRemoval: true,
      bgTolerance: 8,
    }), palette);
    const manual = generatePattern(img, params({
      targetWidth: 20,
      targetColorCount: 4,
      backgroundRemoval: true,
      bgTolerance: 8,
      backgroundPrototype: '#FF0000',
    }), palette);

    expect(automatic.totalBeadCount).toBe(400);
    expect(manual.totalBeadCount).toBe(300);
    expect(manual.pattern.cells.filter((cell) => cell.external).every((cell) => cell.hex === '#FF0000')).toBe(true);
  });

  it('E19：漫漫色板中不可用色（#55514C）绝不出现，可用色 code 非空', () => {
    const palette = [...getBuiltinPalette('漫漫').engineColors];
    const img = solidImage(30, 30, 0x55, 0x51, 0x4c); // #55514C
    const out = generatePattern(img, params({ targetColorCount: 128 }), palette);
    for (const cell of out.pattern.cells) {
      expect(cell.hex).not.toBe('#55514C');
      if (!cell.transparent) expect(cell.code).not.toBeNull();
    }
  });

  it('E19：调用方传入完整品牌色板时，引擎仍会排除无色号颜色', () => {
    const palette = [...getBuiltinPalette('漫漫').colors];
    const img = solidImage(20, 20, 0x55, 0x51, 0x4c); // 漫漫中该颜色 code=null
    const out = generatePattern(img, params({ targetWidth: 20, targetColorCount: 128 }), palette);

    expect(out.pattern.cells.every((cell) => cell.transparent || cell.code !== null)).toBe(true);
    expect(out.pattern.cells.some((cell) => cell.hex === '#55514C')).toBe(false);
    expect(out.stats.every((item) => item.code !== '?')).toBe(true);
  });

  it('E19：空色板与全不可用色板使用同一稳定领域错误', () => {
    const img = solidImage(1, 1, 0, 0, 0);
    expect(() => generatePattern(img, params(), [])).toThrow('palette is empty');
    expect(() =>
      generatePattern(img, params(), [{ hex: '#000000', code: null }]),
    ).toThrow('palette is empty');
  });

  it('引擎统一排除空白、问号和 UNKNOWN-* 色号，并输出裁剪后的合法色号', () => {
    const palette: PaletteColor[] = [
      { hex: '#000000', code: null },
      { hex: '#111111', code: '   ' },
      { hex: '#222222', code: '?' },
      { hex: '#333333', code: ' UNKNOWN-03 ' },
      { hex: '#FFFFFF', code: '  GOOD-1  ' },
    ];
    const out = generatePattern(
      solidImage(20, 20, 255, 255, 255),
      params({ targetWidth: 20, targetColorCount: 2 }),
      palette,
    );
    expect(out.pattern.cells.every((item) => item.transparent || item.code === 'GOOD-1')).toBe(true);
    expect(out.stats).toEqual([{ code: 'GOOD-1', hex: '#FFFFFF', count: 400 }]);
  });

  it('取消探针能中断冷启动 LUT，且不缓存半成品', () => {
    clearLutCache();
    let probes = 0;
    expect(() => generatePattern(
      solidImage(200, 200, 12, 34, 56),
      params({ targetWidth: 200 }),
      MARD,
      undefined,
      () => ++probes >= 4,
    )).toThrow(expect.objectContaining({ name: 'AbortError' }));
    expect(probes).toBe(4);
    expect(generatePattern(solidImage(4, 4, 12, 34, 56), params({ targetWidth: 20 }), MARD).pattern.width).toBe(20);
  });
});

describe('generatePattern 性质测试', () => {
  // 50 组随机输入在 CI 慢速 runner 上约 10-15s，超出默认 5s；显式放宽到 30s
  it('50 组随机输入：不抛异常、尺寸正确、输出全部在色板内、统计自洽', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const w = 1 + Math.floor(mulberry32(seed)() * 40);
      const h = 1 + Math.floor(mulberry32(seed + 1000)() * 40);
      const img = randomImage(seed + 5000, w, h, 0.25);
      const targetWidth = 20 + Math.floor(mulberry32(seed + 9000)() * 180);
      const p = params({
        targetWidth,
        targetColorCount: 2 + Math.floor(mulberry32(seed + 8000)() * 126),
        dithering: seed % 2 === 0,
        mode: seed % 3 === 0 ? 'average' : 'dominant',
        backgroundRemoval: seed % 4 === 0,
      });
      const out = generatePattern(img, p, MARD);
      expect(out.pattern.cells.length, `seed=${seed}`).toBe(out.pattern.width * out.pattern.height);
      for (const cell of out.pattern.cells) {
        if (!cell.transparent) {
          expect(MARD_HEXES.has(cell.hex!), `seed=${seed} hex=${cell.hex}`).toBe(true);
        }
      }
      const counted = out.stats.reduce((s, i) => s + i.count, 0);
      expect(out.totalBeadCount, `seed=${seed}`).toBe(counted);
      for (const item of out.stats) {
        expect(MARD_HEXES.has(item.hex)).toBe(true);
        expect(item.count).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it('确定性：同输入两次输出完全一致', () => {
    const img = randomImage(99, 33, 27, 0.3);
    const p = params({ targetWidth: 60, dithering: true, backgroundRemoval: true });
    const a = generatePattern(img, p, MARD);
    const b = generatePattern(img, p, MARD);
    expect(a).toEqual(b);
  });

  it('半透明像素（alpha<128）视为透明（E11）', () => {
    const img = solidImage(10, 10, 255, 0, 0, 127);
    const out = generatePattern(img, params(), MARD);
    expect(out.pattern.cells.every((c) => c.transparent)).toBe(true);
  });
});

describe('computeStats', () => {
  it('数量降序 + 同数量按 hex 排序 + 忽略透明/外部', () => {
    const cells: PatternCell[] = [
      { hex: '#000000', code: 'A', transparent: false },
      { hex: '#000000', code: 'A', transparent: false },
      { hex: '#FFFFFF', code: 'B', transparent: false },
      { hex: null, code: null, transparent: true },
      { hex: '#123456', code: 'C', transparent: false, external: true },
    ];
    const stats = computeStats(cells);
    expect(stats).toEqual([
      { code: 'A', hex: '#000000', count: 2 },
      { code: 'B', hex: '#FFFFFF', count: 1 },
    ]);
  });

  it('非透明制作格缺少合法色号时抛出领域错误，不生成 ? 统计项', () => {
    expect(() => computeStats([{ hex: '#123456', code: null, transparent: false }])).toThrow(
      'cell has no available color code: #123456',
    );
  });
});
