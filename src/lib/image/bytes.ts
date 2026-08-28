/**
 * 字节读取小工具（J-3）：sniff.ts 与 animation.ts 此前各自复制了同一份实现。
 * 两者都在解析不可信文件头，越界必须安全返回而不是抛异常。
 */

/** 从 start 起读取 length 个字节的 ASCII 串（越界部分忽略）。 */
export function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(start + length, bytes.length);
  for (let index = start; index < end; index++) out += String.fromCharCode(bytes[index]);
  return out;
}

/** 大端 32 位无符号整数；越界字节读作 undefined → 结果为 NaN 的安全传播。 */
export function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
