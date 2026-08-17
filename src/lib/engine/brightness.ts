/** 亮度/对比度线性变换（spec §F4.1）：out = clamp((in-128)×(1+c/100) + 128 + b×1.28)。 */
import { assertGenerationActive, clamp255, type CancellationProbe, type ImageDataLike } from './types';

export function applyBrightnessContrast(
  input: ImageDataLike,
  brightness: number,
  contrast: number,
  shouldCancel?: CancellationProbe,
): ImageDataLike {
  if (brightness === 0 && contrast === 0) return input; // 无操作时不复制（性能）
  const { data, width, height } = input;
  const out = new Uint8ClampedArray(data.length);
  const factor = 1 + contrast / 100;
  const offset = 128 + brightness * 1.28;
  for (let i = 0; i < data.length; i += 4) {
    if ((i & 0x3ffff) === 0) assertGenerationActive(shouldCancel);
    out[i] = clamp255(Math.round((data[i] - 128) * factor + offset));
    out[i + 1] = clamp255(Math.round((data[i + 1] - 128) * factor + offset));
    out[i + 2] = clamp255(Math.round((data[i + 2] - 128) * factor + offset));
    out[i + 3] = data[i + 3]; // alpha 不变
  }
  return { data: out, width, height };
}
