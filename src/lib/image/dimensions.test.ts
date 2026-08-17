import { describe, expect, it } from 'vitest';
import { readImageDimensions } from './dimensions';

describe('readImageDimensions', () => {
  it('在解码前从 PNG IHDR 读取尺寸', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    bytes.set([0x00, 0x00, 0x1f, 0x40, 0x00, 0x00, 0x0f, 0xa0], 16); // 8000×4000
    expect(readImageDimensions(bytes, 'png')).toEqual({ width: 8000, height: 4000 });
  });

  it('跳过 JPEG APP 段并从 SOF 读取尺寸', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x0f, 0xa0, 0x1f, 0x40, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    expect(readImageDimensions(bytes, 'jpeg')).toEqual({ width: 8000, height: 4000 });
  });

  it('从 GIF 逻辑屏幕描述符读取小端尺寸', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x1f, 0xa0, 0x0f]);
    expect(readImageDimensions(bytes, 'gif')).toEqual({ width: 8000, height: 4000 });
  });

  it('从扩展 WebP VP8X 头读取 24 位尺寸', () => {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    bytes.set([0x3f, 0x1f, 0x00, 0x9f, 0x0f, 0x00], 24); // (7999+1)×(3999+1)
    expect(readImageDimensions(bytes, 'webp')).toEqual({ width: 8000, height: 4000 });
  });

  it('从无损 WebP VP8L 头读取位包尺寸', () => {
    const bytes = new Uint8Array(25);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]);
    bytes[20] = 0x2f;
    const bits = (7999 | (3999 << 14)) >>> 0;
    bytes.set([bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 21);
    expect(readImageDimensions(bytes, 'webp')).toEqual({ width: 8000, height: 4000 });
  });

  it('从有损 WebP VP8 关键帧头读取尺寸', () => {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
    bytes.set([0x9d, 0x01, 0x2a], 23);
    bytes.set([0x40, 0x1f, 0xa0, 0x0f], 26);
    expect(readImageDimensions(bytes, 'webp')).toEqual({ width: 8000, height: 4000 });
  });

  it('从 HEIC ispe 属性读取最大自然尺寸，不解码 RGBA', () => {
    const bytes = new Uint8Array(64);
    // Minimal ftyp brand so the fixture resembles an ISO BMFF HEIC file.
    bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
    // ispe full box: size/type/version+flags/width/height.
    bytes.set([0, 0, 0, 20, 0x69, 0x73, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 0x1f, 0x41, 0, 0, 0x1f, 0x40], 24);
    expect(readImageDimensions(bytes, 'heic')).toEqual({ width: 8001, height: 8000 });
  });

  it('忽略损坏或伪造的 HEIC ispe 字节串', () => {
    const bytes = new Uint8Array([0x69, 0x73, 0x70, 0x65, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(readImageDimensions(bytes, 'heic')).toBeNull();
  });
});
