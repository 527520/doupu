/**
 * 整数盒式降采样（性能预算关键路径，spec §7.1）：
 * 当图片任一维超过 maxDim 时，把图片缩小到 ≤ maxDim（保持比例、不放大），
 * 使抖动/采样工作量与图纸格数成正比；具体每格采样密度由调用方传入 maxDim 控制。
 * 使用连续覆盖面积和预乘 alpha 做盒式平均；区域无有效 alpha → 透明。
 */
import { assertGenerationActive, type CancellationProbe, type ImageDataLike } from './types';

export function downscaleBox(input: ImageDataLike, maxDim: number, shouldCancel?: CancellationProbe): ImageDataLike {
  const { width: w, height: h } = input;
  if (Math.max(w, h) <= maxDim) return input;
  const scale = Math.max(w, h) / maxDim;
  const dw = Math.max(1, Math.ceil(w / scale));
  const dh = Math.max(1, Math.ceil(h / scale));
  const out = new Uint8ClampedArray(dw * dh * 4);

  for (let y = 0; y < dh; y++) {
    assertGenerationActive(shouldCancel);
    const sourceY0 = (y * h) / dh;
    const sourceY1 = ((y + 1) * h) / dh;
    const y0 = Math.floor(sourceY0);
    const y1 = Math.ceil(sourceY1);
    for (let x = 0; x < dw; x++) {
      const sourceX0 = (x * w) / dw;
      const sourceX1 = ((x + 1) * w) / dw;
      const x0 = Math.floor(sourceX0);
      const x1 = Math.ceil(sourceX1);
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaWeight = 0;
      for (let yy = y0; yy < y1; yy++) {
        const overlapY = Math.max(0, Math.min(sourceY1, yy + 1) - Math.max(sourceY0, yy));
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          const alpha = input.data[i + 3] / 255;
          if (alpha === 0) continue;
          const overlapX = Math.max(0, Math.min(sourceX1, xx + 1) - Math.max(sourceX0, xx));
          const weight = overlapX * overlapY * alpha;
          r += input.data[i] * weight;
          g += input.data[i + 1] * weight;
          b += input.data[i + 2] * weight;
          alphaWeight += weight;
        }
      }
      const o = (y * dw + x) * 4;
      if (alphaWeight === 0) {
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(r / alphaWeight);
        out[o + 1] = Math.round(g / alphaWeight);
        out[o + 2] = Math.round(b / alphaWeight);
        const area = (sourceX1 - sourceX0) * (sourceY1 - sourceY0);
        out[o + 3] = Math.round((alphaWeight / area) * 255);
      }
    }
  }
  return { data: out, width: dw, height: dh };
}
