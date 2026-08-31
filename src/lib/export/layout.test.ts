import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_NAME,
  EXPORT_CELL_PX_DEFAULT,
  EXPORT_CELL_PX_MAX,
  EXPORT_CELL_PX_MIN,
  clampCellPx,
  pngCanvasWithinLimits,
  contentBounds,
  pngFileName,
  sanitizeFilename,
} from './layout';
import type { Pattern, PatternCell } from '@/lib/types';

const cell = (hex: string): PatternCell => ({ hex, code: 'A', transparent: false });
const transparent: PatternCell = { hex: null, code: null, transparent: true };
const external = (hex: string): PatternCell => ({ hex, code: null, transparent: false, external: true });

function makePattern(w: number, h: number, cells: PatternCell[]): Pattern {
  return { width: w, height: h, cells };
}

describe('contentBounds（包围盒）', () => {
  it('全透明 → null（E10）', () => {
    const p = makePattern(2, 2, [transparent, transparent, transparent, transparent]);
    expect(contentBounds(p)).toBeNull();
  });

  it('全外部 → null（E24 编辑后全透明/全外部的导出场景）', () => {
    const p = makePattern(2, 2, [external('#000000'), external('#000000'), external('#000000'), external('#000000')]);
    expect(contentBounds(p)).toBeNull();
  });

  it('混合透明/外部 → null', () => {
    const p = makePattern(2, 2, [transparent, external('#111111'), transparent, transparent]);
    expect(contentBounds(p)).toBeNull();
  });

  it('1×1 单格 → 含端点 {0,0,0,0}', () => {
    const p = makePattern(1, 1, [cell('#000000')]);
    expect(contentBounds(p)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  it('L 形内容取精确矩形（忽略透明与外部）', () => {
    // 3×3：内容在 (1,0)、(1,1)、(2,1)；其余透明/外部
    const p = makePattern(3, 3, [
      transparent, cell('#000000'), transparent,
      external('#FFFFFF'), cell('#000000'), cell('#000000'),
      transparent, transparent, transparent,
    ]);
    expect(contentBounds(p)).toEqual({ x0: 1, y0: 0, x1: 2, y1: 1 });
  });

  it('全图内容 → 完整边界', () => {
    const p = makePattern(2, 2, [cell('#000000'), cell('#000000'), cell('#000000'), cell('#000000')]);
    expect(contentBounds(p)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe('clampCellPx', () => {
  it('边界 8/48 原样通过；越界钳制；默认值回退', () => {    expect(clampCellPx(8)).toBe(EXPORT_CELL_PX_MIN);
    expect(clampCellPx(48)).toBe(EXPORT_CELL_PX_MAX);
    expect(clampCellPx(4)).toBe(EXPORT_CELL_PX_MIN);
    expect(clampCellPx(100)).toBe(EXPORT_CELL_PX_MAX);
    expect(clampCellPx(24)).toBe(24);
    expect(clampCellPx(NaN)).toBe(EXPORT_CELL_PX_DEFAULT);
    expect(clampCellPx(Infinity)).toBe(EXPORT_CELL_PX_DEFAULT);
    expect(clampCellPx(-Infinity)).toBe(EXPORT_CELL_PX_DEFAULT);
    expect(clampCellPx(23.5)).toBe(24); // 四舍五入
    expect(clampCellPx(23.4)).toBe(23);
  });
});

describe('sanitizeFilename（规则锁定）', () => {
  it('空/纯空白 → 未命名设计', () => {
    expect(sanitizeFilename('')).toBe(DEFAULT_DESIGN_NAME);
    expect(sanitizeFilename('   ')).toBe(DEFAULT_DESIGN_NAME);
    expect(sanitizeFilename('\t\n')).toBe(DEFAULT_DESIGN_NAME);
  });

  it('首尾空白去除', () => {
    expect(sanitizeFilename('  豆谱  ')).toBe('豆谱');
  });

  it('非法字符替换为 -（\\/:*?"<>| 与控制字符）', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeFilename('a\u0007b')).toBe('a-b');
    expect(sanitizeFilename('a\u007fb')).toBe('a-b');
  });

  it('连续 - 折叠、首尾 - 去除', () => {
    expect(sanitizeFilename('a--b')).toBe('a-b');
    expect(sanitizeFilename('---abc---')).toBe('abc');
    expect(sanitizeFilename('a///b')).toBe('a-b');
  });

  it('全部替换后为空 → 未命名设计', () => {
    expect(sanitizeFilename('///')).toBe(DEFAULT_DESIGN_NAME);
    expect(sanitizeFilename('\\\\')).toBe(DEFAULT_DESIGN_NAME);
  });

  it('超长名称截断到 60 字符（J-3 统一规则；spec §E26 允许「完整显示或截断」）', () => {
    // 100 个中文在 UTF-8 下是 300 字节，加上「豆谱-」前缀与「-100x200.pdf」后缀
    // 会接近部分文件系统/网盘的 255 字节上限，因此统一截断。
    const name = '豆'.repeat(100);
    expect(sanitizeFilename(name)).toBe('豆'.repeat(60));
    expect(sanitizeFilename('豆'.repeat(60))).toBe('豆'.repeat(60));
  });

  it('合法中文与常规字符原样保留', () => {
    expect(sanitizeFilename('小狐狸图纸 v2')).toBe('小狐狸图纸 v2');
    expect(sanitizeFilename('A.B-C_D')).toBe('A.B-C_D');
  });
});

describe('pngFileName', () => {
  it('常规名称', () => {
    expect(pngFileName('我的设计', 100, 80)).toBe('豆谱-我的设计-100x80.png');
  });

  it('空名称 → 未命名设计（E26）', () => {
    expect(pngFileName('', 20, 20)).toBe('豆谱-未命名设计-20x20.png');
    expect(pngFileName('   ', 1, 1)).toBe('豆谱-未命名设计-1x1.png');
  });

  it('非法字符名被清洗', () => {
    expect(pngFileName('a/b', 30, 30)).toBe('豆谱-a-b-30x30.png');
  });
});

describe('Canvas 安全限制', () => {
  it('在创建 Canvas 前按移动端保守交集拒绝超过 8192 边长或 4096² 像素的布局', () => {
    expect(pngCanvasWithinLimits({ width: 8192, height: 1 })).toBe(true);
    expect(pngCanvasWithinLimits({ width: 8193, height: 1 })).toBe(false);
    expect(pngCanvasWithinLimits({ width: 4096, height: 4096 })).toBe(true);
    expect(pngCanvasWithinLimits({ width: 4097, height: 4096 })).toBe(false);
  });
});
