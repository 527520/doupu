/** 亮度/对比度线性变换（spec §F4.1）：out = clamp((in-128)×(1+c/100) + 128 + b×1.28)。 */
import { clamp255, type ImageDataLike } from './types';

export function applyBrightnessContrast(
  input: ImageDataLike,
  brightness: number,
  contrast: number,
): ImageDataLike {
  if (brightness === 0 && contrast === 0) return input; // 无操作时不复制（性能）
  const { data, width, height } = input;
  const out = new Uint8ClampedArray(data.length);
  const factor = 1 + contrast / 100;
  const offset = 128 + brightness * 1.28;
  for (let i = 0; i < data.length; i += 4) {
    out[i] = clamp255(Math.round((data[i] - 128) * factor + offset));
    out[i + 1] = clamp255(Math.round((data[i + 1] - 128) * factor + offset));
    out[i + 2] = clamp255(Math.round((data[i + 2] - 128) * factor + offset));
    out[i + 3] = data[i + 3]; // alpha 不变
  }
  return { data: out, width, height };
}
