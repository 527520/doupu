/**
 * 浏览器端解码适配层（spec §F1）。
 * 本模块依赖 DOM API（createImageBitmap/OffscreenCanvas），无 Node 单测，
 * 真实解码断言在 E2E（ticket 20）覆盖。
 * HEIC 的 WASM 兜底（heic2any）在 ticket 07 接入，此处保留调用缝。
 */
import type { ImageType } from './sniff';
import type { ImageErrorCode } from './validation';

export interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  mime: string;
}

export type DecodeResult = { ok: true; image: DecodedImage } | { ok: false; code: ImageErrorCode };

const MIME: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

/** HEIC 原生解码能力探测（Safari 支持；其余浏览器返回 false）。 */
export async function canDecodeHeicNatively(): Promise<boolean> {
  try {
    const probe = new Uint8Array([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31,
    ]);
    await createImageBitmap(new Blob([probe], { type: 'image/heic' }));
    return true;
  } catch {
    return false;
  }
}

/**
 * TODO(ticket 07)：HEIC 的 WASM 转码兜底。当前实现直接返回 HEIC_UNSUPPORTED，
 * 由调用方在 canDecodeHeicNatively() 为 false 时调用。
 */
export async function convertHeicWithWasm(_bytes: Uint8Array): Promise<Uint8Array> {
  void _bytes; // 占位参数，ticket 07 接入 heic2any 时替换实现
  throw new Error('HEIC WASM fallback not wired yet (ticket 07)');
}

/**
 * 解码图片为 RGBA 像素（EXIF 方向按 from-image 自动转正，边界 E6）。
 */
export async function decodeImageFile(bytes: Uint8Array, type: ImageType): Promise<DecodeResult> {
  let bitmap: ImageBitmap | null = null;
  try {
    // slice() 保证类型为 Uint8Array<ArrayBuffer>（满足 BlobPart 约束），并隔离调用方缓冲区
    bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: MIME[type] }), {
      imageOrientation: 'from-image',
    });
  } catch {
    // 部分 WebKit/Safari 不支持 imageOrientation 选项（会直接抛错）：
    // 降级为不带选项的解码，保证跨浏览器可用（EXIF 方向由浏览器默认行为处理）
    try {
      bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: MIME[type] }));
    } catch {
      return { ok: false, code: type === 'heic' ? 'HEIC_UNSUPPORTED' : 'DECODE_FAILED' };
    }
  }

  try {
    // WebKit 部分构建不支持 OffscreenCanvas：回退到常规 canvas（仅浏览器环境）
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), {
            width: bitmap.width,
            height: bitmap.height,
          });
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, code: 'DECODE_FAILED' };
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const image = { data: imageData.data, width: bitmap.width, height: bitmap.height, mime: MIME[type] };
    bitmap.close();
    return { ok: true, image };
  } catch {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
    return { ok: false, code: 'DECODE_FAILED' };
  }
}
