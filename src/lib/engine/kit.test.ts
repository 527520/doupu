import { describe, expect, it } from 'vitest';
import { KIT_TIERS, createBlankPattern, nearestInKit, paletteColorsForSelection, selectKitColors } from './kit';
import { clearLutCache } from './lut';
import { getBuiltinPalette } from '@/lib/palettes';
import type { PaletteColor } from '@/lib/types';

describe('createBlankPattern（H-2 空白起稿）', () => {
  it('给出全透明格的图纸', () => {
    const pattern = createBlankPattern(3, 2);
    expect(pattern.width).toBe(3);
    expect(pattern.height).toBe(2);
    expect(pattern.cells).toHaveLength(6);
    expect(pattern.cells.every((cell) => cell.transparent && cell.hex === null)).toBe(true);
  });

  it('非法尺寸抛错', () => {
    for (const [w, h] of [[0, 5], [5, 0], [-1, 5], [1.5, 5], [Number.NaN, 5]] as Array<[number, number]>) {
      expect(() => createBlankPattern(w, h), `${w}×${h}`).toThrow();
    }
  });
});

describe('selectKitColors（H-3 套装档位）', () => {
  const mard = [...getBuiltinPalette('MARD').engineColors];

  it('0 或大于色板容量时返回全部可用色', () => {
    expect(selectKitColors(mard, 0)).toHaveLength(mard.length);
    expect(selectKitColors(mard, 9999)).toHaveLength(mard.length);
  });

  it('按档位挑出对应数量，且保持色板原顺序', () => {
    const kit = selectKitColors(mard, 24);
    expect(kit).toHaveLength(24);
    const indices = kit.map((color) => mard.findIndex((item) => item.code === color.code));
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it('确定性：同一输入两次得到同一子集', () => {
    expect(selectKitColors(mard, 24).map((c) => c.code)).toEqual(selectKitColors(mard, 24).map((c) => c.code));
  });

  it('包含最深与最浅色（黑白是套装必备，也最影响轮廓）', () => {
    const kit = selectKitColors(mard, 24);
    const hexes = kit.map((color) => color.hex.toUpperCase());
    // MARD 含纯黑与纯白
    expect(hexes).toContain('#000000');
    expect(hexes).toContain('#FFFFFF');
  });

  it('覆盖色域而不是挤在一个色系：24 色档的色相分布明显宽于「取前 24 个色号」', () => {
    const kit = selectKitColors(mard, 24);
    const spread = (colors: PaletteColor[]): number => {
      const values = colors.map((color) => {
        const r = Number.parseInt(color.hex.slice(1, 3), 16);
        const g = Number.parseInt(color.hex.slice(3, 5), 16);
        const b = Number.parseInt(color.hex.slice(5, 7), 16);
        return Math.max(r, g, b) - Math.min(r, g, b); // 饱和度近似
      });
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread(kit)).toBeGreaterThan(spread(mard.slice(0, 24)));
  });

  it('档位常量含「不限制」与常见成品套装规格', () => {
    expect(KIT_TIERS[0]).toBe(0);
    expect(KIT_TIERS).toContain(24);
    expect(KIT_TIERS).toContain(48);
  });

  it('档位选色排除空白、问号与 UNKNOWN-* 色号，并裁剪合法色号', () => {
    const palette: PaletteColor[] = [
      { hex: '#000000', code: null },
      { hex: '#111111', code: ' ' },
      { hex: '#222222', code: '?' },
      { hex: '#333333', code: 'unknown-3' },
      { hex: '#FFFFFF', code: '  W  ' },
    ];
    expect(selectKitColors(palette, 0)).toEqual([{ hex: '#FFFFFF', code: 'W' }]);
  });
});

describe('paletteColorsForSelection', () => {
  it('仅由持久化 selection 投影出可复现的引擎颜色数组', () => {
    const palette = paletteColorsForSelection({
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 24,
    });

    expect(palette).toHaveLength(24);
    expect(palette).toEqual(selectKitColors([...getBuiltinPalette('MARD').engineColors], 24));
  });

  it('拒绝超出当前色板容量的 selection，不静默退回全色板', () => {
    expect(() => paletteColorsForSelection({
      palette: { kind: 'custom', colors: [{ code: 'A', hex: '#000000' }] },
      kitTier: 24,
    })).toThrow('套装档位超出当前色板可生成颜色数');
  });
});

describe('nearestInKit', () => {
  it('把任意颜色映射到档位内最近色', () => {
    clearLutCache();
    const kit: PaletteColor[] = [
      { hex: '#000000', code: 'K' },
      { hex: '#FFFFFF', code: 'W' },
    ];
    expect(nearestInKit('#0A0A0A', kit).code).toBe('K');
    expect(nearestInKit('#F5F5F5', kit).code).toBe('W');
  });

  it('即使调用方传入未过滤档位，也不会返回占位色号', () => {
    const kit: PaletteColor[] = [
      { hex: '#000000', code: '?' },
      { hex: '#111111', code: ' UNKNOWN-1 ' },
      { hex: '#FFFFFF', code: '  W  ' },
    ];
    expect(nearestInKit('#000000', kit)).toEqual({ hex: '#FFFFFF', code: 'W' });
    expect(() => nearestInKit('#000000', kit.slice(0, 2))).toThrow('palette is empty');
  });
});
