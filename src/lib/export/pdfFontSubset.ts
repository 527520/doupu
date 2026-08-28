/**
 * PDF 中文字体的子集/全量选择（A-04）。
 *
 * 问题：过去每次冷启动导出 PDF 都要 fetch 16 437 364 字节的完整
 * NotoSansCJKsc-Regular.otf。pdf-lib 的 `subset: true` 只让**嵌入产物**变小，
 * 传输量一点没省，弱网下按钮会长时间停在「生成中」甚至超时。
 *
 * 方案：构建期预生成常用字子集（scripts/build-pdf-font-subset.mjs），
 * 运行时按本次要渲染的文本选择字体：
 * - 文本全在子集覆盖范围内（绝大多数情况）→ 下载子集；
 * - 出现覆盖范围外的生僻字（用户用生僻字命名设计）→ 回退全量字体，不掉字。
 *
 * 字符集是构建期与运行时共用的同一份 JSON 产物，避免两处定义漂移。
 */
import charsetData from './pdfSubsetCharset.json';

export const PDF_SUBSET_FONT_URL = '/fonts/NotoSansCJKsc-Regular.subset.otf';
export const PDF_FULL_FONT_URL = '/fonts/NotoSansCJKsc-Regular.otf';

let cachedCharset: Set<string> | null = null;

/** 子集覆盖的字符集合。 */
export function subsetCharset(): Set<string> {
  cachedCharset ??= new Set([...charsetData.chars]);
  return cachedCharset;
}

/**
 * 文本能否全部用子集字体渲染。
 * 空白（含换行/制表）视为可渲染；任一字符未覆盖即回退全量字体。
 */
export function coveredBySubset(text: string): boolean {
  const charset = subsetCharset();
  for (const char of text) {
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;
    if (!charset.has(char)) return false;
  }
  return true;
}

/** 本次导出该用哪个字体文件。 */
export function pdfFontUrlFor(text: string): string {
  return coveredBySubset(text) ? PDF_SUBSET_FONT_URL : PDF_FULL_FONT_URL;
}
