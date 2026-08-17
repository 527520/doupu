/** Pure image decode core shared by the browser fallback and decode Worker. */
import type { ImageType } from './sniff';
import type { ImageErrorCode } from './validation';
import { readImageDimensions } from './dimensions';

export interface DecodedImage {
  data: Uint8ClampedArray;
  /** RGBA preview-buffer dimensions (bounded for untrusted large images). */
  width: number;
  height: number;
  /** Oriented source dimensions used by crop geometry. Omitted when equal. */
  naturalWidth?: number;
  naturalHeight?: number;
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

/** Reuse ordinary ArrayBuffer-backed input without an eager Uint8Array copy. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.slice() as Uint8Array<ArrayBuffer>;
}

export function encodedImageBlob(bytes: Uint8Array, type: ImageType): Blob {
  return new Blob([asBlobPart(bytes)], { type: MIME[type] });
}

// 512² remains detailed enough for crop selection. More importantly, formats
// with orientation-stable coordinates can ask the decoder for this bounded
// bitmap directly instead of completing an 8000² bitmap on the main thread.
const PREVIEW_MAX_DIMENSION = 512;
const DIRECT_RESIZE_TYPES = new Set<ImageType>(['png', 'webp', 'gif']);

function createPixelCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
}

type PixelContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function getPixelContext(canvas: OffscreenCanvas | HTMLCanvasElement): PixelContext | null {
  return canvas.getContext('2d') as PixelContext | null;
}

function safeCloseBitmap(bitmap: ImageBitmap | null): void {
  try { bitmap?.close(); } catch { /* ignore */ }
}

async function openOrientedBitmap(
  blob: Blob,
  resize?: { resizeWidth: number; resizeHeight: number; resizeQuality: ResizeQuality },
): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image', ...resize });
  } catch {
    // Older WebKit rejects imageOrientation even though it can decode the file.
    return createImageBitmap(blob);
  }
}

/** Decode an untrusted image to a bounded, oriented crop preview. */
export async function decodeImageFile(bytes: Uint8Array, type: ImageType): Promise<DecodeResult> {
  let bitmap: ImageBitmap | null = null;
  try {
    const probed = DIRECT_RESIZE_TYPES.has(type) ? readImageDimensions(bytes, type) : null;
    const previewScale = probed
      ? Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(probed.width, probed.height))
      : 1;
    const requestedWidth = probed ? Math.max(1, Math.round(probed.width * previewScale)) : undefined;
    const requestedHeight = probed ? Math.max(1, Math.round(probed.height * previewScale)) : undefined;
    bitmap = await openOrientedBitmap(
      encodedImageBlob(bytes, type),
      requestedWidth && requestedHeight && previewScale < 1
        ? { resizeWidth: requestedWidth, resizeHeight: requestedHeight, resizeQuality: 'high' }
        : undefined,
    );
    const naturalWidth = probed?.width ?? bitmap.width;
    const naturalHeight = probed?.height ?? bitmap.height;
    const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = createPixelCanvas(width, height);
    const ctx = getPixelContext(canvas);
    if (!ctx) {
      bitmap.close();
      return { ok: false, code: 'DECODE_FAILED' };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    bitmap = null;
    const imageData = ctx.getImageData(0, 0, width, height);
    return {
      ok: true,
      image: {
        data: imageData.data,
        width,
        height,
        naturalWidth,
        naturalHeight,
        mime: MIME[type],
      },
    };
  } catch {
    safeCloseBitmap(bitmap);
    return { ok: false, code: type === 'heic' ? 'HEIC_UNSUPPORTED' : 'DECODE_FAILED' };
  }
}

/**
 * Decode an oriented natural-pixel rectangle to a bounded RGBA buffer. JPEG
 * deliberately avoids source-crop-before-orientation; orientation-stable
 * PNG/WebP/GIF can use the decoder's direct crop+resize path.
 */
export async function decodeImageRegion(
  bytes: Uint8Array,
  type: ImageType,
  rect: { x: number; y: number; width: number; height: number },
  maxDimension: number,
): Promise<DecodeResult> {
  const sourceWidth = Math.max(1, Math.round(rect.width));
  const sourceHeight = Math.max(1, Math.round(rect.height));
  const scale = Math.min(1, Math.max(1, Math.floor(maxDimension)) / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const blob = encodedImageBlob(bytes, type);
  let bitmap: ImageBitmap | null = null;
  try {
    let decoderAppliedCrop = false;
    if (DIRECT_RESIZE_TYPES.has(type)) {
      try {
        bitmap = await createImageBitmap(
          blob,
          Math.max(0, Math.round(rect.x)),
          Math.max(0, Math.round(rect.y)),
          sourceWidth,
          sourceHeight,
          { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' },
        );
        decoderAppliedCrop = true;
      } catch {
        // Older engines may reject source-crop resize options.
      }
    }
    if (!bitmap) bitmap = await openOrientedBitmap(blob);
    const canvas = createPixelCanvas(width, height);
    const ctx = getPixelContext(canvas);
    if (!ctx) throw new Error('2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (decoderAppliedCrop) {
      ctx.drawImage(bitmap, 0, 0, width, height);
    } else {
      ctx.drawImage(
        bitmap,
        Math.max(0, Math.round(rect.x)),
        Math.max(0, Math.round(rect.y)),
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );
    }
    bitmap.close();
    bitmap = null;
    const imageData = ctx.getImageData(0, 0, width, height);
    return { ok: true, image: { data: imageData.data, width, height, mime: MIME[type] } };
  } catch {
    safeCloseBitmap(bitmap);
    return { ok: false, code: type === 'heic' ? 'HEIC_UNSUPPORTED' : 'DECODE_FAILED' };
  }
}
