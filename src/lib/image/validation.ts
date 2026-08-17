/** 图片输入校验（spec §F1，边界 E1–E4/E8/E13）。 */
import { LIMITS } from '@/lib/appInfo';
import { isAnimatedImage } from './animation';
import { readImageDimensions } from './dimensions';
import { sniffImageType, type ImageType } from './sniff';

export type ImageErrorCode =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE_FILE'
  | 'TOO_MANY_PIXELS'
  | 'ANIMATED'
  | 'DECODE_FAILED'
  | 'HEIC_UNSUPPORTED';

export interface ImageFileInput {
  bytes: Uint8Array;
  name: string;
}

export type ValidationResult = { ok: true; type: ImageType } | { ok: false; code: ImageErrorCode };

/** 文件级校验：空文件 → 大小上限 → 魔数嗅探 → 动图拒绝。 */
export function validateImageFile(file: ImageFileInput): ValidationResult {
  if (file.bytes.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (file.bytes.length > LIMITS.maxFileBytes) return { ok: false, code: 'TOO_LARGE_FILE' };
  const type = sniffImageType(file.bytes);
  if (type === 'unknown') return { ok: false, code: 'UNSUPPORTED_TYPE' };
  const dimensions = readImageDimensions(file.bytes, type);
  // Every accepted format has a bounded header-level dimension parser. If it
  // cannot establish dimensions, fail closed before any browser/WASM decoder
  // can allocate a full pixel surface for a malformed input.
  if (!dimensions) return { ok: false, code: 'DECODE_FAILED' };
  if (!validatePixelCount(dimensions.width, dimensions.height).ok) {
    return { ok: false, code: 'TOO_MANY_PIXELS' };
  }
  if (isAnimatedImage(file.bytes, type)) return { ok: false, code: 'ANIMATED' };
  return { ok: true, type };
}

/** 解码后像素总数校验（8000×8000 以内，边界 E8）。 */
export function validatePixelCount(
  width: number,
  height: number,
): { ok: true } | { ok: false; code: 'TOO_MANY_PIXELS' } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'TOO_MANY_PIXELS' };
  }
  if (width * height > LIMITS.maxPixels) return { ok: false, code: 'TOO_MANY_PIXELS' };
  return { ok: true };
}
