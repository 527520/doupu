/**
 * 最小 PNG 编码器（8 位 RGB，无滤波），仅依赖 node:zlib。
 * 图纸缩略图是大块纯色，filter 0 + deflate 已足够紧凑，无需引入原生图像库。
 */
import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Buffer[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      crc = CRC_TABLE[(crc ^ part[index]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBytes, data), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export interface RgbImage {
  width: number;
  height: number;
  /** 紧密 RGB 缓冲，长度 width * height * 3。 */
  data: Uint8Array;
}

export function encodeRgbPng(image: RgbImage): Buffer {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('PNG 尺寸必须是正整数');
  }
  if (data.length !== width * height * 3) throw new RangeError('RGB 数据长度与尺寸不一致');
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
