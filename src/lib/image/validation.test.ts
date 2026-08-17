import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateImageFile, validatePixelCount, type ImageErrorCode } from './validation';
import { zhCN } from '@/messages/zh-CN';

function fixture(name: string): Uint8Array {
  const url = new URL(`../../../tests/fixtures/${name}`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

describe('validateImageFile（边界 E1–E4/E8/E13）', () => {
  it('E1：0 字节 → EMPTY_FILE', () => {
    const r = validateImageFile({ bytes: fixture('empty.bin'), name: 'x.png' });
    expect(r).toEqual({ ok: false, code: 'EMPTY_FILE' });
  });

  it('E13：改名 .jpg 的文本 → UNSUPPORTED_TYPE', () => {
    const r = validateImageFile({ bytes: fixture('text-as-photo.jpg'), name: 'photo.jpg' });
    expect(r).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });
  });

  it('E4：动画 GIF/APNG/WebP → ANIMATED', () => {
    for (const name of ['animated-2frames.gif', 'animated-2frames.png', 'animated.webp']) {
      const r = validateImageFile({ bytes: fixture(name), name });
      expect(r, name).toEqual({ ok: false, code: 'ANIMATED' });
    }
  });

  it('E8：>20 MB → TOO_LARGE_FILE（在嗅探之前拦截）', () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const r = validateImageFile({ bytes: big, name: 'big.png' });
    expect(r).toEqual({ ok: false, code: 'TOO_LARGE_FILE' });
  });

  it('E8：从 PNG 文件头发现像素超限，在解码前拒绝', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    bytes.set([0x00, 0x00, 0x1f, 0x41, 0x00, 0x00, 0x1f, 0x40], 16); // 8001×8000
    expect(validateImageFile({ bytes, name: 'oversized.png' }))
      .toEqual({ ok: false, code: 'TOO_MANY_PIXELS' });
  });

  it('E8：从 HEIC ispe 发现像素超限，在原生/WASM 解码前拒绝', () => {
    const bytes = new Uint8Array(64);
    bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
    bytes.set([0, 0, 0, 20, 0x69, 0x73, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 0x1f, 0x41, 0, 0, 0x1f, 0x40], 24);
    expect(validateImageFile({ bytes, name: 'oversized.heic' }))
      .toEqual({ ok: false, code: 'TOO_MANY_PIXELS' });
  });

  it('合法静态图全部通过并返回正确类型', () => {
    const cases: Array<[string, string]> = [
      ['static.png', 'png'],
      ['static.webp', 'webp'],
      ['static.gif', 'gif'],
      ['static-real.heic', 'heic'],
      ['max-8000-square.png', 'png'],
      ['max-100x8000.png', 'png'],
    ];
    for (const [name, type] of cases) {
      const r = validateImageFile({ bytes: fixture(name), name });
      expect(r, name).toEqual({ ok: true, type });
    }
  });

  it('E2：已知安全尺寸但像素截断的 PNG 交给有界解码层报错', () => {
    const r = validateImageFile({ bytes: fixture('truncated.png'), name: 'broken.png' });
    expect(r).toEqual({ ok: true, type: 'png' });
  });

  it('无法从受支持格式读取自然尺寸时在解码前 fail closed', () => {
    const signatureOnly = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateImageFile({ bytes: signatureOnly, name: 'header-only.png' }))
      .toEqual({ ok: false, code: 'DECODE_FAILED' });
  });
});

describe('validatePixelCount（边界 E8）', () => {
  it('8000×8000 通过；8001×8000 拒绝', () => {
    expect(validatePixelCount(8000, 8000)).toEqual({ ok: true });
    expect(validatePixelCount(8001, 8000)).toEqual({ ok: false, code: 'TOO_MANY_PIXELS' });
    expect(validatePixelCount(8000, 8001)).toEqual({ ok: false, code: 'TOO_MANY_PIXELS' });
  });

  it('非法尺寸（0/负数/小数）拒绝', () => {
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-1, 10],
      [10.5, 10],
      [NaN, 10],
    ] as Array<[number, number]>) {
      expect(validatePixelCount(w, h), `${w}×${h}`).toEqual({ ok: false, code: 'TOO_MANY_PIXELS' });
    }
  });
});

describe('错误码 ↔ 文案映射完整性', () => {
  it('每个 ImageErrorCode 都有对应的 messages.errors 键', () => {
    const codes: ImageErrorCode[] = [
      'EMPTY_FILE',
      'UNSUPPORTED_TYPE',
      'TOO_LARGE_FILE',
      'TOO_MANY_PIXELS',
      'ANIMATED',
      'DECODE_FAILED',
      'HEIC_UNSUPPORTED',
    ];
    for (const code of codes) {
      expect(zhCN.errors[code], code).toBeTypeOf('string');
      expect((zhCN.errors[code] as string).length, code).toBeGreaterThan(0);
    }
  });
});
