/**
 * 导出文件名的唯一规则（J-3）。
 *
 * 此前有两套实现：`export/layout.ts` 把非法字符换成 `-` 且不截断，
 * `export/pdfLayout.ts` 换成 `_` 且截断 60 字符——同一个设计名导出的
 * PNG 与 PDF 会得到不同文件名（名字含 `:` 时一个是 `-` 一个是 `_`），
 * 而 pdfLayout 的注释还写着「与 PNG 同规则」。
 *
 * 统一规则：
 * 1. 去首尾空白；为空 → 未命名设计；
 * 2. 非法字符（\/:*?"<>| 与控制字符）→ `-`；
 * 3. 连续 `-` 折叠为一个；4. 去掉首尾 `-`；
 * 5. 截断到 60 字符——设计名上限 100 个字符，中文在 UTF-8 下是 3 字节，
 *    连上「豆谱-」前缀与「-100x200.pdf」后缀会接近 320 字节，超过部分文件系统
 *    与网盘的 255 字节上限（spec §E26 允许「完整显示或截断」）；
 * 6. 结果为空 → 未命名设计。
 */
export const DEFAULT_DESIGN_NAME = '未命名设计';

/** 截断上限：见文件头说明（255 字节文件名上限下的安全值）。 */
export const FILENAME_PART_MAX = 60;

const ILLEGAL_FILENAME_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export function sanitizeFilename(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return DEFAULT_DESIGN_NAME;
  const cleaned = trimmed
    .replace(ILLEGAL_FILENAME_RE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILENAME_PART_MAX)
    // 截断可能又在末尾留下分隔符
    .replace(/-+$/g, '');
  return cleaned.length === 0 ? DEFAULT_DESIGN_NAME : cleaned;
}

/** 导出文件名：豆谱-<设计名>-<W>x<H>.<ext>（PNG/PDF/项目文件共用）。 */
export function buildExportFilename(name: string, width: number, height: number, ext = 'pdf'): string {
  return `豆谱-${sanitizeFilename(name)}-${width}x${height}.${ext}`;
}
