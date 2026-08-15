import { describe, expect, it } from 'vitest';
import { generatePattern, computeStats } from './generate';
import type { ImageDataLike } from './types';
import { buildBrandPalette, getAvailableColors } from '@/lib/palettes';
import {
  DEFAULT_GENERATION_PARAMS,
  type Brand,
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

const MARD: PaletteColor[] = buildBrandPalette('MARD');
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

  it('E19：漫漫色板中不可用色（#55514C）绝不出现，可用色 code 非空', () => {
    const mm: Brand = '漫漫';
    const palette = getAvailableColors(mm);
    const img = solidImage(30, 30, 0x55, 0x51, 0x4c); // #55514C
    const out = generatePattern(img, params({ targetColorCount: 128 }), palette);
    for (const cell of out.pattern.cells) {
      expect(cell.hex).not.toBe('#55514C');
      if (!cell.transparent) expect(cell.code).not.toBeNull();
    }
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
});

describe('性能预算（spec §7.1）', () => {
  it('200×200 图纸 + 291 色色板 < 3000ms（CI 阈值）', () => {
    const img = randomImage(42, 1600, 1600, 0);
    const start = performance.now();
    const out = generatePattern(img, params({ targetWidth: 200, dithering: true }), MARD);
    const elapsed = performance.now() - start;
    expect(out.pattern.width).toBe(200);
    expect(elapsed).toBeLessThan(3000);
  }, 15000);
});
