// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PalettePicker, { type PalettePickerOption } from './PalettePicker';

const options: readonly PalettePickerOption[] = [
  {
    value: 'builtin:mard-classic',
    brand: 'MARD',
    series: '豆谱经典 291 色',
    colors: ['#ffffff', '#000000'],
    collectedCount: 291,
    usableCount: 291,
    sourceQuality: '豆谱经典固定数据',
    boardProfiles: ['5mm / 29×29'],
    technicalVersion: 'doupu-legacy-v1',
    defaultForBrand: true,
  },
  {
    value: 'builtin:mard-public',
    brand: 'MARD',
    series: '291 色公开资料版',
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    collectedCount: 291,
    usableCount: 291,
    sourceQuality: '公开资料核对',
    boardProfiles: ['5mm / 29×29'],
    technicalVersion: '178dafbc9e77d3de556550dbd058270200129186',
    defaultForBrand: false,
  },
  {
    value: 'builtin:coco-classic',
    brand: 'COCO',
    series: '豆谱经典 291 色',
    colors: ['#fefefe', '#010101'],
    collectedCount: 291,
    usableCount: 289,
    sourceQuality: '豆谱经典固定数据',
    boardProfiles: ['5mm / 29×29'],
    technicalVersion: 'doupu-legacy-v1',
    defaultForBrand: true,
  },
];

describe('PalettePicker', () => {
  it('把品牌与系列拆成两个原生选择器，并用色带卡片展示选择依据', () => {
    render(
      <PalettePicker
        options={options}
        value="builtin:mard-public"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: '色板品牌' })).toHaveValue('MARD');
    expect(screen.getByRole('combobox', { name: '色板系列' })).toHaveValue('builtin:mard-public');
    expect(screen.getByRole('img', { name: 'MARD 291 色公开资料版色带' })).toBeTruthy();
    expect(screen.getByText('收录 291 色')).toBeTruthy();
    expect(screen.getByText('可生成 291 色')).toBeTruthy();
    expect(screen.getByText('适用 5mm / 29×29')).toBeTruthy();
    const technicalDetails = screen.getByText('数据版本').closest('details');
    expect(technicalDetails).not.toBeNull();
    expect(technicalDetails?.open).toBe(false);
  });

  it('切换品牌只提交该品牌的一个稳定系列值', () => {
    const onSelect = vi.fn();
    render(
      <PalettePicker
        options={options}
        value="builtin:mard-public"
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '色板品牌' }), {
      target: { value: 'COCO' },
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('builtin:coco-classic');
  });

  it('品牌默认系列由显式标记决定，不依赖选项数组顺序', () => {
    const onSelect = vi.fn();
    const reordered = [options[0], options[1], {
      ...options[2], value: 'builtin:coco-public', series: 'COCO 公开版', defaultForBrand: false,
    }, options[2]];
    render(<PalettePicker options={reordered} value="builtin:mard-public" onSelect={onSelect} />);

    fireEvent.change(screen.getByRole('combobox', { name: '色板品牌' }), {
      target: { value: 'COCO' },
    });

    expect(onSelect).toHaveBeenCalledWith('builtin:coco-classic');
  });

  it('切回我的色板时恢复本会话上次选择而不依赖 ID 或选项顺序', () => {
    const onSelect = vi.fn();
    const customOptions: readonly PalettePickerOption[] = [
      ...options,
      {
        ...options[0],
        value: 'custom:z-last',
        brand: '我的色板',
        series: '暖色组',
        defaultForBrand: false,
      },
      {
        ...options[0],
        value: 'custom:a-first',
        brand: '我的色板',
        series: '冷色组',
        defaultForBrand: false,
      },
    ];
    const view = render(
      <PalettePicker options={customOptions} value="custom:z-last" onSelect={onSelect} />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '色板品牌' }), {
      target: { value: 'MARD' },
    });
    expect(onSelect).toHaveBeenLastCalledWith('builtin:mard-classic');
    view.rerender(
      <PalettePicker options={customOptions} value="builtin:mard-classic" onSelect={onSelect} />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '色板品牌' }), {
      target: { value: '我的色板' },
    });
    expect(onSelect).toHaveBeenLastCalledWith('custom:z-last');
  });

  it('从未选择过且没有默认项的品牌只展开系列，不自动改动项目色板', () => {
    const onSelect = vi.fn();
    const customOptions: readonly PalettePickerOption[] = [
      ...options,
      {
        ...options[0],
        value: 'custom:z-last',
        brand: '我的色板',
        series: '暖色组',
        defaultForBrand: false,
      },
      {
        ...options[0],
        value: 'custom:a-first',
        brand: '我的色板',
        series: '冷色组',
        defaultForBrand: false,
      },
    ];
    render(
      <PalettePicker options={customOptions} value="builtin:mard-classic" onSelect={onSelect} />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '色板品牌' }), {
      target: { value: '我的色板' },
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '色板品牌' })).toHaveValue('我的色板');
    expect(screen.getByRole('combobox', { name: '色板系列' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: '色板系列' }), {
      target: { value: 'custom:a-first' },
    });
    expect(onSelect).toHaveBeenCalledWith('custom:a-first');
  });

  it('受控值不在选项中时明确显示不可用，不伪装成第一套色板', () => {
    render(<PalettePicker options={options} value="custom:deleted" onSelect={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('当前色板不可用');
    expect(screen.queryByRole('img', { name: /色带/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: '色板品牌' })).toHaveValue('');
  });

  it('切换同品牌系列时原样提交稳定值', () => {
    const onSelect = vi.fn();
    render(
      <PalettePicker
        options={options}
        value="builtin:mard-classic"
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '色板系列' }), {
      target: { value: 'builtin:mard-public' },
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('builtin:mard-public');
  });
});
