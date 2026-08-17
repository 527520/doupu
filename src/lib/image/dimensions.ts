/** 图片自然尺寸预检：只读文件头，不解码像素。 */
import type { ImageType } from './sniff';

export interface ImageDimensions {
  width: number;
  height: number;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_SOF.has(marker)) {
      if (length < 7) return null;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

/** HEIF/HEIC stores coded image dimensions in one or more `ispe` full boxes.
 * We conservatively return the largest valid property so an oversized primary
 * image, thumbnail, grid tile, or auxiliary plane is rejected before decode. */
function heicDimensions(bytes: Uint8Array): ImageDimensions | null {
  let largest: ImageDimensions | null = null;
  let largestArea = 0;
  for (let typeOffset = 4; typeOffset + 16 <= bytes.length; typeOffset++) {
    if (
      bytes[typeOffset] !== 0x69
      || bytes[typeOffset + 1] !== 0x73
      || bytes[typeOffset + 2] !== 0x70
      || bytes[typeOffset + 3] !== 0x65
    ) continue;
    const boxStart = typeOffset - 4;
    const boxSize = u32be(bytes, boxStart);
    if (boxSize < 20 || boxStart + boxSize > bytes.length) continue;
    if (bytes[typeOffset + 4] !== 0) continue; // only defined ispe version 0
    const width = u32be(bytes, typeOffset + 8);
    const height = u32be(bytes, typeOffset + 12);
    if (width <= 0 || height <= 0) continue;
    const area = width * height;
    if (area > largestArea) {
      largest = { width, height };
      largestArea = area;
    }
  }
  return largest;
}

/** 头部不完整、尺寸非法或格式无安全预检方式时返回 null。 */
export function readImageDimensions(bytes: Uint8Array, type: ImageType): ImageDimensions | null {
  if (type === 'jpeg') return jpegDimensions(bytes);
  if (type === 'heic') return heicDimensions(bytes);
  if (type === 'webp' && bytes.length >= 16) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (chunk === 'VP8L' && bytes.length >= 24 && bytes[20] === 0x2f) {
      // Some encoders omit the final zero byte for tiny images. It can only
      // contain the high height bits; treating an absent byte as zero keeps
      // the safe small dimension while a later decoder still validates data.
      const bits = (u24le(bytes, 21) + (bytes[24] ?? 0) * 0x1000000) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (
      chunk === 'VP8 '
      && bytes.length >= 30
      && bytes[23] === 0x9d
      && bytes[24] === 0x01
      && bytes[25] === 0x2a
    ) {
      const width = u16le(bytes, 26) & 0x3fff;
      const height = u16le(bytes, 28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  if (type === 'gif' && bytes.length >= 10) {
    const width = u16le(bytes, 6);
    const height = u16le(bytes, 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (type === 'png' && bytes.length >= 24) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}
