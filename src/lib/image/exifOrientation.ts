/**
 * EXIF Orientation 读取（A-16）。
 *
 * 为什么需要：`decodeImageRegion` 对 JPEG 有意避开「解码器直接 source-crop」这条路，
 * 因为裁剪坐标是相对**已按 EXIF 旋转后**的图，先按源坐标裁再旋转会错位。代价是
 * 接近上限的 JPEG（8000×8000）裁剪时要在 Worker 里解出完整位图，约 256 MB RGBA，
 * 移动端只会拿到一句「解码失败」。
 *
 * 事实是：绝大多数 JPEG 的 Orientation 是 1（或压根没有 EXIF），这时源坐标与
 * 显示坐标一致，可以安全走 source-crop 省掉整幅位图。只有真的带旋转标记时才回退。
 *
 * 实现只解析到 IFD0 的 0x0112 标签，不引入 EXIF 库；解析失败一律当作「未知」，
 * 由调用方保守回退。
 */

/** 1 表示不旋转不镜像；null 表示无 EXIF 或解析失败（按未知处理）。 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null;

function u16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** 从 TIFF 头（"II"/"MM" 起）解析 IFD0 的 Orientation。 */
function readTiffOrientation(bytes: Uint8Array, tiffStart: number): ExifOrientation {
  if (tiffStart + 8 > bytes.length) return null;
  const byteOrder = u16(bytes, tiffStart, false);
  const littleEndian = byteOrder === 0x4949; // "II"
  if (!littleEndian && byteOrder !== 0x4d4d) return null; // 既不是 II 也不是 MM
  if (u16(bytes, tiffStart + 2, littleEndian) !== 0x002a) return null;
  const ifdOffset = u32(bytes, tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > bytes.length) return null;
  const entryCount = u16(bytes, ifdStart, littleEndian);
  // 条目数畸形（超过剩余字节能容纳的数量）时放弃解析。
  if (entryCount <= 0 || ifdStart + 2 + entryCount * 12 > bytes.length) return null;
  for (let i = 0; i < entryCount; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (u16(bytes, entry, littleEndian) !== 0x0112) continue;
    const value = u16(bytes, entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? (value as ExifOrientation) : null;
  }
  return 1; // 有 IFD0 但没有 Orientation 标签 → 等同于不旋转
}

/**
 * 读取 JPEG 的 EXIF Orientation。
 * 无 EXIF（常见于导出/截图产物）返回 1；解析不出来返回 null。
 */
export function readJpegOrientation(bytes: Uint8Array): ExifOrientation {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // 段结构异常
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // 到了扫描数据或图像结束，说明前面没有 APP1/EXIF
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = u16(bytes, offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xe1 && length >= 8) {
      const header = offset + 4;
      const isExif = bytes[header] === 0x45 && bytes[header + 1] === 0x78 && bytes[header + 2] === 0x69
        && bytes[header + 3] === 0x66 && bytes[header + 4] === 0x00;
      if (isExif) return readTiffOrientation(bytes, header + 6);
    }
    offset += 2 + length;
  }
  return 1;
}

/** 该 JPEG 是否可以安全地走「解码器源坐标裁剪」路径（无旋转/镜像）。 */
export function jpegCropIsOrientationSafe(bytes: Uint8Array): boolean {
  return readJpegOrientation(bytes) === 1;
}
