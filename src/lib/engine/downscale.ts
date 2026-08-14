/**
 * 整数盒式降采样（性能预算关键路径，spec §7.1）：
 * 当图片任一维超过 maxDim 时，把图片缩小到 ≤ maxDim（保持比例、不放大），
 * 使抖动/采样工作量与图纸格数成正比（每格最多 8×8 像素，足以保证采样质量）。
 * alpha≥128 的像素参与 RGB 平均；区域无有效像素 → 透明。确定性整数运算。
 */
import { type ImageDataLike } from './types';

export function downscaleBox(input: ImageDataLike, maxDim: number): ImageDataLike {
  const { width: w, height: h } = input;
  if (Math.max(w, h) <= maxDim) return input;
  const scale = Math.max(w, h) / maxDim;
  const dw = Math.max(1, Math.ceil(w / scale));
  const dh = Math.max(1, Math.ceil(h / scale));
  const out = new Uint8ClampedArray(dw * dh * 4);

  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * h) / dh);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * w) / dw);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * w) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          if (input.data[i + 3] < 128) continue;
          r += input.data[i];
          g += input.data[i + 1];
          b += input.data[i + 2];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (n === 0) {
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
      }
    }
  }
  return { data: out, width: dw, height: dh };
}
