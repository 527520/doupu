/**
 * EXIF Orientation 解析（A-16）：决定超大 JPEG 裁剪能否走解码器 source-crop。
 */
import { describe, expect, it } from 'vitest';
import { jpegCropIsOrientationSafe, readJpegOrientation } from './exifOrientation';

/** 构造一个带 APP1/EXIF 的最小 JPEG 头：orientation 可指定，字节序可切换。 */
function jpegWithOrientation(orientation: number, littleEndian = false): Uint8Array {
  const tiff: number[] = [];
  const push16 = (value: number) => {
    if (littleEndian) tiff.push(value & 0xff, (value >> 8) & 0xff);
    else tiff.push((value >> 8) & 0xff, value & 0xff);
  };
  const push32 = (value: number) => {
    if (littleEndian) tiff.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
    else tiff.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  };
  // TIFF header
  if (littleEndian) tiff.push(0x49, 0x49);
  else tiff.push(0x4d, 0x4d);
  push16(0x002a);
  push32(8); // IFD0 紧跟头部
  push16(1); // 一个条目
  push16(0x0112); // Orientation
  push16(3); // SHORT
  push32(1); // count
  push16(orientation);
  push16(0); // value 字段补齐 4 字节
  push32(0); // next IFD

  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = exif.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...exif,
    0xff, 0xda, 0x00, 0x02, // SOS
  ]);
}

describe('readJpegOrientation', () => {
  it('大端（MM）与小端（II）都能读出 Orientation', () => {
    expect(readJpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(readJpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(readJpegOrientation(jpegWithOrientation(1))).toBe(1);
    expect(readJpegOrientation(jpegWithOrientation(8, true))).toBe(8);
  });

  it('无 EXIF 的 JPEG 视为不旋转（截图/导出产物的常见形态）', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02]);
    expect(readJpegOrientation(plain)).toBe(1);
  });

  it('非 JPEG、截断与畸形段一律返回 null（调用方保守回退）', () => {
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // 段长度越界
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]))).toBeNull();
    // Orientation 值越界
    expect(readJpegOrientation(jpegWithOrientation(99))).toBeNull();
  });

  it('只有 Orientation=1 才允许 source-crop（A-16 的安全条件）', () => {
    expect(jpegCropIsOrientationSafe(jpegWithOrientation(1))).toBe(true);
    for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
      expect(jpegCropIsOrientationSafe(jpegWithOrientation(orientation))).toBe(false);
    }
    expect(jpegCropIsOrientationSafe(new Uint8Array([0x00]))).toBe(false);
  });
});
