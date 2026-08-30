import { describe, expect, it } from 'vitest';
import { remapPattern } from './remap';
import { clearLutCache } from './lut';
import { getBuiltinPalette } from '@/lib/palettes';
import type { PaletteColor, Pattern } from '@/lib/types';

const twoColor: PaletteColor[] = [
  { hex: '#000000', code: 'K' },
  { hex: '#FFFFFF', code: 'W' },
];

function pattern(): Pattern {
  return {
    width: 2,
    height: 2,
    cells: [
      { hex: '#FF0000', code: 'R', transparent: false },
      { hex: '#FEFEFE', code: 'W0', transparent: false },
      { hex: null, code: null, transparent: true },
      { hex: '#111111', code: 'K0', transparent: false, external: true },
    ],
  };
}

describe('remapPattern（H-1 换色板重映射）', () => {
  it('逐格换成新色板里最接近的颜色，保留格子位置', () => {
    clearLutCache();
    const result = remapPattern(pattern(), twoColor);
    expect(result.pattern.width).toBe(2);
    expect(result.pattern.height).toBe(2);
    // #FEFEFE → 白；#FF0000 在黑白两色里更接近白（Oklab 亮度）或黑，只要求落在新色板内
    for (const cell of result.pattern.cells) {
      if (cell.transparent || cell.external) continue;
      expect(['#000000', '#FFFFFF']).toContain(cell.hex);
      expect(['K', 'W']).toContain(cell.code);
    }
  });

  it('透明格与背景格保持原样（不需要豆子的格子不该被染色）', () => {
    clearLutCache();
    const result = remapPattern(pattern(), twoColor);
    expect(result.pattern.cells[2]).toEqual({ hex: null, code: null, transparent: true });
    expect(result.pattern.cells[3]).toMatchObject({ external: true, hex: '#111111' });
  });

  it('统计与总粒数随之更新，且不含透明/背景格', () => {
    clearLutCache();
    const result = remapPattern(pattern(), twoColor);
    expect(result.totalBeadCount).toBe(2);
    expect(result.stats.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it('报告实际变化的格数；换成同一套色板时为 0', () => {
    clearLutCache();
    const mard = [...getBuiltinPalette('MARD').engineColors];
    const source = remapPattern(pattern(), mard);
    expect(source.changedCells).toBeGreaterThan(0);
    // 已经是该色板的图纸再映射一次不该有变化
    const again = remapPattern(source.pattern, mard);
    expect(again.changedCells).toBe(0);
  });

  it('空色板抛错（与生成路径同一不变量）', () => {
    expect(() => remapPattern(pattern(), [])).toThrow('palette is empty');
    expect(() => remapPattern(pattern(), [{ hex: '#FF0000', code: null }])).toThrow('palette is empty');
  });

  it('重映射统一排除空白、问号与 UNKNOWN-* 色号，并写入裁剪后色号', () => {
    const palette: PaletteColor[] = [
      { hex: '#000000', code: ' ' },
      { hex: '#111111', code: '?' },
      { hex: '#222222', code: 'UNKNOWN-2' },
      { hex: '#FFFFFF', code: '  W  ' },
    ];
    const result = remapPattern(pattern(), palette);
    expect(result.pattern.cells[0]).toMatchObject({ hex: '#FFFFFF', code: 'W' });
    expect(result.pattern.cells[1]).toMatchObject({ hex: '#FFFFFF', code: 'W' });
  });

  it('内置色板之间互换：色号全部来自目标色板', () => {
    clearLutCache();
    const coco = [...getBuiltinPalette('COCO').engineColors];
    const cocoCodes = new Set(coco.map((color) => color.code));
    const result = remapPattern(pattern(), coco);
    for (const cell of result.pattern.cells) {
      if (cell.transparent || cell.external) continue;
      expect(cocoCodes.has(cell.code)).toBe(true);
    }
  });
});
