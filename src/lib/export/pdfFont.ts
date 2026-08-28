/**
 * PDF 中文字体加载（Noto Sans SC，OFL 许可，见 public/fonts/OFL.txt 与 NOTICE.md）。
 *
 * 按本次要渲染的文本选择字体（A-04）：常用字走约 1 MB 的构建期子集，
 * 出现子集外的生僻字才回退 16 MB 全量字体。两者各自模块级缓存；失败返回 null
 * （PDF 走 ASCII 降级路径）。子集缺失（未执行 prebuild 的开发环境）时自动回退全量。
 */
import { PDF_FULL_FONT_URL, PDF_SUBSET_FONT_URL, pdfFontUrlFor } from './pdfFontSubset';

const cache = new Map<string, Promise<Uint8Array | null>>();

async function fetchFont(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function load(url: string): Promise<Uint8Array | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = fetchFont(url);
  cache.set(url, pending);
  return pending;
}

/**
 * 加载能渲染 `text` 的中文字体。
 * text 省略时按全量字体处理（调用方无法保证字符范围时的保守选择）。
 */
export async function loadPdfCjkFont(text?: string): Promise<Uint8Array | null> {
  const url = text === undefined ? PDF_FULL_FONT_URL : pdfFontUrlFor(text);
  const bytes = await load(url);
  if (bytes || url === PDF_FULL_FONT_URL) return bytes;
  // 子集文件不存在（例如未跑 prebuild 的开发环境）→ 回退全量，宁可慢也不掉字。
  cache.delete(PDF_SUBSET_FONT_URL);
  return load(PDF_FULL_FONT_URL);
}
