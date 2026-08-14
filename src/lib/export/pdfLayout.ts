/**
 * PDF 分页拼图的纯布局计算（spec §F7 PDF 部分；边界 E25/E26/E27）。
 * 与 pdf-lib 解耦：几何分页、页眉文本、文本宽度估算/截断、图例排序、文件名规则都在此层，
 * 全部可单测；pdf.ts 只做绘制与文档组装。
 */

export const PDF_CELL_MM = 6;
export const PDF_PAGE_COLS = 31;
export const PDF_PAGE_ROWS = 45;
// 物理自洽（常量自洽测试锁定）：2×8 + 10(页眉) + 45×6 = 296 ≤ 297（A4 高）；2×8 + 31×6 = 202 ≤ 210（A4 宽）
export const PDF_MARGIN_MM = 8;
export const PDF_HEADER_MM = 10;
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const MM_TO_PT = 72 / 25.4;
export const UNTITLED_NAME = '未命名设计';

export interface PdfPageSpec {
  /** 0-based 图纸页序号 */
  pageIndex: number;
  /** 图纸页总数（不含图例页） */
  totalPages: number;
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
}

export interface PdfLayout {
  gridPages: PdfPageSpec[];
  /** 图例页为最后一页（0-based） */
  legendPageIndex: number;
  /** 总页数 = 图纸页 + 图例页 */
  totalPages: number;
}

/** 分页计算：每页 31 列 × 45 行；页数 = ceil(W/31) × ceil(H/45)；另加 1 页图例清单。 */
export function computePdfLayout(W: number, H: number): PdfLayout {
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1) {
    return { gridPages: [], legendPageIndex: 0, totalPages: 1 };
  }
  const pageCols = Math.ceil(W / PDF_PAGE_COLS);
  const pageRows = Math.ceil(H / PDF_PAGE_ROWS);
  const gridPages: PdfPageSpec[] = [];
  for (let pr = 0; pr < pageRows; pr++) {
    for (let pc = 0; pc < pageCols; pc++) {
      const colStart = pc * PDF_PAGE_COLS;
      const rowStart = pr * PDF_PAGE_ROWS;
      gridPages.push({
        pageIndex: gridPages.length,
        totalPages: pageCols * pageRows,
        colStart,
        rowStart,
        cols: Math.min(PDF_PAGE_COLS, W - colStart),
        rows: Math.min(PDF_PAGE_ROWS, H - rowStart),
      });
    }
  }
  return { gridPages, legendPageIndex: gridPages.length, totalPages: gridPages.length + 1 };
}

/** 页眉文本（spec：第 x/y 页、行列区间；坐标为 1-based 闭区间）。 */
export function pageHeaderText(page: PdfPageSpec): string {
  const colEnd = page.colStart + page.cols;
  const rowEnd = page.rowStart + page.rows;
  return `第 ${page.pageIndex + 1}/${page.totalPages} 页 · 列 ${page.colStart + 1}–${colEnd} · 行 ${page.rowStart + 1}–${rowEnd}`;
}

/** 全局板缝位置（每 29 格，落在当前页区间内才绘制）。 */
export function seamPositionsForPage(page: PdfPageSpec): { cols: number[]; rows: number[] } {
  const cols: number[] = [];
  const rows: number[] = [];
  for (let s = 29; s < page.colStart + page.cols; s += 29) {
    if (s > page.colStart) cols.push(s);
  }
  for (let s = 29; s < page.rowStart + page.rows; s += 29) {
    if (s > page.rowStart) rows.push(s);
  }
  return { cols, rows };
}

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * 文本宽度估算（pt）：CJK 全角记 1em，其余记 0.55em。
 * 用于无字体测量环境（纯模块）下的截断判定；pdf.ts 中另有 pdf-lib 精确宽度兜底。
 */
export function estimateTextWidthPt(text: string, fontSizePt: number): number {
  let units = 0;
  for (const ch of text) units += CJK_RE.test(ch) ? 1 : 0.55;
  return units * fontSizePt;
}

/** 超宽文本截断（附加省略号，保证估算宽度 ≤ maxWidthPt；连省略号都放不下时返回 ''）。 */
export function truncateTextToWidth(
  text: string,
  fontSizePt: number,
  maxWidthPt: number,
  ellipsis = '…',
): string {
  if (estimateTextWidthPt(text, fontSizePt) <= maxWidthPt) return text;
  if (estimateTextWidthPt(ellipsis, fontSizePt) > maxWidthPt) return '';
  let out = '';
  for (const ch of text) {
    if (estimateTextWidthPt(out + ch + ellipsis, fontSizePt) > maxWidthPt) break;
    out += ch;
  }
  return out + ellipsis;
}

/**
 * WinAnsi 安全化：StandardFonts.Helvetica 仅支持 WinAnsi，
 * 中文等字符渲染为垃圾，绘制前统一替换为 '?'（升级路径：嵌入 CJK 字体后移除本层）。
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x20 && code <= 0x7e ? ch : '?';
  }
  return out;
}

/** 图例/清单排序（spec：数量降序；同数量按 hex 升序；不修改入参）。 */
export function sortStatsForLegend<T extends { count: number; hex: string }>(stats: readonly T[]): T[] {
  return [...stats].sort((a, b) => {
    const d = b.count - a.count;
    return d !== 0 ? d : a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });
}

/** 图例列数：每项 ≥30mm 宽，最多 6 列（保证 291 色单页放得下）。 */
export function legendColumns(usableMm: number): number {
  return Math.min(6, Math.max(1, Math.floor(usableMm / 30)));
}

const ILLEGAL_FILENAME_RE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 设计名清洗：非法文件名字符替换为 '_'，折叠重复，裁剪首尾，限长 60。 */
export function sanitizeFilenamePart(name: string): string {
  return name
    .trim()
    .replace(ILLEGAL_FILENAME_RE, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/** 导出文件名（与 PNG 同规则，spec E26）：豆谱-<设计名>-<W>x<H>.<ext>；空名用「未命名设计」。 */
export function buildExportFilename(name: string, W: number, H: number, ext = 'pdf'): string {
  const part = sanitizeFilenamePart(name) || UNTITLED_NAME;
  return `豆谱-${part}-${W}x${H}.${ext}`;
}
