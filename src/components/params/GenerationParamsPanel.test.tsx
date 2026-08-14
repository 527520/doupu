// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GenerationParamsPanel from './GenerationParamsPanel';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';

const builtinOptions = [
  { value: 'MARD', label: 'MARD', kind: 'builtin' as const },
  { value: 'COCO', label: 'COCO', kind: 'builtin' as const },
];

function setup(over: Partial<GenerationParams> = {}) {
  const onChange = vi.fn();
  const onPalette = vi.fn();
  render(
    <GenerationParamsPanel
      params={{ ...DEFAULT_GENERATION_PARAMS, ...over }}
      paletteOptions={builtinOptions}
      selectedPalette="MARD"
      onParamsChange={onChange}
      onPaletteSelect={onPalette}
    />,
  );
  return { onChange, onPalette };
}

/** 滑杆：label htmlFor 指向它；数字输入：aria-label + type=number（spinbutton 角色） */
const widthSlider = () => document.querySelector('#param-width') as HTMLInputElement;
const colorsSlider = () => document.querySelector('#param-colors') as HTMLInputElement;
const widthInput = () => screen.getByRole('spinbutton', { name: '目标宽度（格）' }) as HTMLInputElement;
const colorsInput = () => screen.getByRole('spinbutton', { name: '目标颜色数' }) as HTMLInputElement;

describe('GenerationParamsPanel', () => {
  it('渲染核心参数与品牌选择', () => {
    setup();
    expect(widthSlider()).toBeTruthy();
    expect(colorsSlider()).toBeTruthy();
    expect(screen.getByText('抖动')).toBeTruthy();
    expect(screen.getByLabelText('色板品牌')).toBeTruthy();
  });

  it('滑杆只能产生合法值（浏览器 min/max 约束）', () => {
    setup();
    expect(widthSlider().getAttribute('min')).toBe('20');
    expect(widthSlider().getAttribute('max')).toBe('200');
    expect(colorsSlider().getAttribute('min')).toBe('2');
    expect(colorsSlider().getAttribute('max')).toBe('128');
  });

  it('数字输入非法值时回退到当前合法值（不发出非法参数）', () => {
    const { onChange } = setup({ targetWidth: 100 });
    fireEvent.change(widthInput(), { target: { value: '300' } });
    fireEvent.blur(widthInput());
    expect(widthInput().value).toBe('100'); // 回退
    fireEvent.change(colorsInput(), { target: { value: '12.5' } });
    fireEvent.blur(colorsInput());
    expect(colorsInput().value).toBe('40');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('滑杆合法变更经 300ms 防抖上抛', () => {
    vi.useFakeTimers();
    const { onChange } = setup({ targetWidth: 100 });
    fireEvent.change(widthSlider(), { target: { value: '120' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ targetWidth: 120 }));
    vi.useRealTimers();
  });

  it('切换品牌触发 onPaletteSelect', () => {
    const { onPalette } = setup();
    const select = screen.getByLabelText('色板品牌');
    fireEvent.change(select, { target: { value: 'COCO' } });
    expect(onPalette).toHaveBeenCalledWith('COCO');
  });

  it('高级面板默认收起，展开后显示取样模式与背景去除', () => {
    setup();
    expect(screen.queryByLabelText('取样模式')).toBeNull();
    fireEvent.click(screen.getByText('高级选项'));
    expect(screen.getByLabelText('取样模式')).toBeTruthy();
    expect(screen.getByText('背景去除')).toBeTruthy();
    // 容差仅当背景去除开启时出现
    expect(screen.queryByLabelText(/背景容差/)).toBeNull();
    fireEvent.click(screen.getByText('背景去除'));
    expect(screen.getByLabelText(/背景容差/)).toBeTruthy();
  });

  it('外部参数变化时同步面板（换图场景）', () => {
    const { rerender } = render(
      <GenerationParamsPanel
        params={{ ...DEFAULT_GENERATION_PARAMS, targetWidth: 80 }}
        paletteOptions={builtinOptions}
        selectedPalette="MARD"
        onParamsChange={() => {}}
        onPaletteSelect={() => {}}
      />,
    );
    rerender(
      <GenerationParamsPanel
        params={{ ...DEFAULT_GENERATION_PARAMS, targetWidth: 60 }}
        paletteOptions={builtinOptions}
        selectedPalette="MARD"
        onParamsChange={() => {}}
        onPaletteSelect={() => {}}
      />,
    );
    expect(widthSlider().value).toBe('60');
  });
});
