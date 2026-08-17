/**
 * Floyd–Steinberg 误差扩散（spec §F4.2）：蛇形扫描，系数 7/16、3/16、5/16、1/16。
 * 透明像素（alpha<128）不参与量化与扩散。误差只会流向当前行和下一行，
 * 因此使用两条 Float64 滚动行，避免分配/初始化随整图面积增长的累加器。
 */
import { assertGenerationActive, clamp255, type CancellationProbe, type ImageDataLike } from './types';
import { lutIndex, type Lut } from './lut';

export function floydSteinberg(input: ImageDataLike, lut: Lut, shouldCancel?: CancellationProbe): ImageDataLike {
  const { data: src, width, height } = input;
  const out = new Uint8ClampedArray(src.length);
  let currentError = new Float64Array(width * 3);
  let nextError = new Float64Array(width * 3);

  for (let y = 0; y < height; y++) {
    assertGenerationActive(shouldCancel);
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
      const errorIndex = x * 3;
      const r0 = clamp255(Math.round(src[i] + currentError[errorIndex]));
      const g0 = clamp255(Math.round(src[i + 1] + currentError[errorIndex + 1]));
      const b0 = clamp255(Math.round(src[i + 2] + currentError[errorIndex + 2]));
      const p = lutIndex(lut, r0, g0, b0);
      const target = lut.paletteRgbs[p];
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
      if (sameRow) {
        const ahead = (x + dir) * 3;
        currentError[ahead] += er * (7 / 16);
        currentError[ahead + 1] += eg * (7 / 16);
        currentError[ahead + 2] += eb * (7 / 16);
      }
      if (nextRow) {
        const prevCol = leftToRight ? x - 1 >= 0 : x + 1 < width;
        if (prevCol) {
          const behind = (x - dir) * 3;
          nextError[behind] += er * (3 / 16);
          nextError[behind + 1] += eg * (3 / 16);
          nextError[behind + 2] += eb * (3 / 16);
        }
        nextError[errorIndex] += er * (5 / 16);
        nextError[errorIndex + 1] += eg * (5 / 16);
        nextError[errorIndex + 2] += eb * (5 / 16);
        if (sameRow) {
          const ahead = (x + dir) * 3;
          nextError[ahead] += er * (1 / 16);
          nextError[ahead + 1] += eg * (1 / 16);
          nextError[ahead + 2] += eb * (1 / 16);
        }
      }
    }
    const consumed = currentError;
    currentError = nextError;
    nextError = consumed;
    nextError.fill(0);
  }
  return { data: out, width, height };
}
