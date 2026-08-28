/** 图片类型嗅探（魔数优先；spec §F1）。 */
export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif' | 'heic';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif']);

import { ascii, readU32BE } from './bytes';

/** 检查 ISO-BMFF ftyp 盒的主品牌与兼容品牌是否属于 HEIF/HEIC。 */
function isHeifBrand(bytes: Uint8Array): boolean {
  const major = ascii(bytes, 8, 4);
  if (HEIF_BRANDS.has(major)) return true;
  const boxSize = readU32BE(bytes, 0);
  if (boxSize < 16 || boxSize > bytes.length) return false;
  for (let off = 16; off + 4 <= boxSize; off += 4) {
    if (HEIF_BRANDS.has(ascii(bytes, off, 4))) return true;
  }
  return false;
}

/**
 * 按魔数嗅探图片类型；无法识别返回 'unknown'。
 * 不做扩展名兜底：改名文件（如文本改名 .jpg）必须按内容嗅探失败（spec 边界 E3）。
 */
export function sniffImageType(bytes: Uint8Array): ImageType | 'unknown' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    return 'png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 6) {
    const gif = ascii(bytes, 0, 6);
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  }
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp' && isHeifBrand(bytes)) {
    return 'heic';
  }
  return 'unknown';
}
