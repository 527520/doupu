/** 动图检测（spec 边界 E4）：GIF 多帧 / APNG / 动画 WebP。解析失败一律返回 false（不抛异常）。 */
import type { ImageType } from './sniff';
import { ascii, readU32BE } from './bytes';

export function isAnimatedImage(bytes: Uint8Array, type: ImageType): boolean {
  switch (type) {
    case 'gif':
      return countGifFrames(bytes) > 1;
    case 'png':
      return hasApngAnimation(bytes);
    case 'webp':
      return hasWebpAnimation(bytes);
    default:
      return false;
  }
}

/** GIF 帧计数：遍历块结构，统计图像描述符（0x2C）数量。结构异常时返回已统计数。 */
function countGifFrames(bytes: Uint8Array): number {
  if (bytes.length < 14) return 1;
  const lsdPacked = bytes[10];
  const hasGct = (lsdPacked & 0x80) !== 0;
  const gctBytes = hasGct ? 3 * (2 << (lsdPacked & 0x07)) : 0;
  let off = 13 + gctBytes;
  let frames = 0;

  const skipSubBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length && bytes[p] !== 0x00) {
      p += 1 + bytes[p];
    }
    return p + 1; // 跳过 0x00 终止符
  };

  while (off < bytes.length) {
    const block = bytes[off];
    if (block === 0x3b) break; // trailer
    if (block === 0x2c) {
      frames++;
      off += 9; // left2 top2 w2 h2 → 落在 packed 字节
      const packed = bytes[off];
      off += 1; // 跳过 packed
      const hasLct = (packed & 0x80) !== 0;
      if (hasLct) off += 3 * (2 << (packed & 0x07));
      off += 1; // LZW 最小码长
      off = skipSubBlocks(off);
      continue;
    }
    if (block === 0x21) {
      off = skipSubBlocks(off + 2); // 扩展标签 + 块大小
      continue;
    }
    return frames; // 未知块，安全退出
  }
  return frames;
}

/** APNG 检测：acTL chunk 必须先于 IDAT 出现。 */
function hasApngAnimation(bytes: Uint8Array): boolean {
  if (bytes.length < 41) return false;
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = readU32BE(bytes, off);
    const type = ascii(bytes, off + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    if (len > bytes.length - off - 12) return false; // 截断/损坏
    off += 12 + len;
  }
  return false;
}

/** 动画 WebP 检测：ANIM chunk 或 VP8X 的动画标志位（bit 1）。 */
function hasWebpAnimation(bytes: Uint8Array): boolean {
  if (bytes.length < 21) return false;
  let off = 12; // 跳过 RIFF 头（RIFF + size + WEBP）
  while (off + 8 <= bytes.length) {
    const type = ascii(bytes, off, 4);
    const size = readU32BE(bytes, off + 4);
    if (type === 'ANIM') return true;
    if (type === 'VP8X') {
      if (off + 9 <= bytes.length && (bytes[off + 8] & 0x02) !== 0) return true;
    }
    off += 8 + size + (size & 1); // RIFF 子块按偶数字节对齐
  }
  return false;
}
