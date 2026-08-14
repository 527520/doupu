import { describe, expect, it } from 'vitest';
import { hexToRgb, oklabDistance, rgbToHex } from './color';

describe('color 工具', () => {
  it('hexToRgb：合法解析、大小写不敏感、非法返回 null', () => {
    expect(hexToRgb('#FAF4C8')).toEqual({ r: 250, g: 244, b: 200 });
    expect(hexToRgb('#faf4c8')).toEqual({ r: 250, g: 244, b: 200 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#FFF')).toBeNull();
    expect(hexToRgb('#GGGGGG')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('rgbToHex：格式化与越界钳制', () => {
    expect(rgbToHex({ r: 250, g: 244, b: 200 })).toBe('#FAF4C8');
    expect(rgbToHex({ r: -5, g: 300, b: 12.6 })).toBe('#00FF0D');
  });

  it('oklabDistance：同色为 0；黑白距离 = 100（公式自校验）；对称', () => {
    expect(oklabDistance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toBe(0);
    const bw = oklabDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(bw).toBeCloseTo(100, 5);
    const a = oklabDistance({ r: 10, g: 20, b: 30 }, { r: 200, g: 100, b: 50 });
    const b = oklabDistance({ r: 200, g: 100, b: 50 }, { r: 10, g: 20, b: 30 });
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeGreaterThan(0);
  });
});
