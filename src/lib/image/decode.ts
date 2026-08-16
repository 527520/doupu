/**
 * 浏览器端解码适配层（spec §F1）。
 * 本模块依赖 DOM API（createImageBitmap/OffscreenCanvas）：jsdom 下用桩做契约级单测（decode.test.ts），
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
 * HEIC 的 WASM 转码兜底（优化票 05）：接入 heic2any（libheif 内联打包、无外部 CDN 依赖），
 * 由调用方在 canDecodeHeicNatively() 为 false 时调用。
 * 转换失败（损坏文件/不支持）上抛，由调用方映射为 HEIC_UNSUPPORTED 友好文案。
 * 动态 import：1.3MB 的转换组件只在真正需要时下载，不进首屏包。
 */
export async function convertHeicWithWasm(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: heic2any } = await import('heic2any');
  const blob = new Blob([bytes.slice()], { type: 'image/heic' });
  const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
  const out = Array.isArray(result) ? result[0] : result;
  if (!out) throw new Error('HEIC 转换无输出');
  return new Uint8Array(await out.arrayBuffer());
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
