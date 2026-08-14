/**
 * 15-bit RGB LUT（spec §F4.2）：32768 项，每项为调色板中最近色下标。
 * 构建时把调色板颜色预转换为 Oklab，随后仅做平方距离比较（性能关键路径）。
 * LUT 仅依赖色板内容，按色板 hex 列表做模块级缓存（确定性，测试可 clearLutCache）。
 */
import { hexToRgb, oklabSquaredDistance, rgbToOklab, type Oklab } from './color';
import type { PaletteColor } from '@/lib/types';

export interface Lut {
  /** 长度 32768；下标 = (r>>3)<<10 | (g>>3)<<5 | (b>>3) */
  indices: Int32Array;
  palette: PaletteColor[];
}

/** 5-bit 通道值扩展回 8-bit（复制高位）。 */
function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}

function buildLutUncached(palette: PaletteColor[]): Lut {
  if (palette.length === 0) throw new Error('palette is empty');
  const indices = new Int32Array(32768);
  const paletteOklabs: Oklab[] = palette.map((p) => {
    const rgb = hexToRgb(p.hex);
    if (!rgb) throw new Error(`invalid palette hex: ${p.hex}`);
    return rgbToOklab(rgb);
  });

  for (let r5 = 0; r5 < 32; r5++) {
    for (let g5 = 0; g5 < 32; g5++) {
      for (let b5 = 0; b5 < 32; b5++) {
        const idx = (r5 << 10) | (g5 << 5) | b5;
        const target = rgbToOklab({ r: expand5(r5), g: expand5(g5), b: expand5(b5) });
        let best = 0;
        let bestDistance = Infinity;
        for (let p = 0; p < paletteOklabs.length; p++) {
          const d = oklabSquaredDistance(target, paletteOklabs[p]);
          if (d < bestDistance) {
            bestDistance = d;
            best = p;
          }
        }
        indices[idx] = best;
      }
    }
  }
  return { indices, palette };
}

const lutCache = new Map<string, Lut>();

export function buildLut(palette: PaletteColor[]): Lut {
  const key = palette.map((p) => p.hex).join(',');
  const cached = lutCache.get(key);
  if (cached) return cached;
  const lut = buildLutUncached(palette);
  lutCache.set(key, lut);
  return lut;
}

/** 清空 LUT 缓存（测试隔离用）。 */
export function clearLutCache(): void {
  lutCache.clear();
}

/** 查表：RGB（0–255）→ 调色板下标。 */
export function lutIndex(lut: Lut, r: number, g: number, b: number): number {
  return lut.indices[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}
