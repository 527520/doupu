// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GenerationParamsPanel from './GenerationParamsPanel';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import userEvent from '@testing-library/user-event';

const builtinOptions = [
  {
    value: 'builtin:mard-classic', brand: 'MARD', series: '豆谱经典 291 色', colors: ['#fff000'],
    collectedCount: 291, usableCount: 291, sourceQuality: '固定数据', boardProfiles: ['5mm / 29×29'], defaultForBrand: true,
  },
  {
    value: 'builtin:mard-public', brand: 'MARD', series: '291 色公开资料版', colors: ['#00ff00'],
    collectedCount: 291, usableCount: 291, sourceQuality: '公开资料', boardProfiles: ['5mm / 29×29'], defaultForBrand: false,
  },
  {
    value: 'builtin:coco-classic', brand: 'COCO', series: '豆谱经典 291 色', colors: ['#0000ff'],
    collectedCount: 291, usableCount: 291, sourceQuality: '固定数据', boardProfiles: ['5mm / 29×29'], defaultForBrand: true,
  },
];

function setup(over: Partial<GenerationParams> = {}) {
  const onChange = vi.fn();
  const onPalette = vi.fn();
  render(
    <GenerationParamsPanel
      params={{ ...DEFAULT_GENERATION_PARAMS, ...over }}
      paletteOptions={builtinOptions}
      selectedPalette="builtin:mard-classic"
      onParamsChange={onChange}
      onPaletteSelect={onPalette}
      boardProfileOptions={[
        { value: '5mm-29', label: '5mm / 29×29', boardSize: 29 },
        { value: '2.6mm-50', label: '2.6mm / 50×50', boardSize: 50 },
      ]}
      selectedBoardProfile="5mm-29"
      onBoardProfileSelect={vi.fn()}
      paletteColorCount={291}
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
    expect(screen.queryByRole('switch', { name: '抖动' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('高级选项'));
    expect(screen.getByRole('switch', { name: '抖动' })).toBeVisible();
    expect(screen.getByLabelText('色板品牌')).toBeTruthy();
    expect(screen.getByLabelText('色板系列')).toBeTruthy();
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

  it('切换品牌触发 onPaletteSelect', async () => {
    const { onPalette } = setup();
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:/色板品牌/}));
    await user.click(screen.getByRole('option',{name:'COCO'}));
    expect(onPalette).toHaveBeenCalledTimes(1);
    expect(onPalette).toHaveBeenCalledWith('builtin:coco-classic');
  });

  it('按品牌分组色板，并切换独立制作规格', async () => {
    const onBoardProfileSelect = vi.fn();
    render(
      <GenerationParamsPanel
        params={DEFAULT_GENERATION_PARAMS}
        paletteOptions={builtinOptions}
        selectedPalette="builtin:mard-classic"
        onParamsChange={vi.fn()}
        onPaletteSelect={vi.fn()}
        boardProfileOptions={[
          { value: '5mm-29', label: '5mm / 29×29', boardSize: 29 },
          { value: '2.6mm-50', label: '2.6mm / 50×50', boardSize: 50 },
        ]}
        selectedBoardProfile="5mm-29"
        onBoardProfileSelect={onBoardProfileSelect}
        paletteColorCount={197}
      />,
    );

    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:/色板品牌/}));
    expect(screen.getAllByRole('option').map(option=>option.querySelector('[slot=label]')?.textContent)).toEqual([
      'MARD',
      'COCO',
    ]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button',{name:/色板系列/}));
    expect(screen.getAllByRole('option').map(option=>option.querySelector('[slot=label]')?.textContent)).toEqual([
      '豆谱经典 291 色',
      '291 色公开资料版',
    ]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button',{name:/制作规格/}));
    await user.click(screen.getByRole('option',{name:'2.6mm / 50×50'}));
    expect(onBoardProfileSelect).toHaveBeenCalledWith('2.6mm-50');
  });

  it('全部颜色和套装档位随当前可生成色数变化', async () => {
    render(
      <GenerationParamsPanel
        params={DEFAULT_GENERATION_PARAMS}
        paletteOptions={builtinOptions}
        selectedPalette="builtin:mard-classic"
        onParamsChange={vi.fn()}
        onPaletteSelect={vi.fn()}
        boardProfileOptions={[{ value: '5mm-29', label: '5mm / 29×29', boardSize: 29 }]}
        selectedBoardProfile="5mm-29"
        onBoardProfileSelect={vi.fn()}
        paletteColorCount={70}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button',{name:/手里的套装/}));
    expect(screen.getAllByRole('option').map(option=>option.querySelector('[slot=label]')?.textContent)).toEqual([
      '全部可生成颜色（70 色）',
      '24 色套装',
      '48 色套装',
    ]);
  });

  it('高级面板默认收起，展开后显示取样模式与背景去除', () => {
    setup();
    expect(screen.queryByRole('group',{name:'取样模式'})).toBeNull();
    fireEvent.click(screen.getByText('高级选项'));
    expect(screen.getByRole('group',{name:'取样模式'})).toBeTruthy();
    expect(screen.getByText('背景去除')).toBeTruthy();
    // 容差仅当背景去除开启时出现
    expect(screen.queryByLabelText(/背景容差/)).toBeNull();
    fireEvent.click(screen.getByText('背景去除'));
    expect(screen.getByLabelText(/背景容差/)).toBeTruthy();
  });

  it('背景去除可显式指定背景原型颜色并防抖上抛', () => {
    vi.useFakeTimers();
    try {
      const { onChange } = setup();
      fireEvent.click(screen.getByText('高级选项'));
      fireEvent.click(screen.getByText('背景去除'));
      fireEvent.click(screen.getByText('手动指定背景色'));
      const color = screen.getByLabelText('背景原型颜色');
      fireEvent.change(color, { target: { value: '#ff0000' } });
      act(() => vi.advanceTimersByTime(300));

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        backgroundRemoval: true,
        backgroundPrototype: '#FF0000',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('可直接点击原图预览取样背景原型颜色', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(
        <GenerationParamsPanel
          params={DEFAULT_GENERATION_PARAMS}
          paletteOptions={builtinOptions}
        selectedPalette="builtin:mard-classic"
        onParamsChange={onChange}
        onPaletteSelect={vi.fn()}
        boardProfileOptions={[{ value: '5mm-29', label: '5mm / 29×29', boardSize: 29 }]}
        selectedBoardProfile="5mm-29"
        onBoardProfileSelect={vi.fn()}
        paletteColorCount={291}
          backgroundSampleSource={{
            width: 2,
            height: 1,
            data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
          }}
        />,
      );
      fireEvent.click(screen.getByText('高级选项'));
      fireEvent.click(screen.getByText('背景去除'));
      fireEvent.click(screen.getByText('手动指定背景色'));
      const sampler = screen.getByLabelText('在原图中取样背景色');
      vi.spyOn(sampler, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, toJSON: () => ({}),
      });
      fireEvent.click(sampler, { clientX: 75, clientY: 25 });
      act(() => vi.advanceTimersByTime(300));

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        backgroundRemoval: true,
        backgroundPrototype: '#00FF00',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('外部参数变化时同步面板（换图场景）', () => {
    const { rerender } = render(
      <GenerationParamsPanel
        params={{ ...DEFAULT_GENERATION_PARAMS, targetWidth: 80 }}
        paletteOptions={builtinOptions}
        selectedPalette="builtin:mard-classic"
        onParamsChange={() => {}}
        onPaletteSelect={() => {}}
        boardProfileOptions={[{ value: '5mm-29', label: '5mm / 29×29', boardSize: 29 }]}
        selectedBoardProfile="5mm-29"
        onBoardProfileSelect={() => {}}
        paletteColorCount={291}
      />,
    );
    rerender(
      <GenerationParamsPanel
        params={{ ...DEFAULT_GENERATION_PARAMS, targetWidth: 60 }}
        paletteOptions={builtinOptions}
        selectedPalette="builtin:mard-classic"
        onParamsChange={() => {}}
        onPaletteSelect={() => {}}
        boardProfileOptions={[{ value: '5mm-29', label: '5mm / 29×29', boardSize: 29 }]}
        selectedBoardProfile="5mm-29"
        onBoardProfileSelect={() => {}}
        paletteColorCount={291}
      />,
    );
    expect(widthSlider().value).toBe('60');
  });
});
