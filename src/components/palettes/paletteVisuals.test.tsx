// @vitest-environment jsdom
/**
 * 色板可视化（批次 E）：色带取样规则、可展开色格、编辑器取色器。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ColorBand, { sampleColors } from './ColorBand';
import PaletteSwatches from './PaletteSwatches';
import PaletteEditor from './PaletteEditor';
import { zhCN } from '@/messages/zh-CN';
import { buildBrandPalette } from '@/lib/palettes';
import type { PaletteColor } from '@/lib/types';

describe('ColorBand 取样（E-1）', () => {
  it('少于上限时原样保留顺序', () => {
    expect(sampleColors(['#000000', '#FFFFFF'], 24)).toEqual(['#000000', '#FFFFFF']);
  });

  it('超过上限时等间距抽样，而不是只取开头的同色系', () => {
    const colors = Array.from({ length: 100 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`);
    const sampled = sampleColors(colors, 10);
    expect(sampled).toHaveLength(10);
    expect(sampled[0]).toBe(colors[0]);
    expect(sampled[9]).toBe(colors[90]);
    // 抽样必须跨越整个色板（品牌色板按色号排序，取前 N 个会得到一片灰白）
    expect(new Set(sampled).size).toBe(10);
  });

  it('有 label 时作为图像暴露给读屏，否则视为装饰', () => {
    const { rerender } = render(<ColorBand colors={['#FF0000']} label="漫德 291 色" />);
    expect(screen.getByRole('img', { name: '漫德 291 色' })).toBeTruthy();
    rerender(<ColorBand colors={['#FF0000']} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('空色板不渲染', () => {
    const { container } = render(<ColorBand colors={[]} label="空" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('PaletteSwatches（E-1）', () => {
  const palette: PaletteColor[] = buildBrandPalette('MARD');

  it('默认只显示色带，展开后铺出全部色格并带色号', () => {
    render(<PaletteSwatches name="MARD" colors={palette} />);
    expect(screen.getByRole('img', { name: zhCN.palettes.bandAria('MARD', palette.length) })).toBeTruthy();
    expect(screen.queryByLabelText(`${palette[0].code} ${palette[0].hex}`)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: zhCN.palettes.showColors }));
    expect(screen.getByLabelText(`${palette[0].code} ${palette[0].hex}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.palettes.hideColors })).toBeTruthy();
  });
});

describe('PaletteEditor 取色器（E-2）', () => {
  it('每行都有取色器，改色会同步 hex 文本框', () => {
    render(
      <PaletteEditor
        initialName="我的色板"
        initialColors={[{ code: 'A', hex: '#FF0000' }]}
        saving={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const picker = screen.getByLabelText(`${zhCN.palettes.editor.pickColor} 1`) as HTMLInputElement;
    expect(picker.type).toBe('color');
    expect(picker.value).toBe('#ff0000');

    fireEvent.change(picker, { target: { value: '#00ff00' } });
    expect((screen.getByLabelText(`${zhCN.palettes.editor.hex} 1`) as HTMLInputElement).value).toBe('#00FF00');
  });

  it('hex 非法时取色器回落到白色而不是崩溃', () => {
    render(
      <PaletteEditor
        initialName="我的色板"
        initialColors={[{ code: 'A', hex: 'not-a-hex' }]}
        saving={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(`${zhCN.palettes.editor.pickColor} 1`) as HTMLInputElement).value).toBe('#ffffff');
  });
});
