/**
 * Floyd–Steinberg 误差扩散（spec §F4.2）：蛇形扫描，系数 7/16、3/16、5/16、1/16。
 * 透明像素（alpha<128）不参与量化与扩散。使用 Float64 累加器避免中间截断。
 */
import { hexToRgb } from './color';
import { clamp255, type ImageDataLike } from './types';
import { lutIndex, type Lut } from './lut';

export function floydSteinberg(input: ImageDataLike, lut: Lut): ImageDataLike {
  const { data: src, width, height } = input;
  const out = new Uint8ClampedArray(src.length);
  const acc = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) acc[i] = src[i];

  const diffuse = (targetIndex: number, weight: number, er: number, eg: number, eb: number): void => {
    if (targetIndex < 0 || targetIndex + 2 >= src.length) return;
    // 越界保护由调用方保证列范围；此处按整图索引加误差
    acc[targetIndex] += er * weight;
    acc[targetIndex + 1] += eg * weight;
    acc[targetIndex + 2] += eb * weight;
  };

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0;
    for (let k = 0; k < width; k++) {
      const x = leftToRight ? k : width - 1 - k;
      const i = (y * width + x) * 4;
      if (src[i + 3] < 128) {
        // 透明像素：原样复制，不扩散误差
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = src[i + 3];
        continue;
      }
      const r0 = clamp255(Math.round(acc[i]));
      const g0 = clamp255(Math.round(acc[i + 1]));
      const b0 = clamp255(Math.round(acc[i + 2]));
      const p = lutIndex(lut, r0, g0, b0);
      const target = hexToRgb(lut.palette[p].hex)!;
      out[i] = target.r;
      out[i + 1] = target.g;
      out[i + 2] = target.b;
      out[i + 3] = src[i + 3];

      const er = r0 - target.r;
      const eg = g0 - target.g;
      const eb = b0 - target.b;
      const dir = leftToRight ? 1 : -1;
      const sameRow = leftToRight ? x + 1 < width : x - 1 >= 0;
      const nextRow = y + 1 < height;
      if (sameRow) diffuse(i + 4 * dir, 7 / 16, er, eg, eb);
      if (nextRow) {
        const prevCol = leftToRight ? x - 1 >= 0 : x + 1 < width;
        if (prevCol) diffuse(i + width * 4 - 4 * dir, 3 / 16, er, eg, eb);
        diffuse(i + width * 4, 5 / 16, er, eg, eb);
        if (sameRow) diffuse(i + width * 4 + 4 * dir, 1 / 16, er, eg, eb);
      }
    }
  }
  return { data: out, width, height };
}
