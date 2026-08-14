import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAnimatedImage } from './animation';
import { sniffImageType } from './sniff';

function fixture(name: string): Uint8Array {
  const url = new URL(`../../../tests/fixtures/${name}`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

function animated(bytes: Uint8Array): boolean {
  const type = sniffImageType(bytes);
  if (type === 'unknown') throw new Error('fixture 无法嗅探类型');
  return isAnimatedImage(bytes, type);
}

describe('isAnimatedImage（边界 E4）', () => {
  it('GIF：两帧为动图、一帧为静图', () => {
    expect(animated(fixture('animated-2frames.gif'))).toBe(true);
    expect(animated(fixture('static.gif'))).toBe(false);
  });

  it('APNG：含 acTL 为动图，普通 PNG 为静图', () => {
    expect(animated(fixture('animated-2frames.png'))).toBe(true);
    expect(animated(fixture('static.png'))).toBe(false);
  });

  it('WebP：VP8X 动画标志为动图，VP8L 为静图', () => {
    expect(animated(fixture('animated.webp'))).toBe(true);
    expect(animated(fixture('static.webp'))).toBe(false);
  });

  it('JPEG/HEIC 恒为静图', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(isAnimatedImage(jpeg, 'jpeg')).toBe(false);
    expect(isAnimatedImage(fixture('fake.heic'), 'heic')).toBe(false);
  });

  it('截断/损坏文件不抛异常，返回 false', () => {
    expect(() => animated(fixture('truncated.png'))).not.toThrow();
    expect(animated(fixture('truncated.png'))).toBe(false);
    expect(isAnimatedImage(new Uint8Array([0x89, 0x50]), 'png')).toBe(false);
    expect(isAnimatedImage(new Uint8Array(0), 'gif')).toBe(false);
  });

  it('acTL 出现在 IDAT 之后不算动图（APNG 规范）', () => {
    // 手工构造：PNG 签名 + IDAT(0字节) + acTL(8字节) —— 不规范但需按「acTL 必须在 IDAT 前」判为 false
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
    };
    const bytes = new Uint8Array(Buffer.concat([sig, mk('IDAT', Buffer.alloc(0)), mk('acTL', Buffer.alloc(8))]));
    expect(isAnimatedImage(bytes, 'png')).toBe(false);
  });
});
