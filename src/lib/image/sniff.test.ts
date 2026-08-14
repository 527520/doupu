import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sniffImageType } from './sniff';

function fixture(name: string): Uint8Array {
  const url = new URL(`../../../tests/fixtures/${name}`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

describe('sniffImageType（魔数嗅探）', () => {
  it('识别全部支持格式', () => {
    expect(sniffImageType(fixture('static.png'))).toBe('png');
    expect(sniffImageType(fixture('static.webp'))).toBe('webp');
    expect(sniffImageType(fixture('static.gif'))).toBe('gif');
    expect(sniffImageType(fixture('fake.heic'))).toBe('heic');
    // JPEG：最小魔数
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffImageType(jpeg)).toBe('jpeg');
  });

  it('改名文件按内容嗅探失败（E3）：文本改名 .jpg → unknown', () => {
    expect(sniffImageType(fixture('text-as-photo.jpg'))).toBe('unknown');
  });

  it('空内容与超短内容 → unknown', () => {
    expect(sniffImageType(new Uint8Array(0))).toBe('unknown');
    expect(sniffImageType(new Uint8Array([0xff]))).toBe('unknown');
  });

  it('损坏的 PNG 头（签名不完整）→ unknown', () => {
    const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    expect(sniffImageType(bad)).toBe('unknown');
  });

  it('RIFF 容器但非 WEBP → unknown', () => {
    const riff = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('AVI ')]);
    expect(sniffImageType(riff)).toBe('unknown');
  });

  it('HEIC 兼容品牌命中（mif1 主品牌 + heic 兼容）', () => {
    // ftyp size=24, major 'mif1', minor 0, compat 'heic','mif1'
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write('ftyp', 4, 'ascii');
    ftyp.write('mif1', 8, 'ascii');
    ftyp.write('heic', 16, 'ascii');
    ftyp.write('mif1', 20, 'ascii');
    expect(sniffImageType(new Uint8Array(ftyp))).toBe('heic');
  });
});
