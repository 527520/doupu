import { describe, expect, it } from 'vitest';
import type { Pattern, PatternCell } from '@/lib/types';
import {
  PNG_FOOTER_PADDING,
  PNG_LEGEND_BODY_FONT_MAX,
  PNG_LEGEND_BODY_FONT_MIN,
  PNG_LEGEND_ROW_MIN,
  PNG_LEGEND_SWATCH_MIN,
  createPngExportPlan,
  defaultPngTextMeasurer,
} from './pngPlan';

const transparent: PatternCell = { hex: null, code: null, transparent: true };

function coloredCell(index: number, code = `C${index.toString().padStart(3, '0')}`): PatternCell {
  return {
    hex: `#${(index + 1).toString(16).padStart(6, '0')}`,
    code,
    transparent: false,
  };
}

function patternWithColors(width: number, height: number, colorCount: number, longCodes = false): Pattern {
  const cells = Array.from({ length: width * height }, (_, index) => {
    if (colorCount === 0) return transparent;
    const colorIndex = index % colorCount;
    const code = longCodes ? `LONG-COLOR-${colorIndex.toString().padStart(9, '0')}` : undefined;
    return coloredCell(colorIndex, code);
  });
  return { width, height, cells };
}

describe('PngExportPlan', () => {
  it('空图纸不会规划任何 Canvas', () => {
    expect(createPngExportPlan(patternWithColors(2, 2, 0), { cellPx: 24 })).toEqual({ kind: 'empty' });
  });

  it.each([1, 32, 291, 500])('为 %i 色生成不缩小字号的独立 footer 布局', (colorCount) => {
    const pattern = patternWithColors(25, 20, colorCount, true);
    const plan = createPngExportPlan(pattern, {
      cellPx: 8,
      cropToContent: false,
      includeLegend: true,
    });

    expect(['single', 'split']).toContain(plan.kind);
    if (plan.kind !== 'single' && plan.kind !== 'split') return;
    expect(plan.stats).toHaveLength(colorCount);
    expect(plan.legend).not.toBeNull();
    expect(plan.legend?.padding).toBe(PNG_FOOTER_PADDING);
    expect(plan.legend?.bodyFontPx).toBeGreaterThanOrEqual(PNG_LEGEND_BODY_FONT_MIN);
    expect(plan.legend?.bodyFontPx).toBeLessThanOrEqual(PNG_LEGEND_BODY_FONT_MAX);
    expect(plan.legend?.swatchPx).toBeGreaterThanOrEqual(PNG_LEGEND_SWATCH_MIN);
    expect(plan.legend?.rowHeight).toBeGreaterThanOrEqual(PNG_LEGEND_ROW_MIN);
    expect(plan.legend?.rows).toBe(Math.ceil(colorCount / (plan.legend?.columns ?? 1)));
  });

  it.each([
    { width: 1, height: 200, cellPx: 32, expected: 'single' },
    { width: 200, height: 1, cellPx: 32, expected: 'single' },
    { width: 200, height: 200, cellPx: 16, expected: 'single' },
    { width: 200, height: 200, cellPx: 24, expected: 'too-large' },
    { width: 200, height: 200, cellPx: 32, expected: 'too-large' },
  ])('$width×$height@$cellPx 按移动端保守 Canvas 限制规划为 $expected', ({ width, height, cellPx, expected }) => {
    const plan = createPngExportPlan(patternWithColors(width, height, 32), {
      cellPx,
      cropToContent: false,
      includeLegend: true,
    });
    expect(plan.kind).toBe(expected);
  });

  it('合并画布超限但图纸与图例分别合法时规划为两张 PNG', () => {
    const plan = createPngExportPlan(patternWithColors(200, 200, 500, true), {
      cellPx: 20,
      cropToContent: false,
      includeLegend: true,
    });

    expect(plan.kind).toBe('split');
    if (plan.kind !== 'split') return;
    expect(plan.patternCanvas).toEqual({ width: 4000, height: 4000 });
    expect(plan.legendCanvas.width).toBeGreaterThanOrEqual(960);
    expect(plan.legendCanvas.height).toBe(plan.legend.height);
  });

  it('图纸本身超限时明确拒绝，不能靠缩小图例掩盖', () => {
    const plan = createPngExportPlan(patternWithColors(200, 200, 32), {
      cellPx: 48,
      cropToContent: false,
      includeLegend: true,
    });
    expect(plan).toMatchObject({ kind: 'too-large', reason: 'pattern' });
  });

  it('文字测量参与列宽，长色号不会与下一列重叠', () => {
    const measure = (text: string, fontPx: number): number => text.length * fontPx;
    const plan = createPngExportPlan(patternWithColors(20, 2, 32, true), {
      cellPx: 24,
      cropToContent: false,
      includeLegend: true,
    }, measure);

    expect(plan.kind).toBe('single');
    if (plan.kind !== 'single' || !plan.legend) return;
    expect(plan.legend.columnWidth).toBeGreaterThan(plan.legend.maxTextWidth);
    expect(plan.legend.padding * 2 + plan.legend.columns * plan.legend.columnWidth)
      .toBeLessThanOrEqual(plan.legend.width);
  });

  it('默认估算将宽 ASCII 色号按 1em 计算，不会因系统字体差异挤入下一列', () => {
    expect(defaultPngTextMeasurer('WWWWWWWWWW', 16)).toBeGreaterThanOrEqual(160);
  });
});
