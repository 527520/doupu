import { describe, expect, it } from 'vitest';
import { generatePattern } from './generate';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams, type PaletteColor } from '@/lib/types';
import type { ImageDataLike } from './types';

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

const params = (targetWidth: number, targetColorCount: number): GenerationParams => ({
  ...DEFAULT_GENERATION_PARAMS,
  targetWidth,
  targetColorCount,
  mode: 'average',
});

describe('固定素材算法 golden', () => {
  it('肤色渐变按精确 Oklab 恒等映射保留四个色阶', () => {
    const palette: PaletteColor[] = [
      { code: 'SKIN-1', hex: '#F7D7C4' },
      { code: 'SKIN-2', hex: '#E8B298' },
      { code: 'SKIN-3', hex: '#C98267' },
      { code: 'SKIN-4', hex: '#8D4F3A' },
    ];
    const input = image(4, 1, (x) => {
      const rgb = palette[x].hex.match(/[0-9a-f]{2}/gi)!.map((value) => Number.parseInt(value, 16));
      return [rgb[0], rgb[1], rgb[2], 255] as const;
    });

    const output = generatePattern(input, params(4, 4), palette);
    expect(output.pattern.cells.map((cell) => cell.code)).toEqual(['SKIN-1', 'SKIN-2', 'SKIN-3', 'SKIN-4']);
  });

  it('贴边主体不会被角落共识背景误删', () => {
    const input = image(5, 5, (x, y) => (x === 0 && y >= 1 && y <= 3
      ? [255, 0, 0, 255]
      : [255, 255, 255, 255]));
    const output = generatePattern(
      input,
      { ...params(5, 2), backgroundRemoval: true, bgTolerance: 8 },
      [{ code: 'W', hex: '#FFFFFF' }, { code: 'R', hex: '#FF0000' }],
    );

    expect(output.pattern.cells.map((cell) => cell.external ? 'E' : cell.code).join(''))
      .toBe('EEEEEREEEEREEEEREEEEEEEEE');
  });

  it('透明抗锯齿的隐藏 RGB 不污染可见前景色', () => {
    const input = image(2, 1, (x) => x === 0
      ? [0, 0, 0, 0]
      : [255, 0, 0, 255]);
    const output = generatePattern(input, params(1, 1), [{ code: 'R', hex: '#FF0000' }]);

    expect(output.pattern.cells).toEqual([{ hex: '#FF0000', code: 'R', transparent: false }]);
  });

  it('像素画棋盘逐格保持确定性，不产生额外颜色', () => {
    const input = image(4, 4, (x, y) => (x + y) % 2 === 0
      ? [0, 0, 0, 255]
      : [255, 255, 255, 255]);
    const output = generatePattern(
      input,
      params(4, 2),
      [{ code: 'K', hex: '#000000' }, { code: 'W', hex: '#FFFFFF' }],
    );

    expect(output.pattern.cells.map((cell) => cell.code).join(''))
      .toBe('KWKWWKWKKWKWWKWK');
  });
});
